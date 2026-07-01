import * as THREE from 'three';
import { QuadPlanetContents } from '../../src/space/universe/QuadPlanetContents.js';

const canvas = document.querySelector('#planet');
const status = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07111e');
scene.add(new THREE.AmbientLight('#b8d2df', 1.5));
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 30_000_000);
const descriptor = {
    seed: 'phase-25-browser-world',
    childSeed: 'phase-25-browser-world',
    name: 'Phase 25 Temperate Test',
    kind: 'terrestrial',
    type: 'temperate',
    landable: true,
    systemRadius: 1200,
    palette: {
        water: '#2073a3',
        lowland: '#4f9b58',
        midland: '#9a7b45',
        highland: '#60635f',
        snow: '#e7f2f4',
        rock: '#343a36',
        accent: '#d8c98b',
        emissive: '#5fd6ff'
    },
    atmosphere: { color: '#6fb4ff', density: 0.42, rimStrength: 1.3 },
    surface: {
        hasWater: true,
        seaLevel: 0.5,
        reliefMetres: 16_000,
        baseFreq: 2.25,
        detailAmplitude: 360,
        detailFreq: 360,
        ridgeAmplitude: 1200,
        ridgeFreq: 820,
        microAmplitude: 90,
        microFreq: 4800,
        moistureFreq: 5.5,
        temperatureBias: 0.03
    }
};

const planet = new QuadPlanetContents({
    seed: descriptor.seed,
    descriptor,
    regionRadius: 12_000_000
});
scene.add(planet.group);

const requestedView = new URLSearchParams(location.search).get('view') ?? 'land';
const targetRegion = requestedView === 'water'
    ? planet.findRegions({ biome: 'ocean', kind: 'sea' })[0]
    : planet.findRegions({ biome: 'green lowland', kind: 'region' })[0]
        ?? planet.findRegions({ kind: 'region' })[0];
const landPlacement = planet.resolveRegionPlacement(targetRegion.id, {
    seed: 'browser-harness',
    maxSlopeDeg: 18
});
const viewDirection = new THREE.Vector3().fromArray(landPlacement.direction);
camera.position.copy(viewDirection).multiplyScalar(landPlacement.height + (requestedView === 'water' ? 140 : 35));
const tangent = new THREE.Vector3(-viewDirection.z, 0, viewDirection.x).normalize();
camera.lookAt(
    viewDirection.clone().multiplyScalar(landPlacement.height - (requestedView === 'water' ? 5 : 10))
        .addScaledVector(tangent, requestedView === 'water' ? 420 : 95)
);

let last = performance.now();
const frameTimes = [];
function render(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 120) frameTimes.shift();
    planet.update(camera.position, dt, camera.position);
    planet._material.uniforms.uSunDir.value.copy(viewDirection);
    if (planet.water?.material?.uniforms?.uSunDir) {
        planet.water.material.uniforms.uSunDir.value.copy(viewDirection);
    }
    renderer.render(scene, camera);
    const state = planet.getPlanetState(camera.position);
    status.textContent = JSON.stringify({
        ready: true,
        regionCount: planet.getRegions().length,
        regionId: state.regionId,
        biome: state.biome,
        regionBiome: state.regionBiome,
        leafTiles: state.leafTiles,
        maxLodDepth: state.maxLodDepth,
        averageFrameMs: Number(
            (frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length).toFixed(2)
        ),
        cover: state.cover,
        water: state.water
    }, null, 2);
    requestAnimationFrame(render);
}
requestAnimationFrame(render);

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

addEventListener('error', (event) => {
    status.textContent = `ERROR: ${event.message}`;
});
