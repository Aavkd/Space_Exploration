import * as THREE from 'three';

export const SHIP_UNITS = 'meters';

export const SHIP_DIMENSIONS = Object.freeze({
    units: SHIP_UNITS,
    length: 34,
    width: 13.6,
    height: 7.4,
    landingClearance: 2.8,
    deckHeight: 0,
    eyeHeight: 0.8,
    mainCeilingHeight: 2.7,
    corridorClearWidth: 3.2,
    cockpitClearRadius: 1.4,
    airlockClearWidth: 2.2,
    airlockClearDepth: 2.6,
    reactorServiceClearance: 1.2
});

export const SHIP_INTERIOR_ZONES = Object.freeze({
    cockpit: {
        label: 'Cockpit',
        role: 'Pilot seat, controls, and forward bay window.',
        center: [0, 1.25, -11.4],
        size: [5.8, 2.7, 6.2],
        walkable: true
    },
    circulation: {
        label: 'Circulation',
        role: 'Short central route between cockpit, airlock, and reactor bay.',
        center: [0, 1.25, -2.2],
        size: [3.2, 2.7, 11.6],
        walkable: true
    },
    observationBay: {
        label: 'Observation bay',
        role: 'Side windows and stable visual reference while the ship moves.',
        center: [0, 1.25, 2.2],
        size: [5.4, 2.7, 4.4],
        walkable: true
    },
    airlock: {
        label: 'Airlock',
        role: 'Reference-frame transition between ship interior and open space.',
        center: [-4.7, 1.25, 4.2],
        size: [2.8, 2.7, 3.2],
        walkable: true
    },
    reactor: {
        label: 'Reactor bay',
        role: 'Technical volume around the drive core and aft systems.',
        center: [0, 1.25, 10.4],
        size: [6.2, 2.7, 5.4],
        walkable: true
    }
});

// Hand-authored collision blockout for player locomotion, in the ship-local
// frame (origin = ship root, forward = -Z, deck = y 0). Each volume is an XZ
// floor footprint [minX, minZ] -> [maxX, maxZ]; the player is constrained to
// the UNION of these rectangles via per-axis sliding (see RelativeLocomotion).
//
// This is deliberately NOT derived from the imported GLB interior: the GLB hull
// ships its own detailed cabin, but its geometry is not aligned to these
// abstract anchors/zones (see phase-02/phase-03 notes), so colliding against it
// is out of scope here. These rectangles are tuned to be CONTIGUOUS (neighbours
// overlap), including two short connector volumes that bridge the gaps the raw
// zone footprints leave (observation->reactor aft run, and observation->airlock),
// so the whole interior is traversable on foot. Limits are documented in
// docs/phase-04-ship-interior.md.
export const SHIP_WALKABLE_VOLUMES = Object.freeze([
    { id: 'cockpit', min: [-2.9, -14.6], max: [2.9, -7.6] },
    { id: 'circulation', min: [-1.7, -8.0], max: [1.7, 4.2] },
    { id: 'observation', min: [-2.7, 0.0], max: [2.7, 4.6] },
    { id: 'observationToReactor', min: [-1.7, 3.8], max: [1.7, 8.0], connector: true },
    { id: 'reactor', min: [-3.1, 7.6], max: [3.1, 13.1] },
    { id: 'observationToAirlock', min: [-4.2, 2.6], max: [-2.4, 5.0], connector: true },
    { id: 'airlock', min: [-6.1, 2.6], max: [-3.0, 5.8] }
]);

export const REQUIRED_SHIP_ANCHORS = Object.freeze([
    'cockpitSeat',
    'pilotControls',
    'commsStation',
    'navigationStation',
    'exitAirlock',
    'interiorSpawn',
    'exteriorSpawn',
    'cameraDebugMount',
    'radioStation',
    'shipComputerStation',
    'cargoTerminalStation'
]);

