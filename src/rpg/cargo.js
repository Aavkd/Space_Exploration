import { NAMED_SYSTEM_DEFINITIONS, NAMED_SYSTEM_IDS } from './registries.js';

export const CARGO_DEFINITIONS = Object.freeze({
    index_archive_canister: Object.freeze({
        id: 'index_archive_canister',
        name: 'Sealed Index archive canister',
        unitMass: 5,
        legalityTags: Object.freeze(['legal', 'index_sealed', 'mission_cargo'])
    }),
    maintenance_supplies: Object.freeze({
        id: 'maintenance_supplies',
        name: 'Maintenance supplies',
        unitMass: 10,
        legalityTags: Object.freeze(['legal', 'industrial'])
    }),
    unregistered_signal_scrambler: Object.freeze({
        id: 'unregistered_signal_scrambler',
        name: 'Unregistered signal scrambler',
        unitMass: 5,
        legalityTags: Object.freeze(['restricted', 'commonwealth_contraband'])
    })
});

export const CARGO_IDS = Object.freeze(Object.keys(CARGO_DEFINITIONS));
export const SHIP_STATE_VERSION = 1;
export const DEFAULT_CREDITS = 300;
export const DEFAULT_FUEL_CAPACITY = 100;
export const DEFAULT_FUEL_RESERVE = 15;
export const DEFAULT_CARGO_CAPACITY_MASS = 40;
export const REFUEL_UNIT_QUANTITY = 10;
export const REFUEL_UNIT_PRICE = 25;
export const EMERGENCY_RESCUE_PRICE = 50;

export function createInitialShipState() {
    return {
        version: SHIP_STATE_VERSION,
        credits: DEFAULT_CREDITS,
        fuel: {
            current: DEFAULT_FUEL_CAPACITY,
            capacity: DEFAULT_FUEL_CAPACITY,
            reserve: DEFAULT_FUEL_RESERVE
        },
        cargo: {
            capacityMass: DEFAULT_CARGO_CAPACITY_MASS,
            stacks: []
        },
        travel: {
            currentSystemId: null,
            pendingJump: null
        }
    };
}

export function sanitizeShipState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Save domain ship must be an object.');
    }
    if (value.version !== SHIP_STATE_VERSION) {
        throw new Error(`Unsupported ship state version: ${value.version ?? 'missing'}.`);
    }

    const credits = sanitizeNonNegative(value.credits, 'ship.credits');
    const capacity = sanitizePositive(value.fuel?.capacity, 'ship.fuel.capacity');
    const reserve = sanitizeNonNegative(value.fuel?.reserve, 'ship.fuel.reserve');
    if (reserve >= capacity) throw new Error('ship.fuel.reserve must be lower than ship.fuel.capacity.');
    const current = sanitizeNonNegative(value.fuel?.current, 'ship.fuel.current');
    if (current > capacity) throw new Error('ship.fuel.current cannot exceed ship.fuel.capacity.');

    const capacityMass = sanitizePositive(value.cargo?.capacityMass, 'ship.cargo.capacityMass');
    const quantities = new Map();
    if (!Array.isArray(value.cargo?.stacks)) throw new Error('ship.cargo.stacks must be an array.');
    for (const stack of value.cargo.stacks) {
        const cargo = getCargoDefinition(stack?.cargoId);
        const quantity = Number(stack?.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            throw new Error(`Cargo quantity must be a positive integer: ${cargo.id}.`);
        }
        quantities.set(cargo.id, (quantities.get(cargo.id) ?? 0) + quantity);
    }
    const stacks = [...quantities.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cargoId, quantity]) => ({ cargoId, quantity }));
    const usedMass = calculateCargoMass(stacks);
    if (usedMass > capacityMass) {
        throw new Error(`Cargo mass ${usedMass} exceeds ship capacity ${capacityMass}.`);
    }

    return {
        version: SHIP_STATE_VERSION,
        credits,
        fuel: { current, capacity, reserve },
        cargo: { capacityMass, stacks },
        travel: {
            currentSystemId: sanitizeSystemId(value.travel?.currentSystemId, 'ship.travel.currentSystemId'),
            pendingJump: sanitizePendingJump(value.travel?.pendingJump)
        }
    };
}

