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

export function findLiveNavigationReplacement(candidates, selectedTarget) {
    if (!selectedTarget || selectedTarget.rpg?.combatTargetId) return null;
    const entries = candidates ?? [];
    const selectedRpg = selectedTarget.rpg ?? {};
    if (selectedRpg.surfacePoiId) {
        return entries.find((poi) => poi?.rpg?.surfacePoiId === selectedRpg.surfacePoiId) ?? null;
    }
    if (selectedRpg.boardingPoiId) {
        return entries.find((poi) => poi?.rpg?.boardingPoiId === selectedRpg.boardingPoiId) ?? null;
    }
    if (selectedRpg.namedSystemId) {
        return entries.find((poi) => (
            poi?.rpg?.namedSystemId === selectedRpg.namedSystemId
            && !poi.rpg.surfacePoiId
            && !poi.rpg.boardingPoiId
        )) ?? null;
    }
    if (selectedTarget.id !== undefined && selectedTarget.id !== null) {
        const byId = entries.find((poi) => poi?.id === selectedTarget.id);
        if (byId) return byId;
    }
    return entries.find((poi) => (
        poi?.name === selectedTarget.name
        && poi?.type === selectedTarget.type
    )) ?? null;
}
