import * as THREE from 'three';

export const HalftoneShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        dotSize: { value: 1 },
        angle: { value: 45 },
        scale: { value: 1 }
    },
    vertexShader: `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float dotSize;
        uniform float angle;
        uniform float scale;

        varying vec2 vUv;

        vec2 rotate(vec2 uv, float theta) {
            float c = cos(theta);
            float s = sin(theta);
            return vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        }

        float inkAmount(float value, vec2 uv, float screenAngle, float freq) {
            vec2 grid = 2.0 * fract(rotate(uv, radians(screenAngle)) * freq) - 1.0;
            float radius = sqrt(clamp(value, 0.0, 1.0));
            float edge = max(fwidth(length(grid)), 0.02);
            return 1.0 - smoothstep(radius, radius + edge, length(grid));
        }

        void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb;
            float k = min(1.0 - color.r, min(1.0 - color.g, 1.0 - color.b));
            vec3 cmy = (1.0 - color - k) / (1.0 - k + 0.0001);
            float freq = min(resolution.x, resolution.y) / max(2.0, 8.0 * dotSize) * scale;

            float inkC = inkAmount(cmy.r, vUv, angle - 30.0, freq);
            float inkM = inkAmount(cmy.g, vUv, angle + 30.0, freq);
            float inkY = inkAmount(cmy.b, vUv, angle - 45.0, freq);
            float inkK = inkAmount(k, vUv, angle, freq);

            vec3 result = vec3(1.0);
            result *= mix(vec3(1.0), vec3(0.0, 1.0, 1.0), inkC);
            result *= mix(vec3(1.0), vec3(1.0, 0.0, 1.0), inkM);
            result *= mix(vec3(1.0), vec3(1.0, 1.0, 0.0), inkY);
            result *= mix(vec3(1.0), vec3(0.0), inkK);

            gl_FragColor = vec4(result, 1.0);
        }
    `
};
