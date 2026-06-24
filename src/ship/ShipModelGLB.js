import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    SHIP_DIMENSIONS,
    SHIP_INTERIOR_ZONES,
    createShipAnchors
} from './ShipInterior.js';

// External hull authored in Blender (converted from a Star Citizen .ctm).
// Single untextured, materialless high-poly mesh, so we normalize its scale
// and apply a Deep Space hull material on load.
export const SHIP_GLB_URL = './ship.glb';

// Lengthwise axis of the source mesh used to normalize scale onto the 34 m
// design length shared with the procedural blockout.
const NORMALIZE_AXIS = 'z';

// Where the normalized hull centroid sits on Y, roughly matching the
// procedural hull center so the exterior debug camera framing stays valid.
const VERTICAL_CENTER = 2.2;

// Glass authored as OPAQUE in Blender (transmission does not survive glTF export
// without KHR_materials_transmission). Matched by MATERIAL name so every mesh
// using the shared "Architectural Glass" material -- including the full cockpit
// canopy dome -- becomes see-through. The material is cloned per mesh before
// editing, so non-glass props keep their own materials untouched.
const GLASS_MATERIAL_PATTERN = /architectural glass|canopy|windshield|windscreen|\bvisor\b|\bglass\b/i;

// Engine/RCS flame and jet sprite cards. Authored OPAQUE/BLEND, so idle they
// render as flat gray/brown quads scattered over the hull instead of firing
// effects. Hidden while idle; can be re-enabled later as additive thruster FX.
const FX_SPRITE_MATERIAL_PATTERN = /^fire_mat|^rcs_thruster|hyperdrive_fx/i;

export const GLB_SHIP_PARTS = Object.freeze([
    {
        id: 'importedHull',
        role: 'Star Citizen exterior hull imported from ship.glb',
        source: SHIP_GLB_URL,
        material: 'darkMetal'
    }
]);

function createHullMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x39424f,
        metalness: 0.78,
        roughness: 0.42,
        emissive: 0x03070c,
        emissiveIntensity: 1,
        // The Blender->GLB export has inconsistent face winding, so single-sided
        // culling makes near walls vanish and you see through the hull.
        // DoubleSide renders every face and corrects lighting per-face.
        side: THREE.DoubleSide
    });
}

function normalizeHull(model, { targetLength, verticalCenter }) {
    model.updateWorldMatrix(true, true);

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);

    const sourceLength = size[NORMALIZE_AXIS] || Math.max(size.x, size.y, size.z) || 1;
    const scale = targetLength / sourceLength;
    model.scale.multiplyScalar(scale);

    model.updateWorldMatrix(true, true);
    const scaledBox = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);

    // Recenter horizontally on the ship root and lift to the design centroid.
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y += verticalCenter - center.y;

    model.updateWorldMatrix(true, true);
    const finalBox = new THREE.Box3().setFromObject(model);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);

    return { appliedScale: scale, size: finalSize.toArray() };
}

// Fallback used only when the GLB ships with no materials of its own
// (e.g. a mesh-only OpenCTM/.ctm conversion).
function applyHullMaterial(model, material) {
    model.traverse((node) => {
        if (!node.isMesh) return;
        node.material = material;
        node.castShadow = false;
        node.receiveShadow = false;
        node.frustumCulled = true;
    });
}

// When the GLB already has authored materials/textures, keep them and only
// nudge the properties we care about: render both faces (winding fix) and let
// PBR metals pick up the scene environment so they are not rendered near-black.
function prepareAuthoredMaterials(model, { envMapIntensity = 0.85 } = {}) {
    model.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = false;
        node.receiveShadow = false;
        node.frustumCulled = true;

        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
            if (!material) continue;
            material.side = THREE.DoubleSide;
            if ('envMapIntensity' in material) material.envMapIntensity = envMapIntensity;
            material.needsUpdate = true;
        }
    });
}

// Converts the canopy meshes into see-through windows by cloning their material
// (so shared opaque props stay opaque). Returns the cloned glass materials so the
// runtime can re-tune their opacity live.
function applyGlassMaterials(model, { opacity = 0.15 } = {}) {
    const glassMaterials = new Set();

    const toGlass = (material) => {
        const glass = material.clone();
        glass.transparent = true;
        glass.opacity = opacity;
        glass.depthWrite = false;
        glass.metalness = 0;
        // Deliberately NOT a mirror: a glossy canopy reflects the studio IBL
        // (RoomEnvironment) back as a bright floating rectangle in deep space.
        // Soft, low-intensity reflection keeps it reading as glass without that
        // artifact. The hull envMap slider skips glass so this value sticks.
        glass.roughness = Math.max(glass.roughness ?? 0.2, 0.22);
        if ('envMapIntensity' in glass) glass.envMapIntensity = 0.12;
        if ('clearcoat' in glass) {
            glass.clearcoat = 0.2;
            glass.clearcoatRoughness = 0.5;
        }
        glass.side = THREE.DoubleSide;
        glass.needsUpdate = true;
        glassMaterials.add(glass);
        return glass;
    };

    model.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        let changed = false;
        const next = materials.map((material) => {
            if (material && GLASS_MATERIAL_PATTERN.test(material.name || '')) {
                changed = true;
                return toGlass(material);
            }
            return material;
        });
        if (changed) node.material = Array.isArray(node.material) ? next : next[0];
    });

    return [...glassMaterials];
}

