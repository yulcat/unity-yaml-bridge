/**
 * Convert a parsed UnityFile AST into the compact .ubridge format.
 */

import * as fs from 'fs';
import {
  UnityFile,
  UnityDocument,
  GameObjectNode,
  ComponentInfo,
  TransformInfo,
  PrefabInstanceInfo,
  PropertyModification,
  OMIT_COMPONENTS,
  UNITY_TYPE_MAP,
} from './types';
import { GuidResolver } from './guid-resolver';
import { parseUnityYaml } from './unity-yaml-parser';

/** Additional fields to filter from compact output for cleaner results */
const COMPACT_OMIT_FIELDS = new Set([
  'm_Enabled',
  'm_Material',      // Usually null or default
  'm_RaycastTarget', // Usually default
  'm_OnCullStateChanged', // Boilerplate event
  'm_PreserveAspect',
  'm_FillMethod',
  'm_FillAmount',
  'm_FillClockwise',
  'm_FillOrigin',
  'm_UseSpriteMesh',
  'm_CullTransparentMesh',
]);

/** Variant modification property paths that are boilerplate (always present, not user-relevant) */
const VARIANT_OMIT_PATHS = new Set([
  'm_LocalPosition.x', 'm_LocalPosition.y', 'm_LocalPosition.z',
  'm_LocalRotation.x', 'm_LocalRotation.y', 'm_LocalRotation.z', 'm_LocalRotation.w',
  'm_RootOrder',
  'm_LocalEulerAnglesHint.x', 'm_LocalEulerAnglesHint.y', 'm_LocalEulerAnglesHint.z',
  'm_AnchoredPosition.x', 'm_AnchoredPosition.y',
  'm_SizeDelta.x', 'm_SizeDelta.y',
  'm_AnchorMin.x', 'm_AnchorMin.y',
  'm_AnchorMax.x', 'm_AnchorMax.y',
  'm_Pivot.x', 'm_Pivot.y',
  'm_LocalScale.x', 'm_LocalScale.y', 'm_LocalScale.z',
  'm_havePropertiesChanged',
  'm_isInputParsingRequired',
  'm_textInfo.characterCount',
  'm_textInfo.spaceCount',
  'm_textInfo.wordCount',
]);

/** Options for compact writer */
export interface CompactWriterOptions {
  /** GUID resolver for script name resolution */
  guidResolver?: GuidResolver;
  /** Include all fields (disable boilerplate filtering) */
  verbose?: boolean;
}

/** Convert a UnityFile to compact .ubridge string */
export function writeCompact(file: UnityFile, options: CompactWriterOptions = {}): string {
  const lines: string[] = [];
  const resolver = options.guidResolver;

  // Header
  if (file.type === 'variant' && file.variantSource) {
    lines.push(`# ubridge v1 | variant | base-guid:${file.variantSource.guid || 'unknown'}`);
  } else {
    lines.push(`# ubridge v1 | ${file.type}`);
  }

  if (file.type === 'variant') {
    return writeVariantCompact(file, lines, resolver);
  }

  if (!file.hierarchy) {
    return lines.join('\n') + '\n';
  }

  // Structure section
  lines.push('--- STRUCTURE');
  let expansionCtx: NestedExpansionContext | undefined;
  if (resolver) {
    expansionCtx = {
      resolver,
      prefabInstances: file.prefabInstances,
      visited: new Set(),
    };
  }
  writeStructureTree(file.hierarchy, lines, '', true, resolver, expansionCtx);

  // Details section
  lines.push('--- DETAILS');
  writeDetails(file.hierarchy, lines, '', resolver, !options.verbose);

  // REFS section
  lines.push('--- REFS');
  writeRefsSection(file.hierarchy, lines, resolver);

  return lines.join('\n') + '\n';
}

/** Context for nested prefab tree expansion */
interface NestedExpansionContext {
  resolver: GuidResolver;
  prefabInstances: PrefabInstanceInfo[];
  visited: Set<string>; // GUIDs currently being expanded (cycle detection)
}

/** Result of expanding a nested prefab */
interface ExpandedNestedPrefab {
  hierarchy: GameObjectNode;
  modifiedFileIds: Set<string>;
  sourcePrefabInstances: PrefabInstanceInfo[];
}

