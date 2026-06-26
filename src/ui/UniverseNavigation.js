import * as THREE from 'three';

export class UniverseNavigation {
    constructor({ universe }) {
        this.universe = universe;
        this.visible = true;
        this.markers = [];
        this.element = this._createElement();
        document.body.appendChild(this.element);
    }

    update({ shipPosition, camera, displayMode, pilotActive, selectedTarget, ship }) {
        // Only show HUD compass when piloting the ship
        this.element.hidden = displayMode === 'vr' || !this.visible || !pilotActive;
        
        if (selectedTarget) {
            // Keep markers array sync'd for getState() telemetry calls
            const dist = shipPosition.distanceTo(selectedTarget.position);
            this.markers = [{
                type: selectedTarget.type,
                name: selectedTarget.name,
                rpg: selectedTarget.rpg ?? null,
                distance: dist,
                position: selectedTarget.position
            }];
        } else {
            this.markers = [];
        }

        if (this.element.hidden) return;

        const navNode = this.element.querySelector('[data-nav]');

        if (!selectedTarget) {
            navNode.innerHTML = `
                <div style="color: #ff9d3b; font-weight: bold; font-size: 13px; text-shadow: 0 0 8px rgba(255, 157, 59, 0.4);">NO NAVIGATION TARGET SET</div>
                <div style="font-size: 11px; margin-top: 5px; color: rgba(210, 232, 255, 0.65);">Interact [C] with Navigation Console (Left) to lock target</div>
            `;
            return;
        }

        // Selected target calculation relative to ship (independent of Three.js matrix update order)
        const localPoi = selectedTarget.position.clone().sub(shipPosition);
        const distance = localPoi.length();
        localPoi.applyQuaternion(ship.object3D.quaternion.clone().invert());
        localPoi.normalize();

        // Local Yaw (negative = left, positive = right)
        const yawAngle = Math.atan2(localPoi.x, -localPoi.z) * 180 / Math.PI;
        // Local Pitch (negative = down, positive = up)
        const pitchAngle = Math.asin(localPoi.y) * 180 / Math.PI;

        // Build a 7x5 ASCII crosshair grid
        const grid = [
            ['.', '.', '.', '|', '.', '.', '.'],
            ['.', '.', '.', '|', '.', '.', '.'],
            ['-', '-', '-', '+', '-', '-', '-'],
            ['.', '.', '.', '|', '.', '.', '.'],
            ['.', '.', '.', '|', '.', '.', '.']
        ];

        // Map Yaw to columns [0..6]
        let yawIdx = 3;
        if (yawAngle < -20) yawIdx = 0;
        else if (yawAngle < -10) yawIdx = 1;
        else if (yawAngle < -2) yawIdx = 2;
        else if (yawAngle > 20) yawIdx = 6;
        else if (yawAngle > 10) yawIdx = 5;
        else if (yawAngle > 2) yawIdx = 4;

        // Map Pitch to rows [0..4] (pitch positive is UP, row 0 is top)
        let pitchIdx = 2;
        if (pitchAngle > 10) pitchIdx = 0;
        else if (pitchAngle > 3) pitchIdx = 1;
        else if (pitchAngle < -10) pitchIdx = 4;
        else if (pitchAngle < -3) pitchIdx = 3;

        // Overlay current target indicator
        const isCentered = Math.abs(yawAngle) <= 5 && Math.abs(pitchAngle) <= 5;
        if (pitchIdx === 2 && yawIdx === 3) {
            grid[2][3] = isCentered ? 'X' : 'o';
        } else {
            grid[pitchIdx][yawIdx] = 'o';
        }

        const gridString = grid.map(row => row.join(' ')).join('\n');
        const distStr = formatDistance(distance);
        
        let alignmentLabel = '<span style="color: #8fa6c2; font-weight: bold;">STEER TO ALIGN TARGET</span>';
        if (isCentered) {
            alignmentLabel = '<span style="color: #74ffb0; font-weight: bold; text-shadow: 0 0 10px rgba(116, 255, 176, 0.7);">ALIGNMENT OPTIMAL (HYPERDRIVE READY)</span>';
        }

        const rpgTag = selectedTarget.rpg ? '<span style="color: #ffd075; border: 1px solid #ffd075; padding: 0 3px; font-size: 9px; border-radius: 2px; margin-left: 6px; font-weight: bold; vertical-align: middle;">RPG</span>' : '';

        navNode.innerHTML = `
            <div style="border-bottom: 1px solid rgba(135, 210, 255, 0.22); padding-bottom: 6px; margin-bottom: 6px; display: flex; justify-content: center; align-items: center;">
                <span style="color: #8ce2ff; font-weight: bold; font-size: 13px; text-shadow: 0 0 8px rgba(140, 226, 255, 0.5);">LOCK: ${selectedTarget.name.toUpperCase()}</span>${rpgTag}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 10px 6px;">
                <div style="text-align: left; line-height: 1.6;">
                    <div>RANGE: <span style="color: #fff; font-weight: bold;">${distStr}</span></div>
                    <div style="margin-top: 2px;">YAW  : <span style="color: ${yawAngle >= 0 ? '#ffb061' : '#8ce2ff'}; font-weight: bold;">${yawAngle >= 0 ? 'R' : 'L'} ${Math.abs(yawAngle).toFixed(1)}°</span></div>
                    <div>PITCH: <span style="color: ${pitchAngle >= 0 ? '#74ffb0' : '#ffcf8c'}; font-weight: bold;">${pitchAngle >= 0 ? 'U' : 'D'} ${Math.abs(pitchAngle).toFixed(1)}°</span></div>
                </div>
                <div style="font-family: 'Consolas', monospace; white-space: pre; line-height: 1.1; color: #8ce2ff; letter-spacing: 0.15em; font-weight: bold; background: rgba(0, 8, 20, 0.5); padding: 6px 12px; border-radius: 4px; border: 1px solid rgba(135, 210, 255, 0.2); text-shadow: 0 0 5px rgba(140, 226, 255, 0.4);">
${gridString}
                </div>
            </div>
            <div style="border-top: 1px solid rgba(135, 210, 255, 0.12); padding-top: 5px; margin-top: 4px;">
                ${alignmentLabel}
            </div>
        `;
    }

    getState() {
        return {
            markers: this.markers.map((poi) => ({
                type: poi.type,
                name: poi.name,
                rpg: poi.rpg ?? null,
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
                    width: min(440px, calc(100vw - 320px));
                    min-width: 350px;
                    padding: 10px 14px;
                    background: rgba(4, 9, 22, 0.88);
                    border: 1px solid rgba(135, 210, 255, 0.38);
                    border-radius: 4px;
                    color: #cfe6ff;
                    font: 12px/1.45 "Consolas", "Courier New", monospace;
                    letter-spacing: 0.04em;
                    pointer-events: none;
                    z-index: 8;
                    box-shadow: 0 0 24px rgba(70, 150, 255, 0.14);
                }
            </style>
            <div data-nav></div>
        `;
        return element;
    }
}

function formatDistance(distance) {
    if (distance > 100000) return `${(distance / 1000).toFixed(0)}k`;
    if (distance > 1000) return `${(distance / 1000).toFixed(1)}k`;
    return `${distance.toFixed(0)}m`;
}
