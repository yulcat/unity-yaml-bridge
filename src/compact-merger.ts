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
import { UnityFile, GameObjectNode, UnityDocument, UNITY_TYPE_MAP, ComponentInfo } from './types';
import { CompactFile, CompactSection, CompactProperty, parseCompactValue } from './compact-reader';
import { PathLookupOptions, findPathMapEntry, findPathSetEntry } from './path-utils';
import { GuidResolver } from './guid-resolver';

export interface CompactMergeOptions {
  /** Project GUID resolver, required to add a custom script by class name. */
  guidResolver?: GuidResolver;
}

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

/** Recursively collect all GO paths from a STRUCTURE tree */
function collectStructurePaths(node: import('./compact-reader').CompactStructureNode, parentPath: string, paths: Set<string>): void {
  const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  paths.add(currentPath);
  // Also add with each component
  for (const comp of node.components) {
    const componentName = comp.replace(/^[+*-]/, '').replace(/\*$/, '');
    paths.add(`${currentPath}:${componentName}`);
  }
  for (const child of node.children) {
    collectStructurePaths(child, currentPath, paths);
  }
}

interface PendingAddedComponent {
  section: CompactSection;
  document: UnityDocument;
}

const NEW_COMPONENT_STRUCTURAL_FIELDS = new Set([
  'm_CorrespondingSourceObject',
  'm_PrefabInstance',
  'm_PrefabAsset',
  'm_GameObject',
]);

/** Generate a fileID that does not collide with any existing or newly created document. */
function generateUniqueFileId(file: UnityFile): string {
  const used = new Set(file.documents.map(doc => doc.fileId));
  let id = generateFileId();
  while (used.has(id)) id = generateFileId();
  return id;
}

function getSingleRef(refs: Map<string, string[]>, key: string): string | undefined {
  return findPathMapEntry(refs, key, { allowAddedRootAliases: true })?.value[0];
}

function findScriptReference(
  section: CompactSection,
  componentType: string,
  resolver?: GuidResolver
): Record<string, any> | undefined {
  const scriptProperty = section.properties.find(prop =>
    prop.key === 'm_Script' && typeof prop.value === 'string'
  );
  if (scriptProperty && typeof scriptProperty.value === 'string') {
    const parsed = parseCompactValue(scriptProperty.value);
    if (parsed && typeof parsed === 'object' && parsed.guid) return parsed;
  }

  const guid = /^[a-f0-9]{32}$/i.test(componentType)
    ? componentType
    : (resolver || new GuidResolver()).resolveGuid(componentType);
  if (!guid) return undefined;
  return { fileID: 11500000, guid, type: 3 };
}

function resolveNewComponentType(
  section: CompactSection,
  resolver?: GuidResolver
): { typeId: number; typeName: string; script?: Record<string, any> } {
  const nativeEntry = Object.entries(UNITY_TYPE_MAP).find(([id, name]) =>
    name === section.componentType && ![1, 4, 114, 224, 1001].includes(Number(id))
  );
  if (nativeEntry) {
    return { typeId: Number(nativeEntry[0]), typeName: nativeEntry[1] };
  }

  const script = findScriptReference(section, section.componentType, resolver);
  if (script) return { typeId: 114, typeName: 'MonoBehaviour', script };

  throw new Error(
    `Cannot determine Unity type for new component ${section.goPath}:${section.componentType}. ` +
    'Use a built-in component name, pass a project GuidResolver, or add an m_Script reference.'
  );
}

function createComponentProperties(
  typeId: number,
  gameObjectFileId: string,
  script?: Record<string, any>
): Record<string, any> {
  const properties: Record<string, any> = {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
    m_GameObject: { fileID: gameObjectFileId },
  };
  if (typeId === 114) {
    properties.m_Enabled = 1;
    properties.m_EditorHideFlags = 0;
    properties.m_Script = script;
    properties.m_Name = '';
    properties.m_EditorClassIdentifier = '';
  }
  return properties;
}

