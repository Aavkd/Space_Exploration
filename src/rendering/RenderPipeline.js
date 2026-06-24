import { DesktopPostFxPipeline } from './DesktopPostFxPipeline.js';
import { XRPostFxPipeline } from './XRPostFxPipeline.js';

/**
 * Renderer-facing facade (Phase 06). `App` calls one stable render entrypoint
 * and this decides the backend:
 *   - `desktop`    : EffectComposer chain (DesktopPostFxPipeline).
 *   - `vr_postfx`  : custom WebXR post-FX (XRPostFxPipeline) — the visual feature.
 *   - `vr_direct`  : plain XR render, only when XR post-FX is explicitly disabled
 *                    for non-visual locomotion/debug work. NOT a silent fallback.
 *
 * The spec named a library backend (pmndrs/postprocessing) as the first route,
 * but it has no shipped WebXR support, so the implemented XR backend is `custom`.
 * `setXrPostFxBackend('library')` is accepted but reports unavailable.
 */
export class RenderPipeline {
    constructor({ renderer, scene, camera, config }) {
        this.renderer = renderer;
        this.config = config;

        this.desktop = new DesktopPostFxPipeline({ renderer, scene, camera, config });
        this.xr = new XRPostFxPipeline({ renderer });
        this.xr.applyConfig(config);

        this.requestedXrBackend = 'custom';
        this.activeBackend = 'desktop';
        // Run the XR combined shader single-camera on the desktop canvas so the
        // VR look can be A/B'd against the desktop composer without a headset.
        this.previewXrOnDesktop = Boolean(config.xrPostFx?.previewOnDesktop);
    }

    /** Single render entrypoint for App. */
    render({ scene, camera, dt = 0 }) {
        if (this.renderer.xr.isPresenting) {
            const drove = this.xr.render({ scene, camera, dt });
            if (drove) {
                this.activeBackend = 'vr_postfx';
                return this.activeBackend;
            }
            // XR post-FX is explicitly disabled: direct render for debug only.
            this.activeBackend = 'vr_direct';
            this.renderer.render(scene, camera);
            return this.activeBackend;
        }

        if (this.previewXrOnDesktop && this.xr.enabled) {
            this.activeBackend = 'vr_postfx_preview';
            this.xr.renderDesktopPreview({ scene, camera, dt });
            return this.activeBackend;
        }

        this.activeBackend = 'desktop';
        this.desktop.render(dt);
        return this.activeBackend;
    }

    applyConfig(config) {
        this.config = config;
        this.previewXrOnDesktop = Boolean(config.xrPostFx?.previewOnDesktop);
        this.desktop.applyConfig(config);
        this.xr.applyConfig(config);
    }

    setWarpSpeedFactor(value) {
        this.desktop.setWarpSpeedFactor(value);
        this.xr.setWarpSpeedFactor(value);
    }

    // Phase 08: speed-driven radial warp distortion, capped + eased by the caller
    // (desktop and VR use different caps; see App._tick).
    setWarpDistortion(value) {
        this.desktop.setWarpDistortion(value);
        this.xr.setWarpDistortion(value);
    }

    resize(width, height) {
        this.desktop.resize(width, height);
        // XR targets size themselves from the XR framebuffer every frame.
    }

    setXrPostFxEnabled(enabled) {
        this.xr.enabled = Boolean(enabled);
        return this.xr.enabled;
    }

    setXrPostFxBackend(name) {
        this.requestedXrBackend = name;
        if (name === 'library') {
            console.warn('RenderPipeline: "library" XR backend (pmndrs/postprocessing) has no shipped WebXR support; staying on "custom".');
        }
        // Only the custom backend is implemented; the XR pipeline is always custom.
        return 'custom';
    }

    getState() {
        return {
            activeBackend: this.activeBackend,
            requestedXrBackend: this.requestedXrBackend,
            isPresenting: this.renderer.xr.isPresenting,
            desktop: this.desktop.getDebugState(),
            xr: this.xr.getDebugState()
        };
    }

    getXrPostFxState() {
        return {
            backend: 'custom',
            requestedBackend: this.requestedXrBackend,
            ...this.xr.getDebugState()
        };
    }
}
