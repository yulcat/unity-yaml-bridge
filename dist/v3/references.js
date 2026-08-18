"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateV3ExternalObjectReference = validateV3ExternalObjectReference;
exports.resolveV3OverrideReference = resolveV3OverrideReference;
exports.encodeV3References = encodeV3References;
exports.resolveV3References = resolveV3References;
function validateV3ExternalObjectReference(value, context) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid v3 external object reference at ${context}.`);
    }
    const object = value;
    const keys = Object.keys(object);
    if (keys.length !== 3 || !keys.includes('fileID') || !keys.includes('guid') || !keys.includes('type')) {
        throw new Error(`Invalid v3 external object reference at ${context}.`);
    }
    const fileId = typeof object.fileID === 'number'
        ? (Number.isSafeInteger(object.fileID) ? String(object.fileID) : '')
        : typeof object.fileID === 'string' && /^(0|-?[1-9]\d*)$/.test(object.fileID)
            ? object.fileID
            : '';
    if (!fileId || fileId === '0' || typeof object.guid !== 'string' ||
        !/^[0-9a-f]{32}$/.test(object.guid) || object.type !== 3) {
        throw new Error(`Invalid v3 external object reference at ${context}.`);
    }
    return { fileID: fileId, guid: object.guid, type: 3 };
}
/** Normalize the deliberately narrow object-reference forms accepted by an
 * inherited nested DETAILS override. Arbitrary object values fail closed. */
function resolveV3OverrideReference(value, resolveMachineReference, context) {
    if (value === null)
        return { fileID: 0 };
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value))
        throw new Error(`Invalid v3 object reference at ${context}.`);
    const object = value;
    const keys = Object.keys(object);
    if (Object.prototype.hasOwnProperty.call(object, '$ref')) {
        if (keys.length !== 1 || typeof object.$ref !== 'string' || object.$ref.length === 0) {
            throw new Error(`Invalid v3 machine reference at ${context}.`);
        }
        const resolved = resolveMachineReference(object.$ref);
        if (!resolved)
            throw new Error(`Dangling v3 reference at ${context}: ${object.$ref} is not an effective identity.`);
        return resolved;
    }
    if (keys.length !== 3 || !keys.includes('fileID') || !keys.includes('guid') || !keys.includes('type')) {
        throw new Error(`Invalid v3 object reference at ${context}.`);
    }
    return validateV3ExternalObjectReference(object, context);
}
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