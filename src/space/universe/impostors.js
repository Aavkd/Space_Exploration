import * as THREE from 'three';

const textureCache = new Map();

export function getImpostorTexture(type = 'glow', palette = {}) {
    const key = `${type}:${palette.inner ?? ''}:${palette.outer ?? ''}`;
    if (textureCache.has(key)) return textureCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const inner = palette.inner ?? '#ffffff';
    const outer = palette.outer ?? '#66aaff';

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (type === 'spiral') drawSpiral(ctx, inner, outer);
    else if (type === 'elliptical') drawElliptical(ctx, inner, outer);
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

function drawElliptical(ctx, inner, outer) {
    ctx.save();
    ctx.translate(128, 128);
    ctx.scale(1.55, 0.72);
    drawGlow(ctx, inner, outer);
    ctx.restore();
}

function drawSpiral(ctx, inner, outer) {
    drawGlow(ctx, inner, outer);
    ctx.save();
    ctx.translate(128, 128);
    ctx.strokeStyle = outer;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 9;
    for (let arm = 0; arm < 4; arm++) {
        ctx.beginPath();
        for (let i = 0; i < 88; i++) {
            const t = i / 87;
            const a = t * 5.4 + arm * Math.PI * 0.5;
            const r = 10 + t * 102;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r * 0.55;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
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