// Hides flat flame/jet sprite cards (matched by FX material name) that otherwise
// appear as opaque patches on the hull while idle. Returns the hidden meshes.
function hideFxSprites(model) {
    const hidden = [];

    model.traverse((node) => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (materials.some((material) => material && FX_SPRITE_MATERIAL_PATTERN.test(material.name || ''))) {
            node.visible = false;
            hidden.push(node);
        }
    });

    return hidden;
}

/**
 * Builds the GLB-backed ship model bundle. The anchor/interior frame is created
 * synchronously (it is model-independent), while the heavy exterior mesh streams
 * in and is attached to `exteriorRoot` when ready. Mirrors the bundle shape of
 * `createShipModel()` so `Ship` can use either variant interchangeably.
 */
export function createGlbShipModel({
    url = SHIP_GLB_URL,
    targetLength = SHIP_DIMENSIONS.length,
    verticalCenter = VERTICAL_CENTER,
    glassOpacity = 0.15,
    showDebugMarkers = true,
    onLoad,
    onProgress,
    onError
} = {}) {
    const root = new THREE.Group();
    root.name = 'ShipModelGlb';

    const exteriorRoot = new THREE.Group();
    exteriorRoot.name = 'ShipExterior';

    const interiorRoot = new THREE.Group();
    interiorRoot.name = 'ShipInterior';

    const { root: anchorRoot, anchors } = createShipAnchors({ showDebugMarkers });

    root.add(exteriorRoot, interiorRoot, anchorRoot);
    root.userData = {
        units: SHIP_DIMENSIONS.units,
        dimensions: SHIP_DIMENSIONS,
        zones: SHIP_INTERIOR_ZONES,
        parts: GLB_SHIP_PARTS,
        variant: 'glb',
        loaded: false
    };

    const hullMaterial = createHullMaterial();
    const loader = new GLTFLoader();

    const ready = new Promise((resolve, reject) => {
        loader.load(
            url,
            (gltf) => {
                const model = gltf.scene;
                model.name = 'ImportedShipHull';

                const hasAuthoredMaterials = (gltf.parser?.json?.materials?.length ?? 0) > 0;
                let glassMaterials = [];
                let fxSprites = [];
                if (hasAuthoredMaterials) {
                    prepareAuthoredMaterials(model);
                    glassMaterials = applyGlassMaterials(model, { opacity: glassOpacity });
                    fxSprites = hideFxSprites(model);
                } else {
                    applyHullMaterial(model, hullMaterial);
                }

                // The source hull faces +Z (cockpit/canopy sit on the +Z end),
                // but the whole project treats -Z as forward: physics thrust,
                // the cockpit/window anchors and the speed lines all point -Z.
                // Without this flip the ship flies tail-first and reads as
                // "reversed" in every camera mode. Applied before normalizeHull
                // so the recenter is computed in the corrected orientation.
                model.rotation.y = Math.PI;

                const normalized = normalizeHull(model, { targetLength, verticalCenter });

                const animations = gltf.animations ?? [];
                const mixer = animations.length ? new THREE.AnimationMixer(model) : null;

                exteriorRoot.add(model);
                root.userData.loaded = true;
                root.userData.usesAuthoredMaterials = hasAuthoredMaterials;
                root.userData.glassMaterialCount = glassMaterials.length;
                root.userData.hiddenFxSpriteCount = fxSprites.length;
                root.userData.animationNames = animations.map((clip) => clip.name);
                root.userData.normalized = normalized;

                const result = {
                    gltf,
                    model,
                    hasAuthoredMaterials,
                    glassMaterials,
                    fxSprites,
                    animations,
                    mixer,
                    ...normalized
                };
                if (onLoad) onLoad(result);
                resolve(result);
            },
            onProgress,
            (error) => {
                console.error('Failed to load ship GLB from', url, error);
                if (onError) onError(error);
                reject(error);
            }
        );
    });

    return {
        root,
        exteriorRoot,
        interiorRoot,
        anchorRoot,
        anchors,
        dimensions: SHIP_DIMENSIONS,
        zones: SHIP_INTERIOR_ZONES,
        parts: GLB_SHIP_PARTS,
        material: hullMaterial,
        ready
    };
}
