import { getCargoDefinition } from './cargo.js';
import {
    FACTION_DEFINITIONS,
    NAMED_SYSTEM_DEFINITIONS
} from './registries.js';

export const PATROL_WORLD_SEED = 'deep-space-vr-patrol-v1';

export const FACTION_TERRITORY_POLICIES = Object.freeze({
    commonwealth_port_meridian: Object.freeze({
        id: 'commonwealth_port_meridian',
        systemId: 'entry_hub',
        factionId: 'commonwealth',
        agentId: 'commonwealth_meridian_watch_1',
        influence: 1,
        inspectionTags: Object.freeze(['index_sealed', 'mission_cargo']),
        prohibitedTags: Object.freeze(['commonwealth_contraband'])
    })
});

export const FACTION_TERRITORY_POLICY_IDS = Object.freeze(
    Object.keys(FACTION_TERRITORY_POLICIES)
);

export const REPUTATION_BANDS = Object.freeze([
    'positive',
    'neutral',
    'negative',
    'hostile'
]);

export function queryFactionInfluence({ systemId, rpgState } = {}) {
    const definition = NAMED_SYSTEM_DEFINITIONS[systemId];
    if (!definition) throw new Error(`Unknown RPG named system ID for faction influence: ${systemId ?? 'missing'}`);
    const savedSystem = rpgState?.namedSystems?.byId?.[systemId];
    const factionId = savedSystem?.startingFactionId ?? definition.startingFactionId ?? null;
    if (factionId && !FACTION_DEFINITIONS[factionId]) {
        throw new Error(`Unknown controlling faction ID in system state: ${systemId}/${factionId}`);
    }
    const policy = Object.values(FACTION_TERRITORY_POLICIES)
        .find((entry) => entry.systemId === systemId && entry.factionId === factionId) ?? null;
    const influences = factionId
        ? [{ factionId, influence: policy?.influence ?? 1 }]
        : [];
    return {
        systemId,
        controllingFactionId: factionId,
        policyId: policy?.id ?? null,
        patrolEnabled: Boolean(policy),
        influences: influences.sort((a, b) => (
            b.influence - a.influence || a.factionId.localeCompare(b.factionId)
        ))
    };
}

export function getFactionTerritoryPolicy(id) {
    const policy = FACTION_TERRITORY_POLICIES[id];
    if (!policy) throw new Error(`Unknown faction territory policy ID: ${id}`);
    return policy;
}

export function classifyReputation(value, previousBand = null) {
    const reputation = Number(value);
    if (!Number.isFinite(reputation) || reputation < -1 || reputation > 1) {
        throw new Error(`Faction reputation must be a finite value from -1 to 1: ${value}`);
    }
    if (previousBand !== null && !REPUTATION_BANDS.includes(previousBand)) {
        throw new Error(`Unknown reputation band: ${previousBand}`);
    }

    if (previousBand === 'positive' && reputation >= 0.30) return 'positive';
    if (previousBand === 'hostile' && reputation <= -0.55) return 'hostile';
    if (previousBand === 'negative' && reputation <= -0.20 && reputation > -0.60) return 'negative';
    if (previousBand === 'neutral' && reputation > -0.25 && reputation < 0.35) return 'neutral';

    if (reputation >= 0.35) return 'positive';
    if (reputation <= -0.60) return 'hostile';
    if (reputation <= -0.25) return 'negative';
    return 'neutral';
}

export function scanCargoLegality(ship, policyId, {
    appraise = () => ({ unitValue: 0, totalValue: 0 })
} = {}) {
    const policy = getFactionTerritoryPolicy(policyId);
    const matches = [];
    let hasRestricted = false;
    let hasContraband = false;
    for (const stack of ship?.cargo?.stacks ?? []) {
        const cargo = getCargoDefinition(stack.cargoId);
        const quantity = Number(stack.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            throw new Error(`Cargo scan requires a positive integer quantity: ${cargo.id}`);
        }
        const restrictedTags = cargo.legalityTags.filter((tag) => policy.inspectionTags.includes(tag));
        const prohibitedTags = cargo.legalityTags.filter((tag) => policy.prohibitedTags.includes(tag));
        if (restrictedTags.length || prohibitedTags.length) {
            const appraisal = appraise(cargo.id, quantity);
            const unitValue = sanitizeAppraisalValue(appraisal?.unitValue, `${cargo.id} unit value`);
            const totalValue = sanitizeAppraisalValue(appraisal?.totalValue, `${cargo.id} total value`);
            if (totalValue !== unitValue * quantity) {
                throw new Error(`Cargo appraisal total does not match unit value and quantity: ${cargo.id}`);
            }
            matches.push({
                cargoId: cargo.id,
                quantity,
                restrictedTags: [...restrictedTags].sort(),
                prohibitedTags: [...prohibitedTags].sort(),
                unitValue,
                totalValue
            });
        }
        hasRestricted ||= restrictedTags.length > 0;
        hasContraband ||= prohibitedTags.length > 0;
    }
    matches.sort((a, b) => a.cargoId.localeCompare(b.cargoId));
    return {
        status: hasContraband ? 'contraband' : hasRestricted ? 'restricted' : 'clear',
        matches,
        contrabandValue: matches.reduce(
            (total, match) => total + (match.prohibitedTags.length ? match.totalValue : 0),
            0
        )
    };
}

export function evaluatePatrolPolicy({ reputationBand, cargoScan } = {}) {
    if (!REPUTATION_BANDS.includes(reputationBand)) {
        throw new Error(`Unknown reputation band for patrol policy: ${reputationBand}`);
    }
    if (!['clear', 'restricted', 'contraband'].includes(cargoScan?.status)) {
        throw new Error(`Unknown cargo scan status for patrol policy: ${cargoScan?.status ?? 'missing'}`);
    }
    if (reputationBand === 'hostile') return { action: 'safe_hostility', requiresScan: false };
    if (reputationBand === 'negative') return { action: 'warning_refusal', requiresScan: false };
    if (cargoScan.status === 'contraband') return { action: null, requiresScan: true };
    if (reputationBand === 'neutral' || cargoScan.status === 'restricted') {
        return { action: null, requiresScan: true };
    }
    return { action: 'welcome', requiresScan: false };
}

export function createCargoFingerprint(ship) {
    const manifest = (ship?.cargo?.stacks ?? [])
        .map((stack) => `${stack.cargoId}:${Number(stack.quantity)}`)
        .sort()
        .join('|');
    return stableHash(manifest || 'empty');
}

export function createPatrolEncounterId({
    worldSeed = PATROL_WORLD_SEED,
    policyId,
    systemId,
    sequence,
    gameTime,
    reputationSnapshot,
    cargoFingerprint,
    contrabandValue = 0
} = {}) {
    const canonical = [
        worldSeed,
        policyId,
        systemId,
        sequence,
        Number(gameTime).toFixed(3),
        Number(reputationSnapshot).toFixed(6),
        cargoFingerprint,
        sanitizeAppraisalValue(contrabandValue, 'encounter contraband value')
    ].join('|');
    return `patrol-${stableHash(canonical)}`;
}

function stableHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeAppraisalValue(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`Cargo appraisal ${label} must be a non-negative safe integer.`);
    }
    return number;
}
