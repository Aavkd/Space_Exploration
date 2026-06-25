import * as THREE from 'three';
import { createSeededRandom, gaussian, randomRange } from './rng.js';
import { getImpostorTexture } from './impostors.js';

export class GalaxyInteriorField {
    constructor({ config }) {
        this.config = config;
        this.interior = config.galaxyInterior ?? {};
        this.descriptor = this.interior.descriptor ?? fallbackDescriptor(config);
        this.rng = createSeededRandom(`${this.descriptor.seed}:interior`);
        this.group = new THREE.Group();
        this.group.name = 'GalaxyInteriorField';
        this.disk = null;
        this.gas = null;
        this.hii = null;
        this.core = null;

        if (this.interior.enabled !== false) this._create();
        this.setRuntimeConfig(this.interior);
    }

    update(dt) {
        const speed = 0.0025 * (this.descriptor.spin ?? 1);
        if (this.disk) {
            this.disk.rotation.y += dt * speed;
            this.disk.material.uniforms.time.value += dt;
        }
        if (this.gas) {
            this.gas.rotation.y += dt * speed * 0.62;
            this.gas.material.uniforms.time.value += dt;
        }
        if (this.hii) {
            this.hii.rotation.y += dt * speed * 1.15;
            this.hii.material.uniforms.time.value += dt;
        }
        if (this.core) this.core.material.rotation += dt * speed * 0.35;
    }

    setRuntimeConfig(interior = {}) {
        this.interior = { ...this.interior, ...interior };
        const opacity = this.interior.opacity ?? 0.18;
        const brightness = this.interior.brightness ?? 0.52;
        const bloom = this.interior.bloom ?? 0.32;
        if (this.disk) {
            this.disk.material.uniforms.opacity.value = opacity;
            this.disk.material.uniforms.brightness.value = brightness;
            this.disk.material.uniforms.bloom.value = bloom;
        }
        if (this.gas) {
            this.gas.material.uniforms.opacity.value = this.interior.gasOpacity ?? opacity * 0.82;
            this.gas.material.uniforms.brightness.value = this.interior.gasBrightness ?? brightness * 0.9;
            this.gas.material.uniforms.bloom.value = this.interior.gasBloom ?? bloom * 0.65;
        }
        if (this.hii) {
            this.hii.material.uniforms.opacity.value = opacity * 0.42;
            this.hii.material.uniforms.brightness.value = brightness * 0.68;
            this.hii.material.uniforms.bloom.value = bloom * 0.55;
        }
        if (this.core) {
            this.core.material.opacity = opacity * 0.16;
            this.core.material.color.setScalar(Math.min(brightness * bloom, 0.22));
        }
    }

    rebaseOrigin(offset) {
        this.group.position.sub(offset);
    }

    _create() {
        this.disk = this._createDisk();
        this.gas = this._createGasClouds();
        this.hii = this._createHiiRegions();
        this.core = this._createCore();

        this.group.add(this.gas, this.disk, this.core, this.hii);
    }

    _createDisk() {
        const regionRadius = this.interior.regionRadius ?? this.config.global.regionRadius;
        const count = Math.max(1200, Math.floor(this.interior.particleCount ?? 8200));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const inner = new THREE.Color(this.descriptor.palette.inner);
        const outer = new THREE.Color(this.descriptor.palette.outer);
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const p = this._sampleDiskPoint(regionRadius, false);
            const index = i * 3;
            positions[index] = p.x;
            positions[index + 1] = p.y;
            positions[index + 2] = p.z;

            const radial = Math.min(1, Math.hypot(p.x, p.z) / Math.max(regionRadius, 1));
            color.copy(inner).lerp(outer, radial);
            if (this.descriptor.type === 'spiral') {
                const angle = Math.atan2(p.z, p.x);
                const dust = dustBand(angle, radial, this.descriptor);
                color.multiplyScalar(THREE.MathUtils.lerp(1, 0.48, dust * (0.35 + radial * 0.35)));
            }
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
            sizes[i] = randomRange(this.rng, 12, 42) * THREE.MathUtils.lerp(1.15, 0.55, radial);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
        const points = new THREE.Points(geometry, createInteriorMaterial());
        points.name = 'GalaxyInteriorDisk';
        points.renderOrder = 1;
        return points;
    }

