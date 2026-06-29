import { cloneRpgValue, sanitizeRpgState } from './state.js';
import { MISSION_DEFINITIONS, MISSION_STATUSES, OBJECTIVE_STATUSES } from './missions.js';
import {
    SURFACE_COMBAT_ENCOUNTER_ID,
    SURFACE_COMBAT_ENEMY_ID,
    SURFACE_COMBAT_LIMITS,
    SURFACE_COMBAT_MAX_ATTEMPTS,
    SURFACE_COMBAT_MISSION_ID,
    SURFACE_COMBAT_OBJECTIVE_ID,
    SURFACE_COMBAT_PLANET_ID,
    SURFACE_COMBAT_REWARD_CREDITS,
    SURFACE_COMBAT_SITE_ID,
    SURFACE_COMBAT_SYSTEM_ID,
    SURFACE_COMBAT_WEAPON_ID,
    sanitizeSurfaceCombatState,
    selectSurfaceCombatSpawn
} from './surfaceCombat.js';

export const SURFACE_COMBAT_FIXED_STEP = 1 / 60;
export const SURFACE_COMBAT_MAX_STEPS = 8;

export class SurfaceCombatRuntime {
    constructor({ slots, rpg, getGameTime = () => 0, now = () => new Date().toISOString() } = {}) {
        if (!slots) throw new Error('SurfaceCombatRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('SurfaceCombatRuntime requires an RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        sanitizeSurfaceCombatState(this.rpg.getState().surfaceCombat);
        this.context = emptyContext();
        this.world = null;
        this.active = false;
        this.enemy = null;
        this.accumulator = 0;
        this.heat = 0;
        this.cooldown = 0;
        this.enemyCooldown = 0;
        this.searchRemaining = 0;
        this.patrolIndex = 0;
        this.feedback = [];
        this.shotEffects = [];
        this.sequence = 1;
        this.recoveryRequested = false;
        this.performance = {
            samples: 0,
            totalMs: 0,
            maxMs: 0,
            lastMs: 0,
            p95Ms: 0,
            durations: []
        };
    }

    reload() {
        this.cleanup('reload');
        this.context = emptyContext();
        return this.getState();
    }

    setWorldAdapter(adapter) {
        if (adapter !== null && typeof adapter !== 'object') {
            throw new Error('Surface-combat world adapter must be an object or null.');
        }
        this.world = adapter;
        return Boolean(adapter);
    }

    getState() {
        const saved = sanitizeSurfaceCombatState(this.rpg.getState().surfaceCombat)
            .byId[SURFACE_COMBAT_ENCOUNTER_ID];
        return cloneRpgValue({
            available: true,
            active: this.active,
            context: this.context,
            saved,
            enemy: this.enemy,
            heat: this.heat,
            cooldown: this.cooldown,
            feedback: this.feedback.slice(-SURFACE_COMBAT_LIMITS.maxFeedback),
            shotEffects: this.shotEffects.slice(-SURFACE_COMBAT_LIMITS.maxShotEffects),
            performance: this.getPerformance()
        });
    }

    getPerformance() {
        return {
            samples: this.performance.samples,
            averageMs: this.performance.samples
                ? this.performance.totalMs / this.performance.samples
                : 0,
            maxMs: this.performance.maxMs,
            p95Ms: this.performance.p95Ms,
            lastMs: this.performance.lastMs,
            liveEnemies: this.enemy ? 1 : 0,
            liveShotEffects: this.shotEffects.length
        };
    }

    scan({ systemId, planetId, siteId = SURFACE_COMBAT_SITE_ID } = {}) {
        this._assertSite(siteId);
        this._assertLocation(systemId, planetId, 'Hostile-site scan');
        const rpg = this.rpg.getState();
        const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
        if (encounter.checkpoint !== 'undiscovered') {
            return { changed: false, reason: 'already-discovered', state: this.getState() };
        }
        const mission = rpg.missions.byId[SURFACE_COMBAT_MISSION_ID];
        offerAndAcceptMission(mission, this.now());
        completeObjective(mission, 'discover_black_cache', this.now());
        activateObjective(mission, 'land_at_black_cache', this.now());
        encounter.checkpoint = 'approach';
        appendEvent(rpg, 'surface_combat.site.discovered', {
            encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
            siteId: SURFACE_COMBAT_SITE_ID,
            missionId: SURFACE_COMBAT_MISSION_ID
        }, this.now());
        this._commit({ rpg, reason: 'surface-combat-site-discovered' });
        return { changed: true, state: this.getState() };
    }

    syncContext({
        systemId = null,
        planetId = null,
        siteId = null,
        playerState = 'walking',
        landed = false,
        withinLandingArea = false,
        playerPosition = null,
        shipPosition = null,
        placement = null
    } = {}) {
        this.context = {
            systemId,
            planetId,
            siteId,
            playerState,
            landed: Boolean(landed),
            withinLandingArea: Boolean(withinLandingArea)
        };
        if (placement) this.setWorldAdapter(placement);
        if (systemId !== SURFACE_COMBAT_SYSTEM_ID || planetId !== SURFACE_COMBAT_PLANET_ID) {
            if (this.active) this.cleanup('location-change');
            return this.getState();
        }
        const rpg = this.rpg.getState();
        const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
        const mission = rpg.missions.byId[SURFACE_COMBAT_MISSION_ID];
        if (encounter.checkpoint === 'undiscovered' || mission.status !== MISSION_STATUSES.ACCEPTED) {
            return this.getState();
        }
        let changed = false;
        if (landed && withinLandingArea && mission.objectives.byId.land_at_black_cache.status !== OBJECTIVE_STATUSES.COMPLETE) {
            completeObjective(mission, 'land_at_black_cache', this.now());
            activateObjective(mission, 'recover_stolen_survey_core', this.now());
            appendEvent(rpg, 'surface_combat.site.landed', {
                encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
                siteId: SURFACE_COMBAT_SITE_ID
            }, this.now());
            changed = true;
        }
        if (
            playerState === 'surface'
            && !encounter.objective.recovered
            && mission.objectives.byId.land_at_black_cache.status === OBJECTIVE_STATUSES.COMPLETE
            && ['approach', 'active'].includes(encounter.checkpoint)
        ) {
            if (!this.active) this._startEncounter({ playerPosition, shipPosition });
            if (encounter.checkpoint !== 'active') {
                encounter.checkpoint = 'active';
                changed = true;
            }
        } else if (playerState !== 'surface' && this.active) {
            this.cleanup('left-surface');
        }
        if (changed) this._commit({ rpg, reason: 'surface-combat-context' });
        return this.getState();
    }

    update(dt, { playerPosition = null } = {}) {
        const started = nowMs();
        const elapsed = Number(dt);
        if (!Number.isFinite(elapsed) || elapsed < 0) {
            throw new Error('Surface-combat update dt must be a non-negative finite number.');
        }
        this.accumulator = Math.min(
            this.accumulator + elapsed,
            SURFACE_COMBAT_FIXED_STEP * SURFACE_COMBAT_MAX_STEPS
        );
        let steps = 0;
        while (this.accumulator >= SURFACE_COMBAT_FIXED_STEP && steps < SURFACE_COMBAT_MAX_STEPS) {
            this._step(SURFACE_COMBAT_FIXED_STEP, playerPosition);
            this.accumulator -= SURFACE_COMBAT_FIXED_STEP;
            steps += 1;
        }
        this.shotEffects = this.shotEffects
            .map((effect) => ({ ...effect, age: effect.age + elapsed }))
            .filter((effect) => effect.age < 0.18)
            .slice(-SURFACE_COMBAT_LIMITS.maxShotEffects);
        this._recordPerformance(nowMs() - started);
        return this.getState();
    }

    fire({ origin, direction, visualOrigin = null } = {}) {
        if (this.cooldown > 1e-6) throw new Error('Surface pulse carbine is cooling down.');
        if (this.heat + SURFACE_COMBAT_LIMITS.playerHeatPerShot > 1) {
            throw new Error('Surface pulse carbine is overheated.');
        }
        const rayOrigin = finiteVector(origin, 'surface weapon origin');
        const rayDirection = normalize(finiteVector(direction, 'surface weapon direction'));
        const effectOrigin = visualOrigin === null
            ? rayOrigin
            : finiteVector(visualOrigin, 'surface weapon visual origin');
        this.cooldown = SURFACE_COMBAT_LIMITS.playerCooldown;
        this.heat = Math.min(1, this.heat + SURFACE_COMBAT_LIMITS.playerHeatPerShot);
        const end = add(rayOrigin, scale(rayDirection, SURFACE_COMBAT_LIMITS.playerRange));
        const hitDistance = this.active && this.enemy
            ? raySphereDistance(rayOrigin, rayDirection, this.enemy.position, 1.1)
            : null;
        const enemyInRange = hitDistance !== null && hitDistance <= SURFACE_COMBAT_LIMITS.playerRange;
        const targetPoint = enemyInRange ? this.enemy.position : end;
        const clear = enemyInRange ? this._lineClear(rayOrigin, targetPoint) : true;
        const shotId = `surface-shot-${String(this.sequence++).padStart(6, '0')}`;
        this.shotEffects.push({
            id: shotId,
            start: effectOrigin,
            end: targetPoint,
            hit: enemyInRange && clear,
            age: 0
        });
        this._feedback('surface_combat.weapon.fired', { shotId, weaponId: SURFACE_COMBAT_WEAPON_ID });
        if (enemyInRange && clear && this.enemy) {
            this.enemy.integrity = Math.max(0, this.enemy.integrity - SURFACE_COMBAT_LIMITS.playerDamage);
            const rpg = this.rpg.getState();
            const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
            encounter.enemy.integrity = this.enemy.integrity;
            appendEvent(rpg, 'surface_combat.hit', {
                encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
                sourceId: 'player',
                targetId: this.enemy.id,
                weaponId: SURFACE_COMBAT_WEAPON_ID,
                shotId,
                damage: SURFACE_COMBAT_LIMITS.playerDamage
            }, this.now());
            if (this.enemy.integrity === 0) {
                encounter.enemy.disposition = 'destroyed';
                this.enemy.phase = 'destroyed';
                this._feedback('surface_combat.enemy.destroyed', { enemyId: this.enemy.id });
            } else {
                this.enemy.phase = 'attack';
            }
            this._commit({ rpg, reason: 'surface-combat-player-hit' });
        }
        return { shotId, hit: enemyInRange && clear, state: this.getState() };
    }

    recoverObjective({ playerPosition } = {}) {
        const rpg = this.rpg.getState();
        const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
        if (encounter.objective.recovered) {
            return { changed: false, reason: 'already-recovered', state: this.getState() };
        }
        if (encounter.checkpoint !== 'active') {
            throw new Error(`Surface objective requires active encounter; current checkpoint is ${encounter.checkpoint}.`);
        }
        const objectivePosition = finiteVector(this.world?.objectivePosition, 'surface objective position');
        const distance = length(sub(finiteVector(playerPosition, 'surface player position'), objectivePosition));
        if (distance > SURFACE_COMBAT_LIMITS.objectiveRange) {
            throw new Error(`Stolen survey core is out of range: ${distance.toFixed(1)} m.`);
        }
        const route = encounter.enemy.disposition === 'destroyed' ? 'combat_resolved' : 'evaded';
        if (route === 'evaded') encounter.enemy.disposition = 'bypassed';
        encounter.route = route;
        encounter.lastOutcome = route;
        encounter.objective.recovered = true;
        encounter.objective.recoveredAtGameTime = this._gameTime();
        encounter.checkpoint = 'objective_recovered';
        this._appendAttempt(encounter, route);
        const mission = rpg.missions.byId[SURFACE_COMBAT_MISSION_ID];
        completeObjective(mission, 'recover_stolen_survey_core', this.now());
        activateObjective(mission, 'return_safely_with_core', this.now());
        appendEvent(rpg, 'surface_combat.objective.recovered', {
            encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
            missionId: SURFACE_COMBAT_MISSION_ID,
            objectiveId: SURFACE_COMBAT_OBJECTIVE_ID,
            route
        }, this.now());
        this.cleanup('objective-recovered');
        this._commit({ rpg, reason: 'surface-combat-objective-recovered' });
        return { changed: true, route, state: this.getState() };
    }

    recordBoarded() {
        const envelope = this.slots.getActiveEnvelope();
        const rpg = this.rpg.getState();
        const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
        if (encounter.checkpoint === 'completed') {
            return { changed: false, reason: 'already-completed', state: this.getState() };
        }
        if (encounter.checkpoint !== 'objective_recovered' || !encounter.route) {
            throw new Error('Surface-combat return requires the recovered survey core.');
        }
        const mission = rpg.missions.byId[SURFACE_COMBAT_MISSION_ID];
        assertAccepted(mission, 'Surface-combat return');
        const ship = envelope.ship;
        if (!encounter.reward.claimed) {
            ship.credits += SURFACE_COMBAT_REWARD_CREDITS;
            encounter.reward.claimed = true;
            encounter.reward.claimedAtGameTime = this._gameTime();
        }
        encounter.checkpoint = 'completed';
        completeObjective(mission, 'return_safely_with_core', this.now());
        mission.objectives.currentObjectiveId = null;
        mission.status = MISSION_STATUSES.RESOLVED;
        mission.resolvedAt = this.now();
        mission.outcomeId = encounter.route;
        mission.lastBranchId = encounter.route;
        mission.updatedAt = this.now();
        Object.assign(
            rpg.worldFlags,
            cloneRpgValue(MISSION_DEFINITIONS[SURFACE_COMBAT_MISSION_ID].branches[encounter.route].worldFlags)
        );
        appendEvent(rpg, 'mission.resolved', {
            missionId: SURFACE_COMBAT_MISSION_ID,
            branchId: encounter.route,
            encounterId: SURFACE_COMBAT_ENCOUNTER_ID
        }, this.now());
        appendEvent(rpg, 'surface_combat.reward.claimed', {
            encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
            credits: SURFACE_COMBAT_REWARD_CREDITS
        }, this.now());
        this._commit({ rpg, ship, reason: 'surface-combat-returned' });
        return { changed: true, route: encounter.route, state: this.getState() };
    }

    recoverFromDefeat() {
        const rpg = this.rpg.getState();
        return this._recoverFromDefeatState(rpg);
    }

    _recoverFromDefeatState(rpg) {
        const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
        encounter.lastOutcome = 'defeat';
        encounter.suitIntegrity = 100;
        encounter.enemy.disposition = 'available';
        encounter.enemy.integrity = 100;
        encounter.checkpoint = 'approach';
        this._appendAttempt(encounter, 'defeat');
        appendEvent(rpg, 'surface_combat.defeat.recovered', {
            encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
            missionId: SURFACE_COMBAT_MISSION_ID
        }, this.now());
        this.cleanup('defeat-recovery');
        this.recoveryRequested = true;
        this._commit({ rpg, reason: 'surface-combat-defeat-recovery' });
        return this.getState();
    }

    consumeRecoveryRequest() {
        const requested = this.recoveryRequested;
        this.recoveryRequested = false;
        return requested;
    }

    queryEvents({ type = null, limit = 100 } = {}) {
        return this.rpg.queryEvents({ type, limit })
            .filter((event) => event.type.startsWith('surface_combat.'));
    }

    cleanup(reason = 'manual') {
        const changed = this.active || this.enemy || this.shotEffects.length;
        this.active = false;
        this.enemy = null;
        this.accumulator = 0;
        this.heat = 0;
        this.cooldown = 0;
        this.enemyCooldown = 0;
        this.searchRemaining = 0;
        this.shotEffects = [];
        if (changed) this._feedback('surface_combat.cleaned', { reason });
        return changed;
    }

    _startEncounter({ playerPosition, shipPosition }) {
        if (!this.world) throw new Error('Surface-combat world placement is unavailable.');
        const spawn = selectSurfaceCombatSpawn({
            candidates: this.world.spawnCandidates,
            structures: this.world.structures,
            playerPosition,
            shipPosition,
            terrainClear: this.world.terrainClear ?? (() => true)
        });
        this.enemy = {
            id: SURFACE_COMBAT_ENEMY_ID,
            position: spawn.position,
            integrity: this.rpg.getState().surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID].enemy.integrity,
            phase: 'patrol',
            patrolIndex: 0
        };
        this.active = true;
        this._feedback('surface_combat.spawned', { enemyId: this.enemy.id, spawnId: spawn.id });
    }

