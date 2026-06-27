import { sanitizeShipState } from './cargo.js';
import { cloneRpgValue, sanitizeRpgState } from './state.js';

export const SHIP_CONDITION_IDS = Object.freeze([
    'hull',
    'engine',
    'hyperdrive',
    'sensors',
    'comms',
    'life_support',
    'weapons'
]);
export const SHIP_SYSTEM_IDS = Object.freeze(SHIP_CONDITION_IDS.filter((id) => id !== 'hull'));
export const SALVAGE_SOURCE_ID = 'index_k7_derelict_cache';
export const HAZARD_ID = 'index_k7_micrometeoroid_shear';
export const SALVAGE_SYSTEM_ID = 'index_hq';
export const SALVAGE_GRANT = Object.freeze({ repairParts: 3, hullPlates: 2 });
export const HAZARD_DAMAGE = Object.freeze({ hull: 35, engine: 45, sensors: 30 });
export const REPAIR_AMOUNTS = Object.freeze({ hull: 25, system: 30 });
export const CRITICAL_THRESHOLD = 10;
export const STABILIZED_CONDITION = 25;

export class ShipConditionRuntime {
    constructor({ slots, rpg, getGameTime = () => 0, now = () => new Date().toISOString() } = {}) {
        if (!slots) throw new Error('ShipConditionRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('ShipConditionRuntime requires the RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        this.activeSystemId = null;
        sanitizeShipState(this.slots.getActiveEnvelope().ship);
    }

    reload() {
        sanitizeShipState(this.slots.getActiveEnvelope().ship);
        return this.getState();
    }

    syncSystem(systemId) {
        this.activeSystemId = systemId || null;
        return this.getState();
    }

    getState() {
        const ship = this._getShip();
        return {
            condition: cloneRpgValue(ship.condition),
            inventory: cloneRpgValue(ship.inventory),
            maintenance: cloneRpgValue(ship.maintenance),
            capabilities: calculateShipCapabilities(ship.condition),
            activeSystemId: this.activeSystemId,
            salvageAvailable: this.activeSystemId === SALVAGE_SYSTEM_ID
                && !ship.maintenance.salvageSources[SALVAGE_SOURCE_ID].claimed,
            critical: isCriticalCondition(ship.condition)
        };
    }

    claimSalvage() {
        if (this.activeSystemId !== SALVAGE_SYSTEM_ID) {
            throw new Error(
                `Salvage source ${SALVAGE_SOURCE_ID} requires authored system ${SALVAGE_SYSTEM_ID}; `
                + `active system is ${this.activeSystemId ?? 'none'}.`
            );
        }
        const ship = this._getShip();
        const source = ship.maintenance.salvageSources[SALVAGE_SOURCE_ID];
        if (source.claimed) {
            return { changed: false, reason: 'already-claimed', state: this.getState() };
        }
        const hazard = ship.maintenance.hazards[HAZARD_ID];
        if (hazard.triggered) {
            throw new Error(`Hazard ${HAZARD_ID} cannot predate its unclaimed salvage source.`);
        }
        if (
            ship.inventory.repairParts > 999 - SALVAGE_GRANT.repairParts
            || ship.inventory.hullPlates > 999 - SALVAGE_GRANT.hullPlates
        ) {
            throw new Error('Repair inventory cannot accept the exact derelict salvage grant.');
        }
        const gameTime = sanitizeGameTime(this.getGameTime());
        applyConditionDelta(ship, 'hull', -HAZARD_DAMAGE.hull);
        applyConditionDelta(ship, 'engine', -HAZARD_DAMAGE.engine);
        applyConditionDelta(ship, 'sensors', -HAZARD_DAMAGE.sensors);
        ship.inventory.repairParts += SALVAGE_GRANT.repairParts;
        ship.inventory.hullPlates += SALVAGE_GRANT.hullPlates;
        source.claimed = true;
        source.claimedAtGameTime = gameTime;
        hazard.triggered = true;
        hazard.triggeredAtGameTime = gameTime;

        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.hazard.applied', {
            hazardId: HAZARD_ID,
            salvageSourceId: SALVAGE_SOURCE_ID,
            damage: cloneRpgValue(HAZARD_DAMAGE)
        }, this.now());
        appendEvent(rpg, 'ship.salvage.claimed', {
            salvageSourceId: SALVAGE_SOURCE_ID,
            namedSystemId: SALVAGE_SYSTEM_ID,
            grant: cloneRpgValue(SALVAGE_GRANT)
        }, this.now());
        this._commit(ship, rpg, 'derelict-salvage-claimed');
        return {
            changed: true,
            damage: cloneRpgValue(HAZARD_DAMAGE),
            grant: cloneRpgValue(SALVAGE_GRANT),
            state: this.getState()
        };
    }

    repair(targetId) {
        assertConditionId(targetId);
        const ship = this._getShip();
        const before = getConditionValue(ship.condition, targetId);
        if (before >= 100) throw new Error(`Ship condition target ${targetId} is already at full condition.`);
        const itemKey = targetId === 'hull' ? 'hullPlates' : 'repairParts';
        const itemId = targetId === 'hull' ? 'hull_plates' : 'repair_parts';
        if (ship.inventory[itemKey] < 1) {
            throw new Error(`Repair target ${targetId} requires one ${itemId}; none are available.`);
        }
        const repairAmount = targetId === 'hull' ? REPAIR_AMOUNTS.hull : REPAIR_AMOUNTS.system;
        ship.inventory[itemKey] -= 1;
        applyConditionDelta(ship, targetId, repairAmount);
        const after = getConditionValue(ship.condition, targetId);
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.repaired', {
            targetId,
            itemId,
            consumed: 1,
            before,
            after,
            restored: after - before
        }, this.now());
        this._commit(ship, rpg, `ship-repaired-${targetId}`);
        return {
            changed: true,
            targetId,
            itemId,
            consumed: 1,
            before,
            after,
            state: this.getState()
        };
    }

    stabilizeCriticalState() {
        const ship = this._getShip();
        const hullBefore = ship.condition.hull.current;
        const engineBefore = ship.condition.systems.engine.condition;
        if (hullBefore > CRITICAL_THRESHOLD && engineBefore > CRITICAL_THRESHOLD) {
            throw new Error(
                `Emergency stabilization requires hull or engine at or below ${CRITICAL_THRESHOLD}.`
            );
        }
        ship.condition.hull.current = hullBefore <= CRITICAL_THRESHOLD
            ? STABILIZED_CONDITION
            : hullBefore;
        ship.condition.systems.engine.condition = engineBefore <= CRITICAL_THRESHOLD
            ? STABILIZED_CONDITION
            : engineBefore;
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.emergency-stabilized', {
            hull: { before: hullBefore, after: ship.condition.hull.current },
            engine: { before: engineBefore, after: ship.condition.systems.engine.condition }
        }, this.now());
        this._commit(ship, rpg, 'ship-emergency-stabilized');
        return { changed: true, state: this.getState() };
    }

    setConditionForDebug(targetId, value) {
        assertConditionId(targetId);
        const ship = this._getShip();
        const before = getConditionValue(ship.condition, targetId);
        setConditionValue(ship.condition, targetId, value);
        const clean = sanitizeShipState(ship);
        const after = getConditionValue(clean.condition, targetId);
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.condition.debug-set', { targetId, before, after }, this.now());
        this._commit(clean, rpg, `debug-set-condition-${targetId}`);
        return this.getState();
    }

    setInventoryForDebug({ repairParts, hullPlates } = {}) {
        const ship = this._getShip();
        if (repairParts !== undefined) ship.inventory.repairParts = repairParts;
        if (hullPlates !== undefined) ship.inventory.hullPlates = hullPlates;
        const clean = sanitizeShipState(ship);
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.inventory.debug-set', cloneRpgValue(clean.inventory), this.now());
        this._commit(clean, rpg, 'debug-set-repair-inventory');
        return this.getState();
    }

    _getShip() {
        return sanitizeShipState(this.slots.getActiveEnvelope().ship);
    }

    _commit(ship, rpg, reason) {
        const envelope = this.slots.saveDomains(
            {
                ship: sanitizeShipState(ship),
                rpg: sanitizeRpgState(rpg),
                gameTime: sanitizeGameTime(this.getGameTime())
            },
            { kind: 'auto', reason }
        );
        this.rpg.reload();
        this.rpg.setActiveNamedSystem(this.activeSystemId);
        return envelope;
    }
}

