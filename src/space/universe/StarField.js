import * as THREE from 'three';
import { gaussian, randomRange } from './rng.js';
import { randomPointInSphere } from './CosmicWeb.js';
import { blackbody, sampleStarTemperature, sampleLuminosity, starImpostorRadius } from './starColor.js';
import { sampleGalaxyDiskPoint } from './galaxyShape.js';

// Inside a galaxy, how far each rendered star's colour is pulled from its raw
// blackbody tint toward the galaxy's own inner/outer palette, so the dominant
// star mass reads in the galaxy's colours and matches the impostor you flew in
// from. Temperature still sets the base tint and the luminosity/size; this only
// shifts hue. The untinted blackbody colour is kept for system entry + lighting.
const GALAXY_STAR_TINT = 0.64;
const _starTint = new THREE.Color();
const _defaultTravelDirection = new THREE.Vector3(0, 0, -1);

export class StarField {
    constructor({ rng, web, config }) {
        this.rng = rng;
        this.web = web;
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseStars';
        this.layers = {};
        this.heroLights = [];
        this.systemAnchors = [];
        // Inside a galaxy level the config carries the parent galaxy's descriptor.
        // When present, the near/mid stars trace that galaxy's disk + arms instead
        // of the generic cosmic-web scatter, so the resolved stars populate the
        // same arms and clouds the interior haze draws.
        this._galaxyDescriptor = config.global?.parentGalaxy ?? null;
        this._galaxyInner = this._galaxyDescriptor ? new THREE.Color(this._galaxyDescriptor.palette.inner) : null;
        this._galaxyOuter = this._galaxyDescriptor ? new THREE.Color(this._galaxyDescriptor.palette.outer) : null;
        this._create();
        this.setRuntimeConfig(config.stars);
    }

    update(dt, cameraPosition) {
        for (const layer of Object.values(this.layers)) {
            layer.material.uniforms.time.value += dt * this.config.stars.twinkleSpeed;
        }
        if (this.layers.background) this.layers.background.position.copy(cameraPosition);
    }

    setRuntimeConfig(stars) {
        this.config.stars = { ...this.config.stars, ...stars };
        for (const [name, layer] of Object.entries(this.layers)) {
            const scale = name === 'background' ? 0.65 : name === 'mid' ? 0.85 : 1;
            layer.material.uniforms.opacity.value = this.config.stars.opacity;
            layer.material.uniforms.brightness.value = this.config.stars.brightness * scale;
            layer.material.uniforms.size.value = this.config.stars.size * (name === 'near' ? 1.15 : 1);
            layer.material.uniforms.saturation.value = this.config.stars.saturation;
            layer.material.uniforms.bloom.value = this.config.stars.bloom ?? 1;
            layer.material.uniforms.regionRadius.value = this.config.global.regionRadius;
        }
    }

    setRelativisticState({ beta = 0, direction = _defaultTravelDirection, observerPosition = null } = {}) {
        const clampedBeta = THREE.MathUtils.clamp(beta, 0, 0.88);
        for (const layer of Object.values(this.layers)) {
            const uniforms = layer.material.uniforms;
            uniforms.relativisticBeta.value = clampedBeta;
            if (direction?.lengthSq?.() > 1e-8) {
                uniforms.travelDirection.value.copy(direction).normalize();
            }
            if (observerPosition) uniforms.observerPosition.value.copy(observerPosition);
        }
    }

    getCounts() {
        return {
            stars: Object.values(this.layers).reduce((sum, layer) => sum + layer.geometry.attributes.position.count, 0)
        };
    }

