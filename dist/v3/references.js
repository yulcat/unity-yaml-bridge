"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeV3References = encodeV3References;
exports.resolveV3References = resolveV3References;
/** Convert local `{fileID}` references to stable v3 machine identities. */
function encodeV3References(value, documentIds) {
    if (Array.isArray(value))
        return value.map(item => encodeV3References(item, documentIds));
    if (!value || typeof value !== 'object')
        return value;
    const object = value;
    const keys = Object.keys(object);
    if (keys.length === 1 && keys[0] === 'fileID') {
        const machineId = documentIds.get(String(object.fileID));
        if (machineId)
            return { $ref: machineId };
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, encodeV3References(child, documentIds)]));
}
/** Resolve stable v3 machine references only against entities emitted by the
 * desired STRUCTURE. A reference to a tombstoned identity is a hard error. */
function resolveV3References(value, fileIds, emittedMachineIds, context) {
    if (Array.isArray(value)) {
        return value.map((item, index) => resolveV3References(item, fileIds, emittedMachineIds, `${context}[${index}]`));
    }
    if (!value || typeof value !== 'object')
        return value;
    const object = value;
    if (Object.prototype.hasOwnProperty.call(object, '$ref')) {
        if (Object.keys(object).length !== 1 || typeof object.$ref !== 'string') {
            throw new Error(`Invalid v3 machine reference at ${context}.`);
        }
        if (!emittedMachineIds.has(object.$ref)) {
            throw new Error(`Dangling v3 reference at ${context}: ${object.$ref} is absent from desired STRUCTURE.`);
        }
        const fileID = fileIds.get(object.$ref);
        if (!fileID)
            throw new Error(`v3 reference ${object.$ref} has no allocated fileID.`);
        return { fileID };
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [
        key,
        resolveV3References(child, fileIds, emittedMachineIds, `${context}.${key}`),
    ]));
}
//# sourceMappingURL=references.js.map