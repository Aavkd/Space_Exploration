import { cloneRpgValue } from './state.js';
import {
    COMBAT_ENCOUNTER_ID,
    COMBAT_ENEMY_FACTION_ID,
    COMBAT_ENEMY_ID,
    COMBAT_MAX_HISTORY,
    COMBAT_SYSTEM_ID,
    COMBAT_WRECK_ID,
    sanitizeCombatState
} from './combat.js';

export const COMBAT_FIXED_STEP = 1 / 60;
export const COMBAT_MAX_STEPS = 8;
export const COMBAT_WEAPON_ID = 'tier2_pulse_laser';
export const COMBAT_ENEMY_WEAPON_ID = 'tier2_raider_pulse';
export const COMBAT_HARDPOINT_IDS = Object.freeze(['pulse_port', 'pulse_starboard']);
export const COMBAT_SYSTEM_DAMAGE_IDS = Object.freeze([
    'engine', 'hyperdrive', 'sensors', 'comms', 'life_support', 'weapons'
]);
export const COMBAT_WEAPON = Object.freeze({
    id: COMBAT_WEAPON_ID,
    projectileSpeed: 900,
    range: 650,
    cooldown: 0.22,
    heatPerShot: 0.22,
    coolingPerSecond: 0.30,
    hullDamage: 8,
    systemDamage: 12,
    projectileLifetime: 1.2
});
export const COMBAT_ENEMY_WEAPON = Object.freeze({
    id: COMBAT_ENEMY_WEAPON_ID,
    projectileSpeed: 620,
    range: 520,
    cooldown: 1.5,
    hullDamage: 4,
    systemDamage: 6,
    projectileLifetime: 1.6
});
export const COMBAT_LIMITS = Object.freeze({
    detectionRange: 850,
    attackRange: 520,
    disengageRange: 1200,
    disengageSeconds: 3,
    retreatHull: 24,
    maxProjectiles: 32,
    lockConeCos: Math.cos(35 * Math.PI / 180)
});
export const COMBAT_WARNING_DELAY = 10;
export const COMBAT_ATTACK_GRACE = 5;