    // Nearest approachable star systems to `position` (issue #1). This runs every
    // frame (Universe.getPOIs + scale-stack descent checks) over up to tens of
    // thousands of anchors, so the hot loop is allocation-free and works in
    // squared distance: each anchor's world position is computed component-wise
    // (no Vector3 clone), and the POI object — with its Vector3/Color clones — is
    // only built for stars that pass the shortlist/exclusion gate. The single
    // sqrt is deferred to the small returned set.
    getSystemPOIs({ position = null, maxDistance = Infinity, limit = Infinity, excludeWithin = [] } = {}) {
        const results = [];
        const boundedNearest = Boolean(position) && Number.isFinite(limit);
        const maxDistanceSq = maxDistance === Infinity ? Infinity : maxDistance * maxDistance;
        const hasExclusions = excludeWithin.length > 0;

        for (const star of this.systemAnchors) {
            // Every local star layer shares the same rebase offset, so the world
            // position is just the layer offset added to the stored local point.
            const offset = this.layers[star.layerName]?.position;
            const wx = star.localPosition.x + (offset ? offset.x : 0);
            const wy = star.localPosition.y + (offset ? offset.y : 0);
            const wz = star.localPosition.z + (offset ? offset.z : 0);

            let distanceSq = 0;
            if (position) {
                const dx = wx - position.x;
                const dy = wy - position.y;
                const dz = wz - position.z;
                distanceSq = dx * dx + dy * dy + dz * dz;
                if (distanceSq > maxDistanceSq) continue;
            }

            // Squared-distance shortlist gate: skip before allocating anything if
            // this star can't beat the current worst kept candidate.
            if (boundedNearest && results.length >= limit && distanceSq >= results[results.length - 1]._distanceSq) {
                continue;
            }

            if (hasExclusions && this._withinAnyShell(wx, wy, wz, excludeWithin)) continue;

            const poi = this._makeSystemPOI(star, wx, wy, wz, distanceSq);

            if (boundedNearest) {
                let index = results.length;
                while (index > 0 && results[index - 1]._distanceSq > distanceSq) index--;
                results.splice(index, 0, poi);
                if (results.length > limit) results.length = limit;
            } else {
                results.push(poi);
            }
        }

        if (position && !boundedNearest) results.sort((a, b) => a._distanceSq - b._distanceSq);

        const bounded = Number.isFinite(limit) ? results.slice(0, limit) : results;
        for (const poi of bounded) {
            poi.distance = Math.sqrt(poi._distanceSq);
            delete poi._distanceSq;
        }
        return bounded;
    }

    getHeroLightPOIs() {
        return this.heroLights.map((star, index) => ({
            type: 'star',
            name: `Star system ${index + 1}`,
            position: star.position,
            radius: star.systemRadius,
            color: star.color.clone(),
            temperatureK: star.temperatureK,
            luminosity: star.intensity
        }));
    }

    _create() {
        if (!this.config.stars.enabled) return;
        this.layers.near = this._createLayer('near', this.config.stars.nearCount, 80000, true);
        this.layers.mid = this._createLayer('mid', this.config.stars.midCount, this.config.global.regionRadius * 0.82, true);
        this.layers.background = this._createLayer('background', this.config.stars.bgCount, 420000, false);
        this.group.add(...Object.values(this.layers));
    }

