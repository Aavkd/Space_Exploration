import * as THREE from 'three';

export class StarBody {
    constructor({
        name = 'Primary star',
        radius = 9000,
        color = new THREE.Color('#ffd89a'),
        temperatureK = 5800,
        luminosity = 1,
        rng = Math.random
    } = {}) {
        this.name = name;
        this.radius = radius;
        this.temperatureK = temperatureK;
        this.luminosity = luminosity;
        this.color = color.clone ? color.clone() : new THREE.Color(color);
        this.group = new THREE.Group();
        this.group.name = `StarBody:${name}`;
        this._time = 0;

        this.surface = this._createSurface();
        this.corona = this._createCorona();
        this.light = new THREE.PointLight(this.color, 5.5 * luminosity, radius * 18, 1.45);
        this.group.add(this.surface, this.corona, this.light);

        this._flares = this._createFlares(rng);
        this.group.add(...this._flares);
    }

    update(dt) {
        this._time += dt;
        this.surface.rotation.y += dt * 0.015;
        this.surface.material.uniforms.uTime.value = this._time;
        this.corona.material.uniforms.uTime.value = this._time;
        for (const flare of this._flares) {
            flare.material.opacity = flare.userData.baseOpacity * (0.72 + Math.sin(this._time * flare.userData.speed + flare.userData.phase) * 0.28);
            const pulse = 0.86 + Math.sin(this._time * flare.userData.speed * 0.73 + flare.userData.phase) * 0.14;
            flare.scale.copy(flare.userData.baseScale).multiplyScalar(pulse);
        }
    }

    getPOI() {
        return {
            type: 'star',
            name: this.name,
            position: this.getWorldPosition(),
            radius: this.radius,
            temperatureK: this.temperatureK,
            luminosity: this.luminosity,
            color: this.color,
            isHeroLight: true,
            intensity: 2.2 + this.luminosity
        };
    }

    getAttractor() {
        return {
            type: 'star',
            name: this.name,
            position: this.getWorldPosition(),
            mass: 6.0e8 * Math.max(0.65, this.luminosity),
            dangerProfile: {
                type: 'star',
                lethalRadius: this.radius * 1.15,
                heatRadius: this.radius * 6,
                tidalRadius: this.radius * 12
            }
        };
    }

    getWorldPosition(target = new THREE.Vector3()) {
        return this.group.getWorldPosition(target);
    }

    _createSurface() {
        const hot = this.color.clone().lerp(new THREE.Color('#fff7d6'), 0.5);
        const geometry = new THREE.SphereGeometry(this.radius, 96, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uRadius: { value: this.radius },
                uBaseColor: { value: this.color.clone() },
                uHotColor: { value: hot }
            },
            vertexShader: `
                varying vec3 vLocal;
                varying vec3 vNormalW;
                varying vec3 vViewDir;

                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vLocal = position;
                    vNormalW = normalize(mat3(modelMatrix) * normal);
                    vViewDir = normalize(cameraPosition - worldPos.xyz);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                varying vec3 vLocal;
                varying vec3 vNormalW;
                varying vec3 vViewDir;
                uniform float uTime;
                uniform float uRadius;
                uniform vec3 uBaseColor;
                uniform vec3 uHotColor;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
                        f.z
                    );
                }

                float fbm(vec3 p) {
                    float v = 0.0;
                    float a = 0.5;
                    for (int i = 0; i < 5; i++) {
                        v += noise(p) * a;
                        p = p * 2.02 + vec3(7.1, 3.4, 5.8);
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    vec3 p = normalize(vLocal) * 7.0;
                    float cells = fbm(p + vec3(uTime * 0.05, -uTime * 0.035, uTime * 0.02));
                    float fine = fbm(p * 3.1 + uTime * 0.08);
                    float granulation = smoothstep(0.38, 0.78, cells) * 0.7 + fine * 0.3;
                    float limb = smoothstep(0.02, 0.92, dot(normalize(vNormalW), normalize(vViewDir)));
                    vec3 color = mix(uBaseColor * 0.65, uHotColor * 1.75, granulation);
                    color *= 0.5 + limb * 0.78;
                    color += uHotColor * pow(1.0 - limb, 2.4) * 0.85;
                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });
        return new THREE.Mesh(geometry, material);
    }

    _createCorona() {
        const geometry = new THREE.SphereGeometry(this.radius * 1.42, 96, 48);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: this.color.clone() }
            },
            vertexShader: `
                varying vec3 vNormalW;
                varying vec3 vViewDir;

                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vNormalW = normalize(mat3(modelMatrix) * normal);
                    vViewDir = normalize(cameraPosition - worldPos.xyz);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                varying vec3 vNormalW;
                varying vec3 vViewDir;
                uniform float uTime;
                uniform vec3 uColor;

                void main() {
                    float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 2.2);
                    float pulse = 0.78 + 0.22 * sin(uTime * 1.7);
                    vec3 col = uColor * (1.4 + rim * 3.2);
                    gl_FragColor = vec4(col, rim * 0.42 * pulse);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false
        });
        return new THREE.Mesh(geometry, material);
    }

    _createFlares(rng) {
        const flares = [];
        const materialColor = this.color.clone().lerp(new THREE.Color('#fff2c8'), 0.45);
        for (let i = 0; i < 7; i++) {
            const theta = rng() * Math.PI * 2;
            const phi = Math.acos(THREE.MathUtils.lerp(-0.78, 0.78, rng()));
            const normal = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.cos(phi),
                Math.sin(phi) * Math.sin(theta)
            );
            const flare = new THREE.Mesh(
                new THREE.SphereGeometry(this.radius * THREE.MathUtils.lerp(0.035, 0.08, rng()), 16, 8),
                new THREE.MeshBasicMaterial({
                    color: materialColor,
                    transparent: true,
                    opacity: 0.42,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );
            flare.position.copy(normal.multiplyScalar(this.radius * THREE.MathUtils.lerp(1.03, 1.18, rng())));
            flare.scale.set(1, THREE.MathUtils.lerp(1.6, 3.2, rng()), 1);
            flare.userData.baseScale = flare.scale.clone();
            flare.userData.baseOpacity = THREE.MathUtils.lerp(0.16, 0.42, rng());
            flare.userData.speed = THREE.MathUtils.lerp(0.7, 1.8, rng());
            flare.userData.phase = rng() * Math.PI * 2;
            flares.push(flare);
        }
        return flares;
    }
}
