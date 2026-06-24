import * as THREE from 'three';

export class UniverseNavigation {
    constructor({ universe }) {
        this.universe = universe;
        this.visible = true;
        this.markers = [];
        this.element = this._createElement();
        document.body.appendChild(this.element);
    }

    update({ shipPosition, camera, displayMode }) {
        this.markers = this.universe.getPOIs(shipPosition, 8);
        this.element.hidden = displayMode === 'vr' || !this.visible;
        if (this.element.hidden) return;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const lines = this.markers.slice(0, 5).map((poi) => {
            const toPoi = poi.position.clone().sub(shipPosition).normalize();
            const bearing = signedBearing(forward, toPoi);
            const arrow = bearing > 18 ? '>' : bearing < -18 ? '<' : '^';
            return `${arrow} ${poi.name} ${formatDistance(poi.distance)}`;
        });
        this.element.querySelector('[data-nav]').textContent = lines.join('\n');
    }

    getState() {
        return {
            markers: this.markers.map((poi) => ({
                type: poi.type,
                name: poi.name,
                distance: poi.distance
            }))
        };
    }

    _createElement() {
        const element = document.createElement('div');
        element.id = 'universe-navigation';
        element.innerHTML = `
            <style>
                #universe-navigation {
                    position: fixed;
                    left: 50%;
                    top: 16px;
                    transform: translateX(-50%);
                    width: min(460px, calc(100vw - 320px));
                    min-width: 260px;
                    padding: 8px 12px;
                    background: rgba(4, 8, 18, 0.62);
                    border: 1px solid rgba(150, 205, 255, 0.2);
                    color: #cfe6ff;
                    font: 12px/1.45 "Consolas", "Courier New", monospace;
                    letter-spacing: 0.04em;
                    pointer-events: none;
                    z-index: 8;
                    white-space: pre;
                    text-align: center;
                }
            </style>
            <div data-nav></div>
        `;
        return element;
    }
}

function signedBearing(forward, toPoi) {
    const angle = forward.angleTo(toPoi) * 180 / Math.PI;
    const crossY = forward.clone().cross(toPoi).y;
    return crossY >= 0 ? angle : -angle;
}

function formatDistance(distance) {
    if (distance > 100000) return `${(distance / 1000).toFixed(0)}k`;
    if (distance > 1000) return `${(distance / 1000).toFixed(1)}k`;
    return `${distance.toFixed(0)}m`;
}
