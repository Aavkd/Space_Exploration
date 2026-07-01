import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_SYSTEM_TIME = 0;
const BODY_DISTANCE_FACTOR = 0.96;
const MOON_DISTANCE_FACTOR = 0.94;
const TRANSIT_DISTANCE_FACTOR = 0.91;
const MAX_PROJECTED_BODIES = 10;
const MAX_PROJECTED_MOONS = 16;
const MIN_DISC_ANGULAR = 0.005;
const MAX_DISC_ANGULAR = 0.04;
const MIN_MOON_ANGULAR = 0.003;
const MAX_MOON_ANGULAR = 0.013;
const SUN_MIN_ANGULAR = 0.02;
const SUN_MAX_ANGULAR = 0.07;

const scratchEuler = new THREE.Euler();
const scratchVecA = new THREE.Vector3();
const scratchVecB = new THREE.Vector3();
const scratchVecC = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();

let DISC_TEXTURE = null;

export function evaluateParentSystemSnapshot(snapshot, elapsedTime = 0, target = {}) {
    const systemTime = (snapshot?.systemTime ?? DEFAULT_SYSTEM_TIME) + elapsedTime;
    const selected = snapshot?.selected ?? null;
    const selectedPosition = selected
        ? bodyParentPosition(selected, elapsedTime, target.selectedPosition ?? new THREE.Vector3())
        : (target.selectedPosition ?? new THREE.Vector3()).set(0, 0, 0);
    const starPosition = vectorFromArray(snapshot?.star?.position, target.starPosition ?? new THREE.Vector3());
    const starVector = (target.starVector ?? new THREE.Vector3()).copy(starPosition).sub(selectedPosition);
    const sunDirParent = normalizeOrDefault(starVector, target.sunDirParent ?? new THREE.Vector3(), new THREE.Vector3(-1, 0.2, 0.3));
    const sunDirLocal = parentToPlanetLocalDirection(sunDirParent, selected, elapsedTime, target.sunDirLocal ?? new THREE.Vector3());
    const selectedSpinAngle = selectedSpin(selected, elapsedTime);

    target.systemTime = systemTime;
    target.selected = selected;
    target.selectedPosition = selectedPosition;
    target.starPosition = starPosition;
    target.starVector = starVector;
    target.sunDirParent = sunDirParent;
    target.sunDirLocal = sunDirLocal;
    target.selectedSpinAngle = selectedSpinAngle;
    target.starDistance = Math.max(1, starVector.length());
    target.starAngular = angularRadius(snapshot?.star?.radius ?? 1, target.starDistance, 6.0, SUN_MIN_ANGULAR, SUN_MAX_ANGULAR);
    return target;
}

export function parentFrameQuaternion(selected, elapsedTime = 0, target = new THREE.Quaternion()) {
    return target.setFromAxisAngle(UP, selectedSpin(selected, elapsedTime));
}

export function childFrameQuaternion(selected, elapsedTime = 0, target = new THREE.Quaternion()) {
    return target.setFromAxisAngle(UP, -selectedSpin(selected, elapsedTime));
}

export function parentToPlanetLocalDirection(vector, selected, elapsedTime = 0, target = new THREE.Vector3()) {
    target.copy(vector);
    if (target.lengthSq() < 1e-10) return target.set(0, 0, 1);
    target.normalize();
    return target.applyQuaternion(childFrameQuaternion(selected, elapsedTime, scratchQuat)).normalize();
}

export function planetLocalToParentDirection(vector, selected, elapsedTime = 0, target = new THREE.Vector3()) {
    target.copy(vector);
    if (target.lengthSq() < 1e-10) return target.set(0, 0, 1);
    target.normalize();
    return target.applyQuaternion(parentFrameQuaternion(selected, elapsedTime, scratchQuat)).normalize();
}

export function angularRadius(radius = 1, distance = 1, exaggeration = 1, min = 0, max = Infinity) {
    const value = (Math.max(0, radius) / Math.max(1, distance)) * exaggeration;
    return THREE.MathUtils.clamp(value, min, max);
}

export function bodyParentPosition(body, elapsedTime = 0, target = new THREE.Vector3()) {
    if (Number.isFinite(body?.orbitRadius) && Array.isArray(body?.orbitRotation)) {
        const [x = 0, y = 0, z = 0, order = 'XYZ'] = body.orbitRotation;
        scratchEuler.set(x, y + (body.orbitSpeed ?? 0) * elapsedTime, z, order);
        return target.set(body.orbitRadius, 0, 0).applyEuler(scratchEuler);
    }
    return vectorFromArray(body?.position, target);
}

