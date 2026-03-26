/**
 * Merge CompactFile edits back into a UnityFile AST.
 *
 * This enables the full editing pipeline:
 *   Unity YAML → AST → compact (.ubridge) → [AI edits] → parse compact → merge → YAML
 *
 * The merge approach preserves all original data (fileIDs, boilerplate fields,
 * document structure) and only updates properties that appear in the compact file.
 *
 * When REFS are available, uses them for precise fileID-based document lookup.
 * For new elements not in REFS, auto-generates random int64 fileIDs.
 */

import * as crypto from 'crypto';
import { UnityFile, GameObjectNode, UnityDocument, UNITY_TYPE_MAP } from './types';
import { CompactFile, CompactSection, CompactProperty, parseCompactValue } from './compact-reader';

/** Deep clone a UnityFile for safe mutation, preserving non-enumerable markers (__flow, __multiLine) */
function cloneUnityFile(file: UnityFile): UnityFile {
  return deepClone(file) as UnityFile;
}

function deepClone(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);

  const result: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    result[key] = deepClone(value[key]);
  }
  // Preserve non-enumerable markers
  if (value.__flow === true) {
    Object.defineProperty(result, '__flow', { value: true, enumerable: false, writable: false });
  }
  if (value.__multiLine === true) {
    Object.defineProperty(result, '__multiLine', { value: true, enumerable: false, writable: false });
  }
  return result;
}

/**
 * Generate a random int64 fileID like Unity does.
 * Uses crypto.randomBytes for proper randomness.
 * Returns a positive BigInt string (always positive to match Unity convention).
 */
export function generateFileId(): string {
  const bytes = crypto.randomBytes(8);
  // Read as unsigned 64-bit big-endian, then ensure it's positive and non-zero
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  // Ensure positive (clear sign bit) and non-zero
  value = value & BigInt('9223372036854775807'); // Max positive int64
  if (value === BigInt(0)) value = BigInt(1);
  return value.toString();
}

/**
 * Merge compact file changes into the original AST.
 * Returns a new UnityFile with the changes applied.
 * The original is not modified.
 */
export function mergeCompactChanges(original: UnityFile, compact: CompactFile): UnityFile {
  const result = cloneUnityFile(original);

  if (compact.type === 'variant') {
    mergeVariantSections(result, compact.sections, compact.refs);
  } else {
    mergePrefabSections(result, compact.sections, compact.refs);
  }

  return result;
}

// ============================================================
// Prefab merging — match sections by REFS fileID or GO name + component type
// ============================================================

/** Merge sections for a regular prefab */
function mergePrefabSections(file: UnityFile, sections: CompactSection[], refs: Map<string, string>): void {
  if (!file.hierarchy) return;

  // Build a map: document fileId → document (for fast lookup)
  const docMap = new Map<string, UnityDocument>();
  for (const doc of file.documents) {
    docMap.set(doc.fileId, doc);
  }

  // Build a flat map: GO name → GameObjectNode (using the hierarchy)
  const goMap = new Map<string, GameObjectNode[]>();
  flattenHierarchy(file.hierarchy, goMap);

  for (const section of sections) {
    const goPath = section.goPath;
    const compType = section.componentType;
    const refsKey = compType ? `${goPath}:${compType}` : goPath;

    // Try REFS lookup first for precise matching
    const refsFileId = refs.get(refsKey);
    if (refsFileId) {
      const doc = docMap.get(refsFileId);
      if (doc) {
        if (compType === 'Transform' || compType === 'RectTransform') {
          applyTransformProperties(section.properties, doc, compType === 'RectTransform');
        } else {
          applyComponentProperties(section.properties, doc);
        }
        continue;
      }
    }

    // Fallback: name-based matching
    const candidates = goMap.get(goPath) || [];
    if (candidates.length === 0) {
      // New GO — check if this section represents a new element
      // For now, skip (new element creation handled separately)
      continue;
    }

    // Use the first match (name collision handling would use path/index)
    const go = candidates[0];

    if (compType === 'Transform' || compType === 'RectTransform') {
      // Transform section — apply to the transform document
      const transformDoc = docMap.get(go.transform.fileId);
      if (transformDoc) {
        applyTransformProperties(section.properties, transformDoc, compType === 'RectTransform');
      }
    } else {
      // Component section — find the matching component
      const comp = go.components.find(c => {
        if (c.typeName === compType) return true;
        if (c.scriptName === compType) return true;
        // For MonoBehaviour with GUID name
        if (c.scriptGuid === compType) return true;
        return false;
      });

      if (comp) {
        const compDoc = docMap.get(comp.fileId);
        if (compDoc) {
          applyComponentProperties(section.properties, compDoc);
        }
      }
    }
  }
}