/** Try to expand a nested prefab by loading and parsing its source */
function expandNestedPrefab(
  node: GameObjectNode,
  ctx: NestedExpansionContext
): ExpandedNestedPrefab | null {
  if (!node.nestedPrefab) return null;

  const sourceGuid = node.nestedPrefab.sourceGuid;
  if (!sourceGuid || ctx.visited.has(sourceGuid)) return null;

  const sourcePath = ctx.resolver.resolveFilePath(sourceGuid);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  ctx.visited.add(sourceGuid);
  try {
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const sourceFile = parseUnityYaml(sourceContent);
    if (!sourceFile.hierarchy) return null;

    const pi = ctx.prefabInstances.find(p => p.fileId === node.nestedPrefab!.instanceId);
    const modifiedFileIds = new Set<string>();
    if (pi) {
      for (const mod of pi.modifications) {
        modifiedFileIds.add(String(mod.target.fileID));
      }
    }

    return {
      hierarchy: sourceFile.hierarchy,
      modifiedFileIds,
      sourcePrefabInstances: sourceFile.prefabInstances,
    };
  } catch {
    return null;
  } finally {
    ctx.visited.delete(sourceGuid);
  }
}

/** Resolve the display name for a nested prefab source */
function resolveSourceName(node: GameObjectNode, resolver?: GuidResolver): string {
  if (!node.nestedPrefab) return '';
  return node.nestedPrefab.sourceName ||
    (resolver ? resolver.resolve(node.nestedPrefab.sourceGuid) : undefined) ||
    node.nestedPrefab.sourceGuid;
}

/** Build a component name list with optional * markers for modified components */
function buildComponentNames(
  components: ComponentInfo[],
  resolver?: GuidResolver,
  modifiedFileIds?: Set<string>
): string[] {
  return components
    .filter(c => !OMIT_COMPONENTS.has(c.typeName))
    .map(c => {
      const name = resolveComponentName(c, resolver);
      if (modifiedFileIds?.has(c.fileId)) return name + '*';
      return name;
    });
}

/** Write the structure tree for a GO node */
function writeStructureTree(
  node: GameObjectNode,
  lines: string[],
  prefix: string,
  isRoot: boolean,
  resolver?: GuidResolver,
  expansionCtx?: NestedExpansionContext,
  modifiedFileIds?: Set<string>
): void {
  const componentNames = buildComponentNames(node.components, resolver, modifiedFileIds);

  let line = node.name;

  if (node.nestedPrefab) {
    const sourceName = resolveSourceName(node, resolver);
    if (sourceName) line += ` {${sourceName}}`;
  }

  if (componentNames.length > 0) {
    line += ` [${componentNames.join(', ')}]`;
  }

  if (isRoot) {
    lines.push(line);
  }

  // Write children
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const isLast = i === node.children.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    // Try expanding nested prefab
    if (child.nestedPrefab && expansionCtx) {
      const expanded = expandNestedPrefab(child, expansionCtx);
      if (expanded) {
        const sourceRoot = expanded.hierarchy;
        // Use source root name if instance name wasn't overridden
        const instanceName = child.name === 'NestedPrefab' ? sourceRoot.name : child.name;
        const childComps = buildComponentNames(sourceRoot.components, resolver, expanded.modifiedFileIds);

        let childLine = `${prefix}${connector} ${instanceName}`;
        const sourceName = resolveSourceName(child, resolver);
        if (sourceName) childLine += ` {${sourceName}}`;
        if (childComps.length > 0) childLine += ` [${childComps.join(', ')}]`;
        lines.push(childLine);

        // Recurse into source children with the source file's PIs
        if (sourceRoot.children.length > 0) {
          const sourceCtx: NestedExpansionContext = {
            resolver: expansionCtx.resolver,
            prefabInstances: expanded.sourcePrefabInstances,
            visited: expansionCtx.visited,
          };
          writeStructureTree(
            sourceRoot, lines, prefix + childPrefix, false,
            resolver, sourceCtx, expanded.modifiedFileIds
          );
        }
        continue;
      }
    }

    // Normal child (not expanded or expansion failed)
    const childComps = buildComponentNames(child.components, resolver, modifiedFileIds);
    let childLine = `${prefix}${connector} ${child.name}`;

    if (child.nestedPrefab) {
      const sourceName = resolveSourceName(child, resolver);
      if (sourceName) childLine += ` {${sourceName}}`;
    }

    if (childComps.length > 0) childLine += ` [${childComps.join(', ')}]`;
    lines.push(childLine);

    if (child.children.length > 0) {
      writeStructureTree(child, lines, prefix + childPrefix, false, resolver, expansionCtx, modifiedFileIds);
    }
  }
}