    _createGasClouds() {
        const regionRadius = this.interior.regionRadius ?? this.config.global.regionRadius;
        const count = Math.max(120, Math.floor(this.interior.gasCount ?? 1100));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const cool = new THREE.Color(this.descriptor.palette.inner).lerp(new THREE.Color('#3fd6ff'), 0.35);
        const warm = new THREE.Color(this.descriptor.palette.outer).lerp(new THREE.Color('#ff6f9f'), 0.28);
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const p = this._sampleDiskPoint(regionRadius, this.rng() < 0.7);
            const radial = Math.min(1, Math.hypot(p.x, p.z) / Math.max(regionRadius, 1));
            p.y += gaussian(this.rng) * THREE.MathUtils.lerp(800, 6200, radial);
            const index = i * 3;
            positions[index] = p.x;
            positions[index + 1] = p.y;
            positions[index + 2] = p.z;
            color.copy(cool).lerp(warm, this.rng() * 0.65 + radial * 0.25);
            if (this.descriptor.type === 'spiral') {
                const angle = Math.atan2(p.z, p.x);
                color.multiplyScalar(THREE.MathUtils.lerp(1.08, 0.54, dustBand(angle, radial, this.descriptor) * 0.62));
            }
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
            sizes[i] = randomRange(this.rng, 420, 1900) * THREE.MathUtils.lerp(0.78, 1.35, radial);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
        const points = new THREE.Points(geometry, createGasMaterial());
        points.name = 'GalaxyInteriorGas';
        points.renderOrder = 0;
        return points;
    }

    _createHiiRegions() {
        const regionRadius = this.interior.regionRadius ?? this.config.global.regionRadius;
        const count = Math.max(20, Math.floor(this.interior.hiiCount ?? 180));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const magenta = new THREE.Color('#ff78bc');
        const hot = new THREE.Color('#fff2d8');
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const p = this._sampleDiskPoint(regionRadius, true);
            const index = i * 3;
            positions[index] = p.x;
            positions[index + 1] = p.y;
            positions[index + 2] = p.z;
            color.copy(magenta).lerp(hot, this.rng() * 0.28);
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
            sizes[i] = randomRange(this.rng, 18, 56);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
        const points = new THREE.Points(geometry, createInteriorMaterial());
        points.name = 'GalaxyInteriorHII';
        points.renderOrder = 2;
        return points;
    }