/** Flatten hierarchy into a map of name → nodes */
function flattenHierarchy(node: GameObjectNode, map: Map<string, GameObjectNode[]>): void {
  if (!map.has(node.name)) {
    map.set(node.name, []);
  }
  map.get(node.name)!.push(node);

  for (const child of node.children) {
    flattenHierarchy(child, map);
  }
}

/** Apply transform shorthand properties to a transform document */
function applyTransformProperties(
  properties: CompactProperty[],
  doc: UnityDocument,
  isRect: boolean
): void {
  for (const prop of properties) {
    if (typeof prop.value !== 'string') continue;

    const parsed = parseCompactValue(prop.value);

    switch (prop.key) {
      case 'pos':
        if (isRect) {
          preserveFlowMarker(doc.properties.m_AnchoredPosition, parsed);
          doc.properties.m_AnchoredPosition = parsed;
        } else {
          preserveFlowMarker(doc.properties.m_LocalPosition, parsed);
          doc.properties.m_LocalPosition = parsed;
        }
        break;
      case 'rot':
        preserveFlowMarker(doc.properties.m_LocalRotation, parsed);
        doc.properties.m_LocalRotation = parsed;
        break;
      case 'scale':
        preserveFlowMarker(doc.properties.m_LocalScale, parsed);
        doc.properties.m_LocalScale = parsed;
        break;
      case 'anchor': {
        // anchor = (x1, y1)-(x2, y2) → parsed as {min, max}
        if (parsed && parsed.min && parsed.max) {
          preserveFlowMarker(doc.properties.m_AnchorMin, parsed.min);
          preserveFlowMarker(doc.properties.m_AnchorMax, parsed.max);
          doc.properties.m_AnchorMin = parsed.min;
          doc.properties.m_AnchorMax = parsed.max;
        }
        break;
      }
      case 'size':
        preserveFlowMarker(doc.properties.m_SizeDelta, parsed);
        doc.properties.m_SizeDelta = parsed;
        break;
      case 'pivot':
        preserveFlowMarker(doc.properties.m_Pivot, parsed);
        doc.properties.m_Pivot = parsed;
        break;
      default:
        // Direct property name (m_LocalPosition, etc.)
        preserveFlowMarker(doc.properties[prop.key], parsed);
        doc.properties[prop.key] = parsed;
        break;
    }
  }
}

/** Apply component properties to a component document */
function applyComponentProperties(properties: CompactProperty[], doc: UnityDocument): void {
  applyPropertiesToTarget(properties, doc.properties);
}

/** Apply a list of CompactProperty entries into a target object, preserving nesting */
function applyPropertiesToTarget(properties: CompactProperty[], target: Record<string, any>): void {
  for (const prop of properties) {
    if (Array.isArray(prop.value)) {
      // Nested block — check if the target already has this key as an object
      const existing = target[prop.key];
      if (isPlainObject(existing) && prop.value.length > 0 && !prop.value.some(c => c.key === '__item__')) {
        // Recursively apply nested properties into existing object
        applyPropertiesToTarget(prop.value, existing);
      } else {
        // Reconstruct as new object or array
        target[prop.key] = reconstructNestedValue(prop.value);
      }
    } else {
      const parsed = parseCompactValue(prop.value);
      const original = target[prop.key];

      // Preserve null references: compact writes {fileID:0} as "null",
      // but we need to keep the original {fileID: 0} object for YAML round-trip
      if (parsed === null && isNullReference(original)) {
        continue; // Keep original {fileID: 0}
      }

      // Preserve vector/color key names: compact format loses r/g/b/a vs x/y/z/w distinction
      if (isPlainObject(parsed) && isPlainObject(original)) {
        const remapped = remapVectorKeys(parsed, original);
        if (remapped) {
          preserveFlowMarker(original, remapped);
          target[prop.key] = remapped;
          continue;
        }
        preserveFlowMarker(original, parsed);
      }

      target[prop.key] = parsed;
    }
  }
}

/** Preserve the __flow marker from original onto target (non-enumerable) */
function preserveFlowMarker(original: any, target: any): void {
  if (original && typeof original === 'object' && original.__flow === true
      && target && typeof target === 'object') {
    Object.defineProperty(target, '__flow', { value: true, enumerable: false, writable: false });
  }
}

/** Check if a value is a {fileID: 0} null reference */
function isNullReference(value: any): boolean {
  return value && typeof value === 'object' && 'fileID' in value && String(value.fileID) === '0';
}

