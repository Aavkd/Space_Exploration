export const LOCKED_TARGET_ENTRY_RADIUS = 800;
export const LOCKED_TARGET_SEARCH_RADIUS = 1000;

export function descentEntryRadiusForTarget(
    candidate,
    defaultEntryRadius,
    lockedTargetId,
    lockedTargetPosition = null
) {
    return (
        lockedTargetId !== null &&
        matchesLockedDescentTarget(candidate, lockedTargetId, lockedTargetPosition)
    )
        ? LOCKED_TARGET_ENTRY_RADIUS
        : defaultEntryRadius;
}

export function matchesLockedDescentTarget(
    candidate,
    lockedTargetId,
    lockedTargetPosition = null
) {
    if (lockedTargetId === null) return true;
    if (
        candidate.id === lockedTargetId ||
        candidate.rpg?.namedSystemId === lockedTargetId
    ) {
        return true;
    }

    // A system target at Universe tier first descends through its containing
    // galaxy. Positions share that tier's frame, so containment is stable.
    if (
        candidate.kind === 'galaxy' &&
        lockedTargetPosition !== null &&
        lockedTargetPosition.distanceTo(candidate.position) < candidate.radius * 2
    ) {
        return true;
    }

    return false;
}
