import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { WarpSpeedShader } from '../postprocessing/WarpSpeedShader.js';
import { Retro16BitShader } from '../postprocessing/Retro16BitShader.js';
import { ASCIIShader } from '../postprocessing/ASCIIShader.js';
import { HalftoneShader } from '../postprocessing/HalftoneShader.js';

/**
 * Desktop post-FX backend: the original EffectComposer chain
 *   RenderPass -> UnrealBloom -> Warp -> Retro -> ASCII -> Halftone
 * Migrated unchanged from the old PostProcessing class. EffectComposer is kept
 * strictly as a desktop path; the headset uses XRPostFxPipeline instead.
 */
export class DesktopPostFxPipeline {
    constructor({ renderer, scene, camera, config }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.config = config;

        const size = this._getSize();
        this.composer = new EffectComposer(renderer);
        this.renderPass = new RenderPass(scene, camera);
        this.bloomPass = new UnrealBloomPass(size, 1.2, 0.8, 0.1);
        this.warpPass = new ShaderPass(WarpSpeedShader);
        this.retroPass = new ShaderPass(Retro16BitShader);
        this.asciiPass = new ShaderPass(ASCIIShader);
        this.halftonePass = new ShaderPass(HalftoneShader);

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(this.warpPass);
        this.composer.addPass(this.retroPass);
        this.composer.addPass(this.asciiPass);
        this.composer.addPass(this.halftonePass);

        this._loadAsciiTexture();
        this.resize(window.innerWidth, window.innerHeight);
        this.applyConfig(config);
    }

    render(dt) {
        this.composer.render(dt);
    }

    applyConfig(config) {
        this.config = config;

        this.bloomPass.enabled = config.bloom.enabled;
        this.bloomPass.strength = Math.min(config.bloom.strength, config.vrComfort?.bloomMax ?? config.bloom.strength);
        this.bloomPass.radius = config.bloom.radius;
        this.bloomPass.threshold = config.bloom.threshold;

        this.warpPass.enabled = config.warp.enabled;
        Object.assign(this.warpPass.uniforms.blurStrength, { value: config.warp.blurStrength });
        Object.assign(this.warpPass.uniforms.aberrationStrength, { value: config.warp.aberrationStrength });
        Object.assign(this.warpPass.uniforms.vignetteStrength, { value: config.warp.vignetteStrength });
        Object.assign(this.warpPass.uniforms.streakIntensity, { value: config.warp.streakIntensity });
        Object.assign(this.warpPass.uniforms.distortion, { value: config.warp.distortion });
        Object.assign(this.warpPass.uniforms.blurSamples, { value: config.warp.blurSamples });
        Object.assign(this.warpPass.uniforms.speedFactor, { value: config.warp.debugSpeedFactor });

        this.retroPass.enabled = config.retro.enabled;
        const retroUniforms = this.retroPass.uniforms;
        retroUniforms.pixelSize.value = config.retro.pixelSize;
        retroUniforms.colorDepth.value = config.retro.colorDepth;
        retroUniforms.contrast.value = config.retro.contrast;
        retroUniforms.saturation.value = config.retro.saturation;
        retroUniforms.scanlineIntensity.value = config.retro.scanlineIntensity;
        retroUniforms.scanlineCount.value = config.retro.scanlineCount;
        retroUniforms.noiseIntensity.value = config.retro.noiseIntensity;
        retroUniforms.vignetteStength.value = config.retro.vignetteStrength;
        retroUniforms.vignetteIntensity.value = config.retro.vignetteIntensity;
        retroUniforms.aberration.value = config.retro.aberration;
        retroUniforms.brightness.value = config.retro.brightness;
        retroUniforms.exposure.value = config.retro.exposure;

        this.asciiPass.enabled = config.ascii.enabled;
        const asciiUniforms = this.asciiPass.uniforms;
        asciiUniforms.zoom.value = config.ascii.zoom;
        asciiUniforms.fontCharCount.value = config.ascii.fontCharCount;
        asciiUniforms.colorChar.value = config.ascii.colorChar;
        asciiUniforms.invert.value = config.ascii.invert;
        asciiUniforms.fillColor.value.set(config.ascii.fillColor);
        asciiUniforms.backgroundColor.value.set(config.ascii.backgroundColor);

        this.halftonePass.enabled = config.halftone.enabled;
        const halftoneUniforms = this.halftonePass.uniforms;
        halftoneUniforms.dotSize.value = config.halftone.dotSize;
        halftoneUniforms.angle.value = config.halftone.angle;
        halftoneUniforms.scale.value = config.halftone.scale;
    }

    setWarpSpeedFactor(speedFactor) {
        this.warpPass.uniforms.speedFactor.value = Math.max(speedFactor, this.config.warp.debugSpeedFactor);
    }

    resize(width, height) {
        this.composer.setSize(width, height);
        const pixelRatio = this.renderer.getPixelRatio();
        const resolution = new THREE.Vector2(width * pixelRatio, height * pixelRatio);
        this.warpPass.uniforms.resolution.value.copy(resolution);
        this.retroPass.uniforms.resolution.value.copy(resolution);
        this.asciiPass.uniforms.resolution.value.copy(resolution);
        this.halftonePass.uniforms.resolution.value.copy(resolution);
        this.bloomPass.setSize(width, height);
    }

    getDebugState() {
        return {
            bloomStrength: this.bloomPass.strength,
            bloomEnabled: this.bloomPass.enabled,
            warpEnabled: this.warpPass.enabled,
            retroEnabled: this.retroPass.enabled,
            asciiEnabled: this.asciiPass.enabled,
            halftoneEnabled: this.halftonePass.enabled,
            warpResolution: this.warpPass.uniforms.resolution.value.toArray(),
            retroResolution: this.retroPass.uniforms.resolution.value.toArray(),
            asciiResolution: this.asciiPass.uniforms.resolution.value.toArray(),
            halftoneResolution: this.halftonePass.uniforms.resolution.value.toArray()
        };
    }

    _loadAsciiTexture() {
        new THREE.TextureLoader().load('./assets/texture/fillASCII.png', (texture) => {
            texture.colorSpace = THREE.NoColorSpace;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            this.asciiPass.uniforms.tFill.value = texture;
        });
    }

    _getSize() {
        return new THREE.Vector2(window.innerWidth, window.innerHeight);
    }
}
