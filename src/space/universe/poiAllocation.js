export function calculateSystemPoiLimit(limit, authoredSystemCount) {
    const totalLimit = Math.max(0, Math.floor(Number(limit) || 0));
    if (totalLimit === 0) return 0;
    const authoredCount = Math.max(0, Math.floor(Number(authoredSystemCount) || 0));
    const ordinarySystemQuota = Math.max(1, Math.min(4, Math.floor(totalLimit * 0.35)));
    return Math.min(totalLimit, Math.max(ordinarySystemQuota, authoredCount));
}
