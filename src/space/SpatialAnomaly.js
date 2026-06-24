import * as THREE from 'three';

export class SpatialAnomaly {
    constructor(params = {}) {
        this.params = {
            radius: params.radius ?? 180,
            color: new THREE.Color(params.color ?? 0x44ffdd),
            bloomIntensity: params.bloomIntensity ?? 1.8,
            speed: params.speed ?? 1,
            maxDistortion: params.maxDistortion ?? 0.6
        };
        this.time = 37.5;
        this.mesh = this._createMesh();
    }

    update(dt) {
        this.time += dt * this.params.speed;
        this.mesh.rotation.x += dt * 0.2 * this.params.speed;
        this.mesh.rotation.y += dt * 0.3 * this.params.speed;
        const uniforms = this.mesh.material.uniforms;
        uniforms.time.value = this.time;
        uniforms.distortion.value = Math.max(
            uniforms.distortion.value * 0.88,
            Math.random() < 0.035 ? Math.random() * this.params.maxDistortion : 0
        );
    }

    _createMesh() {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color: { value: this.params.color },
                distortion: { value: 0 },
                uBloomIntensity: { value: this.params.bloomIntensity }
            },
            vertexShader: `
                uniform float time;
                uniform float distortion;
                varying vec3 vNormal;
                varying vec3 vPos;
                varying float vNoise;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 x) {
                    vec3 i = floor(x);
                    vec3 f = fract(x);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y), mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                void main() {
                    vNormal = normal;
                    vPos = position;
                    vNoise = noise(position * 2.0 + time);
                    vec3 pos = position + normal * vNoise * (0.2 + distortion);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float time;
                uniform float uBloomIntensity;
                varying vec3 vNormal;
                varying vec3 vPos;
                varying float vNoise;

                void main() {
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
                    vec3 finalColor = (color + vec3(vNoise * 0.5) + color * fresnel * 2.0) * uBloomIntensity;
                    float alpha = 0.55 + 0.35 * sin(time * 3.0 + vPos.y);
                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
        mesh.name = 'SpatialAnomaly';
        mesh.scale.setScalar(this.params.radius);
        mesh.add(new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.2, 0),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3 })
        ));
        return mesh;
    }
}
