const LIVE_KEYS = new Set([
    'gravityScale',
    'opacity',
    'brightness',
    'size',
    'pointSize',
    'colorInner',
    'colorOuter',
    'temperatureBias',
    'saturation',
    'bloom',
    'bloomIntensity',
    'distortion',
    'diskRadius',
    'beaming',
    'photonGlow',
    'photonWidth',
    'photonRadius',
    'scale',
    'rotationSpeed',
    'driftSpeed',
    'hazardIntensity',
    'twinkleSpeed',
    'intensity',
    'range',
    'temperatureInfluence',
    'lerpSpeed',
    'ambientLevel',
    'eventRate',
    'supernova',
    'pulsarSweep',
    'comet',
    'ionStorm'
]);

export class UniversePanel {
    constructor({ config, presets, onLiveChange, onRegen, onPreset }) {
        this.config = config;
        this.presets = presets;
        this.onLiveChange = onLiveChange;
        this.onRegen = onRegen;
        this.onPreset = onPreset;
        this.visible = false;
        this.activeTab = 'Global';
        this.pendingRegen = false;
        this.stats = {};
        this.element = this._createElement();
        document.body.appendChild(this.element);
        this._render();
    }

    toggle() {
        this.setVisible(!this.visible);
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        this.element.hidden = !this.visible;
    }

    refresh() {
        this._render();
    }

    updateStats(stats) {
        this.stats = stats ?? {};
        const node = this.element.querySelector('[data-universe-stats]');
        if (node) node.textContent = this._statsText();
    }

    _createElement() {
        const element = document.createElement('aside');
        element.className = 'universe-panel';
        element.hidden = true;
        element.innerHTML = `
            <style>
                .universe-panel {
                    position: fixed;
                    top: 16px;
                    right: 16px;
                    width: min(430px, calc(100vw - 32px));
                    max-height: calc(100vh - 32px);
                    overflow: auto;
                    padding: 14px;
                    box-sizing: border-box;
                    background: rgba(3, 8, 20, 0.94);
                    border: 1px solid rgba(150, 205, 255, 0.3);
                    color: #dcecff;
                    font: 12px Arial, Helvetica, sans-serif;
                    box-shadow: 0 0 34px rgba(40, 120, 255, 0.2);
                    z-index: 11;
                }
                .universe-panel h2 {
                    margin: 0 0 10px;
                    font-size: 13px;
                    letter-spacing: 0.08em;
                }
                .universe-panel .tabs {
                    display: flex;
                    gap: 4px;
                    flex-wrap: wrap;
                    margin-bottom: 10px;
                }
                .universe-panel button {
                    background: #12304a;
                    border: 1px solid rgba(180, 220, 255, 0.4);
                    color: #e8f4ff;
                    padding: 6px 8px;
                    cursor: pointer;
                }
                .universe-panel button.active {
                    background: #1d5f86;
                    border-color: rgba(180, 240, 255, 0.75);
                }
                .universe-panel button.warn {
                    background: #593314;
                    border-color: rgba(255, 190, 110, 0.7);
                }
                .universe-panel fieldset {
                    border: 1px solid rgba(150, 205, 255, 0.2);
                    margin: 0 0 10px;
                    padding: 10px;
                }
                .universe-panel legend {
                    color: #9bdcff;
                    padding: 0 6px;
                }
                .universe-panel label {
                    display: grid;
                    grid-template-columns: 1fr auto auto;
                    gap: 8px;
                    align-items: center;
                    margin: 8px 0;
                }
                .universe-panel input[type="range"] {
                    width: 150px;
                }
                .universe-panel input[type="text"] {
                    width: 156px;
                    background: #06111f;
                    color: #e8f4ff;
                    border: 1px solid rgba(180, 220, 255, 0.32);
                    padding: 5px;
                }
                .universe-panel .badge {
                    min-width: 42px;
                    text-align: center;
                    color: #001018;
                    background: #8ee8ff;
                    border-radius: 3px;
                    padding: 2px 4px;
                    font-size: 10px;
                    font-weight: 700;
                }
                .universe-panel .badge.regen {
                    background: #ffca73;
                }
                .universe-panel .stats {
                    white-space: pre-wrap;
                    color: #b8dbff;
                    line-height: 1.45;
                }
            </style>
            <h2>UNIVERS / F10</h2>
            <div class="tabs" data-tabs></div>
            <div data-pending></div>
            <div data-content></div>
        `;
        return element;
    }

    _render() {
        const tabs = ['Global', 'Stars', 'Galaxies', 'Black holes', 'Nebulae', 'Debris', 'Lighting', 'Events', 'Tools'];
        const tabNode = this.element.querySelector('[data-tabs]');
        tabNode.innerHTML = '';
        for (const tab of tabs) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = tab;
            button.className = tab === this.activeTab ? 'active' : '';
            button.addEventListener('click', () => {
                this.activeTab = tab;
                this._render();
            });
            tabNode.appendChild(button);
        }

        const pending = this.element.querySelector('[data-pending]');
        pending.innerHTML = this.pendingRegen
            ? '<fieldset><legend>Pending</legend><span class="badge regen">REGEN</span> changes waiting for Regen</fieldset>'
            : '';

