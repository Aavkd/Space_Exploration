import * as THREE from 'three';
import {
    SHIP_DIMENSIONS,
    SHIP_INTERIOR_ZONES,
    createShipAnchors
} from './ShipInterior.js';

export const SHIP_PARTS = Object.freeze([
    { id: 'mainHull', role: 'Primary dark pressure hull', size: [10.8, 4.9, 33.2], localPosition: [0, 1.8, 0] },
    { id: 'cockpitCanopy', role: 'Forward view bay and pilot visibility landmark', size: [5.8, 1.8, 5.0], localPosition: [0, 3.0, -12.8] },
    { id: 'aftEngineBlock', role: 'Reactor and drive housing', size: [10.6, 4.3, 5.4], localPosition: [0, 1.65, 14.3] },
    { id: 'sidePods', role: 'Stable exterior silhouette and utility systems', size: [1.2, 1.5, 18.0], localPosition: [6.15, 1.0, 1.8] },
    { id: 'thrusterCluster', role: 'Visible propulsion read from rear and side views', size: [8.4, 3.0, 1.8], localPosition: [0, 1.75, 17.5] },
    { id: 'interiorDecks', role: 'Walkable cockpit, corridor, airlock, and reactor floors', size: [6.2, 0.12, 27.4], localPosition: [0, 0, -0.5] },
    { id: 'pilotSeat', role: 'Seated piloting interaction prop', size: [1.2, 1.5, 1.3], localPosition: [0, 0.75, -11.55] },
    { id: 'airlockChamber', role: 'Ship-local to exterior transition volume', size: [2.8, 2.7, 3.2], localPosition: [-4.7, 1.25, 4.2] },
    { id: 'reactorCore', role: 'Technical bay visual anchor', size: [1.6, 2.4, 1.6], localPosition: [0, 1.35, 10.5] }
]);

export function createShipModel() {
    const root = new THREE.Group();
    root.name = 'ShipModelProceduralBlockout';

    const exteriorRoot = new THREE.Group();
    exteriorRoot.name = 'ShipExterior';

    const interiorRoot = new THREE.Group();
    interiorRoot.name = 'ShipInterior';

    const materials = createShipMaterials();

    buildExterior(exteriorRoot, materials);
    buildInterior(interiorRoot, materials);

    const { root: anchorRoot, anchors } = createShipAnchors({ showDebugMarkers: true });

    root.add(exteriorRoot, interiorRoot, anchorRoot);
    root.userData = {
        units: SHIP_DIMENSIONS.units,
        dimensions: SHIP_DIMENSIONS,
        zones: SHIP_INTERIOR_ZONES,
        parts: SHIP_PARTS
    };

    return {
        root,
        exteriorRoot,
        interiorRoot,
        anchorRoot,
        anchors,
        dimensions: SHIP_DIMENSIONS,
        zones: SHIP_INTERIOR_ZONES,
        parts: SHIP_PARTS
    };
}

function createShipMaterials() {
    return {
        hull: new THREE.MeshStandardMaterial({
            color: 0x111923,
            metalness: 0.72,
            roughness: 0.36,
            emissive: 0x010409
        }),
        hullPanel: new THREE.MeshStandardMaterial({
            color: 0x22303c,
            metalness: 0.62,
            roughness: 0.44,
            emissive: 0x02070c
        }),
        deck: new THREE.MeshStandardMaterial({
            color: 0x151b24,
            metalness: 0.35,
            roughness: 0.78
        }),
        wall: new THREE.MeshStandardMaterial({
            color: 0x1e2935,
            metalness: 0.48,
            roughness: 0.62
        }),
        trim: new THREE.MeshStandardMaterial({
            color: 0x2f4050,
            metalness: 0.55,
            roughness: 0.42
        }),
        glass: new THREE.MeshStandardMaterial({
            color: 0x8fe8ff,
            emissive: 0x0a3348,
            emissiveIntensity: 0.85,
            transparent: true,
            opacity: 0.38,
            metalness: 0.1,
            roughness: 0.05,
            depthWrite: false
        }),
        cyanLight: new THREE.MeshBasicMaterial({
            color: 0x6fe9ff,
            transparent: true,
            opacity: 0.92
        }),
        magentaLight: new THREE.MeshBasicMaterial({
            color: 0xff4bd8,
            transparent: true,
            opacity: 0.78
        }),
        orangeLight: new THREE.MeshBasicMaterial({
            color: 0xff9b3d,
            transparent: true,
            opacity: 0.88
        }),
        seat: new THREE.MeshStandardMaterial({
            color: 0x252d38,
            metalness: 0.35,
            roughness: 0.72
        }),
        reactor: new THREE.MeshStandardMaterial({
            color: 0x63e8ff,
            emissive: 0x24b9ff,
            emissiveIntensity: 1.4,
            metalness: 0.2,
            roughness: 0.18,
            transparent: true,
            opacity: 0.82
        })
    };
}