    _step(dt, playerPositionValue) {
        this.cooldown = Math.max(0, this.cooldown - dt);
        this.heat = Math.max(0, this.heat - SURFACE_COMBAT_LIMITS.playerCoolingPerSecond * dt);
        this.enemyCooldown = Math.max(0, this.enemyCooldown - dt);
        if (!this.active || !this.enemy || this.enemy.integrity <= 0 || !playerPositionValue) return;
        const playerPosition = finiteVector(playerPositionValue, 'surface player position');
        const toPlayer = sub(playerPosition, this.enemy.position);
        const range = length(toPlayer);
        const visible = range <= SURFACE_COMBAT_LIMITS.enemyDetectionRange
            && this._lineClear(this.enemy.position, playerPosition);
        if (visible) {
            this.enemy.phase = range <= SURFACE_COMBAT_LIMITS.enemyAttackRange ? 'attack' : 'pursue';
            this.searchRemaining = SURFACE_COMBAT_LIMITS.enemySearchSeconds;
        } else if (this.searchRemaining > 0) {
            this.searchRemaining = Math.max(0, this.searchRemaining - dt);
            this.enemy.phase = 'search';
        } else {
            this.enemy.phase = 'patrol';
        }
        if (this.enemy.phase === 'patrol' || this.enemy.phase === 'search' || this.enemy.phase === 'pursue') {
            const patrol = this.world?.patrolPoints ?? [];
            const target = this.enemy.phase === 'pursue' || this.enemy.phase === 'search'
                ? playerPosition
                : patrol[this.patrolIndex % Math.max(1, patrol.length)] ?? this.enemy.position;
            const delta = sub(target, this.enemy.position);
            const distance = length(delta);
            if (distance < 0.5 && patrol.length) this.patrolIndex = (this.patrolIndex + 1) % patrol.length;
            else if (distance > 1e-6) {
                this.enemy.position = add(
                    this.enemy.position,
                    scale(delta, Math.min(distance, SURFACE_COMBAT_LIMITS.enemyPatrolSpeed * dt) / distance)
                );
            }
        }
        if (this.enemy.phase === 'attack' && visible && this.enemyCooldown <= 0) {
            this.enemyCooldown = SURFACE_COMBAT_LIMITS.enemyCooldown;
            const rpg = this.rpg.getState();
            const encounter = rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID];
            encounter.suitIntegrity = Math.max(0, encounter.suitIntegrity - SURFACE_COMBAT_LIMITS.enemyDamage);
            appendEvent(rpg, 'surface_combat.player.hit', {
                encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
                enemyId: this.enemy.id,
                damage: SURFACE_COMBAT_LIMITS.enemyDamage,
                suitIntegrity: encounter.suitIntegrity
            }, this.now());
            this._feedback('surface_combat.player.hit', { suitIntegrity: encounter.suitIntegrity });
            if (encounter.suitIntegrity <= 0) this._recoverFromDefeatState(rpg);
            else this._commit({ rpg, reason: 'surface-combat-player-hit' });
        }
    }

    _lineClear(start, end) {
        return this.world?.lineClear ? Boolean(this.world.lineClear(start, end)) : true;
    }

    _appendAttempt(encounter, outcome) {
        encounter.attempts.push({
            id: `surface-combat-${String(encounter.attempts.length + 1).padStart(6, '0')}`,
            encounterId: SURFACE_COMBAT_ENCOUNTER_ID,
            missionId: SURFACE_COMBAT_MISSION_ID,
            outcome,
            atGameTime: this._gameTime()
        });
        encounter.attempts = encounter.attempts.slice(-SURFACE_COMBAT_MAX_ATTEMPTS);
        encounter.attempts.forEach((attempt, index) => {
            attempt.id = `surface-combat-${String(index + 1).padStart(6, '0')}`;
        });
    }

    _assertSite(siteId) {
        if (siteId !== SURFACE_COMBAT_SITE_ID) throw new Error(`Unknown hostile surface site ID: ${siteId ?? 'missing'}.`);
    }

    _assertLocation(systemId, planetId, action) {
        if (systemId !== SURFACE_COMBAT_SYSTEM_ID || planetId !== SURFACE_COMBAT_PLANET_ID) {
            throw new Error(`${action} requires ${SURFACE_COMBAT_SYSTEM_ID}/${SURFACE_COMBAT_PLANET_ID}.`);
        }
    }

    _feedback(type, payload = {}) {
        this.feedback.push({ type, ...cloneRpgValue(payload) });
        this.feedback = this.feedback.slice(-SURFACE_COMBAT_LIMITS.maxFeedback);
    }

    _recordPerformance(milliseconds) {
        const ms = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
        this.performance.samples += 1;
        this.performance.totalMs += ms;
        this.performance.maxMs = Math.max(this.performance.maxMs, ms);
        this.performance.lastMs = ms;
        this.performance.durations.push(ms);
        this.performance.durations = this.performance.durations.slice(-7200);
        if (this.performance.samples % 120 === 0) {
            this.performance.p95Ms = percentile(this.performance.durations, 0.95);
        }
    }

    _commit({ rpg, ship = undefined, reason }) {
        const activeSystemId = this.rpg.activeNamedSystemId;
        this.slots.saveDomains(
            {
                rpg: sanitizeRpgState(rpg),
                ship,
                gameTime: this._gameTime()
            },
            { kind: 'auto', reason }
        );
        this.rpg.reload();
        this.rpg.setActiveNamedSystem(activeSystemId);
    }

    _gameTime() {
        const value = Number(this.getGameTime());
        if (!Number.isFinite(value) || value < 0) throw new Error('Surface-combat game time must be non-negative and finite.');
        return value;
    }
}