    _createCore() {
        const regionRadius = this.interior.regionRadius ?? this.config.global.regionRadius;
        const material = new THREE.SpriteMaterial({
            map: getImpostorTexture(this.descriptor.type === 'irregular' ? 'glow' : 'elliptical', {
                inner: this.descriptor.palette.inner,
                outer: this.descriptor.palette.outer,
                variant: `${this.descriptor.seed}:core`
            }),
            transparent: true,
            opacity: 0.025,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = 'GalaxyInteriorCore';
        sprite.position.set(regionRadius * 0.12, regionRadius * 0.035, -regionRadius * 0.72);
        sprite.scale.set(regionRadius * 0.12, regionRadius * 0.052, 1);
        sprite.renderOrder = 1;
        return sprite;
    }

    _sampleDiskPoint(regionRadius, preferArms) {
        if (this.descriptor.type === 'elliptical') {
            return new THREE.Vector3(
                gaussian(this.rng) * regionRadius * 0.28,
                gaussian(this.rng) * regionRadius * 0.06,
                gaussian(this.rng) * regionRadius * 0.22
            );
        }

        if (this.descriptor.type === 'irregular') {
            const clump = new THREE.Vector3(
                gaussian(this.rng) * regionRadius * 0.22,
                gaussian(this.rng) * regionRadius * 0.08,
                gaussian(this.rng) * regionRadius * 0.22
            );
            clump.x += randomRange(this.rng, -regionRadius * 0.3, regionRadius * 0.3);
            clump.z += randomRange(this.rng, -regionRadius * 0.3, regionRadius * 0.3);
            return clump;
        }

        const radial = preferArms
            ? THREE.MathUtils.lerp(0.18, 0.92, Math.pow(this.rng(), 0.72))
            : Math.pow(this.rng(), 0.64) * 0.96;
        const armCount = Math.max(2, this.descriptor.armCount || 4);
        const arm = Math.floor(this.rng() * armCount);
        const angle = radial * 7.4 + arm * Math.PI * 2 / armCount + (this.descriptor.dustPhase ?? 0) * 0.12;
        const scatter = THREE.MathUtils.lerp(0.012, preferArms ? 0.035 : 0.07, radial) * regionRadius;
        const r = radial * regionRadius;
        return new THREE.Vector3(
            Math.cos(angle) * r + gaussian(this.rng) * scatter,
            gaussian(this.rng) * THREE.MathUtils.lerp(450, 3300, radial),
            Math.sin(angle) * r + gaussian(this.rng) * scatter
        );
    }
}

function createInteriorMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: {
            opacity: { value: 0.44 },
            brightness: { value: 1.18 },
            bloom: { value: 0.72 },
            time: { value: 0 }
        },
        vertexShader: /* glsl */`
            attribute float particleSize;
            varying vec3 vColor;
            uniform float time;

            void main() {
                vColor = color;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float distanceScale = clamp(24000.0 / max(4000.0, -mvPosition.z), 0.18, 1.45);
                gl_PointSize = min(particleSize * distanceScale, 56.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */`
            varying vec3 vColor;
            uniform float opacity;
            uniform float brightness;
            uniform float bloom;

            void main() {
                vec2 centered = gl_PointCoord - 0.5;
                float d = length(centered) * 2.0;
                float alpha = (1.0 - smoothstep(0.08, 1.0, d)) * opacity;
                vec3 color = vColor * brightness * bloom * (0.28 + alpha * 0.45);
                gl_FragColor = vec4(color, alpha);
            }
        `
    });
}

function createGasMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: {
            opacity: { value: 0.2 },
            brightness: { value: 0.65 },
            bloom: { value: 0.22 },
            time: { value: 0 }
        },
        vertexShader: /* glsl */`
            attribute float particleSize;
            varying vec3 vColor;
            varying float vNoise;
            uniform float time;

            float hash(vec3 p) {
                return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            }

            void main() {
                vColor = color;
                vNoise = hash(position * 0.00021 + time * 0.018);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float distanceScale = clamp(22000.0 / max(5000.0, -mvPosition.z), 0.1, 0.72);
                gl_PointSize = min(particleSize * distanceScale, 240.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */`
            varying vec3 vColor;
            varying float vNoise;
            uniform float opacity;
            uniform float brightness;
            uniform float bloom;

            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv) * 2.0;
                float soft = 1.0 - smoothstep(0.05, 1.0, d);
                float cloud = smoothstep(0.12, 0.95, soft * (0.72 + vNoise * 0.42));
                float alpha = cloud * opacity;
                if (alpha < 0.002) discard;
                gl_FragColor = vec4(vColor * brightness * bloom * (0.35 + cloud * 0.5), alpha);
            }
        `
    });
}

function dustBand(angle, radial, descriptor) {
    const armCount = Math.max(2, descriptor.armCount || 4);
    const band = Math.sin(angle * armCount - radial * 8.5 + (descriptor.dustPhase ?? 0));
    return THREE.MathUtils.smoothstep(band * 0.5 + 0.5, 0.52, 0.96);
}

function fallbackDescriptor(config) {
    return {
        id: 'Local galaxy',
        type: 'spiral',
        seed: `${config.global.seed}:galaxy-interior`,
        radius: config.global.regionRadius,
        density: 1,
        palette: {
            inner: config.galaxies?.colorInner ?? '#88ccff',
            outer: config.galaxies?.colorOuter ?? '#c49f17'
        },
        spin: 1,
        armCount: 5,
        dustPhase: 0,
        hiiSeed: `${config.global.seed}:galaxy-interior:hii`
    };
}