function buildExterior(root, materials) {
    const hullGeometry = new THREE.CapsuleGeometry(3.4, 26.4, 8, 20);
    hullGeometry.rotateX(Math.PI * 0.5);
    hullGeometry.scale(1.58, 0.72, 1);

    const hull = new THREE.Mesh(hullGeometry, materials.hull);
    hull.name = 'MainHull';
    hull.position.set(0, 1.8, 0);
    root.add(hull);

    addBox(root, 'AftEngineBlock', [10.6, 4.3, 5.4], [0, 1.65, 14.3], materials.hullPanel);
    addBox(root, 'DorsalSpine', [2.2, 1.0, 20.2], [0, 4.15, 0.8], materials.hullPanel);
    addBox(root, 'PortSidePod', [1.2, 1.5, 18], [-6.15, 1.0, 1.8], materials.hullPanel);
    addBox(root, 'StarboardSidePod', [1.2, 1.5, 18], [6.15, 1.0, 1.8], materials.hullPanel);
    addBox(root, 'ForwardCanopy', [5.8, 1.8, 5.0], [0, 3.0, -12.8], materials.glass);
    addBox(root, 'DorsalBayWindow', [4.4, 0.12, 4.8], [0, 4.72, -7.5], materials.glass, { rotation: [0.18, 0, 0] });
    addBox(root, 'PortObservationWindow', [0.12, 1.3, 4.6], [-5.55, 2.2, 0.8], materials.glass);
    addBox(root, 'StarboardObservationWindow', [0.12, 1.3, 4.6], [5.55, 2.2, 0.8], materials.glass);

    addBox(root, 'PortCyanHullStrip', [0.08, 0.08, 20.0], [-5.38, 3.0, 0.8], materials.cyanLight);
    addBox(root, 'StarboardCyanHullStrip', [0.08, 0.08, 20.0], [5.38, 3.0, 0.8], materials.cyanLight);
    addBox(root, 'AftMagentaStatusStrip', [5.8, 0.08, 0.08], [0, 3.95, 16.9], materials.magentaLight);

    addThruster(root, 'PortUpperThruster', [-3.4, 2.75, 17.45], materials);
    addThruster(root, 'StarboardUpperThruster', [3.4, 2.75, 17.45], materials);
    addThruster(root, 'PortLowerThruster', [-3.4, 0.65, 17.45], materials);
    addThruster(root, 'StarboardLowerThruster', [3.4, 0.65, 17.45], materials);

    addBox(root, 'PortAirlockOuterDoor', [0.16, 2.35, 2.25], [-6.1, 1.35, 4.2], materials.hullPanel);
    addBox(root, 'PortAirlockDoorGlow', [0.18, 1.85, 1.75], [-6.2, 1.35, 4.2], materials.orangeLight);
}

function buildInterior(root, materials) {
    addBox(root, 'CockpitDeck', [5.8, 0.12, 6.2], [0, 0, -11.2], materials.deck);
    addBox(root, 'CentralCorridorDeck', [3.4, 0.12, 11.8], [0, 0, -2.2], materials.deck);
    addBox(root, 'ObservationBayDeck', [5.4, 0.12, 4.4], [0, 0, 2.2], materials.deck);
    addBox(root, 'AirlockDeck', [2.8, 0.12, 3.2], [-4.7, 0, 4.2], materials.deck);
    addBox(root, 'ReactorDeck', [6.2, 0.12, 5.4], [0, 0, 10.4], materials.deck);

    addBox(root, 'PortCorridorWall', [0.12, 2.35, 12.4], [-1.78, 1.18, -2.0], materials.wall);
    addBox(root, 'StarboardCorridorWall', [0.12, 2.35, 12.4], [1.78, 1.18, -2.0], materials.wall);
    addBox(root, 'CockpitForwardWindowInterior', [4.6, 1.55, 0.12], [0, 2.15, -14.55], materials.glass);
    addBox(root, 'PortBayWindowInterior', [0.1, 1.25, 3.8], [-2.85, 1.7, 1.2], materials.glass);
    addBox(root, 'StarboardBayWindowInterior', [0.1, 1.25, 3.8], [2.85, 1.7, 1.2], materials.glass);

    addInteriorRib(root, -13.8, materials);
    addInteriorRib(root, -7.2, materials);
    addInteriorRib(root, -1.5, materials);
    addInteriorRib(root, 4.8, materials);
    addInteriorRib(root, 9.1, materials);

    addBox(root, 'PortHandrail', [0.08, 0.08, 15.4], [-1.48, 1.28, -2.6], materials.cyanLight);
    addBox(root, 'StarboardHandrail', [0.08, 0.08, 15.4], [1.48, 1.28, -2.6], materials.cyanLight);
    addBox(root, 'DeckCenterlineGlow', [0.08, 0.04, 20.4], [0, 0.08, -1.7], materials.cyanLight);

    buildCockpit(root, materials);
    buildAirlock(root, materials);
    buildReactorBay(root, materials);
}

