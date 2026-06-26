import * as THREE from 'three';

export class DiegeticNavigationPanel {
    constructor({
        width = 512,
        height = 512,
        size = [0.55, 0.44]
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
            opacity: 0.95,
            side: THREE.DoubleSide
        });

        // Create the plane mesh that sits in the cockpit scene.
        this.object3D = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), this.material);
        this.object3D.name = 'NavigationConsoleScreen';

        this.lastStateKey = '';
        this._draw([], null);
    }

    update({ pois, selectedTarget }) {
        const stateKey = JSON.stringify({
            pois: pois.map(p => ({ name: p.name, distance: p.distance })),
            selectedName: selectedTarget ? selectedTarget.name : ''
        });

        if (stateKey === this.lastStateKey) return;
        this.lastStateKey = stateKey;

        this._draw(pois, selectedTarget);
    }

    _draw(pois, selectedTarget) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Rich dark CRT background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#030814');
        bgGrad.addColorStop(1, '#061329');
        ctx.fillStyle = bgGrad;
        
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(0, 0, w, h, 24);
        } else {
            ctx.rect(0, 0, w, h);
        }
        ctx.fill();

        // Screen bezel/border with soft glow representation
        ctx.strokeStyle = 'rgba(70, 160, 255, 0.45)';
        ctx.lineWidth = 6;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(70, 160, 255, 0.15)';
        ctx.lineWidth = 14;
        ctx.stroke();

        // Grid scanlines overlay effect
        ctx.strokeStyle = 'rgba(0, 150, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let y = 10; y < h; y += 8) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Header Title
        ctx.fillStyle = '#8ce2ff';
        ctx.font = 'bold 22px "Consolas", "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(140, 226, 255, 0.5)';
        ctx.shadowBlur = 8;
        ctx.fillText('NAV-COMP v4.09', w / 2, 42);
        ctx.shadowBlur = 0; // reset

        // Status banner
        ctx.fillStyle = 'rgba(140, 226, 255, 0.58)';
        ctx.font = '12px "Consolas", "Courier New", monospace';
        ctx.fillText('WALK TO CONSOLE & INTERACT [C] TO LOCK TARGET', w / 2, 65);

        // Divider
        ctx.strokeStyle = 'rgba(70, 160, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(30, 80);
        ctx.lineTo(w - 30, 80);
        ctx.stroke();

        // List elements
        let startY = 120;
        ctx.textAlign = 'left';

        if (pois.length === 0) {
            ctx.fillStyle = '#ffb061';
            ctx.font = 'bold 16px "Consolas", "Courier New", monospace';
            ctx.fillText('NO SYSTEM MARKERS ACQUIRED', 45, startY + 20);
        } else {
            pois.slice(0, 8).forEach((poi, index) => {
                const isSelected = selectedTarget && selectedTarget.name === poi.name;
                
                // Row selection box background
                if (isSelected) {
                    ctx.fillStyle = 'rgba(20, 82, 58, 0.65)';
                    ctx.fillRect(30, startY - 20, w - 60, 32);
                    ctx.strokeStyle = '#74ffb0';
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(30, startY - 20, w - 60, 32);

                    ctx.fillStyle = '#74ffb0';
                    ctx.shadowColor = 'rgba(116, 255, 176, 0.5)';
                    ctx.shadowBlur = 6;
                } else {
                    ctx.fillStyle = 'rgba(70, 160, 255, 0.04)';
                    ctx.fillRect(30, startY - 20, w - 60, 32);
                    ctx.strokeStyle = 'rgba(70, 160, 255, 0.1)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(30, startY - 20, w - 60, 32);

                    ctx.fillStyle = '#d2e8ff';
                }

                ctx.font = 'bold 15px "Consolas", "Courier New", monospace';
                const prefix = isSelected ? '>> LOCK *' : `[0${index + 1}]   `;
                ctx.fillText(`${prefix} ${poi.name.toUpperCase().slice(0, 20)}`, 45, startY + 2);
                ctx.shadowBlur = 0; // reset

                // Distance output
                let distStr = '';
                const distance = poi.distance;
                if (distance > 100000) distStr = `${(distance / 1000).toFixed(0)}k`;
                else if (distance > 1000) distStr = `${(distance / 1000).toFixed(1)}k`;
                else distStr = `${distance.toFixed(0)}m`;

                ctx.textAlign = 'right';
                ctx.font = 'bold 15px "Consolas", "Courier New", monospace';
                ctx.fillText(distStr, w - 45, startY + 2);
                ctx.textAlign = 'left';

                startY += 38;
            });
        }

        // Footer Divider
        ctx.strokeStyle = 'rgba(70, 160, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(30, h - 55);
        ctx.lineTo(w - 30, h - 55);
        ctx.stroke();

        // Target display status
        ctx.textAlign = 'center';
        if (selectedTarget) {
            ctx.fillStyle = '#74ffb0';
            ctx.font = 'bold 14px "Consolas", "Courier New", monospace';
            ctx.shadowColor = 'rgba(116, 255, 176, 0.4)';
            ctx.shadowBlur = 5;
            ctx.fillText(`LOCKED ON TARGET: ${selectedTarget.name.toUpperCase()}`, w / 2, h - 26);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = '#ffcf8c';
            ctx.font = 'bold 14px "Consolas", "Courier New", monospace';
            ctx.fillText('SYSTEM UNLOCKED - NO DESTINATION TARGET', w / 2, h - 26);
        }

        this.texture.needsUpdate = true;
    }
}