/** Check if a value is a plain object (not array, not null) */
function isPlainObject(value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Remap vector keys from parsed compact value to match original key names.
 * E.g., {x:1, y:1, z:1, w:1} → {r:1, g:1, b:1, a:1} if original had r/g/b/a keys.
 * Returns remapped object, or null if key counts don't match.
 */
function remapVectorKeys(parsed: Record<string, any>, original: Record<string, any>): Record<string, any> | null {
  const parsedKeys = Object.keys(parsed).filter(k => k !== '__multiLine');
  const origKeys = Object.keys(original).filter(k => k !== '__multiLine');
  if (parsedKeys.length !== origKeys.length || parsedKeys.length === 0) return null;

  // Only remap if both look like vectors/colors (2-4 single-letter keys)
  const isVectorLike = (keys: string[]) =>
    keys.length >= 2 && keys.length <= 4 &&
    keys.every(k => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].includes(k));

  if (!isVectorLike(parsedKeys) || !isVectorLike(origKeys)) return null;

  // Check if keys differ — need remapping
  const needsRemap = parsedKeys.some((k, i) => k !== origKeys[i]);
  if (!needsRemap) return null;

  const remapped: Record<string, any> = {};
  for (let i = 0; i < origKeys.length; i++) {
    remapped[origKeys[i]] = parsed[parsedKeys[i]];
  }
  return remapped;
}

/** Reconstruct a nested value from CompactProperty children */
function reconstructNestedValue(children: CompactProperty[]): any {
  // Check if this is an array (items have __item__ key) or an object
  const isArray = children.some(c => c.key === '__item__');
  if (isArray) {
    return children.map(c =>
      typeof c.value === 'string' ? parseCompactValue(c.value) : reconstructNestedValue(c.value as CompactProperty[])
    );
  }

  // Object
  const result: Record<string, any> = {};
  for (const child of children) {
    if (Array.isArray(child.value)) {
      result[child.key] = reconstructNestedValue(child.value);
    } else {
      result[child.key] = parseCompactValue(child.value);
    }
  }
  return result;
}

// ============================================================
// Variant merging — match sections by REFS or target fileID
// ============================================================

/** Merge sections for a variant file */
function mergeVariantSections(file: UnityFile, sections: CompactSection[], refs: Map<string, string>): void {
  // Find the main PrefabInstance (the one with transformParent = {fileID: 0})
  const mainInstance = file.prefabInstances.find(pi =>
    String(pi.transformParent.fileID) === '0'
  );
  if (!mainInstance) return;

  // Find the PrefabInstance document
  const instanceDoc = file.documents.find(d =>
    d.typeId === 1001 && d.fileId === mainInstance.fileId
  );
  if (!instanceDoc) return;

  const modifications = instanceDoc.properties.m_Modification?.m_Modifications;
  if (!Array.isArray(modifications)) return;

  // Build reverse REFS map: fileID → key (for lookup)
  const reverseRefs = new Map<string, string>();
  for (const [key, fileId] of refs) {
    if (key !== '__instance') {
      reverseRefs.set(fileId, key);
    }
  }

  for (const section of sections) {
    // Resolve target fileID from REFS or section header
    let targetFileId: string | undefined;

    if (section.goPath.startsWith('&')) {
      // Legacy format: [&fileID]
      targetFileId = section.goPath.substring(1);
    } else {
      // New format: [GOPath:ComponentType] — look up in REFS
      const refsKey = section.componentType
        ? `${section.goPath}:${section.componentType}`
        : section.goPath;
      targetFileId = refs.get(refsKey);
    }

    if (!targetFileId) continue;

    for (const prop of section.properties) {
      if (typeof prop.value !== 'string') continue;

      // Find existing modification with this target + propertyPath
      const existing = modifications.find(
        (m: any) => String(m.target?.fileID) === targetFileId && m.propertyPath === prop.key
      );

      if (existing) {
        // Update existing modification
        const parsed = parseCompactValue(prop.value);
        if (typeof parsed === 'object' && parsed !== null && 'fileID' in parsed) {
          // Object reference — preserve original type if fileID and guid match
          const origRef = existing.objectReference;
          if (origRef &&
              String(origRef.fileID) === String(parsed.fileID) &&
              (origRef.guid || '') === (parsed.guid || '')) {
            // Same reference — keep original (preserves type field)
          } else {
            existing.objectReference = parsed;
            existing.value = '';
          }
        } else {
          const newValue = String(parsed ?? '');
          if (existing.value !== newValue) {
            existing.value = newValue;
            existing.objectReference = { fileID: 0 };
          }
        }
      }
      // Note: adding NEW modifications would require generating proper target refs.
      // For Phase 1, we only support editing existing modifications.
    }
  }
}