function appendGameObjectComponent(goDoc: UnityDocument, componentId: string): void {
  if (!Array.isArray(goDoc.properties.m_Component)) goDoc.properties.m_Component = [];
  goDoc.properties.m_Component.push({ component: { fileID: componentId } });
}

function addHierarchyComponent(
  file: UnityFile,
  goPath: string,
  document: UnityDocument,
  componentType: string,
  scriptGuid?: string
): void {
  if (!file.hierarchy) return;
  const goMap = new Map<string, GameObjectNode[]>();
  flattenHierarchy(file.hierarchy, goMap);
  const node = goMap.get(goPath)?.[0];
  if (!node) return;
  const info: ComponentInfo = {
    typeName: document.typeName,
    typeId: document.typeId,
    fileId: document.fileId,
    scriptGuid,
    scriptName: document.typeId === 114 ? componentType : undefined,
    properties: document.properties,
    stripped: false,
  };
  node.components.push(info);
}

function findOrCreateStrippedGameObject(
  file: UnityFile,
  targetFileId: string,
  sourceGuid: string,
  ownerInstanceId: string
): UnityDocument {
  const existing = file.documents.find(doc =>
    doc.typeId === 1 && doc.stripped &&
    String(doc.properties.m_CorrespondingSourceObject?.fileID) === targetFileId &&
    (doc.properties.m_CorrespondingSourceObject?.guid || '') === sourceGuid &&
    String(doc.properties.m_PrefabInstance?.fileID) === ownerInstanceId
  );
  if (existing) return existing;

  const document: UnityDocument = {
    typeId: 1,
    typeName: 'GameObject',
    fileId: generateUniqueFileId(file),
    stripped: true,
    properties: {
      m_CorrespondingSourceObject: { fileID: targetFileId, guid: sourceGuid, type: 3 },
      m_PrefabInstance: { fileID: ownerInstanceId },
      m_PrefabAsset: { fileID: 0 },
    },
  };
  file.documents.push(document);
  return document;
}

function attachInheritedAddedComponent(
  file: UnityFile,
  compact: CompactFile,
  section: CompactSection,
  componentId: string,
  referencedGoId: string,
  existingStrippedGo?: UnityDocument
): string {
  const ownerInstanceId = getSingleRef(compact.refs, `${section.goPath}:__instance`)
    || (existingStrippedGo
      ? String(existingStrippedGo.properties.m_PrefabInstance?.fileID || '')
      : getSingleRef(compact.refs, '__instance'));
  if (!ownerInstanceId) {
    throw new Error(`Missing PrefabInstance owner for new component ${section.goPath}:${section.componentType}.`);
  }
  const sourceGuid = getSingleRef(compact.refs, `${section.goPath}:__source`)
    || existingStrippedGo?.properties.m_CorrespondingSourceObject?.guid
    || compact.baseGuid;
  if (!sourceGuid) {
    throw new Error(`Missing source GUID for inherited GameObject ${section.goPath}.`);
  }

  const ownerDoc = file.documents.find(doc => doc.typeId === 1001 && doc.fileId === ownerInstanceId);
  const ownerInfo = file.prefabInstances.find(instance => instance.fileId === ownerInstanceId);
  if (!ownerDoc || !ownerInfo) {
    throw new Error(`PrefabInstance ${ownerInstanceId} not found for new component.`);
  }
  const targetGoId = existingStrippedGo
    ? String(existingStrippedGo.properties.m_CorrespondingSourceObject?.fileID || '')
    : referencedGoId;
  if (!targetGoId) {
    throw new Error(`Missing corresponding source GameObject for ${section.goPath}.`);
  }
  const strippedGo = existingStrippedGo
    || findOrCreateStrippedGameObject(file, targetGoId, sourceGuid, ownerInstanceId);
  const modification = ownerDoc.properties.m_Modification || (ownerDoc.properties.m_Modification = {});
  if (!Array.isArray(modification.m_AddedComponents)) modification.m_AddedComponents = [];
  modification.m_AddedComponents.push({
    targetCorrespondingSourceObject: { fileID: targetGoId, guid: sourceGuid, type: 3 },
    insertIndex: -1,
    addedObject: { fileID: componentId },
  });
  ownerInfo.addedComponents.push({
    targetGameObject: { fileID: targetGoId, guid: sourceGuid, type: 3 },
    insertIndex: -1,
    addedComponent: { fileID: componentId },
  });
  return strippedGo.fileId;
}