export function getCargoDefinition(id) {
    const cargo = CARGO_DEFINITIONS[id];
    if (!cargo) throw new Error(`Unknown cargo ID: ${id}`);
    return cargo;
}

export function calculateCargoMass(stacks) {
    return (stacks ?? []).reduce(
        (total, stack) => total + getCargoDefinition(stack.cargoId).unitMass * stack.quantity,
        0
    );
}

export function getCargoQuantity(ship, cargoId) {
    getCargoDefinition(cargoId);
    return ship.cargo.stacks.find((stack) => stack.cargoId === cargoId)?.quantity ?? 0;
}

export function calculateHyperdriveFuelCost(originSystemId, targetSystemId) {
    const origin = getPositionedSystem(originSystemId);
    const target = getPositionedSystem(targetSystemId);
    const distance = Math.hypot(
        target.position[0] - origin.position[0],
        target.position[1] - origin.position[1],
        target.position[2] - origin.position[2]
    );
    return {
        distance,
        fuelCost: 8 + 2 * Math.ceil(distance / 10000)
    };
}

export function isMeteredAuthoredRoute(originSystemId, targetSystemId) {
    if (!originSystemId || !targetSystemId || originSystemId === targetSystemId) return false;
    getPositionedSystem(originSystemId);
    getPositionedSystem(targetSystemId);
    return true;
}

export function getEmergencyRescueFuelTarget(ship) {
    let maximumRouteCost = 0;
    for (const originId of NAMED_SYSTEM_IDS) {
        const origin = NAMED_SYSTEM_DEFINITIONS[originId];
        if (!origin.position) continue;
        for (const targetId of NAMED_SYSTEM_IDS) {
            const target = NAMED_SYSTEM_DEFINITIONS[targetId];
            if (originId === targetId || !target.position) continue;
            maximumRouteCost = Math.max(
                maximumRouteCost,
                calculateHyperdriveFuelCost(originId, targetId).fuelCost
            );
        }
    }
    return Math.min(ship.fuel.capacity, ship.fuel.reserve + maximumRouteCost);
}

function sanitizePendingJump(value) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('ship.travel.pendingJump must be an object or null.');
    }
    const originSystemId = sanitizeSystemId(value.originSystemId, 'pendingJump.originSystemId');
    const targetSystemId = sanitizeSystemId(value.targetSystemId, 'pendingJump.targetSystemId');
    if (!originSystemId || !targetSystemId || originSystemId === targetSystemId) {
        throw new Error('Pending jump requires different known origin and target system IDs.');
    }
    const expected = calculateHyperdriveFuelCost(originSystemId, targetSystemId);
    const distance = sanitizePositive(value.distance, 'pendingJump.distance');
    const fuelCost = sanitizePositive(value.fuelCost, 'pendingJump.fuelCost');
    if (Math.abs(distance - expected.distance) > 0.001 || fuelCost !== expected.fuelCost) {
        throw new Error('Pending jump does not match the deterministic authored-route fuel formula.');
    }
    return { originSystemId, targetSystemId, distance, fuelCost };
}

function sanitizeSystemId(value, label) {
    if (value === null || value === undefined) return null;
    if (!NAMED_SYSTEM_IDS.includes(value)) throw new Error(`Unknown RPG named system ID in ${label}: ${value}`);
    return value;
}

function getPositionedSystem(id) {
    const system = NAMED_SYSTEM_DEFINITIONS[id];
    if (!system) throw new Error(`Unknown RPG named system ID: ${id}`);
    if (!Array.isArray(system.position)) throw new Error(`RPG named system has no authored route position: ${id}`);
    return system;
}

function sanitizeNonNegative(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite number.`);
    return number;
}

function sanitizePositive(value, label) {
    const number = sanitizeNonNegative(value, label);
    if (number <= 0) throw new Error(`${label} must be greater than zero.`);
    return number;
}
