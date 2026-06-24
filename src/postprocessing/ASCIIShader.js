import * as THREE from 'three';

export const ASCIIShader = {
    uniforms: {
        tDiffuse: { value: null },
        tFill: { value: null },
        tEdges: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        fontCharCount: { value: 10 },
        zoom: { value: 1 },
        fillColor: { value: new THREE.Color(0xffffff) },
        backgroundColor: { value: new THREE.Color(0x000000) },
        colorChar: { value: false },
        invert: { value: false }
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
        uniform sampler2D tFill;
        uniform vec2 resolution;
        uniform float fontCharCount;
        uniform float zoom;
        uniform vec3 fillColor;
        uniform vec3 backgroundColor;
        uniform bool colorChar;
        uniform bool invert;

        varying vec2 vUv;

        float getLuminance(vec3 color) {
            return dot(color, vec3(0.2126, 0.7152, 0.0722));
        }

        void main() {
            float charSize = 8.0 / max(zoom, 0.01);
            vec2 grid = max(resolution / charSize, vec2(1.0));
            vec2 pixelUV = floor(vUv * grid) / grid;
            vec4 sceneColor = texture2D(tDiffuse, pixelUV);
            float lum = getLuminance(sceneColor.rgb);
            if (invert) lum = 1.0 - lum;

            float charIndex = floor(clamp(lum, 0.0, 1.0) * (fontCharCount - 0.01));
            vec2 localUV = fract(vUv * grid);
            vec2 fontUV = vec2((charIndex + localUV.x) / fontCharCount, localUV.y);
            float charMask = texture2D(tFill, fontUV).r;

            vec3 fg = colorChar ? sceneColor.rgb : fillColor;
            vec3 finalColor = mix(backgroundColor, fg, charMask);
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `
};