/** Allocate all requested components before applying properties so cross-references are order-independent. */
function createAddedComponents(
  file: UnityFile,
  compact: CompactFile,
  structurePaths: Set<string>,
  options: CompactMergeOptions
): void {
  const existingDocumentIds = new Set(file.documents.map(doc => doc.fileId));
  const addedSections = compact.sections.filter(section => {
    if (!section.isAdded) return false;
    const key = section.componentType
      ? `${section.goPath}:${section.componentType}`
      : section.goPath;
    const existingId = getSingleRef(compact.refs, key);
    return !existingId || !existingDocumentIds.has(existingId);
  });
  if (addedSections.length === 0) return;

  const pending: PendingAddedComponent[] = [];
  const docMap = new Map(file.documents.map(doc => [doc.fileId, doc]));
  const createdKeys = new Set<string>();

  for (const section of addedSections) {
    if (!section.componentType) {
      throw new Error(`New component section must include a component type: ${section.goPath}`);
    }
    const componentKey = `${section.goPath}:${section.componentType}`;
    if (!findPathSetEntry(structurePaths, componentKey, { allowAddedRootAliases: true })) {
      throw new Error(`New component ${componentKey} must also be listed in STRUCTURE with a + marker.`);
    }
    if (createdKeys.has(componentKey) || getSingleRef(compact.refs, componentKey)) {
      throw new Error(`Component already exists or is duplicated: ${componentKey}`);
    }

    const targetGoId = getSingleRef(compact.refs, section.goPath);
    if (!targetGoId) throw new Error(`GameObject not found for new component: ${section.goPath}`);
    const type = resolveNewComponentType(section, options.guidResolver);
    const componentId = generateUniqueFileId(file);
    let owningGoId = targetGoId;
    const localGoDoc = docMap.get(targetGoId);

    if (localGoDoc && localGoDoc.typeId === 1 && !localGoDoc.stripped) {
      appendGameObjectComponent(localGoDoc, componentId);
    } else if ((localGoDoc && localGoDoc.typeId === 1 && localGoDoc.stripped)
        || compact.type === 'variant') {
      owningGoId = attachInheritedAddedComponent(
        file, compact, section, componentId, targetGoId,
        localGoDoc?.typeId === 1 && localGoDoc.stripped ? localGoDoc : undefined
      );
    } else {
      throw new Error(`GameObject not found for new component: ${section.goPath}`);
    }

    const document: UnityDocument = {
      typeId: type.typeId,
      typeName: type.typeName,
      fileId: componentId,
      stripped: false,
      properties: createComponentProperties(type.typeId, owningGoId, type.script),
    };
    file.documents.push(document);
    docMap.set(componentId, document);
    compact.refs.set(componentKey, [componentId]);
    createdKeys.add(componentKey);
    addHierarchyComponent(file, section.goPath, document, section.componentType, type.script?.guid);
    pending.push({ section, document });
  }

  for (const { section, document } of pending) {
    applyComponentProperties(
      section.properties.filter(prop => !NEW_COMPONENT_STRUCTURAL_FIELDS.has(prop.key)),
      document, compact.refs, structurePaths,
      { allowAddedRootAliases: true }
    );
  }
}

/**
 * Merge compact file changes into the original AST.
 * Returns a new UnityFile with the changes applied.
 * The original is not modified.
 */
