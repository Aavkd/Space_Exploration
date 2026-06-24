import * as THREE from 'three';
import { DEEP_SPACE_PRESET } from '../config/deepSpacePreset.js';

export class SkyDeepSpace {
    constructor(scene) {
        this.scene = scene;
        this.skyDome = this._createSkyDome();
        this.sunLight = new THREE.DirectionalLight(0xaaccff, 1.0);
        this.ambientLight = new THREE.AmbientLight(0x222244, 0.3);

        this.sunLight.position.set(100, 500, 100).normalize();
        this.scene.add(this.skyDome, this.sunLight, this.ambientLight);
    }

    update(deltaTime, cameraPosition) {
        this.skyDome.position.copy(cameraPosition);
    }

    _createSkyDome() {
        return new THREE.Mesh(
            new THREE.SphereGeometry(DEEP_SPACE_PRESET.skyRadius, 32, 32),
            new THREE.ShaderMaterial({
                uniforms: {
                    topColor: { value: new THREE.Color(0x000000) },
                    bottomColor: { value: new THREE.Color(0x000005) },
                    exponent: { value: 0.6 }
                },
                vertexShader: `
                    varying vec3 vWorldPosition;
                    void main() {
                        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPosition.xyz;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 topColor;
                    uniform vec3 bottomColor;
                    uniform float exponent;
                    varying vec3 vWorldPosition;
                    void main() {
                        float h = normalize(vWorldPosition + vec3(0.0, 2000.0, 0.0)).y;
                        vec3 color = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.BackSide,
                depthWrite: false
            })
        );
    }
}
