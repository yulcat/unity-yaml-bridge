"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseV3Value = parseV3Value;
exports.formatV3Value = formatV3Value;
exports.markCanonicalFlowMappings = markCanonicalFlowMappings;
/** JSON is the canonical v3 value syntax. It keeps strings and large numeric
 * scalars unambiguous while still being familiar to humans and agents. */
function parseV3Value(text, context) {
    try {
        return markCanonicalFlowMappings(JSON.parse(text));
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid v3 JSON value at ${context}: ${detail}`);
    }
}
function formatV3Value(value) {
    const formatted = JSON.stringify(value);
    if (formatted === undefined) {
        throw new Error('v3 cannot serialize undefined values.');
    }
    return formatted;
}
/** Unity's YAML writer uses a non-enumerable marker to render vectors and
 * colors as flow mappings. The marker is formatting-only and is intentionally
 * absent from the standalone document. */
function markCanonicalFlowMappings(value) {
    if (Array.isArray(value)) {
        for (const item of value)
            markCanonicalFlowMappings(item);
        return value;
    }
    if (!value || typeof value !== 'object')
        return value;
    const object = value;
    for (const child of Object.values(object))
        markCanonicalFlowMappings(child);
    const keys = Object.keys(object);
    if (keys.length > 0 && keys.length <= 4 &&
        keys.every(key => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].includes(key))) {
        Object.defineProperty(object, '__flow', {
            value: true,
            enumerable: false,
            configurable: true,
        });
    }
    return value;
}
//# sourceMappingURL=value.js.map