        const content = this.element.querySelector('[data-content]');
        content.innerHTML = '';
        if (this.activeTab === 'Global') {
            content.appendChild(this._group('Global', 'global', [
                ['seed', 'text'],
                ['regionRadius', 'range', 100000, 800000, 10000],
                ['masterDensity', 'range', 0.25, 2, 0.01],
                ['nodeCount', 'range', 4, 32, 1],
                ['filamentStrength', 'range', 0, 2, 0.01],
                ['voidScatter', 'range', 0, 0.3, 0.01],
                ['themeVariety', 'range', 0, 2, 0.01],
                ['gravityScale', 'range', 0, 4, 0.05],
                ['fogDensity', 'range', 0, 0.000006, 0.0000001]
            ]));
        } else if (this.activeTab === 'Stars') {
            content.appendChild(this._group('Stars', 'stars', [
                ['enabled', 'checkbox'],
                ['nearCount', 'range', 0, 12000, 100],
                ['midCount', 'range', 0, 60000, 500],
                ['bgCount', 'range', 0, 100000, 1000],
                ['brightness', 'range', 0, 6, 0.05],
                ['size', 'range', 1, 18, 0.5],
                ['opacity', 'range', 0, 1, 0.01],
                ['twinkleSpeed', 'range', 0, 4, 0.01],
                ['temperatureBias', 'range', 0, 1, 0.01],
                ['saturation', 'range', 0, 2, 0.01],
                ['bloom', 'range', 0, 4, 0.05]
            ]));
        } else if (this.activeTab === 'Galaxies') {
            content.appendChild(this._group('Galaxies', 'galaxies', [
                ['enabled', 'checkbox'],
                ['count', 'range', 0, 80, 1],
                ['spiralRatio', 'range', 0, 1, 0.01],
                ['ellipticalRatio', 'range', 0, 1, 0.01],
                ['irregularRatio', 'range', 0, 1, 0.01],
                ['sizeMin', 'range', 1000, 12000, 500],
                ['sizeMax', 'range', 5000, 60000, 500],
                ['opacity', 'range', 0, 1, 0.01],
                ['brightness', 'range', 0, 3, 0.01],
                ['rotationSpeed', 'range', 0, 4, 0.01],
                ['pointSize', 'range', 4, 48, 1],
                ['bloom', 'range', 0, 4, 0.05],
                ['colorInner', 'color'],
                ['colorOuter', 'color']
            ]));
        } else if (this.activeTab === 'Black holes') {
            content.appendChild(this._group('Black holes / Pulsars / Anomalies', 'blackHoles', [
                ['enabled', 'checkbox'],
                ['blackHoleCount', 'range', 0, 12, 1],
                ['pulsarCount', 'range', 0, 8, 1],
                ['anomalyCount', 'range', 0, 20, 1],
                ['bloomIntensity', 'range', 0, 4, 0.05],
                ['distortion', 'range', 0, 0.6, 0.01],
                ['diskRadius', 'range', 2, 12, 0.1],
                ['beaming', 'range', 0, 2, 0.05],
                ['photonGlow', 'range', 0, 3, 0.05],
                ['photonWidth', 'range', 0.05, 1.5, 0.05],
                ['photonRadius', 'range', 1, 4, 0.05],
                ['scale', 'range', 40, 220, 1],
                ['colorInner', 'color'],
                ['colorOuter', 'color']
            ]));
        } else if (this.activeTab === 'Nebulae') {
            content.appendChild(this._group('Nebulae / Clusters / Dust', 'nebulae', [
                ['enabled', 'checkbox'],
                ['nebulaCount', 'range', 0, 26, 1],
                ['clusterCount', 'range', 0, 40, 1],
                ['dust', 'checkbox'],
                ['opacity', 'range', 0, 1.5, 0.01],
                ['brightness', 'range', 0, 6, 0.05],
                ['scale', 'range', 0.3, 2.5, 0.01],
                ['driftSpeed', 'range', 0, 4, 0.01],
                ['bloom', 'range', 0, 4, 0.05]
            ]));
        } else if (this.activeTab === 'Debris') {
            content.appendChild(this._group('Asteroid Fields / Belts / Rings', 'debris', [
                ['enabled', 'checkbox'],
                ['systemBelts', 'checkbox'],
                ['beltCount', 'range', 0, 4, 1],
                ['density', 'range', 0.1, 2, 0.05],
                ['opacity', 'range', 0, 1, 0.01],
                ['brightness', 'range', 0, 2.5, 0.01],
                ['driftSpeed', 'range', 0, 3, 0.01],
                ['hazardIntensity', 'range', 0, 8, 0.05]
            ]));
        } else if (this.activeTab === 'Lighting') {
            content.appendChild(this._group('Lighting', 'lighting', [
                ['intensity', 'range', 0, 3, 0.01],
                ['range', 'range', 20000, 240000, 1000],
                ['temperatureInfluence', 'range', 0, 1, 0.01],
                ['lerpSpeed', 'range', 0.1, 8, 0.1],
                ['ambientLevel', 'range', 0, 1, 0.01]
            ]));
        } else if (this.activeTab === 'Events') {
            content.appendChild(this._group('Events', 'events', [
                ['eventRate', 'range', 0, 0.4, 0.005],
                ['supernova', 'checkbox'],
                ['pulsarSweep', 'checkbox'],
                ['comet', 'checkbox'],
                ['ionStorm', 'checkbox'],
                ['intensity', 'range', 0, 3, 0.01]
            ]));
        } else {
            content.appendChild(this._tools());
        }
    }

    _group(title, section, controls) {
        const fieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = title;
        fieldset.appendChild(legend);
        for (const control of controls) fieldset.appendChild(this._control(section, ...control));
        return fieldset;
    }

    _control(section, key, type, min, max, step) {
        const target = this.config[section];
        const label = document.createElement('label');
        const name = document.createElement('span');
        const input = document.createElement(type === 'select' ? 'select' : 'input');
        const live = LIVE_KEYS.has(key);
        const badge = document.createElement('span');
        name.textContent = key;
        badge.className = `badge ${live ? '' : 'regen'}`;
        badge.textContent = live ? 'LIVE' : 'REGEN';

        if (type === 'checkbox') {
            input.type = 'checkbox';
            input.checked = Boolean(target[key]);
        } else if (type === 'color') {
            input.type = 'color';
            input.value = target[key];
        } else if (type === 'text') {
            input.type = 'text';
            input.value = target[key];
        } else {
            input.type = 'range';
            input.min = min;
            input.max = max;
            input.step = step;
            input.value = target[key];
            input.title = String(target[key]);
        }

        input.addEventListener('input', () => {
            target[key] = readValue(input, type);
            if (type === 'range') input.title = String(target[key]);
            if (live) this.onLiveChange?.();
            else this.pendingRegen = true;
            this._render();
        });

        label.append(name, input, badge);
        return label;
    }

    _tools() {
        const fieldset = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = 'Tools';

        const randomize = document.createElement('button');
        randomize.type = 'button';
        randomize.textContent = 'Randomize Seed';
        randomize.addEventListener('click', () => {
            this.config.global.seed = `universe-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`;
            this.pendingRegen = true;
            this._render();
        });

        const regen = document.createElement('button');
        regen.type = 'button';
        regen.className = this.pendingRegen ? 'warn' : '';
        regen.textContent = 'Regen';
        regen.addEventListener('click', () => {
            this.pendingRegen = false;
            this.onRegen?.();
            this._render();
        });

        const exportButton = document.createElement('button');
        exportButton.type = 'button';
        exportButton.textContent = 'Export JSON';
        exportButton.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'deep-space-universe.json';
            link.click();
            URL.revokeObjectURL(url);
        });

        const importLabel = document.createElement('label');
        const importName = document.createElement('span');
        const importInput = document.createElement('input');
        importName.textContent = 'import';
        importInput.type = 'file';
        importInput.accept = 'application/json,.json';
        importInput.addEventListener('change', async () => {
            const file = importInput.files?.[0];
            if (!file) return;
            mergeConfig(this.config, JSON.parse(await file.text()));
            this.pendingRegen = false;
            this.onRegen?.();
            importInput.value = '';
            this._render();
        });
        importLabel.append(importName, importInput, document.createElement('span'));

        const presetButtons = Object.keys(this.presets).map((name) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = name;
            button.addEventListener('click', () => {
                this.pendingRegen = false;
                this.onPreset?.(name);
            });
            return button;
        });

        const stats = document.createElement('div');
        stats.className = 'stats';
        stats.dataset.universeStats = '';
        stats.textContent = this._statsText();

        fieldset.append(legend, randomize, regen, exportButton, importLabel, ...presetButtons, stats);
        return fieldset;
    }

    _statsText() {
        const counts = this.stats.counts ?? {};
        const fps = this.stats.fps ? `${this.stats.fps.toFixed(0)} fps` : 'fps --';
        const node = this.stats.currentNode?.name
            ? `${this.stats.currentNode.name} (${this.stats.currentNode.theme})`
            : 'node --';
        return [
            '',
            fps,
            node,
            `stars ${counts.stars ?? 0} | galaxies ${counts.galaxies ?? 0}`,
            `black holes ${counts.blackHoles ?? 0} | pulsars ${counts.pulsars ?? 0} | anomalies ${counts.anomalies ?? 0}`,
            `nebulae ${counts.nebulae ?? 0} | clusters ${counts.clusters ?? 0}`,
            `belts ${counts.debrisFields ?? 0} | asteroids ${counts.asteroids ?? 0} | rings ${counts.ringParticles ?? 0}`,
            `nodes ${counts.nodes ?? 0} | filaments ${counts.filaments ?? 0}`
        ].join('\n');
    }
}

function readValue(input, type) {
    if (type === 'checkbox') return input.checked;
    if (type === 'color' || type === 'text') return input.value;
    return Number(input.value);
}

function mergeConfig(target, source) {
    for (const [key, value] of Object.entries(source ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && target[key]) {
            mergeConfig(target[key], value);
        } else {
            target[key] = value;
        }
    }
}
