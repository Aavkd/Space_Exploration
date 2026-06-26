import * as THREE from 'three';

export class DiegeticRadioPanel {
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

        this.object3D = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), this.material);
        this.object3D.name = 'RadioConsoleScreen';

        this.time = 0;
        this._draw({ power: false, currentStation: null, volume: 0.5 });
    }

    update({ power, currentStation, volume, dt }) {
        this.time += dt;
        this._draw({ power, currentStation, volume });
    }

    _draw({ power, currentStation, volume }) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Rich dark CRT background gradient (retro dark brown/amber)
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#100500');
        bgGrad.addColorStop(1, '#2c0e00');
        ctx.fillStyle = bgGrad;
        
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(0, 0, w, h, 24);
        } else {
            ctx.rect(0, 0, w, h);
        }
        ctx.fill();

        // Screen bezel/border with amber glow
        ctx.strokeStyle = 'rgba(255, 120, 0, 0.45)';
        ctx.lineWidth = 6;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 120, 0, 0.15)';
        ctx.lineWidth = 14;
        ctx.stroke();

        // Grid scanlines overlay effect
        ctx.strokeStyle = 'rgba(255, 100, 0, 0.04)';
        ctx.lineWidth = 1;
        for (let y = 10; y < h; y += 8) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Header Title
        ctx.fillStyle = '#ff9c00';
        ctx.font = 'bold 22px "Consolas", "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(255, 156, 0, 0.6)';
        ctx.shadowBlur = 8;
        ctx.fillText('RADIO TRANSCEIVER RX-90', w / 2, 42);
        ctx.shadowBlur = 0; // reset

        // Status banner
        ctx.fillStyle = 'rgba(255, 156, 0, 0.58)';
        ctx.font = '12px "Consolas", "Courier New", monospace';
        ctx.fillText('STAND-BY FREQUENCY RECEIVER', w / 2, 65);

        // Divider
        ctx.strokeStyle = 'rgba(255, 120, 0, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(30, 80);
        ctx.lineTo(w - 30, 80);
        ctx.stroke();

        if (!power) {
            // Screen state: Powered Down
            ctx.fillStyle = '#ff5400';
            ctx.font = 'bold 24px "Consolas", "Courier New", monospace';
            ctx.fillText('[ POWER STANDBY ]', w / 2, h / 2 - 20);
            
            ctx.fillStyle = 'rgba(255, 84, 0, 0.6)';
            ctx.font = '14px "Consolas", "Courier New", monospace';
            ctx.fillText('INTERACT TO POWER ON SYSTEM', w / 2, h / 2 + 10);
            
            // Draw flat line on oscilloscope
            this._drawOscilloscope(ctx, w / 2, h - 140, w - 80, 80, false, false);
        } else {
            // Screen state: Powered On
            // Left block: Frequency info
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffb000';
            ctx.font = 'bold 15px "Consolas", "Courier New", monospace';
            ctx.fillText('STATUS: LOCKED', 40, 115);

            ctx.fillStyle = '#fff0d0';
            ctx.font = 'bold 36px "Consolas", "Courier New", monospace';
            ctx.shadowColor = 'rgba(255, 240, 208, 0.5)';
            ctx.shadowBlur = 10;
            ctx.fillText(currentStation ? currentStation.frequency : '--- MHz', 40, 155);
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#ff9c00';
            ctx.font = 'bold 15px "Consolas", "Courier New", monospace';
            ctx.fillText(`STATION: ${currentStation ? currentStation.name.toUpperCase() : 'NO SIGNAL'}`, 40, 190);

            // Right block: Volume bar
            ctx.textAlign = 'right';
            ctx.fillStyle = '#ffb000';
            ctx.font = 'bold 14px "Consolas", "Courier New", monospace';
            ctx.fillText(`VOLUME: ${(volume * 100).toFixed(0)}%`, w - 40, 115);

            const volBarWidth = 120;
            const volBarHeight = 14;
            const volBarX = w - 40 - volBarWidth;
            const volBarY = 130;

            ctx.strokeStyle = 'rgba(255, 120, 0, 0.4)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(volBarX, volBarY, volBarWidth, volBarHeight);

            // Fill segments
            const filledWidth = volBarWidth * volume;
            ctx.fillStyle = '#ff9c00';
            ctx.fillRect(volBarX + 2, volBarY + 2, Math.max(0, filledWidth - 4), volBarHeight - 4);

            // Draw oscilloscope in the middle-bottom
            const isStatic = currentStation ? currentStation.isStatic : true;
            this._drawOscilloscope(ctx, w / 2, h - 150, w - 80, 90, true, isStatic);
        }

        // Draw frequency dial scale at the bottom
        this._drawFrequencyDial(ctx, w / 2, h - 45, w - 80, currentStation, power);

        this.texture.needsUpdate = true;
    }

    _drawOscilloscope(ctx, centerX, centerY, width, height, active, isStatic) {
        const startX = centerX - width / 2;
        const startY = centerY - height / 2;

        // Draw bezel box
        ctx.fillStyle = 'rgba(20, 5, 0, 0.5)';
        ctx.fillRect(startX, startY, width, height);
        ctx.strokeStyle = 'rgba(255, 100, 0, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(startX, startY, width, height);

        // Center line guide
        ctx.strokeStyle = 'rgba(255, 100, 0, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, centerY);
        ctx.lineTo(startX + width, centerY);
        ctx.stroke();

        ctx.strokeStyle = '#ff9c00';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(255, 156, 0, 0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();

        if (!active) {
            // Draw simple flat line
            ctx.moveTo(startX, centerY);
            ctx.lineTo(startX + width, centerY);
        } else if (isStatic) {
            // Draw rough high-frequency noise
            ctx.moveTo(startX, centerY);
            for (let x = 0; x < width; x += 3) {
                const noise = (Math.random() - 0.5) * (height * 0.7);
                ctx.lineTo(startX + x, centerY + noise);
            }
        } else {
            // Draw clean scrolling multi-frequency sine wave
            ctx.moveTo(startX, centerY);
            for (let x = 0; x < width; x += 2) {
                const t = this.time * 9;
                const wave1 = Math.sin(x * 0.045 - t) * (height * 0.28);
                const wave2 = Math.sin(x * 0.09 + t * 1.5) * (height * 0.12);
                ctx.lineTo(startX + x, centerY + wave1 + wave2);
            }
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
    }

    _drawFrequencyDial(ctx, centerX, centerY, width, currentStation, power) {
        const startX = centerX - width / 2;
        ctx.strokeStyle = 'rgba(255, 120, 0, 0.35)';
        ctx.lineWidth = 2;

        // Horizontal axis line
        ctx.beginPath();
        ctx.moveTo(startX, centerY);
        ctx.lineTo(startX + width, centerY);
        ctx.stroke();

        // Tick marks and labels for 88 - 108 MHz
        const minFreq = 88;
        const maxFreq = 108;
        const range = maxFreq - minFreq;

        ctx.fillStyle = 'rgba(255, 120, 0, 0.6)';
        ctx.font = '10px "Consolas", "Courier New", monospace';
        ctx.textAlign = 'center';

        for (let f = minFreq; f <= maxFreq; f += 2) {
            const pct = (f - minFreq) / range;
            const x = startX + pct * width;
            
            ctx.beginPath();
            ctx.moveTo(x, centerY);
            // Long tick every 4 MHz, short tick every 2 MHz
            const tickH = (f % 4 === 0) ? 8 : 4;
            ctx.lineTo(x, centerY + tickH);
            ctx.stroke();

            if (f % 4 === 0) {
                ctx.fillText(f.toString(), x, centerY + 22);
            }
        }

        // Draw indicator needle if power is on and a station is active
        if (power && currentStation) {
            const freqVal = parseFloat(currentStation.frequency);
            if (!isNaN(freqVal) && freqVal >= minFreq && freqVal <= maxFreq) {
                const pct = (freqVal - minFreq) / range;
                const needleX = startX + pct * width;

                ctx.strokeStyle = '#ff3c00';
                ctx.fillStyle = '#ff3c00';
                ctx.lineWidth = 2.5;
                ctx.shadowColor = 'rgba(255, 60, 0, 0.8)';
                ctx.shadowBlur = 8;

                // Vertical needle line
                ctx.beginPath();
                ctx.moveTo(needleX, centerY - 10);
                ctx.lineTo(needleX, centerY + 12);
                ctx.stroke();

                // Arrow indicator at the top
                ctx.beginPath();
                ctx.moveTo(needleX, centerY - 10);
                ctx.lineTo(needleX - 4, centerY - 14);
                ctx.lineTo(needleX + 4, centerY - 14);
                ctx.closePath();
                ctx.fill();

                ctx.shadowBlur = 0; // reset
            }
        }
    }
}