function emptyContext() {
    return {
        systemId: null,
        planetId: null,
        siteId: null,
        playerState: 'walking',
        landed: false,
        withinLandingArea: false
    };
}

function offerAndAcceptMission(mission, now) {
    if (mission.status === MISSION_STATUSES.UNAVAILABLE) {
        mission.status = MISSION_STATUSES.OFFERED;
        mission.offeredAt = now;
    }
    if (mission.status === MISSION_STATUSES.OFFERED) {
        mission.status = MISSION_STATUSES.ACCEPTED;
        mission.acceptedAt = now;
        mission.updatedAt = now;
        activateObjective(mission, 'discover_black_cache', now);
        return;
    }
    assertAccepted(mission, 'Hostile surface mission');
}

function assertAccepted(mission, action) {
    if (mission.status !== MISSION_STATUSES.ACCEPTED) {
        throw new Error(`${action} requires accepted mission ${SURFACE_COMBAT_MISSION_ID}; current status is ${mission.status}.`);
    }
}

function activateObjective(mission, id, now) {
    const objective = mission.objectives.byId[id];
    if (!objective) throw new Error(`Unknown hostile-surface objective ID: ${id}`);
    if (objective.status === OBJECTIVE_STATUSES.PENDING) {
        objective.status = OBJECTIVE_STATUSES.ACTIVE;
        objective.activatedAt = now;
    }
    mission.objectives.currentObjectiveId = id;
}

