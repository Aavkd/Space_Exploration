import {
    EMERGENCY_RESCUE_PRICE,
    REFUEL_UNIT_PRICE,
    REFUEL_UNIT_QUANTITY,
    calculateCargoMass,
    calculateHyperdriveFuelCost,
    getCargoDefinition,
    getCargoQuantity,
    getEmergencyRescueFuelTarget,
    sanitizeShipState
} from './cargo.js';
import { clampReputation, cloneRpgValue, sanitizeRpgState } from './state.js';
import { MISSION_DEFINITIONS, MISSION_STATUSES, OBJECTIVE_STATUSES } from './missions.js';

export const DELIVERY_MISSION_ID = 'index_archive_delivery';

export class DeliveryRuntime {
    constructor({ slots, rpg, getGameTime = () => 0, now = () => new Date().toISOString() } = {}) {
        if (!slots) throw new Error('DeliveryRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('DeliveryRuntime requires the RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        this.activeSystemId = null;
        this.ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
    }

    reload() {
        this.ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        this.activeSystemId = null;
        return this.getState();
    }

    getState() {
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        this.ship = ship;
        return {
            ship,
            usedCargoMass: calculateCargoMass(ship.cargo.stacks),
            availableCargoMass: ship.cargo.capacityMass - calculateCargoMass(ship.cargo.stacks),
            activeSystemId: this.activeSystemId,
            mission: this.rpg.getMission(DELIVERY_MISSION_ID)
        };
    }

    syncSystem(systemId) {
        this.activeSystemId = systemId || null;
        if (!systemId) return this.getState();

        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        const rpg = this.rpg.getState();
        let changed = ship.travel.currentSystemId !== systemId;
        ship.travel.currentSystemId = systemId;

        if (ship.travel.pendingJump?.targetSystemId === systemId) {
            ship.travel.pendingJump = null;
            changed = true;
        }

        const mission = rpg.missions.byId[DELIVERY_MISSION_ID];
        if (
            mission.status === MISSION_STATUSES.ACCEPTED
            && systemId === MISSION_DEFINITIONS[DELIVERY_MISSION_ID].cargo.deliverySystemId
            && objectiveStatus(mission, 'load_archive_canisters') === OBJECTIVE_STATUSES.COMPLETE
            && objectiveStatus(mission, 'travel_to_index_hq') !== OBJECTIVE_STATUSES.COMPLETE
        ) {
            completeObjective(mission, 'travel_to_index_hq', this.now());
            activateObjective(mission, 'deliver_archive_canisters', this.now());
            appendEvent(rpg, 'mission.objective.completed', {
                missionId: DELIVERY_MISSION_ID,
                objectiveId: 'travel_to_index_hq',
                namedSystemId: systemId
            }, this.now());
            changed = true;
        }

        if (changed) this._commit(ship, rpg, 'authored-system-arrival');
        return this.getState();
    }

    loadMissionCargo() {
        this._assertSystem('entry_hub', 'Cargo pickup');
        const definition = MISSION_DEFINITIONS[DELIVERY_MISSION_ID];
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        const rpg = this.rpg.getState();
        const mission = rpg.missions.byId[DELIVERY_MISSION_ID];
        if (mission.status !== MISSION_STATUSES.ACCEPTED) {
            throw new Error('Cargo pickup requires an accepted Index archive delivery mission.');
        }
        if (objectiveStatus(mission, 'load_archive_canisters') === OBJECTIVE_STATUSES.COMPLETE) {
            return { changed: false, reason: 'already-loaded', state: this.getState() };
        }

        const cargo = getCargoDefinition(definition.cargo.cargoId);
        const requiredMass = cargo.unitMass * definition.cargo.quantity;
        const usedMass = calculateCargoMass(ship.cargo.stacks);
        if (usedMass + requiredMass > ship.cargo.capacityMass) {
            throw new Error(
                `Cargo bay is full: ${requiredMass} mass required, ${ship.cargo.capacityMass - usedMass} available.`
            );
        }
        addCargo(ship, cargo.id, definition.cargo.quantity);
        completeObjective(mission, 'load_archive_canisters', this.now());
        activateObjective(mission, 'travel_to_index_hq', this.now());
        appendEvent(rpg, 'cargo.loaded', {
            missionId: DELIVERY_MISSION_ID,
            cargoId: cargo.id,
            quantity: definition.cargo.quantity,
            mass: requiredMass
        }, this.now());
        this._commit(ship, rpg, 'mission-cargo-loaded');
        return { changed: true, state: this.getState() };
    }

    beginAuthoredJump(targetSystemId) {
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        const originSystemId = ship.travel.currentSystemId;
        if (!originSystemId) {
            throw new Error('Authored hyperdrive route requires departure from a known authored system.');
        }
        if (originSystemId === targetSystemId) {
            throw new Error(`Ship is already in authored system: ${targetSystemId}`);
        }
        if (ship.travel.pendingJump) {
            if (ship.travel.pendingJump.targetSystemId === targetSystemId) {
                return { changed: false, ...cloneRpgValue(ship.travel.pendingJump) };
            }
            throw new Error(
                `Complete pending jump to ${ship.travel.pendingJump.targetSystemId} before starting another authored route.`
            );
        }

        const route = calculateHyperdriveFuelCost(originSystemId, targetSystemId);
        if (ship.fuel.current - route.fuelCost < ship.fuel.reserve) {
            throw new Error(
                `Insufficient fuel: route costs ${route.fuelCost}, and protected reserve is ${ship.fuel.reserve}.`
            );
        }
        ship.fuel.current -= route.fuelCost;
        ship.travel.pendingJump = {
            originSystemId,
            targetSystemId,
            distance: route.distance,
            fuelCost: route.fuelCost
        };
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.hyperdrive.fuel-consumed', {
            originSystemId,
            targetSystemId,
            distance: route.distance,
            fuelCost: route.fuelCost,
            fuelRemaining: ship.fuel.current
        }, this.now());
        this._commit(ship, rpg, 'authored-hyperdrive-engaged');
        return { changed: true, ...cloneRpgValue(ship.travel.pendingJump) };
    }

    deliverMissionCargo() {
        this._assertSystem('index_hq', 'Cargo delivery');
        const definition = MISSION_DEFINITIONS[DELIVERY_MISSION_ID];
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        const rpg = this.rpg.getState();
        const mission = rpg.missions.byId[DELIVERY_MISSION_ID];

        if (mission.status === MISSION_STATUSES.RESOLVED && mission.outcomeId === 'delivered') {
            return { changed: false, reason: 'already-delivered', state: this.getState() };
        }
        if (mission.status !== MISSION_STATUSES.ACCEPTED) {
            throw new Error(`Cargo delivery requires an accepted mission; current status is ${mission.status}.`);
        }
        if (objectiveStatus(mission, 'load_archive_canisters') !== OBJECTIVE_STATUSES.COMPLETE) {
            throw new Error('Cargo cannot be delivered before the pickup objective is complete.');
        }
        if (objectiveStatus(mission, 'travel_to_index_hq') !== OBJECTIVE_STATUSES.COMPLETE) {
            throw new Error('Cargo cannot be delivered before arrival at Index Relay K-7.');
        }
        const held = getCargoQuantity(ship, definition.cargo.cargoId);
        if (held < definition.cargo.quantity) {
            throw new Error(`Required mission cargo is missing: ${definition.cargo.quantity} required, ${held} aboard.`);
        }

        removeCargo(ship, definition.cargo.cargoId, definition.cargo.quantity);
        const now = this.now();
        completeObjective(mission, 'deliver_archive_canisters', now);
        mission.objectives.currentObjectiveId = null;
        mission.status = MISSION_STATUSES.RESOLVED;
        mission.resolvedAt = now;
        mission.outcomeId = 'delivered';
        mission.lastBranchId = 'delivered';
        mission.updatedAt = now;

        const branch = definition.branches.delivered;
        const previousCredits = ship.credits;
        ship.credits += branch.credits;
        for (const [factionId, delta] of Object.entries(branch.reputation)) {
            const faction = rpg.factions.byId[factionId];
            const previous = faction.reputation;
            faction.reputation = clampReputation(previous + delta);
            appendEvent(rpg, 'reputation.changed', {
                factionId,
                previous,
                next: faction.reputation,
                delta: faction.reputation - previous,
                reason: `mission:${DELIVERY_MISSION_ID}:delivered`
            }, now);
        }
        Object.assign(rpg.worldFlags, cloneRpgValue(branch.worldFlags));
        appendEvent(rpg, 'mission.resolved', {
            missionId: DELIVERY_MISSION_ID,
            branchId: 'delivered',
            contactId: mission.contactId,
            namedSystemId: 'index_hq'
        }, now);
        appendEvent(rpg, 'mission.consequence', {
            missionId: DELIVERY_MISSION_ID,
            branchId: 'delivered',
            credits: { previous: previousCredits, next: ship.credits, delta: branch.credits },
            reputation: cloneRpgValue(branch.reputation),
            worldFlags: cloneRpgValue(branch.worldFlags)
        }, now);
        this._commit(ship, rpg, 'mission-delivered');
        return {
            changed: true,
            creditsAwarded: branch.credits,
            reputationAwarded: cloneRpgValue(branch.reputation),
            state: this.getState()
        };
    }

    abandonMission() {
        return this._failMission('abandoned');
    }

    loseMissionCargo() {
        const quantity = getCargoQuantity(
            sanitizeShipState(this.slots.getActiveEnvelope().ship),
            'index_archive_canister'
        );
        if (quantity <= 0) throw new Error('No Index archive mission cargo is aboard to lose.');
        return this._failMission('cargo_lost');
    }

    refuel() {
        if (!this.activeSystemId) throw new Error('Normal refuel is available only inside an authored system.');
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        if (ship.fuel.current >= ship.fuel.capacity) throw new Error('Fuel tanks are already full.');
        if (ship.credits < REFUEL_UNIT_PRICE) {
            throw new Error(`Normal refuel costs ${REFUEL_UNIT_PRICE} credits.`);
        }
        const added = Math.min(REFUEL_UNIT_QUANTITY, ship.fuel.capacity - ship.fuel.current);
        ship.credits -= REFUEL_UNIT_PRICE;
        ship.fuel.current += added;
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.refueled', { kind: 'static', added, price: REFUEL_UNIT_PRICE }, this.now());
        this._commit(ship, rpg, 'static-refuel');
        return { added, price: REFUEL_UNIT_PRICE, state: this.getState() };
    }

    emergencyRescue() {
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        if (ship.fuel.current > ship.fuel.reserve) {
            throw new Error(`Emergency rescue requires fuel at or below reserve (${ship.fuel.reserve}).`);
        }
        const target = getEmergencyRescueFuelTarget(ship);
        const price = Math.min(EMERGENCY_RESCUE_PRICE, ship.credits);
        const added = target - ship.fuel.current;
        ship.credits -= price;
        ship.fuel.current = target;
        ship.travel.pendingJump = null;
        const rpg = this.rpg.getState();
        appendEvent(rpg, 'ship.emergency-rescue', { added, price, fuel: target }, this.now());
        this._commit(ship, rpg, 'emergency-rescue');
        return { added, price, fuel: target, state: this.getState() };
    }

    setFuelForDebug(value) {
        const current = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        const ship = sanitizeShipState({
            ...current,
            fuel: { ...current.fuel, current: Number(value) }
        });
        this._commit(ship, this.rpg.getState(), 'debug-set-fuel');
        return this.getState();
    }

    addCargoForDebug(cargoId, quantity) {
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        addCargo(ship, cargoId, quantity);
        this._commit(ship, this.rpg.getState(), 'debug-add-cargo');
        return this.getState();
    }

    _failMission(outcomeId) {
        const definition = MISSION_DEFINITIONS[DELIVERY_MISSION_ID];
        const ship = sanitizeShipState(this.slots.getActiveEnvelope().ship);
        const rpg = this.rpg.getState();
        const mission = rpg.missions.byId[DELIVERY_MISSION_ID];
        const outcome = definition.failureOutcomes[outcomeId];
        if (!outcome) throw new Error(`Unknown RPG mission failure outcome ID: ${DELIVERY_MISSION_ID}/${outcomeId}`);
        if (mission.status === MISSION_STATUSES.FAILED && mission.outcomeId === outcomeId) {
            return { changed: false, state: this.getState() };
        }
        if (mission.status !== MISSION_STATUSES.ACCEPTED) {
            throw new Error(`Delivery mission cannot fail from status ${mission.status}.`);
        }
        const held = getCargoQuantity(ship, definition.cargo.cargoId);
        if (held > 0) removeCargo(ship, definition.cargo.cargoId, held);
        const now = this.now();
        mission.status = MISSION_STATUSES.FAILED;
        mission.failedAt = now;
        mission.outcomeId = outcomeId;
        mission.lastBranchId = null;
        mission.updatedAt = now;
        mission.objectives.currentObjectiveId = null;
        for (const objective of Object.values(mission.objectives.byId)) {
            if (objective.status !== OBJECTIVE_STATUSES.COMPLETE) {
                objective.status = OBJECTIVE_STATUSES.FAILED;
                objective.failedAt = now;
            }
        }
        Object.assign(rpg.worldFlags, cloneRpgValue(outcome.worldFlags));
        appendEvent(rpg, 'mission.failed', {
            missionId: DELIVERY_MISSION_ID,
            outcomeId,
            removedCargoQuantity: held,
            worldFlags: cloneRpgValue(outcome.worldFlags)
        }, now);
        this._commit(ship, rpg, `mission-${outcomeId}`);
        return { changed: true, outcomeId, state: this.getState() };
    }

    _assertSystem(expected, action) {
        if (this.activeSystemId !== expected) {
            throw new Error(`${action} requires authored system ${expected}; active system is ${this.activeSystemId ?? 'none'}.`);
        }
    }

    _commit(ship, rpg, reason) {
        const activeSystemId = this.activeSystemId;
        const envelope = this.slots.saveDomains(
            {
                ship: sanitizeShipState(ship),
                rpg: sanitizeRpgState(rpg),
                gameTime: this.getGameTime()
            },
            { kind: 'auto', reason }
        );
        this.ship = envelope.ship;
        this.rpg.reload();
        this.rpg.setActiveNamedSystem(activeSystemId);
        return envelope;
    }
}

