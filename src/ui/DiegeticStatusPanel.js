import * as THREE from 'three';

export class DiegeticStatusPanel {
    constructor({
        width = 1024,
        height = 512,
        size = [0.44, 0.22],
        position = [-0.42, -0.25, -0.78]
    } = {}) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        this.material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            opacity: 0.92,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.object3D = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), this.material);
        this.object3D.name = 'VrStatusHud';
        this.object3D.position.fromArray(position);
        this.object3D.renderOrder = 10001;
        this.object3D.visible = false;

        this.lastState = {};
        this._draw({
            displayMode: 'desktop',
            playerState: 'walking',
            speed: 0,
            dampeners: false,
            pilotActive: false,
            preset: 'desktop_default',
            prompt: null
        });
    }

    update(state) {
        const next = {
            displayMode: state.displayMode ?? 'desktop',
            playerState: state.playerState ?? 'walking',
            speed: Math.round(state.speed ?? 0),
            dampeners: Boolean(state.dampeners),
            pilotActive: Boolean(state.pilotActive),
            preset: state.preset ?? 'custom',
            prompt: state.prompt ?? ''
        };

        if (JSON.stringify(next) === JSON.stringify(this.lastState)) return;
        this.lastState = next;
        this._draw(next);
    }

    getDebugState() {
        return {
            visible: this.object3D.visible,
            localPosition: this.object3D.position.toArray(),
            lastState: { ...this.lastState }
        };
    }

    _draw(state) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, 'rgba(4, 12, 24, 0.88)');
        gradient.addColorStop(1, 'rgba(7, 22, 34, 0.76)');
        ctx.fillStyle = gradient;
        roundRect(ctx, 0, 0, w, h, 26);
        ctx.fill();

        ctx.strokeStyle = 'rgba(143, 232, 255, 0.62)';
        ctx.lineWidth = 5;
        roundRect(ctx, 12, 12, w - 24, h - 24, 20);
        ctx.stroke();

        ctx.fillStyle = '#9bdcff';
        ctx.font = '700 42px Consolas, monospace';
        ctx.fillText('DEEP SPACE FLIGHT', 48, 76);

        ctx.fillStyle = 'rgba(220, 244, 255, 0.92)';
        ctx.font = '34px Consolas, monospace';
        ctx.fillText(`MODE ${state.displayMode.toUpperCase()} / ${state.playerState.toUpperCase()}`, 48, 150);
        ctx.fillText(`SPEED ${state.speed.toString().padStart(4, ' ')} M/S`, 48, 210);
        ctx.fillText(`PILOT ${state.pilotActive ? 'LINKED' : 'STANDBY'}`, 48, 270);
        ctx.fillText(`DAMP ${state.dampeners ? 'ON' : 'OFF'}`, 48, 330);
        ctx.fillText(`FX ${state.preset.toUpperCase()}`, 48, 390);

        ctx.fillStyle = state.prompt ? '#ffcc75' : 'rgba(155, 220, 255, 0.68)';
        ctx.font = '700 28px Consolas, monospace';
        ctx.fillText(state.prompt ? trimPrompt(state.prompt) : 'NO LOCAL ACTION', 48, 462);

        this.texture.needsUpdate = true;
    }
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function trimPrompt(prompt) {
    return prompt
        .replace('Press C / Triangle - ', '')
        .replace('through the airlock ', '')
        .toUpperCase()
        .slice(0, 34);
}