export function mergeCompactChanges(
  original: UnityFile,
  compact: CompactFile,
  options: CompactMergeOptions = {}
): UnityFile {
  const result = cloneUnityFile(original);

  // Collect all GO paths from STRUCTURE tree — used to distinguish
  // valid new references (GO exists in hierarchy) from typos
  const structurePaths = new Set<string>();
  if (compact.structure) {
    collectStructurePaths(compact.structure, '', structurePaths);
  }

  createAddedComponents(result, compact, structurePaths, options);

  if (compact.type === 'variant') {
    mergeVariantSections(result, compact.sections, compact.refs, structurePaths);
  } else {
    mergePrefabSections(result, compact.sections, compact.refs, structurePaths);
  }

  syncPrefabInstanceState(result);

  return result;
}

/** Keep the parsed PrefabInstance view consistent with the mutated YAML documents. */
function syncPrefabInstanceState(file: UnityFile): void {
  const instanceDocs = new Map(
    file.documents.filter(doc => doc.typeId === 1001).map(doc => [doc.fileId, doc])
  );
  for (const instance of file.prefabInstances) {
    const modification = instanceDocs.get(instance.fileId)?.properties.m_Modification;
    if (!modification) continue;
    instance.modifications = (modification.m_Modifications || []).map((entry: any) => ({
      target: entry.target,
      propertyPath: entry.propertyPath || '',
      value: entry.value ?? '',
      objectReference: entry.objectReference || { fileID: 0 },
    }));
    instance.addedComponents = (modification.m_AddedComponents || []).map((entry: any) => ({
      targetGameObject: entry.targetCorrespondingSourceObject,
      addedComponent: entry.addedObject,
      insertIndex: entry.insertIndex ?? -1,
    }));
  }
}

// ============================================================
// Prefab merging — match sections by REFS fileID or GO name + component type
// ============================================================

/** Merge sections for a regular prefab */
function mergePrefabSections(file: UnityFile, sections: CompactSection[], refs: Map<string, string[]>, structurePaths?: Set<string>): void {
  if (!file.hierarchy) return;

  // Build a map: document fileId → document (for fast lookup)
  const docMap = new Map<string, UnityDocument>();
  for (const doc of file.documents) {
    docMap.set(doc.fileId, doc);
  }

  // Build a flat map: GO name → GameObjectNode (using the hierarchy)
  const goMap = new Map<string, GameObjectNode[]>();
  flattenHierarchy(file.hierarchy, goMap);

  // Track which REFS fileIDs have been used (for duplicate key handling)
  const usedRefs = new Set<string>();

  for (const section of sections) {
    const goPath = section.goPath;
    const compType = section.componentType;
    const refsKey = compType ? `${goPath}:${compType}` : goPath;

    // Try REFS lookup — find the best matching document for this section
    const refsEntry = findPathMapEntry(refs, refsKey);
    if (refsEntry && refsEntry.value.length > 0) {
      const refsFileIds = refsEntry.value;
      const refsFileId = refsFileIds.length === 1
        ? refsFileIds[0]
        : findBestRefsMatch(refsFileIds, section, docMap, usedRefs);
      if (refsFileId) {
        usedRefs.add(refsFileId);
        const doc = docMap.get(refsFileId);
        if (doc) {
          if (compType === 'Transform' || compType === 'RectTransform') {
            applyTransformProperties(section.properties, doc, compType === 'RectTransform');
          } else {
            applyComponentProperties(section.properties, doc, refs, structurePaths);
          }
          continue;
        }
      }
    }

    // Fallback: name-based matching
    const candidates = goMap.get(goPath) || [];
    if (candidates.length === 0) {
      continue;
    }

    const go = candidates[0];

    if (compType === 'Transform' || compType === 'RectTransform') {
      const transformDoc = docMap.get(go.transform.fileId);
      if (transformDoc) {
        applyTransformProperties(section.properties, transformDoc, compType === 'RectTransform');
      }
    } else {
      const comp = go.components.find(c => {
        if (c.typeName === compType) return true;
        if (c.scriptName === compType) return true;
        if (c.scriptGuid === compType) return true;
        return false;
      });

      if (comp) {
        const compDoc = docMap.get(comp.fileId);
        if (compDoc) {
          applyComponentProperties(section.properties, compDoc, refs, structurePaths);
        }
      }
    }
  }
}

