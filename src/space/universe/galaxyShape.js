import * as THREE from 'three';
import { gaussian, randomRange } from './rng.js';

// Shared galaxy mass distribution (disk + spiral arms / elliptical bulge /
// irregular clumps). Both the structural haze (GalaxyInteriorField) and the
// resolved star field (StarField, when inside a galaxy level) sample from this
// so the stars actually populate the arms and clouds instead of filling a
// generic sphere while only the haze shows the shape.
//
// `preferArms` biases spiral samples outward into the arm radii (vs the broad
// disk fill). Points are returned in the level's XZ disk plane (thin in Y),
// matching the interior field's orientation and the galaxy descent standoff.
export function sampleGalaxyDiskPoint(rng, regionRadius, descriptor, preferArms = false) {
    const type = descriptor?.type ?? 'spiral';

    if (type === 'elliptical') {
        return new THREE.Vector3(
            gaussian(rng) * regionRadius * 0.28,
            gaussian(rng) * regionRadius * 0.06,
            gaussian(rng) * regionRadius * 0.22
        );
    }

    if (type === 'irregular') {
        const clump = new THREE.Vector3(
            gaussian(rng) * regionRadius * 0.22,
            gaussian(rng) * regionRadius * 0.08,
            gaussian(rng) * regionRadius * 0.22
        );
        clump.x += randomRange(rng, -regionRadius * 0.3, regionRadius * 0.3);
        clump.z += randomRange(rng, -regionRadius * 0.3, regionRadius * 0.3);
        return clump;
    }

    const radial = preferArms
        ? THREE.MathUtils.lerp(0.18, 0.92, Math.pow(rng(), 0.72))
        : Math.pow(rng(), 0.64) * 0.96;
    const armCount = Math.max(2, descriptor?.armCount || 4);
    const arm = Math.floor(rng() * armCount);
    const angle = radial * 7.4 + arm * Math.PI * 2 / armCount + (descriptor?.dustPhase ?? 0) * 0.12;
    const scatter = THREE.MathUtils.lerp(0.012, preferArms ? 0.035 : 0.07, radial) * regionRadius;
    const r = radial * regionRadius;
    return new THREE.Vector3(
        Math.cos(angle) * r + gaussian(rng) * scatter,
        gaussian(rng) * THREE.MathUtils.lerp(450, 3300, radial),
        Math.sin(angle) * r + gaussian(rng) * scatter
    );
}