/** Write the details section for a GO and its descendants */
function writeDetails(
  node: GameObjectNode,
  lines: string[],
  path: string,
  resolver?: GuidResolver,
  filterBoilerplate: boolean = true
): void {
  // Use short path (just the GO name, unless we need disambiguation)
  const currentPath = path ? `${path}/${node.name}` : node.name;
  const displayPath = node.name;

  // Write transform details (if non-default)
  const transformSection = writeTransformSection(node.transform, displayPath);
  if (transformSection) {
    lines.push('');
    lines.push(transformSection);
  }

  // Write component details
  for (const comp of node.components) {
    if (OMIT_COMPONENTS.has(comp.typeName)) continue;

    const compName = resolveComponentName(comp, resolver);
    const props = comp.properties;
    const propEntries = Object.entries(props).filter(([k, v]) => {
      // Always filter m_Enabled=1 (default)
      if (k === 'm_Enabled' && v === 1) return false;
      // Filter boilerplate fields in non-verbose mode
      if (filterBoilerplate && COMPACT_OMIT_FIELDS.has(k)) return false;
      // Filter null material references
      if (filterBoilerplate && k === 'm_Material' && isNullRef(v)) return false;
      return true;
    });

    if (propEntries.length === 0) continue;

    lines.push('');
    lines.push(`[${displayPath}:${compName}]`);

    for (const [key, value] of propEntries) {
      writeProperty(key, value, lines, '');
    }
  }

  // Recurse children
  for (const child of node.children) {
    writeDetails(child, lines, currentPath, resolver, filterBoilerplate);
  }
}

/** Write the REFS section mapping paths to fileIDs */
function writeRefsSection(
  node: GameObjectNode,
  lines: string[],
  resolver?: GuidResolver
): void {
  writeNodeRefs(node, lines, resolver);
}

/** Write refs entries for a single node and its descendants */
function writeNodeRefs(
  node: GameObjectNode,
  lines: string[],
  resolver?: GuidResolver
): void {
  const name = node.name;

  // GO fileId
  if (node.fileId && node.fileId !== '0') {
    lines.push(`${name} = ${node.fileId}`);
  }

  // Transform fileId
  if (node.transform.fileId) {
    const typeName = node.transform.isRect ? 'RectTransform' : 'Transform';
    lines.push(`${name}:${typeName} = ${node.transform.fileId}`);
  }

  // Component fileIds
  for (const comp of node.components) {
    if (OMIT_COMPONENTS.has(comp.typeName)) continue;
    const compName = resolveComponentName(comp, resolver);
    lines.push(`${name}:${compName} = ${comp.fileId}`);
  }

  // Nested prefab instance
  if (node.nestedPrefab) {
    lines.push(`${name}:__instance = ${node.nestedPrefab.instanceId}`);
  }

  // Recurse children
  for (const child of node.children) {
    writeNodeRefs(child, lines, resolver);
  }
}

/** Write the transform section in compact form */
function writeTransformSection(transform: TransformInfo, path: string): string | null {
  const props = transform.properties;
  const lines: string[] = [];
  const typeName = transform.isRect ? 'RectTransform' : 'Transform';

  // Position
  if (transform.isRect) {
    const pos = props.m_AnchoredPosition;
    if (pos && !isZero2D(pos)) {
      lines.push(`pos = (${pos.x}, ${pos.y})`);
    }
  } else {
    const pos = props.m_LocalPosition;
    if (pos && !isZero3D(pos)) {
      lines.push(`pos = (${pos.x}, ${pos.y}, ${pos.z})`);
    }
  }

  // Rotation (treat -0 as 0 for default check)
  const rot = props.m_LocalRotation;
  if (rot && !isDefaultRotation(rot)) {
    lines.push(`rot = (${rot.x}, ${rot.y}, ${rot.z}, ${rot.w})`);
  }

  // Scale
  const scale = props.m_LocalScale;
  if (scale && !isDefaultScale(scale)) {
    lines.push(`scale = (${scale.x}, ${scale.y}, ${scale.z})`);
  }

  // RectTransform specific
  if (transform.isRect) {
    const anchorMin = props.m_AnchorMin;
    const anchorMax = props.m_AnchorMax;
    if (anchorMin && anchorMax &&
        !(anchorMin.x === 0.5 && anchorMin.y === 0.5 && anchorMax.x === 0.5 && anchorMax.y === 0.5)) {
      lines.push(`anchor = (${anchorMin.x}, ${anchorMin.y})-(${anchorMax.x}, ${anchorMax.y})`);
    }

    const size = props.m_SizeDelta;
    if (size && !isZero2D(size)) {
      lines.push(`size = (${size.x}, ${size.y})`);
    }

    const pivot = props.m_Pivot;
    if (pivot && (pivot.x !== 0.5 || pivot.y !== 0.5)) {
      lines.push(`pivot = (${pivot.x}, ${pivot.y})`);
    }
  }

  if (lines.length === 0) return null;

  return `[${path}:${typeName}]\n${lines.join('\n')}`;
}