export function moonParentPosition(parentBody, moon, elapsedTime = 0, target = new THREE.Vector3()) {
    bodyParentPosition(parentBody, elapsedTime, target);
    if (!moon) return target;
    const [x = 0, y = 0, z = 0, order = 'XYZ'] = moon.orbitRotation ?? [];
    scratchEuler.set(x, y + (moon.orbitSpeed ?? 0) * elapsedTime, z, order);
    scratchVecA.set(moon.orbitRadius ?? 1, 0, 0).applyEuler(scratchEuler);
    return target.add(scratchVecA);
}

export function vectorFromArray(value, target = new THREE.Vector3()) {
    return Array.isArray(value)
        ? target.fromArray(value)
        : target.set(0, 0, 0);
}

export function selectedSpin(selected, elapsedTime = 0) {
    return (selected?.spinPhase ?? 0) + (selected?.spinSpeed ?? 0) * elapsedTime;
}

export function buildProjectedSystemSky({
    parentSystem,
    sunColor = new THREE.Color('#fff2d6'),
    planetScale = 1,
    moonScale = 1,
    includeBodyLimit = MAX_PROJECTED_BODIES
} = {}) {
    const group = new THREE.Group();
    group.name = 'ProjectedParentSystemSky';

    const sunMaterial = new THREE.SpriteMaterial({
        map: discTexture(),
        color: sunColor,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false
    });
    const sun = new THREE.Sprite(sunMaterial);
    sun.name = `ProjectedSun:${parentSystem?.star?.name ?? 'Parent star'}`;
    sun.frustumCulled = false;
    sun.renderOrder = 1000;
    group.add(sun);

    const glareMaterial = new THREE.SpriteMaterial({
        map: discTexture(),
        color: sunColor,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false
    });
    const glare = new THREE.Sprite(glareMaterial);
    glare.name = `ProjectedSunGlare:${parentSystem?.star?.name ?? 'Parent star'}`;
    glare.frustumCulled = false;
    glare.renderOrder = 999;
    group.add(glare);

    const bodies = [];
    for (const body of (parentSystem?.bodies ?? []).slice(0, includeBodyLimit)) {
        const entry = createProjectedBody(body, { planetScale });
        bodies.push(entry);
        group.add(entry.root);
    }

    const moons = [];
    for (const body of [parentSystem?.selected, ...(parentSystem?.bodies ?? [])]) {
        for (const moon of body?.moons ?? []) {
            if (moons.length >= MAX_PROJECTED_MOONS) break;
            const entry = createProjectedMoon(body, moon, { moonScale });
            moons.push(entry);
            group.add(entry.root);
        }
        if (moons.length >= MAX_PROJECTED_MOONS) break;
    }

    const transits = [];

    return {
        group,
        sun,
        glare,
        bodies,
        moons,
        transits,
        counts: () => ({
            siblings: bodies.length,
            moons: moons.length,
            rings: bodies.filter((entry) => entry.ring).length
        })
    };
}

export function updateProjectedSystemSky(sky, {
    parentSystem,
    elapsedTime = 0,
    skyOrigin = new THREE.Vector3(),
    skyDistance = 100000,
    sunColor = new THREE.Color('#fff2d6'),
    systemState = null,
    occluderCenter = null,
    occluderRadius = 0
} = {}) {
    if (!sky || !parentSystem?.star || !parentSystem?.selected) return null;
    const state = systemState ?? evaluateParentSystemSnapshot(parentSystem, elapsedTime, {});
    const glare = glareTuning(parentSystem.star);

    sky.transits.length = 0;

    sky.sun.position.copy(skyOrigin).addScaledVector(state.sunDirLocal, skyDistance);
    sky.sun.scale.setScalar(skyDistance * state.starAngular);
    sky.sun.material.color.copy(sunColor);
    const horizon = sunHorizonVisibility(skyOrigin, state.sunDirLocal, occluderCenter, occluderRadius);
    sky.sun.visible = horizon > 0.001;
    sky.glare.visible = horizon > 0.001;
    sky.sun.material.opacity = horizon;

    sky.glare.position.copy(skyOrigin).addScaledVector(state.sunDirLocal, skyDistance * 0.998);
    sky.glare.scale.setScalar(skyDistance * state.starAngular * glare.scale);
    sky.glare.material.color.copy(sunColor);
    sky.glare.material.opacity = glare.opacity * horizon;

    for (const entry of sky.bodies) {
        updateProjectedBody(entry, parentSystem, elapsedTime, skyOrigin, skyDistance, state, sky.transits);
    }
    for (const entry of sky.moons) {
        updateProjectedMoon(entry, parentSystem, elapsedTime, skyOrigin, skyDistance, state, sky.transits);
    }

    const eclipseStrength = Math.min(0.82, sky.transits
        .filter((event) => event.kind === 'eclipse')
        .reduce((sum, event) => sum + event.coverage, 0));
    if (eclipseStrength > 0) {
        sky.sun.material.opacity = horizon * (1 - eclipseStrength * 0.75);
        sky.glare.material.opacity = glare.opacity * horizon * (1 - eclipseStrength);
    }

    return state;
}