export const SHIP_ANCHORS = Object.freeze({
    cockpitSeat: {
        role: 'Sit/stand pilot interaction point.',
        zone: 'cockpit',
        position: [0, 0.45, -11.75],
        forward: [0, 0, -1],
        interactionRadius: 1.1
    },
    pilotControls: {
        role: 'Command handoff point for future ship controls.',
        zone: 'cockpit',
        position: [0, 1.1, -13.15],
        forward: [0, 0, -1],
        interactionRadius: 1.2
    },
    commsStation: {
        role: 'Cockpit comms station for RPG contact hails.',
        zone: 'cockpit',
        position: [1.5, 1.05, -11.75],
        forward: [-0.35, 0, -1],
        interactionRadius: 0.9
    },
    navigationStation: {
        role: 'Cockpit navigation station for selecting destinations.',
        zone: 'cockpit',
        position: [-1.2, 0.70, -11.2],
        forward: [0.35, 0, -1],
        interactionRadius: 0.9
    },
    radioStation: {
        role: 'Radio station console for listening to music and frequency tuning.',
        zone: 'circulation',
        position: [-1.3, 0.5, -7.5],
        forward: [1, 0, 0],
        interactionRadius: 1.0
    },
    shipComputerStation: {
        role: 'Durable ship log, simulation clock, and local save-slot terminal.',
        zone: 'observationBay',
        position: [1.7, 0.9, 2.4],
        forward: [-1, 0, 0],
        interactionRadius: 1.0
    },
    cargoTerminalStation: {
        role: 'Physical cargo, fuel, delivery, and recovery terminal.',
        zone: 'observationBay',
        position: [-1.7, 0.9, 2.4],
        forward: [1, 0, 0],
        interactionRadius: 1.0
    },
    exitAirlock: {
        role: 'Interior side of the airlock exit interaction.',
        zone: 'airlock',
        position: [-5.7, 1.05, 4.2],
        forward: [-1, 0, 0],
        interactionRadius: 1.25
    },
    interiorSpawn: {
        role: 'Default player spawn in the ship-local reference frame.',
        zone: 'circulation',
        position: [0, 0, -1.4],
        forward: [0, 0, -1],
        interactionRadius: 0.8
    },
    exteriorSpawn: {
        role: 'Safe spawn outside the outer airlock, still local to the ship.',
        zone: 'exterior',
        position: [-9.2, 0.4, 4.2],
        forward: [1, 0, 0],
        interactionRadius: 1.5
    },
    cameraDebugMount: {
        role: 'Interior debug camera start point.',
        zone: 'circulation',
        position: [0, 1.65, -3.8],
        forward: [0, -0.03, -1],
        interactionRadius: 0
    }
});

export function createShipAnchors({ showDebugMarkers = true } = {}) {
    const root = new THREE.Group();
    root.name = 'ShipAnchors';

    const anchors = {};
    const geometry = new THREE.SphereGeometry(0.12, 12, 8);

    for (const [name, definition] of Object.entries(SHIP_ANCHORS)) {
        const anchor = new THREE.Object3D();
        anchor.name = name;
        anchor.position.fromArray(definition.position);
        anchor.userData = {
            anchorName: name,
            anchorRole: definition.role,
            zone: definition.zone,
            interactionRadius: definition.interactionRadius
        };

        applyForwardVector(anchor, definition.forward);

        if (showDebugMarkers) {
            const marker = new THREE.Mesh(
                geometry,
                new THREE.MeshBasicMaterial({
                    color: name === 'exteriorSpawn' ? 0xff8a35 : 0x66dcff,
                    transparent: true,
                    opacity: 0.9
                })
            );
            marker.name = `${name}Marker`;
            anchor.add(marker);
        }

        anchors[name] = anchor;
        root.add(anchor);
    }

    root.userData.requiredAnchors = [...REQUIRED_SHIP_ANCHORS];
    root.userData.zones = SHIP_INTERIOR_ZONES;

    return { root, anchors };
}

export function validateShipAnchors(anchors) {
    const missing = REQUIRED_SHIP_ANCHORS.filter((name) => !anchors[name]);

    return {
        ok: missing.length === 0,
        missing,
        required: [...REQUIRED_SHIP_ANCHORS]
    };
}

export function getShipAnchorManifest() {
    return Object.fromEntries(
        Object.entries(SHIP_ANCHORS).map(([name, definition]) => [
            name,
            {
                ...definition,
                position: [...definition.position],
                forward: [...definition.forward]
            }
        ])
    );
}

function applyForwardVector(object3D, forwardArray) {
    const forward = new THREE.Vector3().fromArray(forwardArray).normalize();
    const target = object3D.position.clone().add(forward);
    object3D.up.set(0, 1, 0);
    object3D.lookAt(target);
}
