export const SURFACE_OUTPOST_ID = 'index_k7_cartography_outpost';
export const SURFACE_PLANET_ID = 'index_hq_planet_1';
export const SURFACE_MISSION_ID = 'index_k7_surface_verification';

export const SURFACE_CHECKPOINTS = Object.freeze([
    'undiscovered',
    'orbit',
    'landed',
    'walking',
    'objective_complete',
    'returned',
    'completed'
]);

export const SURFACE_POI_DEFINITIONS = Object.freeze({
    [SURFACE_OUTPOST_ID]: Object.freeze({
        id: SURFACE_OUTPOST_ID,
        name: 'K-7 Cartography Annex',
        type: 'surface outpost',
        systemId: 'index_hq',
        planetId: SURFACE_PLANET_ID,
        planetIndex: 0,
        planetKind: 'terrestrial',
        latitudeDeg: 17,
        longitudeDeg: -34,
        landingRadiusMetres: 180,
        interactionRadiusMetres: 3.2,
        terminalOffsetMetres: 42,
        maxLandingSlopeDeg: 12,
        terminalId: 'index_k7_surface_terminal',
        placeholderArt: true
    })
});

export const SURFACE_POI_IDS = Object.freeze(Object.keys(SURFACE_POI_DEFINITIONS));

export function getSurfacePoiDefinition(id) {
    const definition = SURFACE_POI_DEFINITIONS[id];
    if (!definition) throw new Error(`Unknown surface POI ID: ${id}`);
    return structuredClone(definition);
}

export function findSurfacePoiForPlanet({ systemId, planetId, planetIndex, kind, landable } = {}) {
    if (kind === 'gas' || landable === false) return null;
    const definition = SURFACE_POI_DEFINITIONS[SURFACE_OUTPOST_ID];
    if (
        systemId !== definition.systemId
        || planetId !== definition.planetId
        || Number(planetIndex) !== definition.planetIndex
        || kind !== definition.planetKind
        || landable !== true
    ) {
        return null;
    }
    return structuredClone(definition);
}

export function directionFromLatLon(latitudeDeg, longitudeDeg) {
    const lat = degreesToRadians(clamp(Number(latitudeDeg), -90, 90));
    const lon = degreesToRadians(Number(longitudeDeg));
    const cosLat = Math.cos(lat);
    return normalizeDirection([
        cosLat * Math.cos(lon),
        Math.sin(lat),
        cosLat * Math.sin(lon)
    ]);
}

export function angularSurfaceDistanceMetres(a, b, radius) {
    const left = normalizeDirection(a);
    const right = normalizeDirection(b);
    const dot = clamp(left[0] * right[0] + left[1] * right[1] + left[2] * right[2], -1, 1);
    const safeRadius = Number(radius);
    if (!Number.isFinite(safeRadius) || safeRadius <= 0) {
        throw new Error('Surface distance radius must be a positive finite number.');
    }
    return Math.acos(dot) * safeRadius;
}

export function createInitialSurfaceState() {
    return {
        byId: {
            [SURFACE_OUTPOST_ID]: {
                id: SURFACE_OUTPOST_ID,
                checkpoint: 'undiscovered',
                discoveredAt: null,
                visitedAt: null,
                landedAt: null,
                interactedAt: null,
                returnedAt: null,
                completedAt: null
            }
        }
    };
}

export function sanitizeSurfaceState(value) {
    const base = createInitialSurfaceState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    const savedById = value.byId;
    if (!savedById || typeof savedById !== 'object' || Array.isArray(savedById)) {
        throw new Error('Surface outpost state byId must be an object.');
    }
    for (const id of Object.keys(savedById)) {
        if (!SURFACE_POI_IDS.includes(id)) throw new Error(`Unknown saved surface POI ID: ${id}`);
    }
    const saved = savedById[SURFACE_OUTPOST_ID];
    if (!saved) return base;
    if (saved.id !== SURFACE_OUTPOST_ID) {
        throw new Error(`Surface outpost state ID must be ${SURFACE_OUTPOST_ID}.`);
    }
    return {
        byId: {
            [SURFACE_OUTPOST_ID]: {
                id: SURFACE_OUTPOST_ID,
                checkpoint: SURFACE_CHECKPOINTS.includes(saved.checkpoint)
                    ? saved.checkpoint
                    : base.byId[SURFACE_OUTPOST_ID].checkpoint,
                discoveredAt: sanitizeOptionalTimestamp(saved.discoveredAt, 'surface.discoveredAt'),
                visitedAt: sanitizeOptionalTimestamp(saved.visitedAt, 'surface.visitedAt'),
                landedAt: sanitizeOptionalTimestamp(saved.landedAt, 'surface.landedAt'),
                interactedAt: sanitizeOptionalTimestamp(saved.interactedAt, 'surface.interactedAt'),
                returnedAt: sanitizeOptionalTimestamp(saved.returnedAt, 'surface.returnedAt'),
                completedAt: sanitizeOptionalTimestamp(saved.completedAt, 'surface.completedAt')
            }
        }
    };
}

export function surfaceCheckpointIndex(value) {
    const index = SURFACE_CHECKPOINTS.indexOf(value);
    if (index < 0) throw new Error(`Unknown surface checkpoint: ${value}`);
    return index;
}

function sanitizeOptionalTimestamp(value, label) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new Error(`${label} must be an ISO timestamp or null.`);
    }
    return value;
}

function normalizeDirection(value) {
    if (!Array.isArray(value) || value.length !== 3) {
        throw new Error('Surface direction must contain exactly three numbers.');
    }
    const entries = value.map(Number);
    if (entries.some((entry) => !Number.isFinite(entry))) {
        throw new Error('Surface direction entries must be finite.');
    }
    const length = Math.hypot(...entries);
    if (length <= 1e-9) throw new Error('Surface direction cannot be zero.');
    return entries.map((entry) => entry / length);
}

function degreesToRadians(value) {
    return value * Math.PI / 180;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
