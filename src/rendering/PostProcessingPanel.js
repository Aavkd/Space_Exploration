export class PostProcessingPanel {
    constructor({ config, onChange }) {
        this.config = config;
        this.onChange = onChange;
        this.visible = false;
        this.element = this._createElement();
        document.body.appendChild(this.element);
        this._render();
    }

    toggle() {
        this.visible = !this.visible;
        this.element.hidden = !this.visible;
    }

    _createElement() {
        const element = document.createElement('aside');
        element.className = 'post-panel';
        element.hidden = true;
        element.innerHTML = `
            <style>
                .post-panel {
                    position: fixed;
                    top: 16px;
                    right: 16px;
                    width: min(340px, calc(100vw - 32px));
                    max-height: calc(100vh - 32px);
                    overflow: auto;
                    padding: 14px;
                    box-sizing: border-box;
                    background: rgba(4, 8, 18, 0.92);
                    border: 1px solid rgba(150, 205, 255, 0.28);
                    color: #dcecff;
                    font: 12px Arial, Helvetica, sans-serif;
                    box-shadow: 0 0 30px rgba(40, 120, 255, 0.2);
                    z-index: 10;
                }
                .post-panel h2 {
                    margin: 0 0 12px;
                    font-size: 13px;
                    letter-spacing: 0.08em;
                }
                .post-panel fieldset {
                    border: 1px solid rgba(150, 205, 255, 0.2);
                    margin: 0 0 10px;
                    padding: 10px;
                }
                .post-panel legend {
                    color: #9bdcff;
                    padding: 0 6px;
                }
                .post-panel label {
                    display: grid;
                    grid-template-columns: 1fr auto;
                    gap: 10px;
                    align-items: center;
                    margin: 8px 0;
                }
                .post-panel input[type="range"] {
                    width: 130px;
                }
                .post-panel button {
                    background: #12304a;
                    border: 1px solid rgba(180, 220, 255, 0.4);
                    color: #e8f4ff;
                    padding: 6px 8px;
                    cursor: pointer;
                }
            </style>
            <h2>POST FX / F2</h2>
            <div data-content></div>
        `;
        return element;
    }

    _render() {
        const content = this.element.querySelector('[data-content]');
        content.innerHTML = '';

        content.append(
            this._createPresetTools(),
            this._createGroup('Bloom', this.config.bloom, [
                ['enabled', 'checkbox'],
                ['strength', 'range', 0, 2, 0.01],
                ['radius', 'range', 0, 2, 0.01],
                ['threshold', 'range', 0, 1, 0.01]
            ]),
            this._createGroup('Warp', this.config.warp, [
                ['enabled', 'checkbox'],
                ['debugSpeedFactor', 'range', 0, 1, 0.01],
                ['blurStrength', 'range', 0, 0.2, 0.001],
                ['blurSamples', 'range', 1, 16, 1],
                ['aberrationStrength', 'range', 0, 0.01, 0.00001],
                ['vignetteStrength', 'range', 0, 1, 0.01],
                ['streakIntensity', 'range', 0, 0.2, 0.001],
                ['distortion', 'range', 0, 1, 0.01]
            ]),
            this._createGroup('Retro / Pixel', this.config.retro, [
                ['enabled', 'checkbox'],
                ['pixelSize', 'range', 1, 12, 1],
                ['colorDepth', 'range', 2, 32, 1],
                ['contrast', 'range', 0, 2, 0.01],
                ['saturation', 'range', 0, 2, 0.01],
                ['scanlineIntensity', 'range', 0, 1, 0.01],
                ['scanlineCount', 'range', 0, 4, 0.1],
                ['noiseIntensity', 'range', 0, 0.5, 0.01],
                ['vignetteStrength', 'range', 0, 1, 0.01],
                ['vignetteIntensity', 'range', 0, 1, 0.01],
                ['aberration', 'range', 0, 0.02, 0.0005],
                ['brightness', 'range', -1, 1, 0.01],
                ['exposure', 'range', 0.2, 4, 0.01]
            ]),
            this._createGroup('ASCII', this.config.ascii, [
                ['enabled', 'checkbox'],
                ['zoom', 'range', 0.5, 4, 0.1],
                ['fontCharCount', 'range', 2, 16, 1],
                ['colorChar', 'checkbox'],
                ['invert', 'checkbox'],
                ['fillColor', 'color'],
                ['backgroundColor', 'color']
            ]),
            this._createGroup('Halftone', this.config.halftone, [
                ['enabled', 'checkbox'],
                ['dotSize', 'range', 0.5, 8, 0.1],
                ['angle', 'range', 0, 180, 1],
                ['scale', 'range', 0.5, 4, 0.1]
            ]),
            this._createGroup('Deep Space', this.config.deepSpace, [
                ['starOpacity', 'range', 0, 1, 0.01],
                ['starBrightness', 'range', 0, 6, 0.05],
                ['starSize', 'range', 1, 18, 0.5],
                ['nebulaOpacity', 'range', 0, 1.5, 0.01],
                ['nebulaBrightness', 'range', 0, 6, 0.05],
                ['nebulaScale', 'range', 0.3, 2.5, 0.01],
                ['galaxyDensity', 'range', 0, 2, 0.01],
                ['blackHoleChance', 'range', 0, 1, 0.01],
                ['anomalyChance', 'range', 0, 1, 0.01],
                ['gravityScale', 'range', 0, 4, 0.05]
            ]),
            this._createGroup('VR Comfort', this.config.vrComfort, [
                ['bloomMax', 'range', 0, 2, 0.01],
                ['warpMax', 'range', 0, 1, 0.01],
                ['accelerationCap', 'range', 1, 60, 1]
            ]),
            this._createGroup('Ship', this.config.ship, [
                ['brightness', 'range', 0, 2, 0.01],
                ['bloom', 'range', 0, 3, 0.05],
                ['envMapIntensity', 'range', 0, 3, 0.01],
                ['glassOpacity', 'range', 0, 1, 0.01]
            ]),
        );
    }

    _createGroup(title, target, controls) {
        const fieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = title;
        fieldset.appendChild(legend);

        for (const [key, type, min, max, step] of controls) {
            const label = document.createElement('label');
            const name = document.createElement('span');
            const input = document.createElement('input');
            name.textContent = key;
            input.type = type;

            if (type === 'checkbox') {
                input.checked = Boolean(target[key]);
            } else if (type === 'color') {
                input.value = target[key];
            } else {
                input.min = min;
                input.max = max;
                input.step = step;
                input.value = target[key];
            }

            input.addEventListener('input', () => {
                if (type === 'checkbox') {
                    target[key] = input.checked;
                } else if (type === 'color') {
                    target[key] = input.value;
                } else {
                    target[key] = Number(input.value);
                }
                this.onChange();
            });

            label.append(name, input);
            fieldset.appendChild(label);
        }

        return fieldset;
    }

    _createPresetTools() {
        const tools = document.createElement('fieldset');
        const legend = document.createElement('legend');
        const exportButton = this._createExportButton();
        const importLabel = document.createElement('label');
        const importName = document.createElement('span');
        const importInput = document.createElement('input');

        legend.textContent = 'Preset JSON';
        importName.textContent = 'import';
        importInput.type = 'file';
        importInput.accept = 'application/json,.json';
        importInput.addEventListener('change', async () => {
            const file = importInput.files?.[0];
            if (!file) return;

            const imported = JSON.parse(await file.text());
            this._mergeConfig(this.config, imported);
            this._render();
            this.onChange();
            importInput.value = '';
        });

        importLabel.append(importName, importInput);
        tools.append(legend, exportButton, importLabel);
        return tools;
    }

    _createExportButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Export JSON';
        button.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'deep-space-post-fx-preset.json';
            link.click();
            URL.revokeObjectURL(url);
        });
        return button;
    }

    _mergeConfig(target, source) {
        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === 'object' && !Array.isArray(value) && target[key]) {
                this._mergeConfig(target[key], value);
            } else {
                target[key] = value;
            }
        }
    }
}
