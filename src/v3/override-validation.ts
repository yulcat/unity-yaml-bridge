export const V3_OVERRIDE_STRUCTURAL_FIELDS = new Set([
  'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
  'm_GameObject', 'm_Father', 'm_Children', 'm_RootOrder', 'm_Component',
  'm_Name', 'm_Script',
]);

const UNSAFE_OVERRIDE_PATH_SEGMENTS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export function validateV3OverridePropertyPath(propertyPath: string, context: string): string[] {
  const segments = propertyPath.split('.');
  const unsafeSegment = segments.find(segment => UNSAFE_OVERRIDE_PATH_SEGMENTS.has(segment));
  if (unsafeSegment) {
    throw new Error(
      `Inherited nested DETAILS ${context} has unsafe property path segment ${JSON.stringify(unsafeSegment)}.`
    );
  }
  return segments;
}

export function pathsHaveSegmentPrefixOverlap(left: string, right: string): boolean {
  return left !== right && (left.startsWith(`${right}.`) || right.startsWith(`${left}.`));
}

export function isV3OverrideStructuralPath(propertyPath: string): boolean {
  return [...V3_OVERRIDE_STRUCTURAL_FIELDS].some(field =>
    propertyPath === field || propertyPath.startsWith(`${field}.`)
  );
}
