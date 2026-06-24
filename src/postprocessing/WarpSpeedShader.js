import * as THREE from 'three';

export const WarpSpeedShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        speedFactor: { value: 0 },
        center: { value: new THREE.Vector2(0.5, 0.5) },
        blurStrength: { value: 0.04 },
        blurSamples: { value: 12 },
        aberrationStrength: { value: 0.00005 },
        vignetteStrength: { value: 0.4 },
        streakIntensity: { value: 0.015 },
        distortion: { value: 0 }
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
        uniform float speedFactor;
        uniform vec2 center;
        uniform float blurStrength;
        uniform float blurSamples;
        uniform float aberrationStrength;
        uniform float vignetteStrength;
        uniform float streakIntensity;
        uniform float distortion;

        varying vec2 vUv;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
            if (speedFactor < 0.001) {
                gl_FragColor = texture2D(tDiffuse, vUv);
                return;
            }

            vec2 uv = vUv;
            vec2 toCenter = center - uv;
            float dist = length(toCenter);
            vec2 dir = normalize(toCenter + 0.00001);

            if (distortion > 0.001) {
                float f = 1.0 + distortion * dist * dist;
                uv = center - dir * (dist * f);
                toCenter = center - uv;
                dist = length(toCenter);
                dir = normalize(toCenter + 0.00001);
            }

            float speed = smoothstep(0.0, 1.0, speedFactor);
            float speedSq = speed * speed;
            float blurAmount = blurStrength * speedSq * dist;
            int samples = int(blurSamples);
            vec4 color = vec4(0.0);
            float totalWeight = 0.0;

            for (int i = 0; i < 16; i++) {
                if (i >= samples) break;
                float denom = max(float(samples - 1), 1.0);
                float t = float(i) / denom;
                float weight = 1.0 - abs(t - 0.5) * 2.0;
                vec2 sampleUV = uv + dir * blurAmount * (t - 0.5) * 2.0;
                color += texture2D(tDiffuse, sampleUV) * weight;
                totalWeight += weight;
            }

            color /= max(totalWeight, 0.0001);

            float aberration = aberrationStrength * speedSq * dist;
            color.r = mix(color.r, texture2D(tDiffuse, uv + dir * aberration * 1.5).r, speed * 0.7);
            color.b = mix(color.b, texture2D(tDiffuse, uv - dir * aberration * 1.5).b, speed * 0.7);

            float angle = atan(toCenter.y, toCenter.x);
            float streakPattern = pow(abs(sin(angle * 60.0 + hash(floor(uv * 100.0)) * 6.28318)), 3.0);
            color.rgb += vec3(0.8, 0.9, 1.0) * streakPattern * dist * max(speed - 0.25, 0.0) * streakIntensity;

            float vignette = smoothstep(0.0, 1.0, max(0.0, 1.0 - dist * vignetteStrength * speed));
            color.rgb *= mix(1.0, vignette, speed * 0.5);

            float centerGlow = (1.0 - smoothstep(0.0, 0.3, dist)) * speedSq * 0.15;
            color.rgb += vec3(0.9, 0.95, 1.0) * centerGlow;

            gl_FragColor = color;
        }
    `
};