/**
 * Find the best matching REFS fileID for a section when there are duplicates.
 * Compares section properties against each candidate document's existing values.
 * For a zero-edit roundtrip, the correct document already has matching values.
 */
function findBestRefsMatch(
  fileIds: string[],
  section: CompactSection,
  docMap: Map<string, UnityDocument>,
  usedRefs: Set<string>
): string | undefined {
  const unused = fileIds.filter(id => !usedRefs.has(id));
  if (unused.length === 0) return fileIds[0]; // All used, fallback to first
  if (unused.length === 1) return unused[0];

  // Score each candidate by how many section properties match the document's values
  let bestId = unused[0];
  let bestScore = -1;

  for (const id of unused) {
    const doc = docMap.get(id);
    if (!doc) continue;

    let score = 0;
    for (const prop of section.properties) {
      if (typeof prop.value !== 'string') continue;
      const parsed = parseCompactValue(prop.value);
      const docVal = getDocValueForProp(prop.key, doc.properties, section.componentType);
      if (docVal !== undefined && valuesMatch(parsed, docVal)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  return bestId;
}

/** Get the document property value for a compact property key (handles transform shorthands) */
function getDocValueForProp(key: string, props: Record<string, any>, compType: string): any {
  // Transform shorthand mappings
  if (compType === 'RectTransform' || compType === 'Transform') {
    switch (key) {
      case 'pos': return compType === 'RectTransform' ? props.m_AnchoredPosition : props.m_LocalPosition;
      case 'rot': return props.m_LocalRotation;
      case 'scale': return props.m_LocalScale;
      case 'size': return props.m_SizeDelta;
      case 'pivot': return props.m_Pivot;
      case 'anchor': {
        const min = props.m_AnchorMin;
        const max = props.m_AnchorMax;
        return min && max ? { min, max } : undefined;
      }
    }
  }
  return props[key];
}

/** Check if two values match (deep comparison for vectors, shallow for scalars) */
function valuesMatch(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    // For anchor: {min, max} comparison
    if ('min' in a && 'min' in b) {
      return valuesMatch(a.min, b.min) && valuesMatch(a.max, b.max);
    }
    // Vector/color comparison: compare values by position
    const aKeys = Object.keys(a).filter(k => !k.startsWith('__'));
    const bKeys = Object.keys(b).filter(k => !k.startsWith('__'));
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (String(a[aKeys[i]]) !== String(b[bKeys[i]])) return false;
    }
    return true;
  }
  return String(a) === String(b);
}

/** Flatten hierarchy into a map of name → nodes */
function flattenHierarchy(node: GameObjectNode, map: Map<string, GameObjectNode[]>, parentPath: string = ''): void {
  const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (!map.has(currentPath)) {
    map.set(currentPath, []);
  }
  map.get(currentPath)!.push(node);

  for (const child of node.children) {
    flattenHierarchy(child, map, currentPath);
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
function applyComponentProperties(
  properties: CompactProperty[],
  doc: UnityDocument,
  refs?: Map<string, string[]>,
  structurePaths?: Set<string>,
  pathLookupOptions: PathLookupOptions = {}
): void {
  applyPropertiesToTarget(properties, doc.properties, refs, structurePaths, pathLookupOptions);
}

/** Apply a list of CompactProperty entries into a target object, preserving nesting */
function applyPropertiesToTarget(
  properties: CompactProperty[],
  target: Record<string, any>,
  refs?: Map<string, string[]>,
  structurePaths?: Set<string>,
  pathLookupOptions: PathLookupOptions = {}
): void {
  for (const prop of properties) {
    if (Array.isArray(prop.value)) {
      // Nested block — check if the target already has this key as an object
      const existing = target[prop.key];
      if (isPlainObject(existing) && prop.value.length > 0 && !prop.value.some(c => c.key === '__item__')) {
        // Recursively apply nested properties into existing object
        applyPropertiesToTarget(prop.value, existing, refs, structurePaths, pathLookupOptions);
      } else {
        // Reconstruct as new object or array, passing original for key remapping
        target[prop.key] = reconstructNestedValue(prop.value, existing, refs, structurePaths, pathLookupOptions);
      }
    } else {
      let parsed = parseCompactValue(prop.value);

      // Resolve path references (->GOPath:Component or @GOPath:Component)
      parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);

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

/**
 * Resolve ->GOPath:Component or @GOPath:Component path references to {fileID: X} objects.
 * Recursively handles arrays. Returns the original value unchanged if not a path reference.
 */
function resolvePathReference(
  value: any,
  refs?: Map<string, string[]>,
  structurePaths?: Set<string>,
  pathLookupOptions: PathLookupOptions = {}
): any {
  if (!refs) return value;

  if (typeof value === 'string') {
    let pathRef: string | null = null;
    if (value.startsWith('->')) {
      pathRef = value.substring(2);
    } else if (value.startsWith('@')) {
      pathRef = value.substring(1);
    }

    if (!pathRef) return value;

    const refsEntry = findPathMapEntry(refs, pathRef, pathLookupOptions);
    if (refsEntry && refsEntry.value.length > 0) {
      return parseCompactValue('{' + refsEntry.value[0] + '}');
    }

    // Not found in REFS — check if this references a newly added section (+ prefix).
    // If so, auto-generate a fileID and register it in REFS for later use.
    if (structurePaths && findPathSetEntry(structurePaths, pathRef, pathLookupOptions)) {
      const newFileId = generateFileId();
      refs.set(pathRef, [newFileId]);
      return parseCompactValue('{' + newFileId + '}');
    }

    // Also check if just the GO part matches an added path (reference to GO's Transform)
    if (structurePaths) {
      const colonIdx = pathRef.indexOf(':');
      const goPath = colonIdx >= 0 ? pathRef.substring(0, colonIdx) : pathRef;
      if (findPathSetEntry(structurePaths, goPath, pathLookupOptions)) {
        const newFileId = generateFileId();
        refs.set(pathRef, [newFileId]);
        return parseCompactValue('{' + newFileId + '}');
      }
    }

    const sampleKeys = Array.from(refs.keys()).slice(0, 10).join(', ');
    throw new Error(
      `Unresolved path reference: ${value}. Valid REFS keys: [${sampleKeys}]. ` +
      `Make sure the reference exactly matches a key in the REFS section.`
    );
  }

  if (Array.isArray(value)) {
    return value.map(item => resolvePathReference(item, refs, structurePaths, pathLookupOptions));
  }

  return value;
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

/** Reconstruct a nested value from CompactProperty children, using original for key remapping */
function reconstructNestedValue(
  children: CompactProperty[],
  original?: any,
  refs?: Map<string, string[]>,
  structurePaths?: Set<string>,
  pathLookupOptions: PathLookupOptions = {}
): any {
  // Check if this is an array (items have __item__ key) or an object
  const isArray = children.some(c => c.key === '__item__');
  if (isArray) {
    const origArray = Array.isArray(original) ? original : undefined;
    return children.map((c, idx) => {
      const origItem = origArray?.[idx];
      if (typeof c.value === 'string') {
        let parsed = parseCompactValue(c.value);
        parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
        return remapWithOriginal(parsed, origItem);
      }
      return reconstructNestedValue(c.value as CompactProperty[], origItem, refs, structurePaths, pathLookupOptions);
    });
  }

  // Object
  const origObj = isPlainObject(original) ? original : undefined;
  const result: Record<string, any> = {};
  for (const child of children) {
    const origVal = origObj?.[child.key];
    if (Array.isArray(child.value)) {
      result[child.key] = reconstructNestedValue(child.value, origVal, refs, structurePaths, pathLookupOptions);
    } else {
      let parsed = parseCompactValue(child.value);
      parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
      result[child.key] = remapWithOriginal(parsed, origVal);
    }
  }
  return result;
}

/** Remap a parsed value using the original for vector key preservation and flow markers */
function remapWithOriginal(parsed: any, original: any): any {
  if (isPlainObject(parsed) && isPlainObject(original)) {
    const remapped = remapVectorKeys(parsed, original);
    if (remapped) {
      preserveFlowMarker(original, remapped);
      return remapped;
    }
    preserveFlowMarker(original, parsed);
  }
  return parsed;
}

// ============================================================
// Variant merging — match sections by REFS or target fileID
// ============================================================

interface VariantModificationOwner {
  instanceFileId: string;
  modifications: any[];
}

/** Build mutable PrefabInstance modification owners from their Unity documents. */
function buildVariantModificationOwners(file: UnityFile): VariantModificationOwner[] {
  const instanceDocs = new Map<string, UnityDocument>();
  for (const doc of file.documents) {
    if (doc.typeId === 1001) {
      instanceDocs.set(doc.fileId, doc);
    }
  }

  const owners: VariantModificationOwner[] = [];
  for (const instance of file.prefabInstances) {
    const doc = instanceDocs.get(instance.fileId);
    const modifications = doc?.properties.m_Modification?.m_Modifications;
    if (!Array.isArray(modifications)) continue;

    owners.push({
      instanceFileId: instance.fileId,
      modifications,
    });
  }

  return owners;
}

/** Get the first scalar REFS value for a key, with normal path alias handling. */
function getRefsValue(
  refs: Map<string, string[]>,
  key: string,
  pathLookupOptions: PathLookupOptions
): string | undefined {
  const entry = findPathMapEntry(refs, key, pathLookupOptions);
  return entry?.value[0];
}

function modificationTargetsFileId(mod: any, targetFileId: string): boolean {
  return String(mod.target?.fileID) === targetFileId;
}

function ownerHasSectionProperty(
  owner: VariantModificationOwner,
  targetFileId: string,
  section: CompactSection
): boolean {
  const editableKeys = section.properties
    .filter(prop => typeof prop.value === 'string')
    .map(prop => prop.key);

  if (editableKeys.length === 0) {
    return owner.modifications.some(mod => modificationTargetsFileId(mod, targetFileId));
  }

  return owner.modifications.some(mod =>
    modificationTargetsFileId(mod, targetFileId) && editableKeys.includes(mod.propertyPath)
  );
}

/** Pick the PrefabInstance document that owns a variant section's modifications. */
function selectVariantModificationOwner(
  owners: VariantModificationOwner[],
  targetFileId: string,
  section: CompactSection,
  ownerInstanceId?: string,
  refsOccurrenceIndex: number = 0
): VariantModificationOwner | undefined {
  if (ownerInstanceId) {
    return owners.find(owner => owner.instanceFileId === ownerInstanceId);
  }

  let candidates = owners.filter(owner => ownerHasSectionProperty(owner, targetFileId, section));
  if (candidates.length === 0) {
    candidates = owners.filter(owner =>
      owner.modifications.some(mod => modificationTargetsFileId(mod, targetFileId))
    );
  }

  return candidates[refsOccurrenceIndex] || candidates[0];
}

/** Preserve reference context when a path ref only carries a fileID. */
function contextualizeObjectReference(parsed: any, existing: any): any {
  if (!parsed || typeof parsed !== 'object' || !('fileID' in parsed)) return parsed;
  if (!existing || typeof existing !== 'object') return parsed;

  const next = { ...parsed };
  if (next.guid === undefined && existing.guid !== undefined) {
    next.guid = existing.guid;
  }
  if (next.type === undefined && existing.type !== undefined) {
    next.type = existing.type;
  }
  return next;
}

/** Merge sections for a variant file */
function mergeVariantSections(
  file: UnityFile,
  sections: CompactSection[],
  refs: Map<string, string[]>,
  structurePaths?: Set<string>
): void {
  // Find the main PrefabInstance (the one with transformParent = {fileID: 0})
  const mainInstance = file.prefabInstances.find(pi =>
    String(pi.transformParent.fileID) === '0'
  );
  if (!mainInstance) return;

  const modificationOwners = buildVariantModificationOwners(file);
  if (modificationOwners.length === 0) return;

  const docMap = new Map<string, UnityDocument>();
  for (const doc of file.documents) {
    docMap.set(doc.fileId, doc);
  }

  // Track per-key index for cycling through duplicate REFS entries
  const refsIndexMap = new Map<string, number>();
  const pathLookupOptions: PathLookupOptions = { allowAddedRootAliases: true };

  for (const section of sections) {
    // Resolve target fileID from REFS or section header
    let targetFileId: string | undefined;
    let ownerInstanceId: string | undefined;
    let targetSourceGuid: string | undefined;
    let refsOccurrenceIndex = 0;

    if (section.goPath.startsWith('&')) {
      // Legacy format: [&fileID]
      targetFileId = section.goPath.substring(1);
    } else {
      // New format: [GOPath:ComponentType] — look up in REFS
      const refsKey = section.componentType
        ? `${section.goPath}:${section.componentType}`
        : section.goPath;
      const refsEntry = findPathMapEntry(refs, refsKey, pathLookupOptions);
      if (refsEntry && refsEntry.value.length > 0) {
        const idx = refsIndexMap.get(refsEntry.key) || 0;
        refsOccurrenceIndex = idx;
        targetFileId = refsEntry.value[idx];
        refsIndexMap.set(refsEntry.key, idx + 1);
        ownerInstanceId = getRefsValue(refs, `${refsEntry.key}:__instance`, pathLookupOptions);
        targetSourceGuid = getRefsValue(refs, `${refsEntry.key}:__source`, pathLookupOptions);
      }
    }

    if (!targetFileId) continue;

    const targetDoc = docMap.get(targetFileId);
    if (targetDoc && !targetDoc.stripped && targetDoc.typeId !== 1001) {
      if (section.componentType === 'Transform' || section.componentType === 'RectTransform') {
        applyTransformProperties(section.properties, targetDoc, section.componentType === 'RectTransform');
      } else {
        applyComponentProperties(section.properties, targetDoc, refs, structurePaths, pathLookupOptions);
      }
      continue;
    }

    const owner = selectVariantModificationOwner(
      modificationOwners,
      targetFileId,
      section,
      ownerInstanceId,
      refsOccurrenceIndex
    );
    if (!owner) continue;

    for (const prop of section.properties) {
      if (typeof prop.value !== 'string') continue;

      // Find existing modification with this target + propertyPath
      const existing = owner.modifications.find(
        (m: any) => String(m.target?.fileID) === targetFileId && m.propertyPath === prop.key
      );

      if (existing) {
        // Update existing modification
        let parsed = parseCompactValue(prop.value);
        parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
        if (typeof parsed === 'object' && parsed !== null && 'fileID' in parsed) {
          parsed = contextualizeObjectReference(parsed, existing.objectReference);
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
      else {
        let parsed = parseCompactValue(prop.value);
        parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
        const ownerInfo = file.prefabInstances.find(instance =>
          instance.fileId === owner.instanceFileId
        );
        const sourceGuid = targetSourceGuid
          || owner.modifications.find(mod => modificationTargetsFileId(mod, targetFileId!))?.target?.guid
          || ownerInfo?.sourcePrefab.guid
          || mainInstance.sourcePrefab.guid
          || compactBaseGuid(file);
        const target: Record<string, any> = { fileID: targetFileId };
        if (sourceGuid) {
          target.guid = sourceGuid;
          target.type = 3;
        }

        const modification: Record<string, any> = {
          target,
          propertyPath: prop.key,
          value: '',
          objectReference: { fileID: 0 },
        };
        if (parsed && typeof parsed === 'object' && 'fileID' in parsed) {
          modification.objectReference = parsed;
        } else {
          modification.value = String(parsed ?? '');
        }
        owner.modifications.push(modification);
      }
    }
  }
}

/** Best-effort source GUID fallback for legacy compact files without :__source metadata. */
function compactBaseGuid(file: UnityFile): string | undefined {
  return file.variantSource?.guid;
}