export function sunHorizonVisibility(origin, sunDir, occluderCenter, occluderRadius = 0) {
    if (!occluderCenter || !Number.isFinite(occluderRadius) || occluderRadius <= 0) return 1;
    const p = scratchVecA.copy(origin).sub(occluderCenter);
    const radius = Math.max(0, occluderRadius);
    const distanceSq = p.lengthSq();
    if (distanceSq <= radius * radius) return 0;

    const dir = scratchVecB.copy(sunDir);
    if (dir.lengthSq() < 1e-10) return 1;
    dir.normalize();

    const along = p.dot(dir);
    if (along >= 0) return 1;

    const closestSq = distanceSq - along * along;
    const margin = Math.max(radius * 0.018, 1200);
    const fadeStart = Math.max(0, radius - margin);
    if (closestSq <= fadeStart * fadeStart) return 0;
    if (closestSq >= radius * radius) return 1;

    const closest = Math.sqrt(Math.max(0, closestSq));
    return THREE.MathUtils.smoothstep(closest, fadeStart, radius);
}

export function atmosphereUniforms(atmosphere = {}, sunDir = new THREE.Vector3(0, 1, 0)) {
    const base = new THREE.Color(atmosphere.color ?? '#7fb6ff');
    return {
        uColor: { value: base },
        uDayColor: { value: base.clone().lerp(new THREE.Color('#8ec7ff'), 0.35) },
        uSunsetColor: { value: new THREE.Color('#ff9f55') },
        uNightColor: { value: base.clone().multiplyScalar(0.18).lerp(new THREE.Color('#20365f'), 0.45) },
        uSunDir: { value: sunDir.clone() }
    };
}

export function projectedSkyTelemetry(sky, state) {
    const counts = sky?.counts?.() ?? { siblings: 0, moons: 0, rings: 0 };
    return {
        systemTime: state?.systemTime ?? null,
        sunDir: state?.sunDirLocal?.toArray?.() ?? null,
        parentSunDir: state?.sunDirParent?.toArray?.() ?? null,
        selectedSpinAngle: state?.selectedSpinAngle ?? null,
        selectedSpinDeg: Number.isFinite(state?.selectedSpinAngle)
            ? THREE.MathUtils.radToDeg(state.selectedSpinAngle)
            : null,
        projectedBodies: counts.siblings,
        projectedSiblings: counts.siblings,
        projectedMoons: counts.moons,
        projectedRings: counts.rings,
        activeTransits: (sky?.transits ?? []).map((event) => ({ ...event }))
    };
}

function createProjectedBody(body, { planetScale = 1 } = {}) {
    const root = new THREE.Group();
    root.name = `ProjectedSystemBody:${body.name}`;
    root.userData.body = body;

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, body.kind === 'gas' ? 32 : 24, body.kind === 'gas' ? 16 : 12),
        createBodyMaterial(body)
    );
    mesh.name = `ProjectedBodyDisc:${body.name}`;
    mesh.frustumCulled = false;
    root.add(mesh);

    let ring = null;
    if (body.hasRings) {
        const ringColor = colorFromHex(body.ring?.color ?? body.color, '#d8c38a');
        ring = new THREE.Mesh(
            new THREE.RingGeometry(1.35, 2.28, 80, 4),
            new THREE.MeshBasicMaterial({
                color: ringColor,
                transparent: true,
                opacity: 0.46,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                fog: false
            })
        );
        ring.name = `ProjectedBodyRings:${body.name}`;
        ring.frustumCulled = false;
        root.add(ring);
    }

    return { root, mesh, ring, body, planetScale };
}

