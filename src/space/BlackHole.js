import * as THREE from 'three';

const vertexShader = `
varying vec3 vOrigin;
varying vec3 vDirection;

void main() {
    vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
varying vec3 vOrigin;
varying vec3 vDirection;

uniform float uTime;
uniform vec3 uColorInner;
uniform vec3 uColorOuter;
uniform float uDistortion;
uniform float uDiskRadius;
uniform bool uIsPulsar;
uniform float uBloomIntensity;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

mat2 rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

float getDensity(vec3 p) {
    float r = length(p.xy);
    float h = abs(p.z);
    if (r < 1.5 || r > uDiskRadius) return 0.0;

    float density = exp(-h * h * 8.0) * (1.0 / (r * r * 0.5));
    vec3 q = p;
    q.xy *= rot(uTime * 0.8 + 3.0 / (r + 0.1));
    density *= 1.0 + snoise(q * 2.5 + vec3(0.0, 0.0, uTime * 0.3)) * 0.6;
    density *= smoothstep(1.5, 2.0, r) * smoothstep(uDiskRadius, uDiskRadius - 0.8, r);
    return max(0.0, density * 5.0);
}

float getJetDensity(vec3 p) {
    float r = length(p.xy);
    float h = abs(p.z);
    if (r > 3.0) return 0.0;

    float core = exp(-r * r * 15.0);
    float sheath = exp(-r * r * 1.5);
    float pulse = smoothstep(-0.5, 1.0, sin(h * 0.8 - uTime * 5.0));
    float noise = snoise(vec3(p.xy * 1.5, p.z * 0.8 - uTime * 4.0));
    float density = core * 5.0 + sheath * (0.5 + noise * 0.4);
    density *= exp(-h * 0.08) * (0.8 + 0.4 * pulse) * smoothstep(1.2, 2.5, h);
    return density;
}

vec2 intersectAABB(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax) {
    vec3 tMin = (boxMin - rayOrigin) / rayDir;
    vec3 tMax = (boxMax - rayOrigin) / rayDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    return vec2(tNear, tFar);
}

void main() {
    vec3 dir = normalize(vDirection);
    vec2 tBox = intersectAABB(vOrigin, dir, vec3(-15.0), vec3(15.0));
    if (tBox.y < 0.0 || tBox.x > tBox.y) discard;

    float tStart = max(0.0, tBox.x - 2.0);
    vec3 p = vOrigin + dir * tStart;
    vec4 color = vec4(0.0);
    float stepSize = 0.09;

    for (int i = 0; i < 240; i++) {
        float r = length(p);

        if (r < 1.0) {
            color.rgb = vec3(0.0);
            color.a = 1.0;
            break;
        }

        vec3 accel = -normalize(p) * (uDistortion * 2.0) / (r * r + 0.1);
        dir = normalize(dir + accel * stepSize);
        p += dir * stepSize;

        if (abs(p.z) < 4.0 && length(p.xy) < uDiskRadius + 1.0) {
            float d = getDensity(p);
            float diskR = length(p.xy);
            vec3 emission = mix(uColorInner, uColorOuter, smoothstep(1.5, uDiskRadius, diskR));
            emission *= (1.0 + 3.0 / (diskR * diskR)) * uBloomIntensity;
            float alpha = d * stepSize * 0.6;
            color.rgb += emission * alpha * (1.0 - color.a);
            color.a += alpha;
        }

        if (uIsPulsar && abs(p.z) < 14.0 && length(p.xy) < 4.0) {
            float jetD = getJetDensity(p);
            vec3 jetColor = mix(vec3(0.4, 0.8, 1.0), vec3(0.8, 0.2, 1.0), smoothstep(2.0, 12.0, abs(p.z)));
            float jetAlpha = jetD * stepSize * 0.5;
            color.rgb += jetColor * 2.5 * uBloomIntensity * jetAlpha * (1.0 - color.a);
            color.a += jetAlpha;
        }

        if (color.a >= 0.99 || (r > 20.0 && dot(p, dir) > 0.0)) break;
    }

    gl_FragColor = color;
}
`;

export class BlackHole {
    constructor(options = {}) {
        this.rotationSpeed = options.rotationSpeed ?? 1;
        this.distortion = options.distortion ?? 0.18;
        this.diskRadius = options.diskRadius ?? 6;
        this.isPulsar = options.isPulsar ?? false;
        this.bloomIntensity = options.bloomIntensity ?? 1.4;
        this._elapsedTime = 0;

        this.mesh = new THREE.Mesh(
            new THREE.BoxGeometry(15, 15, 15),
            new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms: {
                    uTime: { value: 0 },
                    uColorInner: { value: new THREE.Color(options.colorInner ?? '#ffc880') },
                    uColorOuter: { value: new THREE.Color(options.colorOuter ?? '#ff5050') },
                    uDistortion: { value: this.distortion },
                    uDiskRadius: { value: this.diskRadius },
                    uIsPulsar: { value: this.isPulsar },
                    uBloomIntensity: { value: this.bloomIntensity }
                },
                transparent: true,
                side: THREE.BackSide,
                blending: THREE.NormalBlending,
                depthWrite: false
            })
        );
        this.mesh.name = 'BlackHole';
        this.mesh.rotation.copy(options.tilt ?? new THREE.Euler(-Math.PI / 2.5, 0.2, 0));
        this.mesh.scale.setScalar(options.scale ?? 150);
    }

    update(dt) {
        this._elapsedTime += dt * this.rotationSpeed;
        const uniforms = this.mesh.material.uniforms;
        uniforms.uTime.value = this._elapsedTime;
        uniforms.uDistortion.value = this.distortion;
        uniforms.uDiskRadius.value = this.diskRadius;
        uniforms.uIsPulsar.value = this.isPulsar;
        uniforms.uBloomIntensity.value = this.bloomIntensity;
    }
}