export function calculateShipCapabilities(condition) {
    const clean = sanitizeShipState({
        version: 2,
        credits: 0,
        fuel: { current: 0, capacity: 100, reserve: 15 },
        cargo: { capacityMass: 40, stacks: [] },
        travel: { currentSystemId: null, pendingJump: null },
        condition,
        inventory: { repairParts: 0, hullPlates: 0 },
        maintenance: {
            salvageSources: {
                [SALVAGE_SOURCE_ID]: { claimed: false, claimedAtGameTime: null }
            },
            hazards: {
                [HAZARD_ID]: { triggered: false, triggeredAtGameTime: null }
            }
        }
    }).condition;
    return {
        hullIntegrity: scaleCapability(clean.hull.current, 0.5),
        engineThrust: scaleCapability(clean.systems.engine.condition, 0.4),
        hyperdriveAuthority: scaleCapability(clean.systems.hyperdrive.condition, 0.5),
        sensorRange: scaleCapability(clean.systems.sensors.condition, 0.5),
        commsClarity: scaleCapability(clean.systems.comms.condition, 0.6),
        lifeSupportEfficiency: scaleCapability(clean.systems.life_support.condition, 0.6),
        weaponsReadiness: scaleCapability(clean.systems.weapons.condition, 0.5)
    };
}

export function isCriticalCondition(condition) {
    return condition.hull.current <= CRITICAL_THRESHOLD
        || condition.systems.engine.condition <= CRITICAL_THRESHOLD;
}

function scaleCapability(condition, minimum) {
    return minimum + (1 - minimum) * (condition / 100);
}

function assertConditionId(targetId) {
    if (!SHIP_CONDITION_IDS.includes(targetId)) {
        throw new Error(`Unknown ship condition target ID: ${targetId}`);
    }
}

function getConditionValue(condition, targetId) {
    return targetId === 'hull'
        ? condition.hull.current
        : condition.systems[targetId].condition;
}

function setConditionValue(condition, targetId, value) {
    if (targetId === 'hull') condition.hull.current = value;
    else condition.systems[targetId].condition = value;
}

function applyConditionDelta(ship, targetId, delta) {
    const before = getConditionValue(ship.condition, targetId);
    setConditionValue(ship.condition, targetId, Math.max(0, Math.min(100, before + delta)));
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

function sanitizeGameTime(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time < 0) {
        throw new Error('Ship-condition game time must be a non-negative finite number.');
    }
    return time;
}