function createProjectedMoon(parentBody, moon, { moonScale = 1 } = {}) {
    const root = new THREE.Group();
    root.name = `ProjectedMoon:${parentBody?.name ?? 'Body'}:${moon.name}`;
    root.userData.body = parentBody;
    root.userData.moon = moon;

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 9),
        createBodyMaterial({ ...moon, kind: 'moon', color: moon.color ?? '#b8b8b8' })
    );
    mesh.name = `ProjectedMoonDisc:${moon.name}`;
    mesh.frustumCulled = false;
    root.add(mesh);

    return { root, mesh, body: parentBody, moon, moonScale };
}

function updateProjectedBody(entry, parentSystem, elapsedTime, skyOrigin, skyDistance, state, transits) {
    const selectedPosition = state.selectedPosition;
    const bodyPosition = bodyParentPosition(entry.body, elapsedTime, scratchVecA);
    const rel = scratchVecB.copy(bodyPosition).sub(selectedPosition);
    const distance = rel.length();
    if (distance < 1e-6) {
        entry.root.visible = false;
        return;
    }

    const dir = parentToPlanetLocalDirection(rel, parentSystem.selected, elapsedTime, scratchVecC);
    const angular = angularRadius(entry.body.radius, distance, 3.0 * entry.planetScale, MIN_DISC_ANGULAR, entry.body.kind === 'gas' ? MAX_DISC_ANGULAR : 0.028);
    const projectedScale = skyDistance * angular;
    entry.root.visible = true;
    entry.root.position.copy(skyOrigin).addScaledVector(dir, skyDistance * BODY_DISTANCE_FACTOR);
    entry.mesh.scale.setScalar(projectedScale);
    entry.mesh.material.uniforms.uSunDir.value.copy(state.sunDirLocal);
    entry.mesh.material.uniforms.uTransit.value = transitCoverage(dir, angular, state.sunDirLocal, state.starAngular);

    if (entry.ring) {
        const ringScale = projectedScale * 2.0;
        entry.ring.scale.setScalar(ringScale);
        entry.ring.quaternion.copy(parentFrameQuaternion(entry.body, elapsedTime, scratchQuat));
        entry.ring.rotateX(Math.PI * 0.5 + (entry.body.ring?.tilt ?? 0));
        entry.ring.material.opacity = entry.body.ring?.opacity ?? 0.42;
    }

    pushTransitEvent(transits, {
        kind: 'transit',
        name: entry.body.name,
        bodyKind: entry.body.kind,
        dir,
        angular,
        sunDir: state.sunDirLocal,
        sunAngular: state.starAngular
    });
}

function updateProjectedMoon(entry, parentSystem, elapsedTime, skyOrigin, skyDistance, state, transits) {
    const selectedPosition = state.selectedPosition;
    const moonPosition = moonParentPosition(entry.body, entry.moon, elapsedTime, scratchVecA);
    const rel = scratchVecB.copy(moonPosition).sub(selectedPosition);
    const distance = rel.length();
    if (distance < 1e-6) {
        entry.root.visible = false;
        return;
    }

    const dir = parentToPlanetLocalDirection(rel, parentSystem.selected, elapsedTime, scratchVecC);
    const selectedMoon = entry.body?.id === parentSystem.selected?.id;
    const angular = angularRadius(
        entry.moon.radius,
        distance,
        selectedMoon ? 4.0 * entry.moonScale : 2.6 * entry.moonScale,
        MIN_MOON_ANGULAR,
        selectedMoon ? MAX_MOON_ANGULAR : 0.009
    );
    const projectedScale = skyDistance * angular;

    entry.root.visible = true;
    entry.root.position.copy(skyOrigin).addScaledVector(dir, skyDistance * (selectedMoon ? MOON_DISTANCE_FACTOR : BODY_DISTANCE_FACTOR));
    entry.mesh.scale.setScalar(projectedScale);
    entry.mesh.material.uniforms.uSunDir.value.copy(state.sunDirLocal);
    entry.mesh.material.uniforms.uTransit.value = transitCoverage(dir, angular, state.sunDirLocal, state.starAngular);

    pushTransitEvent(transits, {
        kind: selectedMoon ? 'eclipse' : 'transit',
        name: entry.moon.name,
        parent: entry.body?.name ?? null,
        bodyKind: 'moon',
        dir,
        angular,
        sunDir: state.sunDirLocal,
        sunAngular: state.starAngular
    });

    if (entry.mesh.material.uniforms.uTransit.value > 0.02) {
        entry.root.position.copy(skyOrigin).addScaledVector(dir, skyDistance * TRANSIT_DISTANCE_FACTOR);
    }
}