function completeObjective(mission, id, now) {
    const objective = mission.objectives.byId[id];
    if (!objective) throw new Error(`Unknown hostile-surface objective ID: ${id}`);
    objective.status = OBJECTIVE_STATUSES.COMPLETE;
    objective.completedAt = now;
}

function appendEvent(rpg, type, payload, now) {
    const nextNumber = rpg.eventLog.reduce((maximum, event) => {
        const value = Number(String(event.id).split('-').at(-1));
        return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0) + 1;
    rpg.eventLog.push({
        id: `event-${String(nextNumber).padStart(6, '0')}`,
        type,
        payload: cloneRpgValue(payload),
        createdAt: now
    });
}

function finiteVector(value, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a 3-vector.`);
    const result = value.map(Number);
    if (result.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} must contain finite numbers.`);
    return result;
}

function normalize(value) {
    const magnitude = length(value);
    if (magnitude <= 1e-9) throw new Error('Surface weapon direction cannot be zero.');
    return scale(value, 1 / magnitude);
}

function raySphereDistance(origin, direction, center, radius) {
    const offset = sub(origin, center);
    const b = dot(offset, direction);
    const c = dot(offset, offset) - radius * radius;
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const near = -b - Math.sqrt(discriminant);
    const far = -b + Math.sqrt(discriminant);
    if (far < 0) return null;
    return near >= 0 ? near : far;
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function percentile(values, quantile) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, amount) { return [a[0] * amount, a[1] * amount, a[2] * amount]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(a) { return Math.sqrt(dot(a, a)); }