    _createLayer(name, count, radius, webBiased) {
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        const brightnesses = new Float32Array(count);
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const index = i * 3;
            let position;
            if (webBiased && this._galaxyDescriptor) {
                // Near stars cluster into the arms; mid stars fill the broad disk.
                // Both span the full galaxy region so they coincide with the
                // interior structure rather than the smaller per-layer sphere.
                position = sampleGalaxyDiskPoint(
                    this.rng,
                    this.config.global.regionRadius,
                    this._galaxyDescriptor,
                    name === 'near'
                );
            } else if (webBiased) {
                position = this._webStarPosition(name, radius);
            } else {
                position = randomPointInSphere(this.rng, radius).setLength(randomRange(this.rng, radius * 0.72, radius));
            }

            positions[index] = position.x;
            positions[index + 1] = position.y;
            positions[index + 2] = position.z;

            // Temperature drives both hue (blackbody ramp) and luminosity, so
            // the two stay correlated: hot stars are rare, blue-white, and bright.
            const tempK = sampleStarTemperature(this.rng, this.config.stars.temperatureBias);
            blackbody(tempK, color);
            const lift = 1 + this.config.stars.saturation * 0.12;
            // Render colour: in a galaxy, pull the blackbody tint toward the
            // galaxy palette (inner at the core, outer at the rim) so the field
            // carries the galaxy's colour. `color` itself stays the raw blackbody
            // tint used below for system anchors / hero lights.
            let cr = color.r, cg = color.g, cb = color.b;
            if (this._galaxyInner) {
                const radial = Math.min(1, Math.hypot(position.x, position.z) / Math.max(this.config.global.regionRadius, 1));
                _starTint.copy(this._galaxyInner).lerp(this._galaxyOuter, radial);
                cr = THREE.MathUtils.lerp(cr, _starTint.r, GALAXY_STAR_TINT);
                cg = THREE.MathUtils.lerp(cg, _starTint.g, GALAXY_STAR_TINT);
                cb = THREE.MathUtils.lerp(cb, _starTint.b, GALAXY_STAR_TINT);
            }
            colors[index] = Math.min(1, cr * lift);
            colors[index + 1] = Math.min(1, cg * lift);
            colors[index + 2] = Math.min(1, cb * lift);

            seeds[i] = this.rng() * 1000;
            brightnesses[i] = sampleLuminosity(this.rng, tempK);

            if (name === 'near' && this.heroLights.length < 36 && brightnesses[i] > 1.1) {
                this.heroLights.push({
                    type: 'star',
                    name: `Hero star ${this.heroLights.length + 1}`,
                    position: position.clone(),
                    color: color.clone(),
                    temperatureK: tempK,
                    intensity: brightnesses[i],
                    // Proportional to the true body radius the System tier renders,
                    // so the seen size agrees with the entered size (§5).
                    systemRadius: starImpostorRadius(brightnesses[i]),
                    mass: 1.0e6,
                    isHeroLight: true
                });
            }

            if (name !== 'background') {
                this.systemAnchors.push({
                    type: 'star',
                    name: `${name === 'near' ? 'Near' : 'Mid'} star ${this.systemAnchors.length + 1}`,
                    layerName: name,
                    localPosition: position.clone(),
                    color: color.clone(),
                    temperatureK: tempK,
                    intensity: brightnesses[i],
                    systemRadius: starImpostorRadius(brightnesses[i])
                });
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('brightnessSeed', new THREE.BufferAttribute(brightnesses, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                opacity: { value: this.config.stars.opacity },
                brightness: { value: this.config.stars.brightness },
                size: { value: this.config.stars.size },
                saturation: { value: this.config.stars.saturation },
                bloom: { value: this.config.stars.bloom ?? 1 },
                regionRadius: { value: this.config.global.regionRadius },
                observerPosition: { value: new THREE.Vector3() },
                travelDirection: { value: _defaultTravelDirection.clone() },
                relativisticBeta: { value: 0 }
            },
            vertexShader: `
                attribute float seed;
                attribute float brightnessSeed;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vSpike;
                uniform float time;
                uniform float size;
                uniform float brightness;
                uniform float saturation;
                uniform float regionRadius;
                uniform vec3 observerPosition;
                uniform vec3 travelDirection;
                uniform float relativisticBeta;

                void main() {
                    vec3 saturated = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vec3 toStar = worldPosition.xyz - observerPosition;
                    float starDistance = max(length(toStar), 1.0);
                    vec3 starDirection = toStar / starDistance;

                    float beta = clamp(relativisticBeta, 0.0, 0.88);
                    vec3 travel = normalize(travelDirection);
                    float mu = clamp(dot(starDirection, travel), -0.999, 0.999);
                    float gammaInv = sqrt(max(1.0 - beta * beta, 0.0001));
                    float denom = max(1.0 + beta * mu, 0.0001);
                    vec3 perpendicular = starDirection - travel * mu;
                    vec3 apparentDirection = normalize(
                        travel * ((mu + beta) / denom) +
                        perpendicular * (gammaInv / denom)
                    );
                    worldPosition.xyz = observerPosition + apparentDirection * starDistance;

                    float doppler = sqrt((1.0 + beta * mu) / max(1.0 - beta * mu, 0.0001));
                    doppler = clamp(doppler, 0.62, 1.65);
                    float blueShift = clamp((doppler - 1.0) * 1.35, 0.0, 1.0);
                    float redShift = clamp((1.0 - doppler) * 1.55, 0.0, 1.0);
                    vec3 dopplerColor = saturated;
                    dopplerColor *= mix(vec3(1.0), vec3(0.7, 0.9, 1.32), blueShift);
                    dopplerColor *= mix(vec3(1.0), vec3(1.32, 0.72, 0.48), redShift);
                    float beam = clamp(doppler * doppler, 0.48, 2.05);
                    vColor = dopplerColor * brightness * brightnessSeed * beam;

                    vec4 mvPosition = viewMatrix * worldPosition;
                    float dist = max(-mvPosition.z, 1.0);

                    float twinkle = 0.72 + 0.28 * sin(time * (1.5 + seed * 0.003) + seed);
                    float borderFade = 1.0 - smoothstep(regionRadius * 0.86, regionRadius, length(position));
                    vAlpha = twinkle * max(borderFade, 0.2) * clamp(beam, 0.58, 1.65);
                    // Only the brightest stars grow diffraction glints.
                    vSpike = smoothstep(0.95, 1.8, brightnessSeed);

                    // Perspective attenuation calibrated to the region scale (~10^5
                    // units) instead of the old fixed 260.0 (which assumed a ~10^3
                    // scene and collapsed every layer to sub-pixel). The clamp keeps a
                    // visible pixel floor so the distant mid/background layers actually
                    // render, and a ceiling so close stars don't balloon.
                    float sizeScale = regionRadius * 0.02;
                    float px = size * (sizeScale / dist) * (0.5 + brightnessSeed * 0.7);
                    px *= mix(1.0, clamp(beam, 0.75, 1.45), beta);
                    gl_PointSize = clamp(px, 1.8, 30.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying float vSpike;
                uniform float opacity;
                uniform float bloom;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);

                    // Tight core punched into HDR so the bloom pass catches it, wrapped
                    // in a soft halo for the glow.
                    float core = pow(smoothstep(0.5, 0.0, d), 2.4);
                    float halo = smoothstep(0.5, 0.05, d) * 0.4;

                    // Vertical + horizontal diffraction glints on the brightest stars so
                    // they read as shining rather than as flat dots.
                    vec2 a = abs(uv);
                    float spikeH = smoothstep(0.5, 0.0, a.y) * smoothstep(0.5, 0.0, a.x * 7.0);
                    float spikeV = smoothstep(0.5, 0.0, a.x) * smoothstep(0.5, 0.0, a.y * 7.0);
                    float spike = max(spikeH, spikeV) * vSpike;

                    float mask = core + halo + spike * 0.5;
                    float alpha = mask * vAlpha * opacity;
                    if (alpha < 0.003) discard;

                    // bloom scales how hard the core overshoots into HDR, which is
                    // what the global bloom pass picks up - higher = more glow spill.
                    vec3 col = vColor * (1.0 + core * 1.8 * bloom);
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.name = `StarLayer:${name}`;
        points.frustumCulled = false;
        return points;
    }

    _webStarPosition(name, radius) {
        const sampled = this.web.sample(this.rng, {
            nodeBias: name === 'near' ? 0.82 : 0.58,
            filamentBias: name === 'near' ? 0.12 : 0.36,
            voidScatter: name === 'near' ? 0.03 : this.config.global.voidScatter,
            spread: name === 'near' ? 0.36 : 0.8,
            densityAttempts: name === 'near' ? 5 : 4,
            densityPower: name === 'near' ? 1.45 : 1.2
        });
        if (name === 'near') return sampled.position.clampLength(2000, radius);
        if (sampled.position.length() < 90000) sampled.position.add(new THREE.Vector3(gaussian(this.rng), gaussian(this.rng), gaussian(this.rng)).multiplyScalar(90000));
        return sampled.position.clampLength(20000, radius);
    }

    _makeSystemPOI(star, wx, wy, wz, distanceSq) {
        return {
            type: 'star',
            name: star.name,
            position: new THREE.Vector3(wx, wy, wz),
            radius: star.systemRadius,
            color: star.color.clone(),
            temperatureK: star.temperatureK,
            luminosity: star.intensity,
            _distanceSq: distanceSq
        };
    }

    _withinAnyShell(wx, wy, wz, shells) {
        for (const shell of shells) {
            const dx = wx - shell.position.x;
            const dy = wy - shell.position.y;
            const dz = wz - shell.position.z;
            if (dx * dx + dy * dy + dz * dz < shell.entryRadius * shell.entryRadius) return true;
        }
        return false;
    }
}