function pushTransitEvent(events, { kind, name, parent = null, bodyKind, dir, angular, sunDir, sunAngular }) {
    const coverage = transitCoverage(dir, angular, sunDir, sunAngular);
    if (coverage <= 0.03) return;
    events.push({
        kind,
        name,
        parent,
        bodyKind,
        coverage,
        angular,
        separation: dir.angleTo(sunDir)
    });
}

function transitCoverage(dir, angular, sunDir, sunAngular) {
    const separation = dir.angleTo(sunDir);
    const overlap = angularDiscOverlap(angular, sunAngular, separation);
    if (overlap <= 0) return 0;
    const sunArea = Math.PI * sunAngular * sunAngular;
    return THREE.MathUtils.clamp(overlap / Math.max(sunArea, 1e-8), 0, 1);
}

export function angularDiscOverlap(radiusA, radiusB, distance) {
    if (distance >= radiusA + radiusB) return 0;
    if (distance <= Math.abs(radiusA - radiusB)) {
        const r = Math.min(radiusA, radiusB);
        return Math.PI * r * r;
    }
    const a2 = radiusA * radiusA;
    const b2 = radiusB * radiusB;
    const alpha = Math.acos(THREE.MathUtils.clamp((distance * distance + a2 - b2) / (2 * distance * radiusA), -1, 1));
    const beta = Math.acos(THREE.MathUtils.clamp((distance * distance + b2 - a2) / (2 * distance * radiusB), -1, 1));
    const lens = 0.5 * Math.sqrt(Math.max(0,
        (-distance + radiusA + radiusB) *
        (distance + radiusA - radiusB) *
        (distance - radiusA + radiusB) *
        (distance + radiusA + radiusB)
    ));
    return a2 * alpha + b2 * beta - lens;
}

function createBodyMaterial(body) {
    const color = colorFromHex(body.color, '#c8c8c8');
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: color },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uAmbient: { value: body.kind === 'gas' ? 0.24 : 0.18 },
            uTransit: { value: 0 }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vWorldNormal;
            varying vec3 vLocal;
            void main() {
                vNormal = normalize(normal);
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                vLocal = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vWorldNormal;
            varying vec3 vLocal;
            uniform vec3 uColor;
            uniform vec3 uSunDir;
            uniform float uAmbient;
            uniform float uTransit;
            void main() {
                float ndl = max(dot(normalize(vWorldNormal), normalize(uSunDir)), 0.0);
                float band = sin(vLocal.y * 13.0 + vLocal.x * 2.0) * 0.5 + 0.5;
                vec3 tint = uColor * (0.78 + band * 0.18);
                vec3 color = tint * (uAmbient + smoothstep(0.0, 0.24, ndl) * 1.15);
                color = mix(color, vec3(0.015, 0.012, 0.010), smoothstep(0.02, 0.28, uTransit));
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        fog: false
    });
}

function glareTuning(star = {}) {
    const luminosity = Math.max(0.25, star.luminosity ?? 1);
    const temperature = star.temperatureK ?? 5800;
    const hot = THREE.MathUtils.clamp((temperature - 4300) / 4200, 0, 1);
    return {
        scale: THREE.MathUtils.clamp(2.8 + Math.sqrt(luminosity) * 1.15 + hot * 0.55, 3.0, 5.8),
        opacity: THREE.MathUtils.clamp(0.14 + Math.sqrt(luminosity) * 0.07 + hot * 0.03, 0.12, 0.34)
    };
}

function normalizeOrDefault(value, target, fallback) {
    target.copy(value);
    if (target.lengthSq() < 1e-10) target.copy(fallback);
    return target.normalize();
}

function discTexture() {
    if (DISC_TEXTURE) return DISC_TEXTURE;
    if (typeof document === 'undefined') {
        const data = new Uint8Array([255, 255, 255, 255]);
        DISC_TEXTURE = new THREE.DataTexture(data, 1, 1);
        DISC_TEXTURE.needsUpdate = true;
        return DISC_TEXTURE;
    }

    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
    gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.52, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.80, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    DISC_TEXTURE = new THREE.CanvasTexture(canvas);
    DISC_TEXTURE.colorSpace = THREE.SRGBColorSpace;
    return DISC_TEXTURE;
}

function colorFromHex(value, fallback = '#ffffff') {
    if (!value) return new THREE.Color(fallback);
    const text = String(value);
    return new THREE.Color(text.startsWith('#') ? text : `#${text}`);
}
