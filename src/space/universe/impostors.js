import * as THREE from 'three';

const textureCache = new Map();

export function getImpostorTexture(type = 'glow', palette = {}) {
    const key = `${type}:${palette.inner ?? ''}:${palette.outer ?? ''}:${palette.variant ?? palette.seed ?? ''}:${palette.armCount ?? ''}:${palette.dustPhase ?? ''}`;
    if (textureCache.has(key)) return textureCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const inner = palette.inner ?? '#ffffff';
    const outer = palette.outer ?? '#66aaff';

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (type === 'spiral') drawSpiral(ctx, inner, outer, palette, key);
    else if (type === 'elliptical') drawElliptical(ctx, inner, outer, palette, key);
    else if (type === 'irregular') drawIrregular(ctx, inner, outer, key);
    else if (type === 'blackhole') drawBlackHole(ctx, inner, outer);
    else drawGlow(ctx, inner, outer);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textureCache.set(key, texture);
    return texture;
}

export function disposeImpostorTextures() {
    for (const texture of textureCache.values()) texture.dispose();
    textureCache.clear();
}

function drawGlow(ctx, inner, outer) {
    const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 126);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
}

function drawElliptical(ctx, inner, outer, palette, seedText) {
    const rng = seeded(seedText);
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate((rng() - 0.5) * 0.35);
    ctx.scale(1.35 + rng() * 0.45, 0.62 + rng() * 0.28);
    drawGlow(ctx, inner, outer);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.1 + rng() * 0.08;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 0, 94, 13 + rng() * 12, (rng() - 0.5) * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawSpiral(ctx, inner, outer, palette, seedText) {
    const rng = seeded(seedText);
    const arms = Math.max(2, Math.floor(palette.armCount ?? (3 + Math.floor(rng() * 4))));
    const dustPhase = palette.dustPhase ?? rng() * Math.PI * 2;
    drawGlow(ctx, inner, outer);
    ctx.save();
    ctx.translate(128, 128);
    ctx.strokeStyle = outer;
    ctx.globalAlpha = 0.44 + rng() * 0.22;
    ctx.lineWidth = 7 + rng() * 5;
    for (let arm = 0; arm < arms; arm++) {
        ctx.beginPath();
        for (let i = 0; i < 88; i++) {
            const t = i / 87;
            const a = t * (4.5 + rng() * 1.7) + arm * Math.PI * 2 / arms + dustPhase * 0.08;
            const r = 10 + t * 102;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r * (0.42 + rng() * 0.24);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 4;
    for (let arm = 0; arm < arms; arm++) {
        ctx.beginPath();
        for (let i = 0; i < 72; i++) {
            const t = i / 71;
            const a = t * 5.1 + arm * Math.PI * 2 / arms + dustPhase + 0.23;
            const r = 18 + t * 94;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r * 0.48;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff8ac8';
    for (let i = 0; i < 22; i++) {
        const arm = Math.floor(rng() * arms);
        const t = 0.24 + rng() * 0.7;
        const a = t * 5.2 + arm * Math.PI * 2 / arms + dustPhase * 0.12 + (rng() - 0.5) * 0.42;
        const r = 18 + t * 90;
        ctx.globalAlpha = 0.08 + rng() * 0.16;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.5, 1.5 + rng() * 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawIrregular(ctx, inner, outer, seedText) {
    const rng = seeded(seedText);
    drawGlow(ctx, inner, outer);
    ctx.fillStyle = outer;
    for (let i = 0; i < 90; i++) {
        const a = rng() * Math.PI * 2;
        const r = rng() * 105;
        const x = 128 + Math.cos(a) * r;
        const y = 128 + Math.sin(a) * r * 0.75;
        ctx.globalAlpha = 0.04 + rng() * 0.1;
        ctx.beginPath();
        ctx.arc(x, y, 3 + rng() * 18, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBlackHole(ctx, inner, outer) {
    drawGlow(ctx, outer, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(-0.28);
    ctx.strokeStyle = inner;
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.ellipse(0, 0, 82, 24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function seeded(text) {
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }
    return () => {
        seed += 0x6d2b79f5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
