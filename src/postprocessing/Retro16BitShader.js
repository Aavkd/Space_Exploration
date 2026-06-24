import * as THREE from 'three';

export const Retro16BitShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        pixelSize: { value: 4 },
        colorDepth: { value: 16 },
        contrast: { value: 0.9 },
        saturation: { value: 0.5 },
        scanlineIntensity: { value: 0.15 },
        scanlineCount: { value: 1.5 },
        noiseIntensity: { value: 0 },
        vignetteStength: { value: 0.4 },
        vignetteIntensity: { value: 0.6 },
        aberration: { value: 0 },
        brightness: { value: -0.02 },
        exposure: { value: 3 }
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
        uniform float pixelSize;
        uniform float colorDepth;
        uniform float contrast;
        uniform float saturation;
        uniform float scanlineIntensity;
        uniform float scanlineCount;
        uniform float noiseIntensity;
        uniform float vignetteStength;
        uniform float vignetteIntensity;
        uniform float aberration;
        uniform float brightness;
        uniform float exposure;

        varying vec2 vUv;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        void main() {
            vec2 pixelatedUv = floor(vUv * resolution / pixelSize) * pixelSize / resolution;
            vec2 center = vec2(0.5);
            vec2 offset = normalize(pixelatedUv - center + 0.00001) * aberration;

            vec3 color;
            color.r = texture2D(tDiffuse, pixelatedUv + offset).r;
            color.g = texture2D(tDiffuse, pixelatedUv).g;
            color.b = texture2D(tDiffuse, pixelatedUv - offset).b;

            color *= exposure;
            color += brightness;
            color = (color - 0.5) * contrast + 0.5;

            float luma = dot(color, vec3(0.299, 0.587, 0.114));
            color = mix(vec3(luma), color, saturation);
            color = floor(clamp(color, 0.0, 1.0) * colorDepth) / max(colorDepth, 1.0);

            float scan = sin(vUv.y * resolution.y * scanlineCount * 3.14159);
            color *= 1.0 - scanlineIntensity * (0.5 + 0.5 * scan);
            color += (hash(vUv * resolution) - 0.5) * noiseIntensity;

            float dist = distance(vUv, center);
            float vignette = smoothstep(0.8, vignetteStength, dist);
            color *= mix(1.0, 1.0 - vignetteIntensity, vignette);

            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `
};
