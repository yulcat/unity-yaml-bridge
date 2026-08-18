"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V3_OVERRIDE_STRUCTURAL_FIELDS = void 0;
exports.validateV3OverridePropertyPath = validateV3OverridePropertyPath;
exports.pathsHaveSegmentPrefixOverlap = pathsHaveSegmentPrefixOverlap;
exports.isV3OverrideStructuralPath = isV3OverrideStructuralPath;
exports.V3_OVERRIDE_STRUCTURAL_FIELDS = new Set([
    'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
    'm_GameObject', 'm_Father', 'm_Children', 'm_RootOrder', 'm_Component',
    'm_Name', 'm_Script',
]);
const UNSAFE_OVERRIDE_PATH_SEGMENTS = new Set([
    '__proto__',
    'constructor',
    'prototype',
]);
function validateV3OverridePropertyPath(propertyPath, context) {
    const segments = propertyPath.split('.');
    if (segments.some(segment => segment.length === 0)) {
        throw new Error(`Inherited nested DETAILS ${context} has an invalid property path segment.`);
    }
    const unsafeSegment = segments.find(segment => UNSAFE_OVERRIDE_PATH_SEGMENTS.has(segment));
    if (unsafeSegment) {
        throw new Error(`Inherited nested DETAILS ${context} has unsafe property path segment ${JSON.stringify(unsafeSegment)}.`);
    }
    return segments;
}
function pathsHaveSegmentPrefixOverlap(left, right) {
    return left !== right && (left.startsWith(`${right}.`) || right.startsWith(`${left}.`));
}
function isV3OverrideStructuralPath(propertyPath) {
    return [...exports.V3_OVERRIDE_STRUCTURAL_FIELDS].some(field => propertyPath === field || propertyPath.startsWith(`${field}.`));
}
//# sourceMappingURL=override-validation.js.map