import * as THREE from 'three';
import { DESCENT, SCALE_TIERS } from '../../config/scaleTiers.js';
import { createChildLevel } from './Level.js';
import { matchesLockedDescentTarget } from './descentTargeting.js';

// Total wall-clock length of a descend/ascend transition, and the point in that
// window at which the (expensive) content swap happens — behind the veil's peak
// so the generation hitch and the hard reparent are never seen (§4, §8).
const TRANSITION_TIME = 1.15;
const SWAP_AT = 0.5;

// Where the ship is dropped on ascent: just outside the parent's entry shell so
// it does not immediately re-descend (the hysteresis gap in action).
const ASCEND_SHELL_MARGIN = 1.25;

// Owns the active level chain (docs/universe-scale-architecture.md §9). Only the
// top of the stack is live and rendered; its ancestors are kept dormant (cheap
// "baked" backdrops) and the shared SkyDeepSpace dome remains the universal sky.
//
// Each frame it: updates the active level, applies that level's floating-origin
// rebase, then evaluates the uniform transition rule — descend into a nearby
// object when slow enough, ascend when past the exit shell — running the
// reparent/rescale handoff under an eased veil.
export class ScaleStack {
    constructor({ scene, rootLevel, baseConfig, ship, gravityField, onActiveChange = () => {} }) {
        this.scene = scene;
        this.baseConfig = baseConfig;
        this.ship = ship;
        this.gravityField = gravityField;
        this.onActiveChange = onActiveChange;

        this.stack = [rootLevel];
        this.transition = null; // { kind, t, swapped, candidate? }
        this.veil = createVeil();
        this.lastEvent = null;

        // Descent candidates the ship was already inside when this level became
        // active. They stay blocked until the ship leaves that specific shell,
        // preventing spawn-time capture without disabling unrelated stars inside
        // large overlapping galaxy shells.
        this._blockedDescentKeys = new Set();
        this._descentBlocksInitialized = false;
    }

    get active() {
        return this.stack[this.stack.length - 1];
    }

    get depth() {
        return this.stack.length - 1;
    }

    get isTransitioning() {
        return this.transition !== null;
    }

    // Per-frame entry point. `ctx` carries the live ship state App already has.
    update(ctx) {
        // Keep the active level animating even mid-transition so the swap reveals
        // a living scene, not a frozen one.
        this.active.update(ctx.shipPosition, ctx.dt, ctx.cameraPosition);
        this._updateDormantAncestors(ctx);

        if (this.transition) {
            this._advanceTransition(ctx);
            return;
        }

        // Ascend has priority: leaving is always allowed (no speed gate, §4.2).
        if (this.depth > 0 && this.active.exitDistance(ctx.shipPosition) > this.active.exitRadius) {
            this._begin('ascend');
            return;
        }

        // Entry shells currently containing the ship. We block only the shells
        // the player began inside, then unblock each one independently when it is
        // left. That keeps spawn/ascend hysteresis while allowing newly approached
        // star systems to trigger even if a broad galaxy shell still overlaps.
        const contained = this._containedDescents(ctx.shipPosition, ctx.lockedTargetId, ctx.lockedTargetPosition);
        this._updateBlockedDescents(contained);
        const candidate = this._nearestUnblocked(contained, ctx.lockedTargetId, ctx.lockedTargetPosition);

        // Descend only when this is a newly entered shell and the ship is slow
        // enough (PRECISION, §4.1).
        if (candidate && ctx.hyperdriveLevel < DESCENT.speedGateLevel) {
            this._begin('descend', candidate);
        }
    }

    // Route the floating-origin rebase to the active level only. Dormant
    // ancestors are not rebased — their frame is frozen at the moment of descent
    // so an ascent can restore the ship there via the stored breadcrumb.
    rebaseOrigin(offset) {
        this.active.rebaseOrigin(offset);
    }

    // --- Debug / scripted control (bypasses the gates) ---------------------

    forceDescend(shipPosition) {
        if (this.transition) return false;
        const candidate = this._nearestDescent(shipPosition, Infinity);
        if (!candidate) return false;
        this._begin('descend', candidate);
        return true;
    }

    forceAscend() {
        if (this.transition || this.depth === 0) return false;
        this._begin('ascend');
        return true;
    }