/** Write a property value in compact format */
function writeProperty(key: string, value: any, lines: string[], indent: string): void {
  if (value === null || value === undefined) {
    lines.push(`${indent}${key} = null`);
    return;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    // Check if it's a file reference
    if ('fileID' in value) {
      lines.push(`${indent}${key} = ${formatReference(value)}`);
      return;
    }

    // Check if it's a vector/color
    if (isVector(value)) {
      lines.push(`${indent}${key} = ${formatVector(value)}`);
      return;
    }

    // Nested object
    lines.push(`${indent}${key}:`);
    for (const [k, v] of Object.entries(value)) {
      writeProperty(k, v, lines, indent + '  ');
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${indent}${key} = []`);
      return;
    }

    // Check if all items are simple references
    if (value.every((v: any) => typeof v === 'object' && 'fileID' in v)) {
      const refs = value.map((v: any) => formatReference(v));
      if (refs.join(', ').length < 80) {
        lines.push(`${indent}${key} = [${refs.join(', ')}]`);
        return;
      }
    }

    // Check if all items are simple scalars
    if (value.every((v: any) => typeof v !== 'object')) {
      lines.push(`${indent}${key} = [${value.join(', ')}]`);
      return;
    }

    // Complex array
    lines.push(`${indent}${key}:`);
    for (const item of value) {
      if (typeof item === 'object' && !Array.isArray(item)) {
        if ('fileID' in item) {
          lines.push(`${indent}  - ${formatReference(item)}`);
        } else {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            lines.push(`${indent}  - ${firstKey} = ${formatValue(firstVal)}`);
            for (let i = 1; i < entries.length; i++) {
              lines.push(`${indent}    ${entries[i][0]} = ${formatValue(entries[i][1])}`);
            }
          }
        }
      } else {
        lines.push(`${indent}  - ${formatValue(item)}`);
      }
    }
    return;
  }

  // Simple value
  lines.push(`${indent}${key} = ${value}`);
}

/** Format a value inline */
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && 'fileID' in value) return formatReference(value);
  if (typeof value === 'object' && isVector(value)) return formatVector(value);
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  return String(value);
}

/** Format a file reference */
function formatReference(ref: any): string {
  if (!ref || String(ref.fileID) === '0') return 'null';
  if (ref.guid) {
    return `{${ref.fileID}, ${ref.guid}}`;
  }
  return `{${ref.fileID}}`;
}

/** Check if a value is a null reference */
function isNullRef(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'object' && 'fileID' in value && String(value.fileID) === '0') return true;
  return false;
}

/** Check if an object looks like a vector */
function isVector(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj);
  if (keys.length >= 2 && keys.length <= 4) {
    return keys.every(k => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].includes(k));
  }
  return false;
}

/** Format a vector/color value */
function formatVector(obj: any): string {
  const keys = Object.keys(obj);
  const values = keys.map(k => obj[k]);
  return `(${values.join(', ')})`;
}

/** Check if a 2D vector is zero */
function isZero2D(v: any): boolean {
  return numEq(v.x, 0) && numEq(v.y, 0);
}

/** Check if a 3D vector is zero */
function isZero3D(v: any): boolean {
  return numEq(v.x, 0) && numEq(v.y, 0) && numEq(v.z, 0);
}

/** Check if rotation is default (0,0,0,1) — treats -0 and "0" as 0 */
function isDefaultRotation(rot: any): boolean {
  return numEq(rot.x, 0) && numEq(rot.y, 0) && numEq(rot.z, 0) && numEq(rot.w, 1);
}

/** Check if scale is default (1,1,1) */
function isDefaultScale(scale: any): boolean {
  return numEq(scale.x, 1) && numEq(scale.y, 1) && numEq(scale.z, 1);
}

/** Numeric equality that handles -0, string "0", etc. */
function numEq(a: any, b: number): boolean {
  if (typeof a === 'string') {
    // Handle string "-0" or "0"
    const n = parseFloat(a);
    if (isNaN(n)) return false;
    return Object.is(n, b) || (b === 0 && Object.is(n, -0)) || (b === 0 && n === 0);
  }
  if (typeof a === 'number') {
    if (b === 0) return a === 0 || Object.is(a, -0);
    return a === b;
  }
  return false;
}

/** Resolve a component name from its info */
function resolveComponentName(comp: ComponentInfo, resolver?: GuidResolver): string {
  if (comp.typeId !== 114) return comp.typeName;

  // For MonoBehaviour, try to resolve the script GUID
  if (comp.scriptGuid) {
    if (resolver) {
      const name = resolver.resolve(comp.scriptGuid);
      if (name) return name;
    }
    return comp.scriptGuid; // Fall back to GUID
  }
  return 'MonoBehaviour';
}

// ============================================================
// Variant support — resolve base prefab and build full tree
// ============================================================

/** Info about a document in the base prefab, keyed by fileID */
interface BaseDocInfo {
  fileId: string;
  typeId: number;
  typeName: string;
  goName: string;   // Name of the owning GO
  goFileId: string;  // FileID of the owning GO
}

/**
 * Build a map from base prefab fileID → document info.
 * This allows us to resolve variant modification targets to readable paths.
 * Also includes stripped docs (nested prefab objects with explicit entries).
 */
function buildBaseDocMap(
  baseDocs: UnityDocument[],
  resolver?: GuidResolver,
  baseHierarchy?: GameObjectNode
): Map<string, BaseDocInfo> {
  const map = new Map<string, BaseDocInfo>();

  // Build PI fileID → nested prefab node name mapping from hierarchy
  const piNodeNames = new Map<string, string>();
  if (baseHierarchy) {
    collectNestedNodeNames(baseHierarchy, piNodeNames);
  }

  // Index all docs by fileId
  const byId = new Map<string, UnityDocument>();
  for (const doc of baseDocs) {
    byId.set(doc.fileId, doc);
  }

  // First pass: index GameObjects by fileId → name
  const goNames = new Map<string, string>();
  for (const doc of baseDocs) {
    if (doc.typeId === 1 && !doc.stripped) {
      goNames.set(doc.fileId, doc.properties.m_Name || 'Unnamed');
    }
  }

  // Second pass: index non-stripped documents
  for (const doc of baseDocs) {
    if (doc.stripped) continue;

    const goRef = doc.properties.m_GameObject;
    const goId = goRef ? String(goRef.fileID) : '';
    const goName = goNames.get(goId) || '';

    let typeName = doc.typeName;
    if (doc.typeId === 114 && doc.properties.m_Script?.guid) {
      const resolved = resolver?.resolve(doc.properties.m_Script.guid);
      if (resolved) typeName = resolved;
    }

    map.set(doc.fileId, {
      fileId: doc.fileId,
      typeId: doc.typeId,
      typeName,
      goName: doc.typeId === 1 ? (doc.properties.m_Name || 'Unnamed') : goName,
      goFileId: doc.typeId === 1 ? doc.fileId : goId,
    });
  }

  // Third pass: index stripped documents (nested prefab objects)
  for (const doc of baseDocs) {
    if (!doc.stripped) continue;

    const piRef = doc.properties.m_PrefabInstance;
    if (!piRef) continue;
    const piFileId = String(piRef.fileID);

    // Get GO name from the hierarchy's nested prefab node
    const nodeName = piNodeNames.get(piFileId) || '';

    let typeName = doc.typeName;
    if (doc.typeId === 114 && doc.properties.m_Script?.guid) {
      const resolved = resolver?.resolve(doc.properties.m_Script.guid);
      if (resolved) typeName = resolved;
    }

    map.set(doc.fileId, {
      fileId: doc.fileId,
      typeId: doc.typeId,
      typeName,
      goName: nodeName,
      goFileId: '',
    });
  }

  return map;
}

/** Collect nested prefab node names: PI instanceId → node name */
function collectNestedNodeNames(node: GameObjectNode, map: Map<string, string>): void {
  if (node.nestedPrefab) {
    map.set(node.nestedPrefab.instanceId, node.name);
  }
  for (const child of node.children) {
    collectNestedNodeNames(child, map);
  }
}

/** Property path patterns → component type inference (order matters: first match wins) */
const PROPERTY_COMPONENT_RULES: [RegExp, string][] = [
  // TextMeshPro
  [/^m_text($|\.)/, 'TextMeshProUGUI'],
  [/^m_fontSize/, 'TextMeshProUGUI'],
  [/^m_fontColor/, 'TextMeshProUGUI'],
  [/^m_fontSizeBase/, 'TextMeshProUGUI'],
  [/^m_fontSizeMax/, 'TextMeshProUGUI'],
  [/^m_enableAutoSizing/, 'TextMeshProUGUI'],
  [/^m_textInfo\./, 'TextMeshProUGUI'],
  [/^m_firstOverflowCharacterIndex/, 'TextMeshProUGUI'],
  // Image
  [/^m_Sprite/, 'Image'],
  [/^m_Type$/, 'Image'],
  [/^m_FillCenter/, 'Image'],
  [/^m_Color\.(?!Module)/, 'Image'],
  // ParticleSystem
  [/^EmissionModule\./, 'ParticleSystem'],
  [/^InitialModule\./, 'ParticleSystem'],
  [/^SizeModule\./, 'ParticleSystem'],
  [/^RotationModule\./, 'ParticleSystem'],
  [/^ColorModule\./, 'ParticleSystem'],
  [/^simulationSpeed/, 'ParticleSystem'],
  [/^playOnAwake/, 'ParticleSystem'],
  // ParticleSystemRenderer
  [/^m_MaxParticleSize/, 'ParticleSystemRenderer'],
  [/^texture$/, 'ParticleSystemRenderer'],
  // GameObject
  [/^m_IsActive$/, 'GameObject'],
  // CanvasGroup
  [/^enableAlphaFading/, 'CanvasGroup'],
  [/^m_Alpha$/, 'CanvasGroup'],
];

/** Infer component type from a set of property paths */
function inferComponentType(propertyPaths: string[]): string | null {
  const typeCounts = new Map<string, number>();
  for (const path of propertyPaths) {
    for (const [regex, type] of PROPERTY_COMPONENT_RULES) {
      if (regex.test(path)) {
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        break;
      }
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [type, count] of typeCounts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best || null;
}

/**
 * Resolve unresolved variant targets by matching property paths against
 * nested prefab source objects. Returns a map: targetFileId → resolved key.
 */
function resolveNestedTargets(
  unresolvedTargets: Map<string, PropertyModification[]>,
  baseHierarchy: GameObjectNode,
  basePrefabInstances: PrefabInstanceInfo[],
  resolver: GuidResolver
): Map<string, string> {
  const resolved = new Map<string, string>();

  // Build: nested node name → [component types available in that source]
  // Also track PI fileID → nested node name
  const piNodeNames = new Map<string, string>();
  collectNestedNodeNames(baseHierarchy, piNodeNames);

  // For each PI, load source and build type → node name mapping
  // Also collect source object property paths for disambiguation
  interface SourceObjectInfo {
    nodeName: string;
    componentType: string;
    propertyPaths: Set<string>;  // paths from base PI modifications
  }
  const sourceObjectsByType = new Map<string, SourceObjectInfo[]>();

  for (const pi of basePrefabInstances) {
    const piId = pi.fileId;
    const nodeName = piNodeNames.get(piId);
    if (!nodeName) continue;

    const sourceGuid = pi.sourcePrefab.guid;
    if (!sourceGuid) continue;

    const sourcePath = resolver.resolveFilePath(sourceGuid);
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;

    try {
      const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
      const sourceFile = parseUnityYaml(sourceContent);

      // Build source object type index
      const sourceDocTypes = new Map<string, string>(); // sourceFileId → componentType
      for (const doc of sourceFile.documents) {
        if (doc.stripped) continue;
        let typeName = doc.typeName;
        if (doc.typeId === 114 && doc.properties.m_Script?.guid) {
          const r = resolver.resolve(doc.properties.m_Script.guid);
          if (r) typeName = r;
        }
        sourceDocTypes.set(doc.fileId, typeName);
      }

      // Collect property paths from base PI modifications for each source object
      for (const mod of pi.modifications) {
        const sourceObjId = String(mod.target.fileID);
        const componentType = sourceDocTypes.get(sourceObjId);
        if (!componentType) continue;

        const key = `${nodeName}:${componentType}`;
        if (!sourceObjectsByType.has(key)) {
          sourceObjectsByType.set(key, []);
        }
        let info = sourceObjectsByType.get(key)!.find(
          s => s.nodeName === nodeName && s.componentType === componentType
        );
        if (!info) {
          info = { nodeName, componentType, propertyPaths: new Set() };
          sourceObjectsByType.get(key)!.push(info);
        }
        info.propertyPaths.add(mod.propertyPath);
      }
    } catch {
      // Failed to parse source — skip
    }
  }

  // Now resolve each unresolved target
  for (const [targetId, mods] of unresolvedTargets) {
    const paths = mods.map(m => m.propertyPath);
    const compType = inferComponentType(paths);
    if (!compType) continue;

    // Find all nested prefabs that have this component type
    const candidates: SourceObjectInfo[] = [];
    for (const [, infos] of sourceObjectsByType) {
      for (const info of infos) {
        if (info.componentType === compType) {
          candidates.push(info);
        }
      }
    }

    if (candidates.length === 0) continue;

    if (candidates.length === 1) {
      resolved.set(targetId, `${candidates[0].nodeName}:${compType}`);
      continue;
    }

    // Disambiguate: pick the candidate with the most property path overlap
    let bestCandidate = candidates[0];
    let bestOverlap = 0;
    for (const candidate of candidates) {
      let overlap = 0;
      for (const p of paths) {
        if (candidate.propertyPaths.has(p)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestCandidate = candidate;
      }
    }
    resolved.set(targetId, `${bestCandidate.nodeName}:${compType}`);
  }

  return resolved;
}

/** Resolve a target fileID to a GOPath:ComponentType key using the base doc map */
function resolveTargetKey(targetFileId: string, baseMap: Map<string, BaseDocInfo>): string | null {
  const info = baseMap.get(targetFileId);
  if (!info) return null;

  if (info.typeId === 1) {
    // GameObject — just the name
    return info.goName;
  }

  if (info.typeId === 4 || info.typeId === 224) {
    // Transform/RectTransform
    return `${info.goName}:${info.typeName}`;
  }

  // Component
  return `${info.goName}:${info.typeName}`;
}

/** Write variant compact format with resolved paths */
function writeVariantCompact(file: UnityFile, lines: string[], resolver?: GuidResolver): string {
  const mainInstance = file.prefabInstances.find(pi =>
    String(pi.transformParent.fileID) === '0'
  );

  if (!mainInstance) {
    return lines.join('\n') + '\n';
  }

  const baseGuid = mainInstance.sourcePrefab.guid || '';

  // Try to load and parse the base prefab for full resolution
  let baseMap: Map<string, BaseDocInfo> | null = null;
  let baseHierarchy: GameObjectNode | undefined;
  let basePrefabInstances: PrefabInstanceInfo[] = [];
  let nestedResolved: Map<string, string> | null = null;

  if (resolver && baseGuid) {
    const basePath = resolver.resolveFilePath(baseGuid);
    if (basePath && fs.existsSync(basePath)) {
      try {
        const baseContent = fs.readFileSync(basePath, 'utf-8');
        const baseFile = parseUnityYaml(baseContent);
        baseHierarchy = baseFile.hierarchy;
        basePrefabInstances = baseFile.prefabInstances;
        baseMap = buildBaseDocMap(baseFile.documents, resolver, baseHierarchy);

        // Resolve nested prefab targets that aren't in baseMap
        const unresolvedTargets = new Map<string, PropertyModification[]>();
        for (const mod of mainInstance.modifications) {
          const targetId = String(mod.target.fileID);
          if (!baseMap.has(targetId)) {
            if (!unresolvedTargets.has(targetId)) {
              unresolvedTargets.set(targetId, []);
            }
            unresolvedTargets.get(targetId)!.push(mod);
          }
        }
        if (unresolvedTargets.size > 0 && baseHierarchy) {
          nestedResolved = resolveNestedTargets(
            unresolvedTargets, baseHierarchy, baseFile.prefabInstances, resolver
          );
        }
      } catch {
        // Failed to parse base — fall back to inferred format
      }
    }
  }

  // Determine which target fileIDs have modifications
  const modifiedTargets = new Set<string>();
  for (const mod of mainInstance.modifications) {
    modifiedTargets.add(String(mod.target.fileID));
  }

  // Structure section
  lines.push('--- STRUCTURE');
  if (baseHierarchy && baseMap) {
    let variantExpansionCtx: NestedExpansionContext | undefined;
    if (resolver) {
      variantExpansionCtx = {
        resolver,
        prefabInstances: basePrefabInstances,
        visited: new Set(),
      };
    }
    writeVariantStructureTree(baseHierarchy, lines, '', true, modifiedTargets, baseMap, resolver, variantExpansionCtx);
  } else {
    lines.push(`(variant of ${baseGuid || 'unknown'})`);
  }

  // Details section — group modifications by resolved path
  lines.push('--- DETAILS');
  writeVariantDetails(mainInstance, lines, baseMap, resolver, nestedResolved);

  // REFS section
  lines.push('--- REFS');
  lines.push(`__instance = ${mainInstance.fileId}`);
  writeVariantRefs(mainInstance, lines, baseMap, nestedResolved);

  return lines.join('\n') + '\n';
}

/** Write the variant structure tree from the base prefab hierarchy with modification markers */
function writeVariantStructureTree(
  node: GameObjectNode,
  lines: string[],
  prefix: string,
  isRoot: boolean,
  modifiedTargets: Set<string>,
  baseMap: Map<string, BaseDocInfo>,
  resolver?: GuidResolver,
  expansionCtx?: NestedExpansionContext
): void {
  const componentNames = buildComponentNames(node.components, resolver, modifiedTargets);

  let line = node.name;

  if (node.nestedPrefab) {
    const sourceName = resolveSourceName(node, resolver);
    if (sourceName) line += ` {${sourceName}}`;
  }

  if (componentNames.length > 0) {
    line += ` [${componentNames.join(', ')}]`;
  }

  if (isRoot) {
    lines.push(line);
  }

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const isLast = i === node.children.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    // Try expanding nested prefab
    if (child.nestedPrefab && expansionCtx) {
      const expanded = expandNestedPrefab(child, expansionCtx);
      if (expanded) {
        const sourceRoot = expanded.hierarchy;
        const instanceName = child.name === 'NestedPrefab' ? sourceRoot.name : child.name;
        // Merge modification markers: base PI modifications + variant modifications
        const mergedMods = new Set(expanded.modifiedFileIds);
        for (const id of modifiedTargets) mergedMods.add(id);
        const childComps = buildComponentNames(sourceRoot.components, resolver, mergedMods);

        let childLine = `${prefix}${connector} ${instanceName}`;
        const sourceName = resolveSourceName(child, resolver);
        if (sourceName) childLine += ` {${sourceName}}`;
        if (childComps.length > 0) childLine += ` [${childComps.join(', ')}]`;
        lines.push(childLine);

        if (sourceRoot.children.length > 0) {
          const sourceCtx: NestedExpansionContext = {
            resolver: expansionCtx.resolver,
            prefabInstances: expanded.sourcePrefabInstances,
            visited: expansionCtx.visited,
          };
          writeVariantStructureTree(
            sourceRoot, lines, prefix + childPrefix, false,
            mergedMods, baseMap, resolver, sourceCtx
          );
        }
        continue;
      }
    }

    const childComps = buildComponentNames(child.components, resolver, modifiedTargets);
    let childLine = `${prefix}${connector} ${child.name}`;

    if (child.nestedPrefab) {
      const sourceName = resolveSourceName(child, resolver);
      if (sourceName) childLine += ` {${sourceName}}`;
    }

    if (childComps.length > 0) childLine += ` [${childComps.join(', ')}]`;
    lines.push(childLine);

    if (child.children.length > 0) {
      writeVariantStructureTree(child, lines, prefix + childPrefix, false, modifiedTargets, baseMap, resolver, expansionCtx);
    }
  }
}

/** Write variant details grouped by resolved GO path */
function writeVariantDetails(
  instance: PrefabInstanceInfo,
  lines: string[],
  baseMap: Map<string, BaseDocInfo> | null,
  resolver?: GuidResolver,
  nestedResolved?: Map<string, string> | null
): void {
  // Group modifications by target fileID
  const modsByTarget = new Map<string, typeof instance.modifications>();
  for (const mod of instance.modifications) {
    const targetId = String(mod.target.fileID);
    if (!modsByTarget.has(targetId)) {
      modsByTarget.set(targetId, []);
    }
    modsByTarget.get(targetId)!.push(mod);
  }

  for (const [targetId, mods] of modsByTarget) {
    // Resolve section header
    const header = resolveVariantHeader(targetId, mods, baseMap, nestedResolved);

    // Filter boilerplate modifications
    const filteredMods = mods.filter(m => !VARIANT_OMIT_PATHS.has(m.propertyPath));
    if (filteredMods.length === 0) continue;

    lines.push('');
    lines.push(`[${header}]`);
    for (const mod of filteredMods) {
      const value = mod.objectReference && String(mod.objectReference.fileID) !== '0'
        ? formatReference(mod.objectReference)
        : mod.value;
      lines.push(`${mod.propertyPath} = ${value}`);
    }
  }
}

/**
 * Resolve a variant target to a human-readable header.
 * Uses baseMap first, then nestedResolved, then inference.
 */
function resolveVariantHeader(
  targetId: string,
  mods: { propertyPath: string; value: string }[],
  baseMap: Map<string, BaseDocInfo> | null,
  nestedResolved?: Map<string, string> | null
): string {
  // 1. Try baseMap (direct and stripped docs)
  if (baseMap) {
    const resolved = resolveTargetKey(targetId, baseMap);
    if (resolved) return resolved;
  }

  // 2. Try nested prefab resolution (property-path matching)
  if (nestedResolved) {
    const resolved = nestedResolved.get(targetId);
    if (resolved) return resolved;
  }

  // 3. Fallback: infer from m_Name or property paths
  const nameMod = mods.find(m => m.propertyPath === 'm_Name');
  if (nameMod) return nameMod.value;

  const componentType = inferComponentType(mods.map(m => m.propertyPath));
  if (componentType) return `&${targetId}:${componentType}`;

  return `&${targetId}`;
}

/** Write variant REFS section */
function writeVariantRefs(
  instance: PrefabInstanceInfo,
  lines: string[],
  baseMap: Map<string, BaseDocInfo> | null,
  nestedResolved?: Map<string, string> | null
): void {
  // Group modifications by target fileID (need all mods for inference)
  const modsByTarget = new Map<string, typeof instance.modifications>();
  for (const mod of instance.modifications) {
    const targetId = String(mod.target.fileID);
    if (!modsByTarget.has(targetId)) {
      modsByTarget.set(targetId, []);
    }
    modsByTarget.get(targetId)!.push(mod);
  }

  for (const [targetId, mods] of modsByTarget) {
    const key = resolveVariantHeader(targetId, mods, baseMap, nestedResolved);
    lines.push(`${key} = ${targetId}`);
  }
}
