export function navigationTargetBelongsToDepth(targetDepth, activeDepth) {
    return Number.isInteger(targetDepth)
        && Number.isInteger(activeDepth)
        && targetDepth === activeDepth;
}

export function findAuthoredNavigationReplacement(candidates, namedSystemId) {
    if (typeof namedSystemId !== 'string' || !namedSystemId) return null;
    return (candidates ?? []).find((poi) => (
        poi?.rpg?.namedSystemId === namedSystemId
        && !poi.rpg.surfacePoiId
    )) ?? null;
}