    // Collapse the whole stack back to the root level, disposing every descended
    // level. Used when the tier-0 universe is regenerated (its children are stale).
    resetToRoot() {
        if (this.transition) {
            this._setVeilOpacity(0);
            this.transition = null;
        }
        if (this.depth === 0) return;
        while (this.depth > 0) {
            const leaving = this.stack.pop();
            this.scene.remove(leaving.group);
            leaving.dispose();
        }
        this.scene.add(this.active.group);
        this.active.origin.set(0, 0, 0);
        this._resetDescentBlocks();
        this.onActiveChange(this.active);
    }

    getState(shipPosition = new THREE.Vector3()) {
        return {
            depth: this.depth,
            tier: this.active.tier,
            levelName: this.active.name,
            chain: this.stack.map((level) => level.name),
            transition: this.transition ? this.transition.kind : null,
            transitionT: this.transition ? this.transition.t : 0,
            exitDistance: this.depth > 0 ? this.active.exitDistance(shipPosition) : null,
            exitRadius: this.active.exitRadius,
            lastEvent: this.lastEvent
        };
    }

    // --- Internals ---------------------------------------------------------

    _nearestDescent(shipPosition, maxRadiusOverride = null) {
        let best = null;
        let bestDistance = Infinity;
        for (const candidate of this.active.getDescentCandidates(shipPosition, maxRadiusOverride)) {
            const distance = shipPosition.distanceTo(candidate.position);
            const reach = maxRadiusOverride ?? candidate.entryRadius;
            if (distance <= reach && distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
        return best;
    }

    _containedDescents(shipPosition, lockedTargetId = null, lockedTargetPosition = null) {
        const contained = [];
        for (const candidate of this.active.getDescentCandidates(shipPosition, null, lockedTargetId, lockedTargetPosition)) {
            const distance = shipPosition.distanceTo(candidate.position);
            if (distance <= candidate.entryRadius) contained.push({ candidate, distance });
        }
        return contained;
    }

    _updateBlockedDescents(contained) {
        const currentKeys = new Set(contained.map(({ candidate }) => candidateKey(candidate)));
        if (!this._descentBlocksInitialized) {
            this._blockedDescentKeys = currentKeys;
            this._descentBlocksInitialized = true;
            return;
        }

        for (const key of [...this._blockedDescentKeys]) {
            if (!currentKeys.has(key)) this._blockedDescentKeys.delete(key);
        }
    }

    _nearestUnblocked(contained, lockedTargetId = null, lockedTargetPosition = null) {
        let best = null;
        let bestDistance = Infinity;
        for (const { candidate, distance } of contained) {
            if (this._blockedDescentKeys.has(candidateKey(candidate))) continue;
            // Target-exclusive descent check:
            if (this.active.tier <= SCALE_TIERS.galaxy.tier && lockedTargetId !== null) {
                if (!matchesLockedDescentTarget(candidate, lockedTargetId, lockedTargetPosition)) {
                    continue;
                }
            }
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
        return best;
    }

    _begin(kind, candidate = null) {
        this.transition = { kind, t: 0, swapped: false, candidate };
    }

    _advanceTransition(ctx) {
        const t = this.transition.t + ctx.dt / TRANSITION_TIME;
        this.transition.t = t;
        this._setVeilOpacity(veilCurve(t));

        if (!this.transition.swapped && t >= SWAP_AT) {
            this.transition.swapped = true;
            if (this.transition.kind === 'descend') this._performDescend(this.transition.candidate);
            else this._performAscend();
        }

        if (t >= 1) {
            this._setVeilOpacity(0);
            this.transition = null;
        }
    }

    _performDescend(candidate) {
        const fromScale = this.active.unitScale;

        // Record which side the ship approached the object from (parent frame),
        // so the child level can spawn the ship on that same side instead of a
        // canned standoff — entry stays continuous with the approach (§8.5).
        // Only Planetary uses it today; harmless for the other tiers.
        if (candidate.position) {
            candidate.approachDir = this.ship.object3D.position.clone().sub(candidate.position);
        }

        const child = createChildLevel(candidate, this.baseConfig);

        // Swap which level the scene renders. The parent stays in memory but out
        // of the graph — a cheap dormant backdrop (§7).
        this.scene.remove(this.active.group);
        this.stack.push(child);
        this.scene.add(child.group);

        // Reparent the ship into the child frame and carry velocity across,
        // rescaled by the unit ratio so apparent motion stays continuous
        // (§8.3-8.4). Galaxy starts at the origin; System starts at a scenic
        // standoff from its star.
        const frameRotation = child.universe.getChildFrameQuaternion?.() ?? null;
        this._reparentShip(child.entryPosition?.clone?.() ?? new THREE.Vector3(0, 0, 0), fromScale, child.unitScale, frameRotation);
        child.origin.set(0, 0, 0);

        this._resetDescentBlocks();
        this.lastEvent = `descend:${child.name}`;
        this.onActiveChange(child);
    }

    _performAscend() {
        const leaving = this.stack.pop();
        const parent = this.active;

        this.scene.remove(leaving.group);
        this.scene.add(parent.group);

        // Restore the ship to where it descended from, in the parent's (frozen)
        // frame, nudged just outside the entry shell so it does not fall straight
        // back in (§8.5). Leave on the SAME side the ship is exiting toward —
        // mirroring the approach-direction entry — by taking its current offset
        // from the departed level's centre as the exit direction. The reparent
        // carries orientation unchanged, so this direction (and the outward
        // velocity that earned the ascent) stays consistent across the boundary.
        const breadcrumb = leaving.breadcrumb;
        let target;
        let frameRotation = null;
        if (breadcrumb) {
            const exitDir = this.ship.object3D.position.clone().sub(leaving.origin);
            if (exitDir.lengthSq() < 1e-6) exitDir.set(0, 0, 1);
            exitDir.normalize();
            frameRotation = leaving.universe.getParentFrameQuaternion?.() ?? null;
            const parentExitDir = leaving.universe.toParentFrameDirection?.(exitDir.clone()) ?? exitDir;
            const currentParent = this._findCurrentParentCandidate(parent, breadcrumb);
            const parentPosition = currentParent?.position?.clone?.() ?? breadcrumb.position.clone();
            const entryRadius = currentParent?.entryRadius ?? breadcrumb.entryRadius;
            target = parentPosition.addScaledVector(parentExitDir.normalize(), entryRadius * ASCEND_SHELL_MARGIN);
        } else {
            target = new THREE.Vector3(0, 0, 0);
        }
        this._reparentShip(target, leaving.unitScale, parent.unitScale, frameRotation);

        this._resetDescentBlocks();
        this.lastEvent = `ascend:${parent.name}`;
        this.onActiveChange(parent);

        leaving.dispose();
    }

    // Carry orientation unchanged, rescale velocity by the ratio of the level
    // being left to the one being entered, and place the ship at `target`.
    _reparentShip(target, fromUnitScale, targetUnitScale, frameRotation = null) {
        const ratio = (fromUnitScale || 1) / (targetUnitScale || 1);
        this.ship.velocity.multiplyScalar(ratio);
        if (frameRotation) {
            this.ship.velocity.applyQuaternion(frameRotation);
            this.ship.angularVelocity?.applyQuaternion?.(frameRotation);
            this.ship.object3D.quaternion.premultiply(frameRotation);
        }
        this.ship.object3D.position.copy(target);
        // Gravity for the entered level is rebuilt by App via onActiveChange.
    }

    _setVeilOpacity(value) {
        this.veil.style.opacity = String(THREE.MathUtils.clamp(value, 0, 1));
    }

    _resetDescentBlocks() {
        this._blockedDescentKeys.clear();
        this._descentBlocksInitialized = false;
    }

    _updateDormantAncestors(ctx) {
        if (this.depth < 1) return;
        const active = this.active;
        const parent = this.stack[this.stack.length - 2];
        if (active.tier !== SCALE_TIERS.planetary.tier || parent.tier !== SCALE_TIERS.system.tier) return;
        parent.update(ctx.shipPosition, ctx.dt, ctx.cameraPosition);
    }

    _findCurrentParentCandidate(parent, breadcrumb) {
        if (!breadcrumb?.id || !parent?.getDescentCandidates) return null;
        return parent
            .getDescentCandidates(new THREE.Vector3(), Infinity)
            .find((candidate) => candidate.id === breadcrumb.id && candidate.kind === breadcrumb.kind) ?? null;
    }
}

function candidateKey(candidate) {
    return `${candidate.kind}:${candidate.id}`;
}

// Ease the veil up to full black by the swap point, then back down — hiding the
// content swap and softening the scale change for VR comfort (§8). Symmetric
// triangle peaking at SWAP_AT.
function veilCurve(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    const rising = clamped <= SWAP_AT;
    const phase = rising ? clamped / SWAP_AT : 1 - (clamped - SWAP_AT) / (1 - SWAP_AT);
    return THREE.MathUtils.smoothstep(phase, 0, 1);
}

function createVeil() {
    const veil = document.createElement('div');
    veil.id = 'scale-transition-veil';
    veil.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:#000005',
        'opacity:0',
        'pointer-events:none',
        'z-index:20',
        'transition:none'
    ].join(';');
    document.body.appendChild(veil);
    return veil;
}
