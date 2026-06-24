import * as THREE from 'three';

// Phase 08: ported from Racing's quad-mesh speed lines (plane.js:958-1176).
//
// Each "line" is a 4-vertex billboard streak inside a box-shaped volume ahead of
// the ship (forward is -Z). The streaks are stretched along -Z proportional to
// speedFactor and log(multiplier) so the effect stays calibrated as the active
// gear's top speed grows by orders of magnitude (PRECISION -> HYPERDRIVE).
//
// Anti-jitter: the scroll offset is CPU-accumulated and wrapped into the box
// depth every frame, so we never feed huge world-distance floats into the GPU
// (single-precision streaking artifacts at hyperdrive speed otherwise).
export class SpeedLines {
    constructor({
        count = 2000,
        width = 40,
        height = 20,
        depth = 1000,
        baseLength = 40,
        color = 0xaaccff,
        maxOpacity = 0.38
    } = {}) {
        this.maxOpacity = maxOpacity;
        this.depth = depth;
        this.baseLength = baseLength;

        // Calibration, set per-gear from App each frame.
        this._minSpeed = 200;
        this._maxSpeed = 1800;
        this._multiplier = 1;

        this._travel = 0;
        this._speedFactor = 0;
        this._intensity = 1; // overall scale (subdued when not at the controls)

        const geometry = this._createGeometry(count, width, height, depth);
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uScroll: { value: 0 },
                uDepth: { value: depth },
                uLength: { value: baseLength },
                uWidth: { value: 0.6 },
                uOpacity: { value: 0 },
                uColor: { value: new THREE.Color(color) }
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER
        });

        this.object3D = new THREE.Mesh(geometry, this.material);
        this.object3D.name = 'ShipSpeedLines';
        this.object3D.frustumCulled = false; // verts are repositioned in the shader
        this.object3D.visible = true;
        this.object3D.renderOrder = 5;
    }

    update(dt, speed) {
        const min = this._minSpeed;
        const max = Math.max(this._maxSpeed, min + 1);
        const speedFactor = THREE.MathUtils.clamp((speed - min) / (max - min), 0, 1);
        this._speedFactor = speedFactor;

        // Wrap the scroll into [0, depth) so the GPU only ever sees a small float.
        this._travel = (this._travel + dt * Math.max(speed, 1)) % this.depth;

        const mult = Math.max(this._multiplier, 1);
        const logMult = Math.log(mult + 1); // ~0.69 at mult=1, ~4.8 at mult=120
        const u = this.material.uniforms;
        u.uScroll.value = this._travel;
        // Stretch grows with both how fast we are within the gear and how big the
        // gear's range is (log of the multiplier), matching Racing's plane.js:1077.
        u.uLength.value = this.baseLength * (0.4 + speedFactor * (1.5 + logMult));
        u.uWidth.value = 0.6 * (1 + speedFactor * 1.5);

        // Rise with speed, then roll opacity back near saturation so extreme
        // cruise does not turn the whole view into a solid wash.
        let opacity = this.maxOpacity * THREE.MathUtils.smoothstep(speedFactor, 0.02, 0.35);
        opacity *= 1 - 0.45 * THREE.MathUtils.clamp((speedFactor - 0.9) / 0.1, 0, 1);
        opacity *= this._intensity;
        u.uOpacity.value = opacity;
        this.object3D.visible = opacity > 0.001;
    }

    setMaxOpacity(maxOpacity) {
        if (Number.isFinite(maxOpacity)) {
            this.maxOpacity = THREE.MathUtils.clamp(maxOpacity, 0, 0.5);
        }
    }

    // Per-gear recalibration so the streaks neither saturate instantly in
    // PRECISION nor stay invisible at hyperdrive cruise.
    setSpeedThresholds(minSpeed, maxSpeed) {
        if (Number.isFinite(minSpeed)) this._minSpeed = Math.max(0, minSpeed);
        if (Number.isFinite(maxSpeed)) this._maxSpeed = Math.max(this._minSpeed + 1, maxSpeed);
    }

    setMultiplier(multiplier) {
        if (Number.isFinite(multiplier)) this._multiplier = Math.max(1, multiplier);
    }

    // Overall intensity scale (1 = full). Used to subdue the streaks when nobody
    // is piloting (the ship is just drifting while you walk around / EVA).
    setIntensity(intensity) {
        if (Number.isFinite(intensity)) this._intensity = THREE.MathUtils.clamp(intensity, 0, 1);
    }

    getSpeedFactor() {
        return this._speedFactor;
    }

    _createGeometry(count, width, height, depth) {
        const positions = new Float32Array(count * 4 * 3); // base offset, repeated 4x
        const sides = new Float32Array(count * 4); // -1 / +1 across the streak
        const along = new Float32Array(count * 4); // 0 = head, 1 = tail
        const indices = new Uint32Array(count * 6);

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * width;
            const y = (Math.random() - 0.5) * height;
            const z = -Math.random() * depth;

            const v = i * 4;
            const p = v * 3;
            // 4 verts share the same base offset; the shader builds the quad.
            for (let k = 0; k < 4; k++) {
                positions[p + k * 3] = x;
                positions[p + k * 3 + 1] = y;
                positions[p + k * 3 + 2] = z;
            }
            sides[v] = -1; along[v] = 0;
            sides[v + 1] = 1; along[v + 1] = 0;
            sides[v + 2] = 1; along[v + 2] = 1;
            sides[v + 3] = -1; along[v + 3] = 1;

            const idx = i * 6;
            indices[idx] = v;
            indices[idx + 1] = v + 1;
            indices[idx + 2] = v + 2;
            indices[idx + 3] = v;
            indices[idx + 4] = v + 2;
            indices[idx + 5] = v + 3;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
        geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        return geometry;
    }
}

const VERTEX_SHADER = /* glsl */`
    attribute float aSide;
    attribute float aAlong;
    uniform float uScroll;
    uniform float uDepth;
    uniform float uLength;
    uniform float uWidth;
    varying float vAlong;

    void main() {
        vec3 p = position;
        // Scroll toward the ship along +Z and wrap into [-uDepth, 0] so streaks
        // recycle seamlessly without ever using large coordinates.
        float z = mod(p.z + uScroll, uDepth) - uDepth;

        // Width is tangential to the radial direction in XY, so the streaks read
        // as radiating from the view center rather than as vertical bars.
        vec2 radial = normalize(p.xy + vec2(0.0001));
        vec2 perp = vec2(-radial.y, radial.x);

        vec3 pos = vec3(p.xy + perp * aSide * uWidth, z - aAlong * uLength);
        vAlong = aAlong;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vAlong;

    void main() {
        // Bright at the head, fading toward the tail for a comet-streak look.
        float taper = 1.0 - vAlong;
        gl_FragColor = vec4(uColor, uOpacity * taper);
    }
`;