export class CombatRuntime {
    constructor({
        slots,
        rpg,
        getGameTime = () => 0,
        now = () => new Date().toISOString()
    } = {}) {
        if (!slots) throw new Error('CombatRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('CombatRuntime requires an RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        sanitizeCombatState(this.rpg.getState().combat);
        this.activeSystemId = null;
        this.accumulator = 0;
        this.sequence = 1;
        this.active = false;
        this.combatMode = false;
        this.phase = 'idle';
        this.enemy = null;
        this.targets = new Map();
        this.targetId = null;
        this.projectiles = [];
        this.player = createBody('player_ship', 'player', [0, 0, 0]);
        this.hardpoints = COMBAT_HARDPOINT_IDS.map((id) => ({ id, cooldown: 0, heat: 0 }));
        this.nextHardpoint = 0;
        this.disengageTimer = 0;
        this.feedback = [];
        this.hooks = {};
        this.encounterElapsed = 0;
        this.warningIssued = false;
        this.attackEnabled = false;
    }

    syncSystem(systemId) {
        if (systemId !== null && typeof systemId !== 'string') {
            throw new Error('Combat system ID must be a string or null.');
        }
        if (this.activeSystemId === systemId) return this.getState();
        this.cleanup('system-change');
        this.activeSystemId = systemId;
        const saved = sanitizeCombatState(this.rpg.getState().combat);
        if (systemId === COMBAT_SYSTEM_ID && saved.enemy.disposition !== 'destroyed') {
            this._spawnEnemy();
        }
        return this.getState();
    }

    setCombatMode(enabled) {
        this.combatMode = Boolean(enabled);
        if (!this.combatMode) this.targetId = null;
        this._feedback('combat.mode.changed', { enabled: this.combatMode });
        return this.getState();
    }

    toggleCombatMode() {
        return this.setCombatMode(!this.combatMode);
    }

    reload() {
        const systemId = this.activeSystemId;
        this.cleanup('reload');
        this.activeSystemId = null;
        return this.syncSystem(systemId);
    }

    setOutcomeHooks(hooks = {}) {
        const allowed = ['mission', 'reputation', 'crew', 'salvage'];
        for (const key of Object.keys(hooks)) {
            if (!allowed.includes(key)) throw new Error(`Unknown combat outcome hook: ${key}`);
            if (hooks[key] !== null && typeof hooks[key] !== 'function') {
                throw new Error(`Combat outcome hook ${key} must be a function or null.`);
            }
        }
        this.hooks = { ...this.hooks, ...hooks };
        return Object.keys(this.hooks).filter((key) => typeof this.hooks[key] === 'function');
    }

    getState() {
        return cloneRpgValue({
            available: true,
            activeSystemId: this.activeSystemId,
            combatMode: this.combatMode,
            warningIssued: this.warningIssued,
            warningDelayRemaining: this.active && !this.warningIssued
                ? Math.max(0, COMBAT_WARNING_DELAY - this.encounterElapsed)
                : 0,
            attackGraceRemaining: this.active && this.warningIssued && !this.attackEnabled
                ? Math.max(0, COMBAT_WARNING_DELAY + COMBAT_ATTACK_GRACE - this.encounterElapsed)
                : 0,
            encounterId: this.active ? COMBAT_ENCOUNTER_ID : null,
            active: this.active,
            phase: this.phase,
            targetId: this.targetId,
            target: this.getTargetTelemetry(),
            enemy: this.enemy,
            hardpoints: this.hardpoints,
            projectiles: this.projectiles,
            projectileCount: this.projectiles.length,
            feedback: this.feedback.slice(-12),
            saved: sanitizeCombatState(this.rpg.getState().combat)
        });
    }

    getTargetTelemetry() {
        if (!this.targetId) return null;
        const target = this.targets.get(this.targetId);
        if (!target || target.hull <= 0) return null;
        const relative = sub(target.position, this.player.position);
        const distance = length(relative);
        return {
            id: target.id,
            relation: target.relation,
            locked: true,
            range: distance,
            inRange: distance <= COMBAT_WEAPON.range,
            lead: calculateInterceptPoint(
                this.player.position,
                target.position,
                target.velocity,
                COMBAT_WEAPON.projectileSpeed
            )
        };
    }

    cycleTarget() {
        if (!this.combatMode) throw new Error('Target lock requires combat mode.');
        const valid = [...this.targets.values()]
            .filter((target) => target.relation === 'hostile' && target.hull > 0)
            .sort((a, b) => a.id.localeCompare(b.id));
        if (!valid.length) {
            this.targetId = null;
            throw new Error('No hostile combat target is available.');
        }
        const index = valid.findIndex((target) => target.id === this.targetId);
        const target = valid[(index + 1) % valid.length];
        const direction = normalize(sub(target.position, this.player.position));
        if (dot(direction, normalize(this.player.forward)) < COMBAT_LIMITS.lockConeCos) {
            this.targetId = null;
            throw new Error(`Combat target ${target.id} is outside the 35 degree lock cone.`);
        }
        this.targetId = target.id;
        this._feedback('target.locked', { targetId: target.id });
        return this.getTargetTelemetry();
    }

    clearTarget() {
        this.targetId = null;
    }

    update(dt, input = {}) {
        const elapsed = Number(dt);
        if (!Number.isFinite(elapsed) || elapsed < 0) {
            throw new Error('Combat update dt must be a non-negative finite number.');
        }
        this._syncPlayer(input);
        this.accumulator = Math.min(this.accumulator + elapsed, COMBAT_FIXED_STEP * COMBAT_MAX_STEPS);
        let steps = 0;
        while (this.accumulator >= COMBAT_FIXED_STEP && steps < COMBAT_MAX_STEPS) {
            this._step(COMBAT_FIXED_STEP, input);
            this.accumulator -= COMBAT_FIXED_STEP;
            steps += 1;
        }
        return this.getState();
    }

    fire() {
        if (!this.combatMode) throw new Error('Combat weapon fire requires combat mode.');
        if (!this.active) throw new Error('Combat weapon fire requires an active encounter.');
        const telemetry = this.getTargetTelemetry();
        if (!telemetry) throw new Error('Combat weapon fire requires a hostile target lock.');
        if (!telemetry.inRange) throw new Error(`Combat target ${telemetry.id} is out of weapon range.`);
        const condition = this.slots.getActiveEnvelope().ship.condition.systems.weapons.condition;
        if (condition <= 0) throw new Error('Combat weapons are disabled at zero condition.');
        const hardpoint = this.hardpoints[this.nextHardpoint];
        if (hardpoint.cooldown > 0) throw new Error(`Weapon hardpoint ${hardpoint.id} is cooling down.`);
        if (hardpoint.heat + COMBAT_WEAPON.heatPerShot > 1) {
            throw new Error(`Weapon hardpoint ${hardpoint.id} is overheated.`);
        }
        if (this.projectiles.length >= COMBAT_LIMITS.maxProjectiles) {
            throw new Error('Combat projectile limit reached.');
        }
        hardpoint.cooldown = COMBAT_WEAPON.cooldown;
        hardpoint.heat = Math.min(1, hardpoint.heat + COMBAT_WEAPON.heatPerShot);
        const projectile = this._createProjectile({
            ownerId: this.player.id,
            targetId: telemetry.id,
            origin: this.player.position,
            aim: telemetry.lead,
            hardpointId: hardpoint.id
        });
        this.projectiles.push(projectile);
        this.nextHardpoint = (this.nextHardpoint + 1) % this.hardpoints.length;
        this._feedback('weapon.fired', { projectileId: projectile.id, hardpointId: hardpoint.id });
        return cloneRpgValue(projectile);
    }

    addTargetForDebug({ id, relation = 'neutral', position = [0, 0, -100] } = {}) {
        if (typeof id !== 'string' || !id) throw new Error('Debug combat target requires a stable ID.');
        if (!['friendly', 'neutral', 'hostile'].includes(relation)) {
            throw new Error(`Unknown combat target relation: ${relation}`);
        }
        const body = createBody(id, relation, position);
        this.targets.set(id, body);
        return cloneRpgValue(body);
    }

    applyHitForDebug({
        sourceId = 'debug',
        targetId,
        projectileId = 'shot-debug-000001',
        weaponId = COMBAT_WEAPON_ID
    } = {}) {
        return this._applyHit({ sourceId, targetId, projectileId, weaponId });
    }

    claimWreckSalvage() {
        const rpg = this.rpg.getState();
        const combat = sanitizeCombatState(rpg.combat);
        if (combat.enemy.disposition !== 'destroyed') {
            throw new Error(`Combat wreck ${COMBAT_WRECK_ID} requires destroyed enemy ${COMBAT_ENEMY_ID}.`);
        }
        if (combat.wreck.claimed) return { changed: false, state: this.getState() };
        const envelope = this.slots.getActiveEnvelope();
        const ship = envelope.ship;
        if (ship.inventory.repairParts > 997 || ship.inventory.hullPlates > 998) {
            throw new Error('Combat wreck salvage would exceed repair inventory capacity.');
        }
        const gameTime = this._gameTime();
        ship.inventory.repairParts += 2;
        ship.inventory.hullPlates += 1;
        combat.wreck.claimed = true;
        combat.wreck.claimedAtGameTime = gameTime;
        rpg.combat = combat;
        appendEvent(rpg, 'combat.salvage.claimed', {
            encounterId: COMBAT_ENCOUNTER_ID,
            enemyId: COMBAT_ENEMY_ID,
            sourceId: COMBAT_WRECK_ID,
            repairParts: 2,
            hullPlates: 1
        }, this.now());
        this._commit(ship, rpg, 'combat-wreck-salvaged');
        this._invokeHook('salvage', { sourceId: COMBAT_WRECK_ID, repairParts: 2, hullPlates: 1 });
        return { changed: true, state: this.getState() };
    }

    rescueAfterDefeat() {
        if (this.phase !== 'defeated') throw new Error('Combat rescue requires a defeated encounter.');
        const envelope = this.slots.getActiveEnvelope();
        const ship = envelope.ship;
        ship.condition.hull.current = Math.max(25, ship.condition.hull.current);
        ship.condition.systems.engine.condition = Math.max(25, ship.condition.systems.engine.condition);
        this._finish('defeat', ship, envelope.rpg, 'combat-defeat-rescue');
        return this.getState();
    }

    cleanup(reason = 'manual') {
        const hadTransientState = this.active || this.enemy || this.projectiles.length || this.targetId;
        this.active = false;
        this.phase = 'idle';
        this.enemy = null;
        this.targets.clear();
        this.targetId = null;
        this.projectiles = [];
        this.disengageTimer = 0;
        this.accumulator = 0;
        this.encounterElapsed = 0;
        this.warningIssued = false;
        this.attackEnabled = false;
        if (hadTransientState) this._feedback('combat.cleaned', { reason });
        return hadTransientState;
    }

    queryCombatEvents({ type = null, limit = 100 } = {}) {
        return this.rpg.queryEvents({ type, limit }).filter((event) => event.type.startsWith('combat.'));
    }

    _spawnEnemy() {
        this.active = true;
        this.phase = 'patrol';
        this.enemy = {
            ...createBody(
                COMBAT_ENEMY_ID,
                'hostile',
                add(this.player.position, scale(normalize(this.player.forward), 600))
            ),
            factionId: COMBAT_ENEMY_FACTION_ID,
            tier: 2,
            hull: 100,
            systems: Object.fromEntries(COMBAT_SYSTEM_DAMAGE_IDS.map((id) => [id, 100])),
            fireCooldown: 1
        };
        this.targets.set(this.enemy.id, this.enemy);
        this._feedback('combat.spawned', { enemyId: this.enemy.id });
    }

    _syncPlayer(input) {
        if (Array.isArray(input.playerPosition)) this.player.position = finiteVec(input.playerPosition, 'playerPosition');
        if (Array.isArray(input.playerVelocity)) this.player.velocity = finiteVec(input.playerVelocity, 'playerVelocity');
        if (Array.isArray(input.playerForward)) this.player.forward = normalize(finiteVec(input.playerForward, 'playerForward'));
    }

    _step(dt, input) {
        for (const hardpoint of this.hardpoints) {
            hardpoint.cooldown = Math.max(0, hardpoint.cooldown - dt);
            hardpoint.heat = Math.max(0, hardpoint.heat - COMBAT_WEAPON.coolingPerSecond * dt);
        }
        if (!this.active || !this.enemy) return;
        if (this.phase === 'defeated') return;
        this.encounterElapsed += dt;
        if (!this.warningIssued && this.encounterElapsed >= COMBAT_WARNING_DELAY) {
            this.warningIssued = true;
            this.phase = 'warning';
            this._feedback('combat.comms.warning', {
                encounterId: COMBAT_ENCOUNTER_ID,
                enemyId: COMBAT_ENEMY_ID,
                graceSeconds: COMBAT_ATTACK_GRACE
            });
        }
        if (!this.attackEnabled && this.encounterElapsed >= COMBAT_WARNING_DELAY + COMBAT_ATTACK_GRACE) {
            this.attackEnabled = true;
            this.phase = 'pursue';
            this._feedback('combat.attack.enabled', { enemyId: COMBAT_ENEMY_ID });
        }
        const toPlayer = sub(this.player.position, this.enemy.position);
        const distance = length(toPlayer);
        if (this.enemy.hull <= 0) {
            this.phase = 'destroyed';
        } else if (this.enemy.hull <= COMBAT_LIMITS.retreatHull) {
            this.phase = 'retreat';
        } else if (!this.warningIssued) {
            this.phase = 'patrol';
        } else if (!this.attackEnabled) {
            this.phase = 'grace';
        } else if (distance <= COMBAT_LIMITS.attackRange) {
            this.phase = 'attack';
        } else if (distance <= COMBAT_LIMITS.detectionRange) {
            this.phase = 'pursue';
        } else {
            this.phase = 'patrol';
        }
        const direction = normalize(toPlayer);
        const speed = this.phase === 'retreat' ? 115 : this.phase === 'pursue' ? 90 : this.phase === 'attack' ? 38 : 0;
        const desired = this.phase === 'retreat' ? scale(direction, -speed) : scale(direction, speed);
        this.enemy.velocity = desired;
        this.enemy.position = add(this.enemy.position, scale(this.enemy.velocity, dt));
        this.enemy.forward = this.phase === 'retreat' ? scale(direction, -1) : direction;
        this.enemy.fireCooldown = Math.max(0, this.enemy.fireCooldown - dt);
        if (this.phase === 'attack' && this.enemy.fireCooldown <= 0 && this.projectiles.length < COMBAT_LIMITS.maxProjectiles) {
            this.enemy.fireCooldown = COMBAT_ENEMY_WEAPON.cooldown;
            this.projectiles.push(this._createProjectile({
                ownerId: this.enemy.id,
                targetId: this.player.id,
                origin: this.enemy.position,
                aim: calculateInterceptPoint(
                    this.enemy.position,
                    this.player.position,
                    this.player.velocity,
                    COMBAT_ENEMY_WEAPON.projectileSpeed
                ),
                hardpointId: 'enemy_pulse',
                weaponId: COMBAT_ENEMY_WEAPON_ID
            }));
            this._feedback('enemy.weapon.fired', { enemyId: this.enemy.id });
        }
        this._stepProjectiles(dt);
        if (distance > COMBAT_LIMITS.disengageRange) this.disengageTimer += dt;
        else this.disengageTimer = 0;
        if (this.disengageTimer >= COMBAT_LIMITS.disengageSeconds) {
            const envelope = this.slots.getActiveEnvelope();
            this._finish('fled', envelope.ship, envelope.rpg, 'combat-disengaged');
        }
        if (input.fire) {
            try { this.fire(); } catch { /* held fire is opportunistic */ }
        }
    }

    _stepProjectiles(dt) {
        const survivors = [];
        for (const projectile of this.projectiles) {
            projectile.age += dt;
            projectile.position = add(projectile.position, scale(projectile.velocity, dt));
            const target = projectile.targetId === this.player.id
                ? this.player
                : this.targets.get(projectile.targetId);
            if (target && length(sub(target.position, projectile.position)) <= 18) {
                this._applyHit(projectile);
                continue;
            }
            if (projectile.age < getWeapon(projectile.weaponId).projectileLifetime) survivors.push(projectile);
        }
        this.projectiles = survivors;
    }

    _createProjectile({ ownerId, targetId, origin, aim, hardpointId, weaponId = COMBAT_WEAPON_ID }) {
        const weapon = getWeapon(weaponId);
        const id = `shot-${String(this.sequence++).padStart(6, '0')}`;
        return {
            id,
            ownerId,
            targetId,
            hardpointId,
            weaponId,
            position: [...origin],
            velocity: scale(normalize(sub(aim, origin)), weapon.projectileSpeed),
            age: 0
        };
    }

    _applyHit({ ownerId, sourceId = ownerId, targetId, id, projectileId = id, weaponId }) {
        const weapon = getWeapon(weaponId);
        const systemId = selectDamageSystem(projectileId);
        if (targetId === this.player.id) {
            const envelope = this.slots.getActiveEnvelope();
            const ship = envelope.ship;
            applyShipDamage(ship, systemId, weapon);
            appendEvent(envelope.rpg, 'combat.hit', hitPayload(sourceId, targetId, projectileId, systemId, weapon), this.now());
            this._commit(ship, envelope.rpg, 'combat-player-hit');
            this._feedback('player.hit', { systemId, projectileId });
            if (ship.condition.hull.current <= 0) {
                this.phase = 'defeated';
                this.projectiles = [];
                this.targetId = null;
            }
            return hitPayload(sourceId, targetId, projectileId, systemId, weapon);
        }
        const target = this.targets.get(targetId);
        if (!target) throw new Error(`Unknown combat target ID: ${targetId}`);
        if (target.relation !== 'hostile') {
            throw new Error(`Combat damage is forbidden against ${target.relation} target ${targetId}.`);
        }
        target.hull = Math.max(0, target.hull - weapon.hullDamage);
        target.systems[systemId] = Math.max(0, target.systems[systemId] - weapon.systemDamage);
        this._feedback('target.hit', { targetId, systemId, projectileId });
        if (target.hull <= 0 && target.id === COMBAT_ENEMY_ID) {
            const envelope = this.slots.getActiveEnvelope();
            this._finish('victory', envelope.ship, envelope.rpg, 'combat-enemy-destroyed');
        }
        return hitPayload(sourceId, targetId, projectileId, systemId, weapon);
    }

    _finish(outcome, ship, rpg, reason) {
        const combat = sanitizeCombatState(rpg.combat);
        const gameTime = this._gameTime();
        if (outcome === 'victory') {
            combat.enemy.disposition = 'destroyed';
            combat.enemy.destroyedAtGameTime = gameTime;
        } else if (outcome === 'fled') {
            combat.enemy.disposition = 'escaped';
        }
        const record = {
            id: `combat-${String(combat.history.length + 1).padStart(6, '0')}`,
            encounterId: COMBAT_ENCOUNTER_ID,
            enemyId: COMBAT_ENEMY_ID,
            outcome,
            atGameTime: gameTime
        };
        combat.lastOutcome = record;
        combat.history.push(record);
        combat.history = combat.history.slice(-COMBAT_MAX_HISTORY);
        rpg.combat = combat;
        appendEvent(rpg, `combat.${outcome}`, record, this.now());
        this._commit(ship, rpg, reason);
        this.cleanup(outcome);
        for (const hook of ['mission', 'reputation', 'crew']) this._invokeHook(hook, record);
    }

    _invokeHook(name, payload) {
        const hook = this.hooks[name];
        if (typeof hook !== 'function') return;
        try {
            hook(cloneRpgValue(payload));
        } catch (error) {
            this._feedback('hook.failed', {
                hook: name,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    _commit(ship, rpg, reason) {
        const activeSystemId = this.rpg.activeNamedSystemId;
        const envelope = this.slots.saveDomains(
            { ship, rpg, gameTime: this._gameTime() },
            { kind: 'auto', reason }
        );
        this.rpg.reload();
        this.rpg.setActiveNamedSystem(activeSystemId);
        return envelope;
    }

    _gameTime() {
        const value = Number(this.getGameTime());
        if (!Number.isFinite(value) || value < 0) {
            throw new Error('Combat game time must be a non-negative finite number.');
        }
        return value;
    }

    _feedback(type, payload = {}) {
        this.feedback.push({ type, payload: cloneRpgValue(payload) });
        this.feedback = this.feedback.slice(-32);
    }
}

export function calculateInterceptPoint(origin, targetPosition, targetVelocity, projectileSpeed) {
    const speed = Number(projectileSpeed);
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('Projectile speed must be positive and finite.');
    const relative = sub(finiteVec(targetPosition, 'targetPosition'), finiteVec(origin, 'origin'));
    const velocity = finiteVec(targetVelocity, 'targetVelocity');
    const a = dot(velocity, velocity) - speed * speed;
    const b = 2 * dot(relative, velocity);
    const c = dot(relative, relative);
    let time = null;
    if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) > 1e-9) {
            const candidate = -c / b;
            if (candidate > 0) time = candidate;
        }
    } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
                .filter((entry) => Number.isFinite(entry) && entry > 0)
                .sort((x, y) => x - y);
            time = candidates[0] ?? null;
        }
    }
    return time === null ? [...targetPosition] : add(targetPosition, scale(velocity, time));
}