function objectiveStatus(mission, objectiveId) {
    const objective = mission.objectives?.byId?.[objectiveId];
    if (!objective) throw new Error(`Unknown RPG mission objective ID: ${DELIVERY_MISSION_ID}/${objectiveId}`);
    return objective.status;
}

function activateObjective(mission, objectiveId, now) {
    const objective = mission.objectives.byId[objectiveId];
    if (!objective) throw new Error(`Unknown RPG mission objective ID: ${DELIVERY_MISSION_ID}/${objectiveId}`);
    if (objective.status === OBJECTIVE_STATUSES.PENDING) {
        objective.status = OBJECTIVE_STATUSES.ACTIVE;
        objective.activatedAt = now;
    }
    mission.objectives.currentObjectiveId = objectiveId;
}

function completeObjective(mission, objectiveId, now) {
    const objective = mission.objectives.byId[objectiveId];
    if (!objective) throw new Error(`Unknown RPG mission objective ID: ${DELIVERY_MISSION_ID}/${objectiveId}`);
    objective.status = OBJECTIVE_STATUSES.COMPLETE;
    objective.completedAt = now;
}

function addCargo(ship, cargoId, quantity) {
    getCargoDefinition(cargoId);
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Cargo quantity must be a positive integer.');
    const stack = ship.cargo.stacks.find((entry) => entry.cargoId === cargoId);
    if (stack) stack.quantity += amount;
    else ship.cargo.stacks.push({ cargoId, quantity: amount });
    const clean = sanitizeShipState(ship);
    ship.cargo = clean.cargo;
}

function removeCargo(ship, cargoId, quantity) {
    const amount = Number(quantity);
    const stack = ship.cargo.stacks.find((entry) => entry.cargoId === cargoId);
    if (!stack || stack.quantity < amount) {
        throw new Error(`Cannot remove ${amount} units of cargo ${cargoId}; insufficient quantity.`);
    }
    stack.quantity -= amount;
    ship.cargo.stacks = ship.cargo.stacks.filter((entry) => entry.quantity > 0);
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