function buildCockpit(root, materials) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.5, 0.42, 16), materials.trim);
    base.name = 'PilotSeatPedestal';
    base.position.set(0, 0.28, -11.55);
    root.add(base);

    addBox(root, 'PilotSeatCushion', [1.15, 0.32, 1.1], [0, 0.52, -11.55], materials.seat);
    addBox(root, 'PilotSeatBack', [1.15, 1.18, 0.22], [0, 1.12, -10.98], materials.seat, { rotation: [-0.16, 0, 0] });
    addBox(root, 'PilotControlConsole', [2.4, 0.75, 0.95], [0, 0.76, -13.08], materials.hullPanel, { rotation: [-0.2, 0, 0] });
    addBox(root, 'ControlCyanPanel', [1.9, 0.05, 0.52], [0, 1.16, -13.28], materials.cyanLight, { rotation: [-0.2, 0, 0] });
    addBox(root, 'LeftControlGrip', [0.22, 0.6, 0.22], [-0.95, 0.88, -12.7], materials.trim);
    addBox(root, 'RightControlGrip', [0.22, 0.6, 0.22], [0.95, 0.88, -12.7], materials.trim);
}

function buildAirlock(root, materials) {
    addBox(root, 'AirlockBackWall', [2.8, 2.55, 0.12], [-4.7, 1.28, 5.8], materials.wall);
    addBox(root, 'AirlockForwardWall', [2.8, 2.55, 0.12], [-4.7, 1.28, 2.6], materials.wall);
    addBox(root, 'AirlockCeiling', [2.8, 0.12, 3.2], [-4.7, 2.64, 4.2], materials.wall);
    addBox(root, 'AirlockInnerDoor', [0.14, 2.25, 1.65], [-3.08, 1.26, 4.2], materials.hullPanel);
    addBox(root, 'AirlockOuterDoor', [0.14, 2.25, 1.85], [-6.18, 1.26, 4.2], materials.hullPanel);
    addBox(root, 'AirlockOuterDoorGlow', [0.16, 1.75, 1.42], [-6.27, 1.26, 4.2], materials.orangeLight);
    addBox(root, 'AirlockFloorWarningA', [1.8, 0.04, 0.08], [-4.7, 0.1, 3.25], materials.orangeLight);
    addBox(root, 'AirlockFloorWarningB', [1.8, 0.04, 0.08], [-4.7, 0.1, 5.15], materials.orangeLight);
}

function buildReactorBay(root, materials) {
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.25, 24), materials.reactor);
    core.name = 'ReactorCore';
    core.position.set(0, 1.28, 10.45);
    root.add(core);

    addBox(root, 'ReactorLowerClamp', [2.8, 0.14, 2.8], [0, 0.55, 10.45], materials.trim);
    addBox(root, 'ReactorUpperClamp', [2.8, 0.14, 2.8], [0, 2.05, 10.45], materials.trim);
    addBox(root, 'PortReactorPipe', [0.18, 0.18, 4.7], [-2.15, 1.35, 10.45], materials.cyanLight);
    addBox(root, 'StarboardReactorPipe', [0.18, 0.18, 4.7], [2.15, 1.35, 10.45], materials.cyanLight);
    addBox(root, 'AftServicePanel', [4.8, 1.4, 0.14], [0, 1.45, 13.05], materials.hullPanel);
    addBox(root, 'AftServicePanelGlow', [3.2, 0.08, 0.16], [0, 1.95, 12.96], materials.magentaLight);
}

function addInteriorRib(root, z, materials) {
    addBox(root, `CeilingRib_${z}`, [4.4, 0.18, 0.18], [0, 2.62, z], materials.trim);
    addBox(root, `PortVerticalRib_${z}`, [0.16, 2.4, 0.16], [-1.72, 1.25, z], materials.trim);
    addBox(root, `StarboardVerticalRib_${z}`, [0.16, 2.4, 0.16], [1.72, 1.25, z], materials.trim);
}

function addThruster(root, name, position, materials) {
    const nozzleGeometry = new THREE.CylinderGeometry(0.78, 0.95, 1.2, 24, 1, true);
    nozzleGeometry.rotateX(Math.PI * 0.5);

    const nozzle = new THREE.Mesh(nozzleGeometry, materials.hullPanel);
    nozzle.name = name;
    nozzle.position.fromArray(position);
    root.add(nozzle);

    addBox(root, `${name}Glow`, [1.05, 1.05, 0.08], [position[0], position[1], position[2] + 0.66], materials.orangeLight);
}

function addBox(parent, name, size, position, material, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.name = name;
    mesh.position.fromArray(position);

    if (options.rotation) {
        mesh.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
    }

    parent.add(mesh);
    return mesh;
}