export function selectDamageSystem(projectileId) {
    if (typeof projectileId !== 'string' || !projectileId) {
        throw new Error('Combat projectile ID must be a non-empty string.');
    }
    let hash = 2166136261;
    for (let i = 0; i < projectileId.length; i += 1) {
        hash ^= projectileId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return COMBAT_SYSTEM_DAMAGE_IDS[(hash >>> 0) % COMBAT_SYSTEM_DAMAGE_IDS.length];
}

function applyShipDamage(ship, systemId, weapon) {
    ship.condition.hull.current = Math.max(0, ship.condition.hull.current - weapon.hullDamage);
    const system = ship.condition.systems[systemId];
    system.condition = Math.max(0, system.condition - weapon.systemDamage);
}

function hitPayload(sourceId, targetId, projectileId, systemId, weapon) {
    return {
        sourceId,
        targetId,
        weaponId: weapon.id,
        projectileId,
        damage: { hull: weapon.hullDamage, system: weapon.systemDamage },
        systemId
    };
}

function getWeapon(weaponId) {
    if (weaponId === COMBAT_WEAPON_ID) return COMBAT_WEAPON;
    if (weaponId === COMBAT_ENEMY_WEAPON_ID) return COMBAT_ENEMY_WEAPON;
    throw new Error(`Unknown combat weapon ID: ${weaponId}`);
}

function appendEvent(rpg, type, payload, createdAt) {
    rpg.eventLog.push({
        id: `event-${String(rpg.eventLog.length + 1).padStart(6, '0')}`,
        type,
        payload: cloneRpgValue(payload),
        createdAt
    });
}

function createBody(id, relation, position) {
    return {
        id,
        relation,
        position: finiteVec(position, `${id}.position`),
        velocity: [0, 0, 0],
        forward: [0, 0, -1],
        hull: 100,
        systems: Object.fromEntries(COMBAT_SYSTEM_DAMAGE_IDS.map((systemId) => [systemId, 100]))
    };
}

function finiteVec(value, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a 3-vector.`);
    const result = value.map(Number);
    if (result.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} must contain finite numbers.`);
    return result;
}
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, amount) { return [a[0] * amount, a[1] * amount, a[2] * amount]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(a) { return Math.sqrt(dot(a, a)); }
function normalize(a) {
    const magnitude = length(a);
    return magnitude > 1e-9 ? scale(a, 1 / magnitude) : [0, 0, -1];
}
