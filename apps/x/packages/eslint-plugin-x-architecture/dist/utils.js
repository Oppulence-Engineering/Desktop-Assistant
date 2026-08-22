export function normalizedFilename(filename) {
    return filename.replaceAll("\\", "/");
}
export function baselineLimit(filename, baseline) {
    const normalized = normalizedFilename(filename);
    for (const [suffix, count] of Object.entries(baseline ?? {})) {
        if (normalized.endsWith(suffix))
            return count;
    }
    return 0;
}
export function memberName(node) {
    if (!node || node.type !== "MemberExpression" || node.computed)
        return null;
    return node.property.type === "Identifier" ? node.property.name : null;
}
export function rootIdentifier(node) {
    let current = node;
    while (current?.type === "MemberExpression")
        current = current.object;
    return current?.type === "Identifier" ? current.name : null;
}
export function isLiteralTrue(node) {
    return node.type === "Literal" && node.value === true;
}
export function isLiteralFalse(node) {
    return node.type === "Literal" && node.value === false;
}
