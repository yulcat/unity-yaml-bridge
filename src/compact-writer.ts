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
  OMIT_FIELDS,
  OMIT_COMPONENTS,
  UNITY_TYPE_MAP,
} from './types';
import { GuidResolver } from './guid-resolver';
import { parseUnityYaml } from './unity-yaml-parser';
import { ADDED_ROOT_NAME, stripAddedRootPrefix } from './path-utils';

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
  /** Compact format version. v2 is the default; pass 1 for legacy output. */
  version?: 1 | 2;
}

interface SelectorContext {
  nodeNames: WeakMap<GameObjectNode, string>;
  nodePaths: WeakMap<GameObjectNode, string>;
  componentNames: WeakMap<ComponentInfo, string>;
  hasAliases: boolean;
}

type NestedSelectorOverrides = Map<string, string>;

function compareCanonicalFileIds(a: string, b: string): number {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return a.localeCompare(b);
  }
}

function compareCanonicalNodes(a: GameObjectNode, b: GameObjectNode): number {
  const aIdentity = a.fileId && a.fileId !== '0'
    ? a.fileId
    : (a.nestedPrefab?.instanceId || a.fileId);
  const bIdentity = b.fileId && b.fileId !== '0'
    ? b.fileId
    : (b.nestedPrefab?.instanceId || b.fileId);
  const identityOrder = compareCanonicalFileIds(aIdentity, bIdentity);
  if (identityOrder !== 0) return identityOrder;
  const aFallback = `${a.nestedPrefab?.sourceGuid || ''}|${a.nestedPrefab?.instanceId || ''}`;
  const bFallback = `${b.nestedPrefab?.sourceGuid || ''}|${b.nestedPrefab?.instanceId || ''}`;
  return aFallback.localeCompare(bFallback);
}

function selectorBaseNodeName(node: GameObjectNode, resolver?: GuidResolver): string {
  if (node.name === 'NestedPrefab' && node.nestedPrefab) {
    return resolveSourceName(node, resolver) || node.name;
  }
  return node.name;
}

/** Build snapshot-scoped #N aliases without depending on hierarchy/component order. */
function buildSelectorContext(root: GameObjectNode, resolver?: GuidResolver): SelectorContext {
  const context: SelectorContext = {
    nodeNames: new WeakMap(),
    nodePaths: new WeakMap(),
    componentNames: new WeakMap(),
    hasAliases: false,
  };

  const visit = (node: GameObjectNode, renderedName: string, parentPath: string): void => {
    const path = parentPath ? `${parentPath}/${renderedName}` : renderedName;
    context.nodeNames.set(node, renderedName);
    context.nodePaths.set(node, path);

    const componentGroups = new Map<string, ComponentInfo[]>();
    for (const component of node.components) {
      const name = resolveComponentName(component, resolver);
      const group = componentGroups.get(name) || [];
      group.push(component);
      componentGroups.set(name, group);
    }
    for (const [name, components] of componentGroups) {
      if (components.length === 1) {
        context.componentNames.set(components[0], name);
        continue;
      }
      const sorted = [...components].sort((a, b) => compareCanonicalFileIds(a.fileId, b.fileId));
      context.hasAliases = true;
      sorted.forEach((component, index) => context.componentNames.set(component, `${name}#${index + 1}`));
    }

    const childGroups = new Map<string, GameObjectNode[]>();
    for (const child of node.children) {
      const name = selectorBaseNodeName(child, resolver);
      const group = childGroups.get(name) || [];
      group.push(child);
      childGroups.set(name, group);
    }
    for (const [name, children] of childGroups) {
      if (children.length === 1) {
        visit(children[0], name, path);
        continue;
      }
      const sorted = [...children].sort(compareCanonicalNodes);
      context.hasAliases = true;
      const ranks = new Map(sorted.map((child, index) => [child, index + 1]));
      for (const child of children) visit(child, `${name}#${ranks.get(child)}`, path);
    }
  };

  visit(root, selectorBaseNodeName(root, resolver), '');
  return context;
}

function applyNestedNodeAliases(
  root: GameObjectNode,
  refs: Map<string, NestedSourceObjectRef>,
  selectors: SelectorContext,
  resolver?: GuidResolver
): void {
  const instances = new Map<string, { oldPath: string; newPath: string }>();
  const visit = (node: GameObjectNode, parentPath: string): void => {
    const name = selectorBaseNodeName(node, resolver);
    const oldPath = parentPath ? `${parentPath}/${name}` : name;
    if (node.nestedPrefab) {
      instances.set(node.nestedPrefab.instanceId, {
        oldPath,
        newPath: selectors.nodePaths.get(node) || oldPath,
      });
    }
    node.children.forEach(child => visit(child, oldPath));
  };
  visit(root, '');

  for (const ref of refs.values()) {
    const instance = instances.get(ref.prefabInstanceId);
    if (!instance) continue;
    if (ref.path === instance.oldPath) ref.path = instance.newPath;
    else if (ref.path.startsWith(`${instance.oldPath}/`)) {
      ref.path = instance.newPath + ref.path.slice(instance.oldPath.length);
    }
  }
}

function buildNestedSelectorOverrides(
  refs: Map<string, NestedSourceObjectRef>
): NestedSelectorOverrides {
  const groups = new Map<string, NestedSourceObjectRef[]>();
  for (const ref of refs.values()) {
    if (REF_SKIP_TYPES.has(ref.typeName)) continue;
    const key = `${ref.path}:${ref.typeName}`;
    const group = groups.get(key) || [];
    group.push(ref);
    groups.set(key, group);
  }
  const overrides = new Map<string, string>();
  for (const [key, group] of groups) {
    if (group.length === 1) continue;
    const sorted = [...group].sort((a, b) => compareCanonicalFileIds(a.fileId, b.fileId));
    sorted.forEach((ref, index) => overrides.set(ref.fileId, `${key}#${index + 1}`));
  }
  return overrides;
}

function finishCompact(lines: string[], version: 1 | 2): string {
  if (version === 2) {
    const refsStart = lines.lastIndexOf('--- REFS');
    if (refsStart >= 0) {
      const groups = new Map<string, Array<{ index: number; value: string }>>();
      for (let index = refsStart + 1; index < lines.length; index++) {
        const line = lines[index];
        const match = /^(.+?)\s*=\s*(.+)$/.exec(line.trim());
        if (!match) continue;
        const key = match[1].trim();
        const group = groups.get(key) || [];
        group.push({ index, value: match[2].trim() });
        groups.set(key, group);
      }
      for (const [key, group] of groups) {
        const distinctValues = [...new Set(group.map(entry => entry.value))];
        if (distinctValues.length <= 1) continue;
        const detailText = lines.slice(0, refsStart).join('\n');
        if (key.endsWith(':__instance') || key.endsWith(':__source') ||
            detailText.includes(`[${key}]`) || detailText.includes(`->${key}`) ||
            detailText.includes(`@${key}`)) {
          throw new Error(
            `Cannot emit unambiguous v2 selector for ${key}. ` +
            'Resolve the nested/source prefab so owner identity is available, or use v1.'
          );
        }
        const sorted = [...distinctValues].sort(compareCanonicalFileIds);
        const ranks = new Map(sorted.map((value, index) => [value, index + 1]));
        for (const entry of group) {
          const numberedKey = `${key}#${ranks.get(entry.value)}`;
          lines[entry.index] = `${numberedKey} = ${entry.value}`;
          const rawRef = `{${entry.value}}`;
          for (let index = 0; index < refsStart; index++) {
            lines[index] = lines[index].split(rawRef).join(`->${numberedKey}`);
          }
        }
      }
    }
  }
  return lines.join('\n') + '\n';
}

/** Convert a UnityFile to compact .ubridge string */
export function writeCompact(file: UnityFile, options: CompactWriterOptions = {}): string {
  const lines: string[] = [];
  const resolver = options.guidResolver;
  const version = options.version || 2;

  // Header
  if (file.type === 'variant' && file.variantSource) {
    lines.push(`# ubridge v${version} | variant | base-guid:${file.variantSource.guid || 'unknown'}`);
  } else {
    lines.push(`# ubridge v${version} | ${file.type}`);
  }

  if (file.type === 'variant') {
    return writeVariantCompact(file, lines, resolver, version);
  }

  if (!file.hierarchy) {
    return finishCompact(lines, version);
  }
  const selectorCandidate = version === 2
    ? buildSelectorContext(file.hierarchy, resolver)
    : undefined;
  const selectors = selectorCandidate?.hasAliases ? selectorCandidate : undefined;

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
  const nestedAddedComponents = resolveAddedComponents(file, undefined, null, resolver);
  const nestedAddedOverlay = buildAddedComponentOverlay(nestedAddedComponents, file.prefabInstances);
  const nestedRemovalOverlay = buildVariantRemovalOverlay(file, undefined, null, resolver);
  writeStructureTree(
    file.hierarchy, lines, '', true, resolver, expansionCtx,
    undefined, nestedAddedOverlay, nestedRemovalOverlay, '', '', selectors
  );

  const nestedObjectRefs = buildNestedSourceObjectRefMap(file.documents, file.hierarchy, resolver);
  if (selectors) applyNestedNodeAliases(file.hierarchy, nestedObjectRefs, selectors, resolver);
  const nestedSelectorOverrides = selectors
    ? buildNestedSelectorOverrides(nestedObjectRefs)
    : undefined;

  // Build internal reference map (fileID → GOPath:ComponentType)
  const refMap = buildInternalRefMap(
    file, resolver, selectors, nestedObjectRefs, nestedSelectorOverrides
  );
  for (const component of nestedAddedComponents) {
    refMap.set(component.document.fileId, `${component.goPath}:${component.componentName}`);
  }
  removeAmbiguousRefPaths(refMap);

  // Details section
  lines.push('--- DETAILS');
  writeDetails(file.hierarchy, lines, '', resolver, !options.verbose, refMap, selectors);
  writeAddedComponentDetails(nestedAddedComponents, lines, refMap);

  // REFS section
  lines.push('--- REFS');
  const strippedMap = buildStrippedComponentMap(file, resolver, nestedObjectRefs);
  writeRefsSection(
    file.hierarchy, lines, resolver, strippedMap, nestedObjectRefs,
    selectors, nestedSelectorOverrides
  );
  writeAddedComponentRefs(nestedAddedComponents, lines);

  return finishCompact(lines, version);
}

/** Context for nested prefab tree expansion */
interface NestedExpansionContext {
  resolver: GuidResolver;
  prefabInstances: PrefabInstanceInfo[];
  visited: Set<string>; // GUIDs currently being expanded (cycle detection)
}

/** Component types that should not be exposed as user-editable refs */
const REF_SKIP_TYPES = new Set(['Transform', 'RectTransform', 'CanvasRenderer', 'GameObject']);

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
  modifiedFileIds?: Set<string>,
  selectors?: SelectorContext
): string[] {
  return components
    .filter(c => !OMIT_COMPONENTS.has(c.typeName))
    .map(c => {
      const name = selectors?.componentNames.get(c) || resolveComponentName(c, resolver);
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
  modifiedFileIds?: Set<string>,
  addedComponentOverlay?: AddedComponentOverlay,
  removalOverlay?: VariantRemovalOverlay,
  ownerInstanceId: string = '',
  sourceGuid: string = '',
  selectors?: SelectorContext
): void {
  const componentNames = appendRemovedComponentNames(
    appendAddedComponentNames(
      buildComponentNames(node.components, resolver, modifiedFileIds, selectors),
      ownerInstanceId, sourceGuid, node.fileId, addedComponentOverlay
    ),
    sourceGuid, node.fileId, removalOverlay
  );

  const renderedNodeName = selectors?.nodeNames.get(node) || node.name;
  let line = variantNodeName(renderedNodeName, sourceGuid, node.fileId, removalOverlay);

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
        const instanceName = selectors?.nodeNames.get(child) ||
          (child.name === 'NestedPrefab' ? sourceRoot.name : child.name);
        const childSourceGuid = child.nestedPrefab.sourceGuid || '';
        const childComps = appendRemovedComponentNames(
          appendAddedComponentNames(
            buildComponentNames(sourceRoot.components, resolver, expanded.modifiedFileIds, selectors),
            child.nestedPrefab.instanceId, childSourceGuid, sourceRoot.fileId, addedComponentOverlay
          ),
          childSourceGuid, sourceRoot.fileId, removalOverlay
        );

        let childLine = `${prefix}${connector} ${variantNodeName(instanceName, childSourceGuid, sourceRoot.fileId, removalOverlay)}`;
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
            resolver, sourceCtx, expanded.modifiedFileIds,
            addedComponentOverlay, removalOverlay, child.nestedPrefab.instanceId, childSourceGuid, selectors
          );
        }
        continue;
      }
    }

    // Normal child (not expanded or expansion failed)
    const childComps = appendRemovedComponentNames(
      appendAddedComponentNames(
        buildComponentNames(child.components, resolver, modifiedFileIds, selectors),
        ownerInstanceId, sourceGuid, child.fileId, addedComponentOverlay
      ),
      sourceGuid, child.fileId, removalOverlay
    );
    const renderedChildName = selectors?.nodeNames.get(child) || child.name;
    let childLine = `${prefix}${connector} ${variantNodeName(renderedChildName, sourceGuid, child.fileId, removalOverlay)}`;

    if (child.nestedPrefab) {
      const sourceName = resolveSourceName(child, resolver);
      if (sourceName) childLine += ` {${sourceName}}`;
    }

    if (childComps.length > 0) childLine += ` [${childComps.join(', ')}]`;
    lines.push(childLine);

    if (child.children.length > 0) {
      writeStructureTree(
        child, lines, prefix + childPrefix, false, resolver, expansionCtx,
        modifiedFileIds, addedComponentOverlay, removalOverlay, ownerInstanceId, sourceGuid, selectors
      );
    }
  }
}

/** Write the details section for a GO and its descendants */
function writeDetails(
  node: GameObjectNode,
  lines: string[],
  path: string,
  resolver?: GuidResolver,
  filterBoilerplate: boolean = true,
  refMap?: Map<string, string>,
  selectors?: SelectorContext
): void {
  const currentPath = selectors?.nodePaths.get(node) || (path ? `${path}/${node.name}` : node.name);

  // Write transform details (if non-default)
  const transformSection = writeTransformSection(node.transform, currentPath);
  if (transformSection) {
    lines.push('');
    lines.push(transformSection);
  }

  // Write component details
  for (const comp of node.components) {
    if (OMIT_COMPONENTS.has(comp.typeName)) continue;

    const compName = selectors?.componentNames.get(comp) || resolveComponentName(comp, resolver);
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
    lines.push(`[${currentPath}:${compName}]`);

    for (const [key, value] of propEntries) {
      writeProperty(key, value, lines, '', refMap);
    }
  }

  // Recurse children
  for (const child of node.children) {
    writeDetails(child, lines, currentPath, resolver, filterBoilerplate, refMap, selectors);
  }
}

/** Build a map from fileID → "GOName:ComponentType" for resolving internal references */
function buildInternalRefMap(
  file: UnityFile,
  resolver?: GuidResolver,
  selectors?: SelectorContext,
  suppliedNestedObjectRefs?: Map<string, NestedSourceObjectRef>,
  nestedSelectorOverrides?: NestedSelectorOverrides
): Map<string, string> {
  const map = new Map<string, string>();
  if (!file.hierarchy) return map;

  // Walk hierarchy to collect all known fileIDs
  collectNodeFileIds(file.hierarchy, map, resolver, '', selectors);

  // Add stripped document entries for nested prefab components
  const piNodeNames = buildPINodeNames(file.hierarchy, resolver);
  const nestedObjectRefs = suppliedNestedObjectRefs ||
    buildNestedSourceObjectRefMap(file.documents, file.hierarchy, resolver);

  for (const doc of file.documents) {
    if (!doc.stripped) continue;
    const piRef = doc.properties.m_PrefabInstance;
    if (!piRef) continue;
    const piFileId = String(piRef.fileID);
    const nodeName = piNodeNames.get(piFileId);
    if (!nodeName) continue;

    const objectRef = nestedObjectRefs.get(doc.fileId);
    if (objectRef) {
      const selectorOverride = nestedSelectorOverrides?.get(doc.fileId);
      if (selectorOverride) {
        map.set(doc.fileId, selectorOverride);
        continue;
      }
      if (objectRef.typeName === 'GameObject') {
        map.set(doc.fileId, objectRef.path);
      } else if (!REF_SKIP_TYPES.has(objectRef.typeName)) {
        map.set(doc.fileId, `${objectRef.path}:${objectRef.typeName}`);
      }
      continue;
    }

    if (map.has(doc.fileId)) continue;

    const typeName = resolveDocumentComponentType(doc, resolver);
    if (REF_SKIP_TYPES.has(typeName)) continue;
    map.set(doc.fileId, `${nodeName}:${typeName}`);
  }

  // Remove ambiguous entries: if multiple fileIDs map to the same refString,
  // the -> path would be ambiguous on read-back. Keep those as raw {fileID}.
  const valueCounts = new Map<string, number>();
  for (const v of map.values()) {
    valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  }
  for (const [fileId, refStr] of [...map.entries()]) {
    if ((valueCounts.get(refStr) || 0) > 1) {
      map.delete(fileId);
    }
  }

  return map;
}

/** Collect fileIDs from hierarchy nodes into a map */
function collectNodeFileIds(
  node: GameObjectNode,
  map: Map<string, string>,
  resolver?: GuidResolver,
  parentPath: string = '',
  selectors?: SelectorContext
): void {
  let name = node.name;
  if (name === 'NestedPrefab' && node.nestedPrefab) {
    name = resolveSourceName(node, resolver) || name;
  }

  const currentPath = selectors?.nodePaths.get(node) || (parentPath ? `${parentPath}/${name}` : name);

  if (node.fileId && node.fileId !== '0') {
    map.set(node.fileId, currentPath);
  }
  if (node.transform.fileId) {
    const ttype = node.transform.isRect ? 'RectTransform' : 'Transform';
    map.set(node.transform.fileId, `${currentPath}:${ttype}`);
  }
  for (const comp of node.components) {
    const compName = selectors?.componentNames.get(comp) || resolveComponentName(comp, resolver);
    map.set(comp.fileId, `${currentPath}:${compName}`);
  }
  for (const child of node.children) {
    collectNodeFileIds(child, map, resolver, currentPath, selectors);
  }
}

/** Keep ambiguous same-path component references in raw {fileID} form. */
function removeAmbiguousRefPaths(map: Map<string, string>): void {
  const counts = new Map<string, number>();
  for (const path of map.values()) counts.set(path, (counts.get(path) || 0) + 1);
  for (const [fileId, path] of [...map]) {
    if ((counts.get(path) || 0) > 1) map.delete(fileId);
  }
}

/** Build PrefabInstance fileId → node path mapping from hierarchy */
function buildPINodeNames(node: GameObjectNode, resolver?: GuidResolver): Map<string, string> {
  const map = new Map<string, string>();
  function collect(n: GameObjectNode, parentPath: string): void {
    let name = n.name;
    if (name === 'NestedPrefab' && n.nestedPrefab) {
      name = resolveSourceName(n, resolver) || name;
    }
    const currentPath = parentPath ? `${parentPath}/${name}` : name;
    if (n.nestedPrefab) {
      map.set(n.nestedPrefab.instanceId, currentPath);
    }
    for (const child of n.children) collect(child, currentPath);
  }
  collect(node, '');
  return map;
}

/** Stripped component ref for a nested prefab instance */
interface StrippedComponentRef {
  typeName: string;
  fileId: string;
  path?: string;
}

/** Path-addressable serialized object from a nested prefab source. */
interface NestedSourceObjectRef {
  typeName: string;
  fileId: string;
  prefabInstanceId: string;
  path: string;
}

/** Build a map from PI instanceId → stripped component refs (excluding Transform/RectTransform/CanvasRenderer/GO) */
function buildStrippedComponentMap(
  file: UnityFile,
  resolver?: GuidResolver,
  nestedObjectRefs: Map<string, NestedSourceObjectRef> =
    buildNestedSourceObjectRefMap(file.documents, file.hierarchy, resolver)
): Map<string, StrippedComponentRef[]> {
  const map = new Map<string, StrippedComponentRef[]>();

  // Map stripped GO fileID → owning PrefabInstance fileID
  const strippedGoToPi = new Map<string, string>();

  for (const doc of file.documents) {
    if (!doc.stripped) continue;

    const piRef = doc.properties.m_PrefabInstance;
    if (!piRef) continue;
    const piFileId = String(piRef.fileID);

    // Track stripped GameObjects for second pass
    if (doc.typeId === 1) {
      strippedGoToPi.set(doc.fileId, piFileId);
    }

    const objectRef = nestedObjectRefs.get(doc.fileId);
    if (objectRef && !REF_SKIP_TYPES.has(objectRef.typeName)) {
      if (!map.has(piFileId)) map.set(piFileId, []);
      map.get(piFileId)!.push({ typeName: objectRef.typeName, fileId: doc.fileId, path: objectRef.path });
      continue;
    }

    const typeName = resolveDocumentComponentType(doc, resolver);
    if (REF_SKIP_TYPES.has(typeName)) continue;
    if (!map.has(piFileId)) map.set(piFileId, []);
    map.get(piFileId)!.push({ typeName, fileId: doc.fileId });
  }

  // Second pass: non-stripped components attached to stripped GameObjects
  // These are components added/overridden on a nested prefab instance's GO
  for (const doc of file.documents) {
    if (doc.stripped) continue;
    if (doc.typeId === 1 || doc.typeId === 1001) continue; // skip GOs and PrefabInstances

    const piRef = doc.properties.m_PrefabInstance;
    if (piRef && String(piRef.fileID) !== '0') continue; // belongs to a PI directly

    const goRef = doc.properties.m_GameObject;
    if (!goRef) continue;
    const goFileId = String(goRef.fileID);

    const owningPiFileId = strippedGoToPi.get(goFileId);
    if (!owningPiFileId) continue;

    const typeName = resolveDocumentComponentType(doc, resolver);
    if (REF_SKIP_TYPES.has(typeName)) continue;

    if (!map.has(owningPiFileId)) map.set(owningPiFileId, []);
    map.get(owningPiFileId)!.push({ typeName, fileId: doc.fileId });
  }

  return map;
}

/** Resolve a UnityDocument's component type, including MonoBehaviour script names when possible. */
function resolveDocumentComponentType(doc: UnityDocument, resolver?: GuidResolver): string {
  if (doc.typeId === 114 && doc.properties.m_Script?.guid) {
    return resolveStrippedScriptName(doc.properties.m_Script.guid, resolver);
  }
  return doc.typeName;
}

/** Load a source prefab by GUID, with a small per-call cache. */
function loadSourceFile(
  guid: string,
  resolver: GuidResolver,
  cache: Map<string, UnityFile | null>
): UnityFile | null {
  if (cache.has(guid)) return cache.get(guid)!;

  const sourcePath = resolver.resolveFilePath(guid);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    cache.set(guid, null);
    return null;
  }

  try {
    const sourceFile = parseUnityYaml(fs.readFileSync(sourcePath, 'utf-8'));
    cache.set(guid, sourceFile);
    return sourceFile;
  } catch {
    cache.set(guid, null);
    return null;
  }
}


/**
 * Resolve every explicitly serialized member of a nested prefab instance to
 * its real source-relative path. This includes root/child GameObjects,
 * transforms, and components, and is deliberately independent of YAML order.
 */
function buildNestedSourceObjectRefMap(
  docs: UnityDocument[],
  hierarchy: GameObjectNode | undefined,
  resolver?: GuidResolver
): Map<string, NestedSourceObjectRef> {
  const result = new Map<string, NestedSourceObjectRef>();
  if (!hierarchy) return result;

  const piNodePaths = buildPINodeNames(hierarchy, resolver);

  // Without a project resolver we cannot recover child paths, but Unity's
  // standard root m_Name override still identifies the source-root GO without
  // relying on document order. Prefer an omitted key to a guessed child key.
  if (!resolver) {
    for (const instanceDoc of docs) {
      if (instanceDoc.typeId !== 1001) continue;
      const instancePath = piNodePaths.get(instanceDoc.fileId);
      if (!instancePath) continue;
      const mods = instanceDoc.properties.m_Modification?.m_Modifications || [];
      const rootNameMod = mods.find((mod: any) => mod.propertyPath === 'm_Name');
      const rootSourceId = String(rootNameMod?.target?.fileID || '');
      if (!rootSourceId) continue;
      const rootStub = docs.find(doc =>
        doc.typeId === 1 && doc.stripped &&
        String(doc.properties.m_PrefabInstance?.fileID) === instanceDoc.fileId &&
        String(doc.properties.m_CorrespondingSourceObject?.fileID) === rootSourceId
      );
      if (!rootStub) continue;
      result.set(rootStub.fileId, {
        typeName: 'GameObject',
        fileId: rootStub.fileId,
        prefabInstanceId: instanceDoc.fileId,
        path: instancePath,
      });
    }
    return result;
  }

  const sourceCache = new Map<string, UnityFile | null>();
  const lookupCache = new Map<string, {
    file: UnityFile;
    docsById: Map<string, UnityDocument>;
    goPaths: Map<string, string>;
  }>();

  for (const doc of docs) {
    if (!doc.stripped) continue;
    const piRef = doc.properties.m_PrefabInstance;
    const sourceRef = doc.properties.m_CorrespondingSourceObject;
    if (!piRef || !sourceRef?.guid || sourceRef.fileID === undefined) continue;

    const piFileId = String(piRef.fileID);
    const instancePath = piNodePaths.get(piFileId);
    if (!instancePath) continue;

    const sourceGuid = String(sourceRef.guid);
    let lookup = lookupCache.get(sourceGuid);
    if (!lookup) {
      const sourceFile = loadSourceFile(sourceGuid, resolver, sourceCache);
      if (!sourceFile?.hierarchy) continue;
      const goPaths = new Map<string, string>();
      collectGoPaths(sourceFile.hierarchy, '', goPaths);
      lookup = {
        file: sourceFile,
        docsById: new Map(sourceFile.documents.map(candidate => [candidate.fileId, candidate])),
        goPaths,
      };
      lookupCache.set(sourceGuid, lookup);
    }

    const sourceFile = lookup.file;
    const sourceDoc = lookup.docsById.get(String(sourceRef.fileID));
    if (!sourceDoc || sourceDoc.stripped) continue;

    const sourceGoId = sourceDoc.typeId === 1
      ? sourceDoc.fileId
      : String(sourceDoc.properties.m_GameObject?.fileID || '');
    const sourceGoPath = lookup.goPaths.get(sourceGoId);
    if (!sourceGoPath) continue;

    const sourceRootPath = sourceFile.hierarchy!.name;
    const relativePath = sourceGoPath === sourceRootPath
      ? ''
      : sourceGoPath.startsWith(`${sourceRootPath}/`)
        ? sourceGoPath.substring(sourceRootPath.length + 1)
        : sourceGoPath;
    const resolvedPath = relativePath ? `${instancePath}/${relativePath}` : instancePath;

    result.set(doc.fileId, {
      typeName: sourceDoc.typeId === 1
        ? 'GameObject'
        : resolveDocumentComponentType(sourceDoc, resolver),
      fileId: doc.fileId,
      prefabInstanceId: piFileId,
      path: resolvedPath,
    });
  }

  return result;
}

/** Resolve a script GUID to a class name, with fallback to MonoBehaviour_<guid8> */
function resolveStrippedScriptName(guid: string, resolver?: GuidResolver): string {
  if (resolver) {
    const name = resolver.resolve(guid);
    if (name) return name;
  }
  return `MonoBehaviour_${guid.substring(0, 8)}`;
}

/** Write the REFS section mapping paths to fileIDs */
function writeRefsSection(
  node: GameObjectNode,
  lines: string[],
  resolver?: GuidResolver,
  strippedMap?: Map<string, StrippedComponentRef[]>,
  nestedObjectRefs?: Map<string, NestedSourceObjectRef>,
  selectors?: SelectorContext,
  nestedSelectorOverrides?: NestedSelectorOverrides
): void {
  const start = lines.length;
  writeNodeRefs(
    node, lines, resolver, strippedMap, nestedObjectRefs, '', selectors,
    nestedSelectorOverrides
  );

  if (nestedObjectRefs) {
    const existing = new Set(lines.slice(start));
    for (const ref of nestedObjectRefs.values()) {
      if (ref.typeName !== 'GameObject' && ref.typeName !== 'Transform' && ref.typeName !== 'RectTransform') continue;
      const key = nestedSelectorOverrides?.get(ref.fileId) ||
        (ref.typeName === 'GameObject' ? ref.path : `${ref.path}:${ref.typeName}`);
      const line = `${key} = ${ref.fileId}`;
      if (!existing.has(line)) {
        lines.push(line);
        existing.add(line);
      }
    }
  }
}

/** Write refs entries for a single node and its descendants */
function writeNodeRefs(
  node: GameObjectNode,
  lines: string[],
  resolver?: GuidResolver,
  strippedMap?: Map<string, StrippedComponentRef[]>,
  nestedObjectRefs?: Map<string, NestedSourceObjectRef>,
  parentPath: string = '',
  selectors?: SelectorContext,
  nestedSelectorOverrides?: NestedSelectorOverrides
): void {
  let name = node.name;
  // Resolve 'NestedPrefab' default to source name
  if (name === 'NestedPrefab' && node.nestedPrefab) {
    const resolved = resolveSourceName(node, resolver);
    if (resolved) name = resolved;
  }

  const currentPath = selectors?.nodePaths.get(node) || (parentPath ? `${parentPath}/${name}` : name);

  // GO fileId
  const nestedRefs = node.nestedPrefab && nestedObjectRefs
    ? [...nestedObjectRefs.values()].filter(ref =>
        ref.prefabInstanceId === node.nestedPrefab!.instanceId && ref.path === currentPath
      )
    : [];
  const nestedGoRef = nestedRefs.find(ref => ref.typeName === 'GameObject');
  if (nestedGoRef) {
    lines.push(`${currentPath} = ${nestedGoRef.fileId}`);
  } else if (!node.nestedPrefab && node.fileId && node.fileId !== '0') {
    lines.push(`${currentPath} = ${node.fileId}`);
  }

  // Transform fileId
  const transformTypeName = node.transform.isRect ? 'RectTransform' : 'Transform';
  const nestedTransformRef = nestedRefs.find(ref => ref.typeName === transformTypeName);
  if (nestedTransformRef) {
    lines.push(`${currentPath}:${transformTypeName} = ${nestedTransformRef.fileId}`);
  } else if (node.transform.fileId) {
    const typeName = node.transform.isRect ? 'RectTransform' : 'Transform';
    lines.push(`${currentPath}:${typeName} = ${node.transform.fileId}`);
  }

  // Component fileIds
  for (const comp of node.components) {
    if (OMIT_COMPONENTS.has(comp.typeName)) continue;
    const compName = selectors?.componentNames.get(comp) || resolveComponentName(comp, resolver);
    lines.push(`${currentPath}:${compName} = ${comp.fileId}`);
  }

  // Stripped component refs from nested prefab (grouped with parent GO)
  if (node.nestedPrefab && strippedMap) {
    const strippedRefs = strippedMap.get(node.nestedPrefab.instanceId) || [];
    for (const ref of strippedRefs) {
      const key = nestedSelectorOverrides?.get(ref.fileId) ||
        `${ref.path || currentPath}:${ref.typeName}`;
      lines.push(`${key} = ${ref.fileId}`);
    }
  }

  // Nested prefab instance
  if (node.nestedPrefab) {
    lines.push(`${currentPath}:__instance = ${node.nestedPrefab.instanceId}`);
  }

  // Recurse children
  for (const child of node.children) {
    writeNodeRefs(
      child, lines, resolver, strippedMap, nestedObjectRefs, currentPath,
      selectors, nestedSelectorOverrides
    );
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
function writeProperty(key: string, value: any, lines: string[], indent: string, refMap?: Map<string, string>): void {
  if (value === null || value === undefined) {
    lines.push(`${indent}${key} = null`);
    return;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    // Check if it's a file reference
    if ('fileID' in value) {
      lines.push(`${indent}${key} = ${formatReference(value, refMap)}`);
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
      writeProperty(k, v, lines, indent + '  ', refMap);
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
      const refs = value.map((v: any) => formatReference(v, refMap));
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
          lines.push(`${indent}  - ${formatReference(item, refMap)}`);
        } else {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            if (isNestedObject(firstVal)) {
              // Nested object value → block format
              lines.push(`${indent}  - ${firstKey}:`);
              for (const [k, v] of Object.entries(firstVal as Record<string, any>)) {
                writeProperty(k, v, lines, indent + '      ', refMap);
              }
            } else {
              lines.push(`${indent}  - ${firstKey} = ${formatValue(firstVal, refMap)}`);
            }
            for (let i = 1; i < entries.length; i++) {
              writeProperty(entries[i][0], entries[i][1], lines, indent + '    ', refMap);
            }
          }
        }
      } else {
        lines.push(`${indent}  - ${formatValue(item, refMap)}`);
      }
    }
    return;
  }

  // Simple value
  lines.push(`${indent}${key} = ${value}`);
}

/** Format a value inline */
function formatValue(value: any, refMap?: Map<string, string>): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && !Array.isArray(value)) {
    if ('fileID' in value) return formatReference(value, refMap);
    if (isVector(value)) return formatVector(value);
    // Nested object — serialize as inline brace notation to avoid [object Object]
    const entries = Object.entries(value);
    const parts = entries.map(([k, v]) => `${k}: ${formatValue(v, refMap)}`);
    return `{${parts.join(', ')}}`;
  }
  if (Array.isArray(value)) return `[${value.map(v => formatValue(v, refMap)).join(', ')}]`;
  return String(value);
}

/** Format a file reference */
function formatReference(ref: any, refMap?: Map<string, string>): string {
  if (!ref) return 'null';
  if (String(ref.fileID) === '0') return '{0}';
  if (ref.guid) {
    const type = ref.type !== undefined && ref.type !== 3 ? `, ${ref.type}` : '';
    return `{${ref.fileID}, ${ref.guid}${type}}`;
  }
  // Internal reference — try to resolve to ->GOPath:Component format
  if (refMap) {
    const resolved = refMap.get(String(ref.fileID));
    if (resolved) return `->${resolved}`;
  }
  return `{${ref.fileID}}`;
}

/** Check if a value is a null reference */
function isNullRef(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'object' && 'fileID' in value && String(value.fileID) === '0') return true;
  return false;
}

/** Check if a value is a nested object (not ref, not vector, not array) */
function isNestedObject(val: any): boolean {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
    && !('fileID' in val) && !isVector(val);
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
  /** Asset GUID that owns the corresponding source object. */
  sourceGuid: string;
  goName: string;   // Name of the owning GO
  goPath: string;   // Full path of the owning GO when a hierarchy is available
  goFileId: string;  // FileID of the owning GO
}

interface ResolvedBaseChain {
  /** GUID of the ultimate concrete base prefab. */
  guid: string;
  file: UnityFile;
  inheritedModifiedTargets: Set<string>;
  /** Intermediate variants ordered from the concrete base toward the leaf. */
  variantLayers: { guid: string; file: UnityFile }[];
  /** GUID aliases by which descendants may refer to concrete-base objects. */
  sourceAliases: string[];
}

/** Follow variant-of-variant sources until a concrete hierarchy is found. */
function resolveBaseChain(
  guid: string,
  resolver: GuidResolver,
  visited: Set<string> = new Set()
): ResolvedBaseChain | null {
  if (!guid || visited.has(guid)) return null;
  visited.add(guid);

  const sourcePath = resolver.resolveFilePath(guid);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  try {
    const file = parseUnityYaml(fs.readFileSync(sourcePath, 'utf-8'));
    if (file.type !== 'variant') {
      return {
        guid,
        file,
        inheritedModifiedTargets: new Set(),
        variantLayers: [],
        sourceAliases: [guid],
      };
    }

    const mainInstance = file.prefabInstances.find(instance =>
      String(instance.transformParent.fileID) === '0'
    );
    const parentGuid = mainInstance?.sourcePrefab.guid;
    if (!mainInstance || !parentGuid) return null;

    const parent = resolveBaseChain(parentGuid, resolver, visited);
    if (!parent) return null;
    for (const modification of mainInstance.modifications) {
      parent.inheritedModifiedTargets.add(String(modification.target.fileID));
    }
    parent.variantLayers.push({ guid, file });
    parent.sourceAliases.push(guid);
    return parent;
  } catch {
    return null;
  }
}

/**
 * Build a map from base prefab fileID → document info.
 * This allows us to resolve variant modification targets to readable paths.
 * Also includes stripped docs (nested prefab objects with explicit entries).
 */
function buildBaseDocMap(
  baseDocs: UnityDocument[],
  resolver?: GuidResolver,
  baseHierarchy?: GameObjectNode,
  defaultSourceGuid: string = ''
): Map<string, BaseDocInfo> {
  const map = new Map<string, BaseDocInfo>();
  const goPaths = new Map<string, string>();
  if (baseHierarchy) collectGoPaths(baseHierarchy, '', goPaths);

  // Build PI fileID → nested prefab node name mapping from hierarchy
  const piNodeNames = new Map<string, string>();
  if (baseHierarchy) {
    collectNestedNodeNames(baseHierarchy, piNodeNames, resolver);
  }
  const nestedObjectRefs = buildNestedSourceObjectRefMap(baseDocs, baseHierarchy, resolver);

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
      sourceGuid: defaultSourceGuid,
      goName: doc.typeId === 1 ? (doc.properties.m_Name || 'Unnamed') : goName,
      goPath: doc.typeId === 1
        ? (goPaths.get(doc.fileId) || doc.properties.m_Name || 'Unnamed')
        : (goPaths.get(goId) || goName),
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
    const objectRef = nestedObjectRefs.get(doc.fileId);
    const nodeName = objectRef?.path || piNodeNames.get(piFileId) || '';

    const typeName = objectRef?.typeName || resolveDocumentComponentType(doc, resolver);

    map.set(doc.fileId, {
      fileId: doc.fileId,
      typeId: doc.typeId,
      typeName,
      sourceGuid: doc.properties.m_CorrespondingSourceObject?.guid || defaultSourceGuid,
      goName: nodeName,
      goPath: nodeName,
      goFileId: '',
    });
  }

  return map;
}

/** Collect nested prefab node names: PI instanceId → node name (resolves 'NestedPrefab' defaults) */
function collectNestedNodeNames(node: GameObjectNode, map: Map<string, string>, resolver?: GuidResolver): void {
  if (node.nestedPrefab) {
    let name = node.name;
    if (name === 'NestedPrefab' && node.nestedPrefab.sourceGuid) {
      name = node.nestedPrefab.sourceName ||
        (resolver ? resolver.resolve(node.nestedPrefab.sourceGuid) : undefined) ||
        name;
    }
    map.set(node.nestedPrefab.instanceId, name);
  }
  for (const child of node.children) {
    collectNestedNodeNames(child, map, resolver);
  }
}

/** Collect source-local GO paths keyed by GO fileID. */
function collectGoPaths(node: GameObjectNode, parentPath: string, map: Map<string, string>): void {
  const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  map.set(node.fileId, currentPath);
  for (const child of node.children) {
    collectGoPaths(child, currentPath, map);
  }
}

/** Join compact paths while avoiding duplicate source root names. */
function joinCompactPath(parentPath: string, childPath: string): string {
  if (!parentPath) return childPath;
  const slashIdx = childPath.indexOf('/');
  if (slashIdx < 0) return parentPath;
  return `${parentPath}/${childPath.slice(slashIdx + 1)}`;
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

/** Entry representing a component reachable through the nested prefab chain */
interface SourceObjectEntry {
  path: string;           // e.g., "_Header_Text" or "small circle/Circle_Image"
  componentType: string;  // e.g., "Image", "TextMeshProUGUI"
  baseModPropPaths: Set<string>; // property paths from base PI modifications
}

/**
 * Resolve unresolved variant targets by recursively traversing nested prefab
 * hierarchies. Returns a map: targetFileId → resolved GOPath:ComponentType key.
 */
function resolveNestedTargets(
  unresolvedTargets: Map<string, PropertyModification[]>,
  baseHierarchy: GameObjectNode,
  basePrefabInstances: PrefabInstanceInfo[],
  resolver: GuidResolver
): Map<string, string> {
  const resolved = new Map<string, string>();

  // Build PI → node name mapping (with source name resolution)
  const piNodeNames = new Map<string, string>();
  collectNestedNodeNames(baseHierarchy, piNodeNames, resolver);

  // Build comprehensive component inventory from all nested prefab chains
  const allEntries: SourceObjectEntry[] = [];

  for (const pi of basePrefabInstances) {
    const nodeName = piNodeNames.get(pi.fileId);
    if (!nodeName) continue;

    const sourceGuid = pi.sourcePrefab.guid;
    if (!sourceGuid) continue;

    collectSourceEntries(nodeName, sourceGuid, pi.modifications, resolver, allEntries, 0);
  }

  // Group unresolved targets by inferred component type for assignment-based matching
  const targetsByType = new Map<string, [string, PropertyModification[]][]>();
  for (const [targetId, mods] of unresolvedTargets) {
    const compType = inferComponentType(mods.map(m => m.propertyPath));
    if (!compType) continue;
    if (!targetsByType.has(compType)) targetsByType.set(compType, []);
    targetsByType.get(compType)!.push([targetId, mods]);
  }

  // For each component type, match targets to candidates (each candidate used at most once)
  for (const [compType, targets] of targetsByType) {
    const candidates = allEntries.filter(e => e.componentType === compType);
    if (candidates.length === 0) continue;

    const usedCandidates = new Set<number>();

    for (const [targetId, mods] of targets) {
      const variantPaths = mods.map(m => m.propertyPath);
      let bestIdx = -1;
      let bestOverlap = -1;

      for (let i = 0; i < candidates.length; i++) {
        if (usedCandidates.has(i)) continue;
        let overlap = 0;
        for (const p of variantPaths) {
          if (candidates[i].baseModPropPaths.has(p)) overlap++;
        }
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        resolved.set(targetId, `${candidates[bestIdx].path}:${compType}`);
        usedCandidates.add(bestIdx);
      }
    }
  }

  return resolved;
}

/**
 * Recursively collect source component entries from a nested prefab chain.
 * For each source object reachable through the PI chain, records its path,
 * component type, and base modification property paths (for disambiguation).
 */
function collectSourceEntries(
  parentPath: string,
  sourceGuid: string,
  piMods: PropertyModification[],
  resolver: GuidResolver,
  result: SourceObjectEntry[],
  depth: number
): void {
  if (depth > 3) return;

  const sourcePath = resolver.resolveFilePath(sourceGuid);
  if (!sourcePath || !fs.existsSync(sourcePath)) return;

  try {
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const sourceFile = parseUnityYaml(sourceContent);

    // Build GO name map: goFileId → name
    const goNames = new Map<string, string>();
    for (const doc of sourceFile.documents) {
      if (doc.typeId === 1 && !doc.stripped) {
        goNames.set(doc.fileId, doc.properties.m_Name || 'Unnamed');
      }
    }

    const goPaths = new Map<string, string>();
    if (sourceFile.hierarchy) {
      collectGoPaths(sourceFile.hierarchy, '', goPaths);
    }

    // Build source doc info: sourceFileId → { goName, componentType }
    const sourceDocInfo = new Map<string, { goName: string; goPath: string; componentType: string }>();
    for (const doc of sourceFile.documents) {
      if (doc.stripped) continue;
      const goRef = doc.properties.m_GameObject ? String(doc.properties.m_GameObject.fileID) : '';
      const goName = goNames.get(goRef) || goNames.get(doc.fileId) || '';
      const goPath = goPaths.get(goRef || doc.fileId) || goName;
      let typeName = doc.typeName;
      if (doc.typeId === 114 && doc.properties.m_Script?.guid) {
        typeName = resolver.resolve(doc.properties.m_Script.guid) || typeName;
      }
      sourceDocInfo.set(doc.fileId, { goName, goPath, componentType: typeName });
    }

    // Count how many times each component type appears (for disambiguation)
    const typeCount = new Map<string, number>();
    const skipTypes = new Set(['GameObject', 'Transform', 'RectTransform', 'CanvasRenderer']);
    for (const [, info] of sourceDocInfo) {
      if (skipTypes.has(info.componentType)) continue;
      typeCount.set(info.componentType, (typeCount.get(info.componentType) || 0) + 1);
    }
    // Also count component types from sub-PIs (they contribute to disambiguation)
    if (sourceFile.hierarchy) {
      countNestedComponentTypes(sourceFile.hierarchy, sourceFile.prefabInstances, resolver, typeCount);
    }

    // Group PI modifications by target fileId
    const modsByTarget = new Map<string, Set<string>>();
    for (const mod of piMods) {
      const id = String(mod.target.fileID);
      if (!modsByTarget.has(id)) modsByTarget.set(id, new Set());
      modsByTarget.get(id)!.add(mod.propertyPath);
    }

    // Build stripped doc → sub-PI mapping
    const strippedToPI = new Map<string, string>();
    for (const doc of sourceFile.documents) {
      if (doc.stripped && doc.properties.m_PrefabInstance) {
        strippedToPI.set(doc.fileId, String(doc.properties.m_PrefabInstance.fileID));
      }
    }

    // Sub-PI node names
    const subPiNodeNames = new Map<string, string>();
    if (sourceFile.hierarchy) {
      collectNestedNodeNames(sourceFile.hierarchy, subPiNodeNames, resolver);
    }

    // Process each PI modification target
    const processedSubPIs = new Set<string>();

    for (const [targetId, propPaths] of modsByTarget) {
      const docInfo = sourceDocInfo.get(targetId);
      if (docInfo) {
        // Direct source doc — use GO name if disambiguation needed
        const needsDisambig = (typeCount.get(docInfo.componentType) || 0) > 1;
        const path = needsDisambig ? joinCompactPath(parentPath, docInfo.goPath) : parentPath;
        result.push({ path, componentType: docInfo.componentType, baseModPropPaths: propPaths });
      } else {
        // Check if it's a stripped doc → recurse into sub-PI
        const subPiId = strippedToPI.get(targetId);
        if (subPiId && !processedSubPIs.has(subPiId)) {
          processedSubPIs.add(subPiId);
          const subPi = sourceFile.prefabInstances.find(p => p.fileId === subPiId);
          if (subPi && subPi.sourcePrefab.guid) {
            const subName = subPiNodeNames.get(subPiId) ||
              resolver.resolve(subPi.sourcePrefab.guid) || 'unknown';
            collectSourceEntries(
              `${parentPath}/${subName}`, subPi.sourcePrefab.guid,
              subPi.modifications, resolver, result, depth + 1
            );
          }
        } else if (!subPiId) {
          // Computed deep fileID — not a stripped doc in source.
          // Infer component type and record with parent path.
          const compType = inferComponentType([...propPaths]);
          if (compType) {
            result.push({ path: parentPath, componentType: compType, baseModPropPaths: propPaths });
          }
        }
      }
    }

    for (const [sourceId, docInfo] of sourceDocInfo) {
      if (modsByTarget.has(sourceId)) continue;
      if (skipTypes.has(docInfo.componentType)) continue;
      result.push({
        path: joinCompactPath(parentPath, docInfo.goPath),
        componentType: docInfo.componentType,
        baseModPropPaths: new Set(),
      });
    }

    // Process sub-PIs that weren't reached via stripped doc resolution
    for (const subPi of sourceFile.prefabInstances) {
      if (processedSubPIs.has(subPi.fileId)) continue;
      processedSubPIs.add(subPi.fileId);

      if (!subPi.sourcePrefab.guid) continue;
      const subName = subPiNodeNames.get(subPi.fileId) ||
        resolver.resolve(subPi.sourcePrefab.guid) || null;
      if (!subName) continue;

      collectSourceEntries(
        `${parentPath}/${subName}`, subPi.sourcePrefab.guid,
        subPi.modifications, resolver, result, depth + 1
      );
    }
  } catch {
    // Failed to parse source — skip
  }
}

/** Count component types in nested prefab sub-PIs (for disambiguation decisions) */
function countNestedComponentTypes(
  hierarchy: GameObjectNode,
  prefabInstances: PrefabInstanceInfo[],
  resolver: GuidResolver,
  typeCount: Map<string, number>
): void {
  const skipTypes = new Set(['GameObject', 'Transform', 'RectTransform', 'CanvasRenderer']);
  function walkNode(node: GameObjectNode): void {
    if (node.nestedPrefab) {
      // Try to load and count components from source
      const sourceGuid = node.nestedPrefab.sourceGuid;
      if (sourceGuid) {
        const sourcePath = resolver.resolveFilePath(sourceGuid);
        if (sourcePath && fs.existsSync(sourcePath)) {
          try {
            const sourceFile = parseUnityYaml(fs.readFileSync(sourcePath, 'utf-8'));
            for (const doc of sourceFile.documents) {
              if (doc.stripped) continue;
              let typeName = doc.typeName;
              if (doc.typeId === 114 && doc.properties.m_Script?.guid) {
                typeName = resolver.resolve(doc.properties.m_Script.guid) || typeName;
              }
              if (!skipTypes.has(typeName)) {
                typeCount.set(typeName, (typeCount.get(typeName) || 0) + 1);
              }
            }
          } catch { /* skip */ }
        }
      }
    }
    for (const child of node.children) {
      walkNode(child);
    }
  }
  for (const child of hierarchy.children) {
    walkNode(child);
  }
}

/** Resolve a target fileID to a GOPath:ComponentType key using the base doc map */
function resolveTargetKey(targetFileId: string, baseMap: Map<string, BaseDocInfo>): string | null {
  const info = baseMap.get(targetFileId);
  if (!info) return null;

  if (info.typeId === 1) {
    return info.goName;
  }

  if (info.typeId === 4 || info.typeId === 224) {
    // Transform/RectTransform
    return `${info.goName}:${info.typeName}`;
  }

  // Component
  return `${info.goName}:${info.typeName}`;
}

/** Resolve a base target with its full hierarchy path for unambiguous REFS. */
function resolveTargetPathKey(info: BaseDocInfo): string {
  const goPath = info.goPath || info.goName;
  return info.typeId === 1 ? goPath : `${goPath}:${info.typeName}`;
}

interface ResolvedAddedComponent {
  instanceId: string;
  sourceGuid: string;
  targetFileId: string;
  goPath: string;
  componentName: string;
  document: UnityDocument;
}

/** Resolve serialized m_AddedComponents entries to their real local documents. */
function resolveAddedComponents(
  file: UnityFile,
  mainInstance: PrefabInstanceInfo | undefined,
  mainSourceMap: Map<string, BaseDocInfo> | null,
  resolver?: GuidResolver
): ResolvedAddedComponent[] {
  const docById = new Map(file.documents.map(doc => [doc.fileId, doc]));
  const result: ResolvedAddedComponent[] = [];

  for (const instance of file.prefabInstances) {
    const sourceMap = mainInstance && instance.fileId === mainInstance.fileId
      ? mainSourceMap
      : buildSourcePrefabMap(instance, resolver);

    for (const added of instance.addedComponents) {
      const componentId = String(added.addedComponent.fileID);
      const targetId = String(added.targetGameObject.fileID);
      const document = docById.get(componentId);
      if (!document || document.stripped || document.typeId === 1 || document.typeId === 1001) continue;

      const targetInfo = sourceMap?.get(targetId);
      const goPath = targetInfo?.goPath || targetInfo?.goName || `&${targetId}`;
      result.push({
        instanceId: instance.fileId,
        sourceGuid: instance.sourcePrefab.guid || '',
        targetFileId: targetId,
        goPath,
        componentName: resolveDocumentComponentType(document, resolver),
        document,
      });
    }
  }

  return result;
}

interface AddedComponentOverlay {
  byInstance: Map<string, string[]>;
  byUniqueSource: Map<string, string[]>;
}

function buildAddedComponentOverlay(
  components: ResolvedAddedComponent[],
  instances: PrefabInstanceInfo[]
): AddedComponentOverlay {
  const byInstance = new Map<string, string[]>();
  const sourceGroups = new Map<string, ResolvedAddedComponent[]>();
  for (const component of components) {
    const instanceKey = `${component.instanceId}:${component.targetFileId}`;
    if (!byInstance.has(instanceKey)) byInstance.set(instanceKey, []);
    byInstance.get(instanceKey)!.push(`+${component.componentName}`);

    const sourceKey = `${component.sourceGuid}:${component.targetFileId}`;
    if (!sourceGroups.has(sourceKey)) sourceGroups.set(sourceKey, []);
    sourceGroups.get(sourceKey)!.push(component);
  }

  const byUniqueSource = new Map<string, string[]>();
  const sourceInstanceCounts = new Map<string, Set<string>>();
  for (const instance of instances) {
    const guid = instance.sourcePrefab.guid || '';
    if (!sourceInstanceCounts.has(guid)) sourceInstanceCounts.set(guid, new Set());
    sourceInstanceCounts.get(guid)!.add(instance.fileId);
  }
  for (const [key, group] of sourceGroups) {
    const sourceGuid = key.slice(0, key.indexOf(':'));
    if ((sourceInstanceCounts.get(sourceGuid)?.size || 0) === 1) {
      byUniqueSource.set(key, group.map(component => `+${component.componentName}`));
    }
  }
  return { byInstance, byUniqueSource };
}

interface VariantRemovalOverlay {
  components: Map<string, string[]>;
  gameObjects: Set<string>;
}

function mergeRemovalOverlays(overlays: VariantRemovalOverlay[]): VariantRemovalOverlay {
  const components = new Map<string, string[]>();
  const gameObjects = new Set<string>();
  for (const overlay of overlays) {
    for (const [key, values] of overlay.components) {
      if (!components.has(key)) components.set(key, []);
      components.get(key)!.push(...values);
    }
    for (const key of overlay.gameObjects) gameObjects.add(key);
  }
  return { components, gameObjects };
}

function sourceAliasList(sourceGuid: string | string[]): string[] {
  return Array.isArray(sourceGuid) ? sourceGuid : [sourceGuid];
}

function buildVariantRemovalOverlay(
  file: UnityFile,
  mainInstance: PrefabInstanceInfo | undefined,
  mainSourceMap: Map<string, BaseDocInfo> | null,
  resolver?: GuidResolver
): VariantRemovalOverlay {
  const components = new Map<string, string[]>();
  const gameObjects = new Set<string>();

  for (const instance of file.prefabInstances) {
    const sourceGuid = instance.sourcePrefab.guid || '';
    const sourceMap = mainInstance && instance.fileId === mainInstance.fileId
      ? mainSourceMap
      : buildSourcePrefabMap(instance, resolver);

    for (const removed of instance.removedComponents) {
      const info = sourceMap?.get(String(removed.fileID));
      if (!info || !info.goFileId) continue;
      const key = `${sourceGuid}:${info.goFileId}`;
      if (!components.has(key)) components.set(key, []);
      components.get(key)!.push(`-${info.typeName}`);
    }

    for (const removed of instance.removedGameObjects) {
      const info = sourceMap?.get(String(removed.fileID));
      if (!info) continue;
      const goFileId = info.typeId === 1 ? info.fileId : info.goFileId;
      if (goFileId) gameObjects.add(`${sourceGuid}:${goFileId}`);
    }
  }

  return { components, gameObjects };
}

function appendAddedComponentNames(
  names: string[],
  instanceId: string,
  sourceGuid: string | string[],
  targetFileId: string,
  overlay?: AddedComponentOverlay
): string[] {
  const exact = overlay?.byInstance.get(`${instanceId}:${targetFileId}`) || [];
  const inherited = sourceAliasList(sourceGuid).flatMap(guid =>
    overlay?.byUniqueSource.get(`${guid}:${targetFileId}`) || []
  );
  return names.concat(exact, inherited.filter(name => !exact.includes(name)));
}

function appendRemovedComponentNames(
  names: string[],
  sourceGuid: string | string[],
  targetFileId: string,
  overlay?: VariantRemovalOverlay
): string[] {
  const removed = sourceAliasList(sourceGuid).flatMap(guid =>
    overlay?.components.get(`${guid}:${targetFileId}`) || []
  );
  const removedTypes = new Set(removed.map(name => name.substring(1)));
  const kept = names.filter(name =>
    !removedTypes.has(name.replace(/^\+/, '').replace(/\*$/, ''))
  );
  return kept.concat(removed);
}

function variantNodeName(
  name: string,
  sourceGuid: string | string[],
  fileId: string,
  overlay?: VariantRemovalOverlay
): string {
  return sourceAliasList(sourceGuid).some(guid =>
    overlay?.gameObjects.has(`${guid}:${fileId}`)
  ) ? `-${name}` : name;
}

function writeAddedComponentDetails(
  components: ResolvedAddedComponent[],
  lines: string[],
  refMap: Map<string, string>
): void {
  for (const component of components) {
    const entries = Object.entries(component.document.properties).filter(([key, value]) => {
      if (OMIT_FIELDS.has(key) || COMPACT_OMIT_FIELDS.has(key)) return false;
      if (key === 'm_Material' && isNullRef(value)) return false;
      return true;
    });
    if (entries.length === 0) continue;

    lines.push('');
    lines.push(`[+ ${component.goPath}:${component.componentName}]`);
    for (const [key, value] of entries) {
      writeProperty(key, value, lines, '', refMap);
    }
  }
}

function writeAddedComponentRefs(
  components: ResolvedAddedComponent[],
  lines: string[]
): void {
  for (const component of components) {
    const key = `${component.goPath}:${component.componentName}`;
    lines.push(`${key} = ${component.document.fileId}`);
    lines.push(`${key}:__instance = ${component.instanceId}`);
  }
}

interface LayerAddedObject {
  node: GameObjectNode;
  /** GUID used by descendant variants to refer to this added object. */
  originGuid: string;
}

type AddedObjectsMap = Map<string, LayerAddedObject[]>;

function collectAddedObjects(
  file: UnityFile,
  originGuid: string,
  concreteBaseHierarchy: GameObjectNode | undefined,
  result: AddedObjectsMap
): void {
  if (!file.hierarchy) return;
  const mainInstance = file.prefabInstances.find(instance =>
    String(instance.transformParent.fileID) === '0'
  );
  const parentGuid = mainInstance?.sourcePrefab.guid || '';
  const roots = file.hierarchy.name === '__added_root__'
    ? file.hierarchy.children
    : [file.hierarchy];
  const docById = new Map(file.documents.map(doc => [doc.fileId, doc]));

  for (const root of roots) {
    const transformDoc = file.documents.find(doc =>
      !doc.stripped && (doc.typeId === 4 || doc.typeId === 224) &&
      String(doc.properties.m_GameObject?.fileID) === root.fileId
    );
    if (!transformDoc) continue;

    const fatherId = String(transformDoc.properties.m_Father?.fileID || '0');
    const strippedParent = docById.get(fatherId);
    let targetGuid = parentGuid;
    let targetTransformId = '';
    if (fatherId === '0') {
      targetTransformId = concreteBaseHierarchy?.transform.fileId || '';
    } else if (strippedParent?.stripped) {
      const sourceRef = strippedParent.properties.m_CorrespondingSourceObject;
      targetGuid = sourceRef?.guid || parentGuid;
      targetTransformId = String(sourceRef?.fileID || '');
    }
    if (!targetTransformId) continue;

    const key = `${targetGuid}:${targetTransformId}`;
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push({ node: root, originGuid });
  }
}

function findAddedObjects(
  map: AddedObjectsMap | undefined,
  sourceGuids: string | string[],
  transformId: string
): LayerAddedObject[] {
  if (!map) return [];
  return sourceAliasList(sourceGuids).flatMap(guid => map.get(`${guid}:${transformId}`) || []);
}

/** Write variant compact format with resolved paths */
function writeVariantCompact(
  file: UnityFile,
  lines: string[],
  resolver?: GuidResolver,
  version: 1 | 2 = 1
): string {
  const mainInstance = file.prefabInstances.find(pi =>
    String(pi.transformParent.fileID) === '0'
  );

  if (!mainInstance) {
    return finishCompact(lines, version);
  }

  const baseGuid = mainInstance.sourcePrefab.guid || '';
  const localSelectorCandidate = version === 2 && file.hierarchy
    ? buildSelectorContext(file.hierarchy, resolver)
    : undefined;
  const localSelectors = localSelectorCandidate?.hasAliases
    ? localSelectorCandidate
    : undefined;

  // Try to load and parse the base prefab for full resolution
  let baseMap: Map<string, BaseDocInfo> | null = null;
  let baseHierarchy: GameObjectNode | undefined;
  let basePrefabInstances: PrefabInstanceInfo[] = [];
  let nestedResolved: Map<string, string> | null = null;
  const inheritedModifiedTargets = new Set<string>();
  let inheritedVariantLayers: { guid: string; file: UnityFile }[] = [];
  let baseSourceAliases: string[] = [baseGuid];
  let baseSelectors: SelectorContext | undefined;

  if (resolver && baseGuid) {
    const resolvedBase = resolveBaseChain(baseGuid, resolver);
    if (resolvedBase) {
      try {
        const baseFile = resolvedBase.file;
        for (const target of resolvedBase.inheritedModifiedTargets) {
          inheritedModifiedTargets.add(target);
        }
        inheritedVariantLayers = resolvedBase.variantLayers;
        baseSourceAliases = resolvedBase.sourceAliases;
        baseHierarchy = baseFile.hierarchy;
        basePrefabInstances = baseFile.prefabInstances;
        baseMap = buildBaseDocMap(
          baseFile.documents, resolver, baseHierarchy, resolvedBase.guid
        );
        if (version === 2 && baseHierarchy) {
          baseSelectors = buildSelectorContext(baseHierarchy, resolver);
          if (baseSelectors.hasAliases) {
            applySelectorsToBaseMap(baseMap, baseHierarchy, baseSelectors);
          } else {
            baseSelectors = undefined;
          }
        }

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
  for (const target of inheritedModifiedTargets) modifiedTargets.add(target);
  for (const mod of mainInstance.modifications) {
    modifiedTargets.add(String(mod.target.fileID));
  }

  const structuralEntries: { file: UnityFile; sourceMap: Map<string, BaseDocInfo> | null }[] = [];
  let compositeSourceMap = baseMap ? new Map(baseMap) : null;
  for (const layer of inheritedVariantLayers) {
    structuralEntries.push({ file: layer.file, sourceMap: compositeSourceMap });
    const layerMap = buildBaseDocMap(
      layer.file.documents, resolver, layer.file.hierarchy, layer.guid
    );
    // Rebind locally serialized added components to their inherited target GO.
    // Descendant variants remove these by the component's local fileID under
    // the middle variant GUID, while the visible node still comes from a parent.
    for (const instance of layer.file.prefabInstances) {
      for (const added of instance.addedComponents) {
        const componentId = String(added.addedComponent.fileID);
        const targetId = String(added.targetGameObject.fileID);
        const componentInfo = layerMap.get(componentId);
        const targetInfo = compositeSourceMap?.get(targetId);
        if (!componentInfo || !targetInfo) continue;
        layerMap.set(componentId, {
          ...componentInfo,
          goName: targetInfo.goName,
          goPath: targetInfo.goPath,
          goFileId: targetInfo.typeId === 1 ? targetInfo.fileId : targetInfo.goFileId,
        });
      }
    }
    if (!compositeSourceMap) compositeSourceMap = new Map();
    for (const [id, info] of layerMap) compositeSourceMap.set(id, info);
  }
  structuralEntries.push({ file, sourceMap: compositeSourceMap });

  const allInstances = structuralEntries.flatMap(entry => entry.file.prefabInstances);
  const overlayAddedComponents = structuralEntries.flatMap(entry => {
    const structuralMain = entry.file.prefabInstances.find(instance =>
      String(instance.transformParent.fileID) === '0'
    );
    return resolveAddedComponents(entry.file, structuralMain, entry.sourceMap, resolver);
  });
  if (localSelectors?.hasAliases && file.hierarchy) {
    applySelectorsToResolvedComponents(overlayAddedComponents, file.hierarchy, localSelectors);
  }
  if (version === 2) numberResolvedComponentCollisions(overlayAddedComponents);
  const addedComponentOverlay = buildAddedComponentOverlay(overlayAddedComponents, allInstances);
  const addedComponents = resolveAddedComponents(file, mainInstance, compositeSourceMap, resolver);
  if (localSelectors?.hasAliases && file.hierarchy) {
    applySelectorsToResolvedComponents(addedComponents, file.hierarchy, localSelectors);
  }
  if (version === 2) numberResolvedComponentCollisions(addedComponents);
  const removalOverlay = mergeRemovalOverlays(structuralEntries.map(entry => {
    const structuralMain = entry.file.prefabInstances.find(instance =>
      String(instance.transformParent.fileID) === '0'
    );
    return buildVariantRemovalOverlay(entry.file, structuralMain, entry.sourceMap, resolver);
  }));

  const addedObjectsMap: AddedObjectsMap = new Map();
  for (const layer of inheritedVariantLayers) {
    collectAddedObjects(layer.file, layer.guid, baseHierarchy, addedObjectsMap);
  }
  collectAddedObjects(file, '', baseHierarchy, addedObjectsMap);

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
    writeVariantStructureTree(
      baseHierarchy, lines, '', true, modifiedTargets, baseMap, resolver,
      variantExpansionCtx, addedObjectsMap, addedComponentOverlay, removalOverlay,
      mainInstance.fileId, baseSourceAliases, baseSelectors
    );
  } else {
    lines.push(`(variant of ${baseGuid || 'unknown'})`);
  }

  // Details section — group modifications by resolved path
  lines.push('--- DETAILS');
  writeVariantDetails(mainInstance, lines, baseMap, resolver, nestedResolved);
  writeNestedPrefabInstanceDetails(file.prefabInstances, mainInstance, lines, resolver);

  const rawAddedComponentRefMap = file.hierarchy
    ? buildInternalRefMap(file, resolver, localSelectors)
    : new Map<string, string>();
  // __added_root__ is a parser-only virtual node. Added-object DETAILS and REFS
  // are both rendered without it, so added-component property values must use
  // the same canonical paths. Otherwise parse can emit a reference that its
  // own REFS section never contains.
  const addedComponentRefMap = file.hierarchy?.name === ADDED_ROOT_NAME
    ? stripAddedRootPrefixFromRefMap(rawAddedComponentRefMap)
    : rawAddedComponentRefMap;
  for (const component of addedComponents) {
    addedComponentRefMap.set(component.document.fileId, `${component.goPath}:${component.componentName}`);
  }
  removeAmbiguousRefPaths(addedComponentRefMap);
  writeAddedComponentDetails(addedComponents, lines, addedComponentRefMap);

  // Write details for added objects
  if (file.hierarchy) {
    const addedRoots = file.hierarchy.name === '__added_root__'
      ? file.hierarchy.children
      : [file.hierarchy];
    const refMap = file.hierarchy.name === ADDED_ROOT_NAME
      ? stripAddedRootPrefixFromRefMap(buildInternalRefMap(file, resolver, localSelectors))
      : buildInternalRefMap(file, resolver, localSelectors);
    for (const addedRoot of addedRoots) {
      writeDetails(addedRoot, lines, '', resolver, true, refMap, localSelectors);
    }
  }

  // REFS section
  lines.push('--- REFS');
  lines.push(`__instance = ${mainInstance.fileId}`);
  writeVariantRefs(mainInstance, lines, baseMap, nestedResolved);
  writeVariantBaseRefs(baseMap, lines, mainInstance.fileId);
  writeNestedPrefabInstanceRefs(file.prefabInstances, mainInstance, lines, resolver);
  writeAddedComponentRefs(addedComponents, lines);

  // Write refs for added objects
  if (file.hierarchy) {
    const addedRoots = file.hierarchy.name === '__added_root__'
      ? file.hierarchy.children
      : [file.hierarchy];
    for (const addedRoot of addedRoots) {
      writeRefsSection(addedRoot, lines, resolver, undefined, undefined, localSelectors);
    }
  }

  // Older v1 output could render an added-component property as ->Path:Type
  // without emitting the matching REFS alias. Keep the v1 syntax, but make
  // every unambiguous path reference written above resolvable by the reader.
  const refsStart = lines.lastIndexOf('--- REFS');
  const existingVariantRefs = new Set(lines.slice(refsStart + 1));
  const variantDetailLines = lines.slice(0, refsStart);
  for (const [fileId, refPath] of addedComponentRefMap) {
    if (!variantDetailLines.some(line =>
      line.includes(`->${refPath}`) || line.includes(`@${refPath}`)
    )) continue;
    const refLine = `${refPath} = ${fileId}`;
    if (!existingVariantRefs.has(refLine)) {
      lines.push(refLine);
      existingVariantRefs.add(refLine);
    }
  }

  return finishCompact(lines, version);
}

/** Match variant added-object DETAILS/REFS, which are written without the virtual root. */
function stripAddedRootPrefixFromRefMap(refMap: Map<string, string>): Map<string, string> {
  const stripped = new Map<string, string>();
  for (const [fileId, refPath] of refMap) {
    stripped.set(fileId, stripAddedRootPrefix(refPath));
  }
  return stripped;
}

/** Apply the same v2 aliases to source identities consumed by variant DETAILS/REFS. */
function applySelectorsToBaseMap(
  baseMap: Map<string, BaseDocInfo>,
  root: GameObjectNode,
  selectors: SelectorContext
): void {
  const visit = (node: GameObjectNode): void => {
    const goPath = selectors.nodePaths.get(node);
    if (goPath) {
      const goInfo = baseMap.get(node.fileId);
      if (goInfo) { goInfo.goName = goPath; goInfo.goPath = goPath; }
      const transformInfo = baseMap.get(node.transform.fileId);
      if (transformInfo) { transformInfo.goName = goPath; transformInfo.goPath = goPath; }
      for (const component of node.components) {
        const info = baseMap.get(component.fileId);
        if (!info) continue;
        info.goName = goPath;
        info.goPath = goPath;
        info.typeName = selectors.componentNames.get(component) || info.typeName;
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
}

function applySelectorsToResolvedComponents(
  components: ResolvedAddedComponent[],
  root: GameObjectNode,
  selectors: SelectorContext
): void {
  const componentNames = new Map<string, string>();
  const nodePaths = new Map<string, string>();
  const visit = (node: GameObjectNode): void => {
    const path = selectors.nodePaths.get(node);
    if (path && node.fileId && node.fileId !== '0') nodePaths.set(node.fileId, path);
    for (const component of node.components) {
      const name = selectors.componentNames.get(component);
      if (name) componentNames.set(component.fileId, name);
    }
    node.children.forEach(visit);
  };
  visit(root);
  for (const component of components) {
    component.componentName = componentNames.get(component.document.fileId) || component.componentName;
    const ownerId = String(component.document.properties.m_GameObject?.fileID ?? '0');
    component.goPath = nodePaths.get(ownerId) || component.goPath;
  }
}

function numberResolvedComponentCollisions(components: ResolvedAddedComponent[]): void {
  const groups = new Map<string, ResolvedAddedComponent[]>();
  for (const component of components) {
    const key = `${component.instanceId}|${component.goPath}|${component.componentName}`;
    const group = groups.get(key) || [];
    group.push(component);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const identities = [...new Set(group.map(component => component.document.fileId))];
    if (identities.length <= 1) continue;
    const sorted = identities.sort(compareCanonicalFileIds);
    const ranks = new Map(sorted.map((identity, index) => [identity, index + 1]));
    for (const component of group) {
      component.componentName += `#${ranks.get(component.document.fileId)}`;
    }
  }
}

/** Load the source prefab map used to label a nested PrefabInstance's own modifications. */
function buildSourcePrefabMap(
  instance: PrefabInstanceInfo,
  resolver?: GuidResolver
): Map<string, BaseDocInfo> | null {
  const sourceGuid = instance.sourcePrefab.guid;
  if (!resolver || !sourceGuid) return null;

  const sourcePath = resolver.resolveFilePath(sourceGuid);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  try {
    const sourceFile = parseUnityYaml(fs.readFileSync(sourcePath, 'utf-8'));
    return buildBaseDocMap(
      sourceFile.documents, resolver, sourceFile.hierarchy, sourceGuid
    );
  } catch {
    return null;
  }
}

/** Write DETAILS blocks for non-root PrefabInstance documents stored in a variant file. */
function writeNestedPrefabInstanceDetails(
  instances: PrefabInstanceInfo[],
  mainInstance: PrefabInstanceInfo,
  lines: string[],
  resolver?: GuidResolver
): void {
  for (const instance of instances) {
    if (instance.fileId === mainInstance.fileId) continue;
    if (instance.modifications.length === 0) continue;

    const sourceMap = buildSourcePrefabMap(instance, resolver);
    writeVariantDetails(instance, lines, sourceMap, resolver, null, true);
  }
}

/** Write REFS entries for non-root PrefabInstance modification targets in a variant file. */
function writeNestedPrefabInstanceRefs(
  instances: PrefabInstanceInfo[],
  mainInstance: PrefabInstanceInfo,
  lines: string[],
  resolver?: GuidResolver
): void {
  for (const instance of instances) {
    if (instance.fileId === mainInstance.fileId) continue;
    if (instance.modifications.length === 0) continue;

    const sourceMap = buildSourcePrefabMap(instance, resolver);
    writeVariantRefs(instance, lines, sourceMap, null, true, instance.fileId);
  }
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
  expansionCtx?: NestedExpansionContext,
  addedObjectsMap?: AddedObjectsMap,
  addedComponentOverlay?: AddedComponentOverlay,
  removalOverlay?: VariantRemovalOverlay,
  ownerInstanceId: string = '',
  sourceGuid: string | string[] = '',
  selectors?: SelectorContext
): void {
  const componentNames = appendRemovedComponentNames(
    appendAddedComponentNames(
      buildComponentNames(node.components, resolver, modifiedTargets, selectors),
      ownerInstanceId, sourceGuid, node.fileId, addedComponentOverlay
    ),
    sourceGuid, node.fileId, removalOverlay
  );

  const renderedNodeName = selectors?.nodeNames.get(node) || node.name;
  let line = variantNodeName(renderedNodeName, sourceGuid, node.fileId, removalOverlay);

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

  // Collect added objects for this node's transform
  const addedNodes = findAddedObjects(addedObjectsMap, sourceGuid, node.transform.fileId);
  const totalChildren = node.children.length + addedNodes.length;
  let childIdx = 0;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    childIdx++;
    const isLast = childIdx === totalChildren;
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    // Try expanding nested prefab
    if (child.nestedPrefab && expansionCtx) {
      const expanded = expandNestedPrefab(child, expansionCtx);
      if (expanded) {
        const sourceRoot = expanded.hierarchy;
        const instanceName = selectors?.nodeNames.get(child) ||
          (child.name === 'NestedPrefab' ? sourceRoot.name : child.name);
        // Merge modification markers: base PI modifications + variant modifications
        const mergedMods = new Set(expanded.modifiedFileIds);
        for (const id of modifiedTargets) mergedMods.add(id);
        const childSourceGuid = child.nestedPrefab.sourceGuid || '';
        const childComps = appendRemovedComponentNames(
          appendAddedComponentNames(
            buildComponentNames(sourceRoot.components, resolver, mergedMods, selectors),
            child.nestedPrefab.instanceId, childSourceGuid, sourceRoot.fileId, addedComponentOverlay
          ),
          childSourceGuid, sourceRoot.fileId, removalOverlay
        );

        let childLine = `${prefix}${connector} ${variantNodeName(instanceName, childSourceGuid, sourceRoot.fileId, removalOverlay)}`;
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
            mergedMods, baseMap, resolver, sourceCtx, addedObjectsMap,
            addedComponentOverlay, removalOverlay, child.nestedPrefab.instanceId, childSourceGuid, selectors
          );
        }
        continue;
      }
    }

    const childComps = appendRemovedComponentNames(
      appendAddedComponentNames(
        buildComponentNames(child.components, resolver, modifiedTargets, selectors),
        ownerInstanceId, sourceGuid, child.fileId, addedComponentOverlay
      ),
      sourceGuid, child.fileId, removalOverlay
    );
    const renderedChildName = selectors?.nodeNames.get(child) || child.name;
    let childLine = `${prefix}${connector} ${variantNodeName(renderedChildName, sourceGuid, child.fileId, removalOverlay)}`;

    if (child.nestedPrefab) {
      const sourceName = resolveSourceName(child, resolver);
      if (sourceName) childLine += ` {${sourceName}}`;
    }

    if (childComps.length > 0) childLine += ` [${childComps.join(', ')}]`;
    lines.push(childLine);

    if (child.children.length > 0) {
      writeVariantStructureTree(
        child, lines, prefix + childPrefix, false, modifiedTargets, baseMap,
        resolver, expansionCtx, addedObjectsMap, addedComponentOverlay,
        removalOverlay, ownerInstanceId, sourceGuid, selectors
      );
    }
  }

  // Write added objects with + prefix
  for (let i = 0; i < addedNodes.length; i++) {
    const addedEntry = addedNodes[i];
    const added = addedEntry.node;
    childIdx++;
    const isLast = childIdx === totalChildren;
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    const addedComps = appendRemovedComponentNames(
      appendAddedComponentNames(
        buildComponentNames(added.components, resolver),
        ownerInstanceId,
        addedEntry.originGuid,
        added.fileId,
        addedComponentOverlay
      ),
      addedEntry.originGuid,
      added.fileId,
      removalOverlay
    );
    const displayedName = variantNodeName(added.name, addedEntry.originGuid, added.fileId, removalOverlay);
    let childLine = `${prefix}${connector} ${displayedName.startsWith('-') ? displayedName : `+${displayedName}`}`;

    if (added.nestedPrefab) {
      const sourceName = resolveSourceName(added, resolver);
      if (sourceName) childLine += ` {${sourceName}}`;
    }

    if (addedComps.length > 0) childLine += ` [${addedComps.join(', ')}]`;
    lines.push(childLine);

    if (added.children.length > 0 || findAddedObjects(
      addedObjectsMap, addedEntry.originGuid, added.transform.fileId
    ).length > 0) {
      writeAddedObjectsTree(
        added, lines, prefix + childPrefix, resolver, addedObjectsMap,
        addedComponentOverlay, removalOverlay, ownerInstanceId, addedEntry.originGuid
      );
    }
  }
}

/** Write the structure tree for added objects (all descendants get + prefix) */
function writeAddedObjectsTree(
  node: GameObjectNode,
  lines: string[],
  prefix: string,
  resolver?: GuidResolver,
  addedObjectsMap?: AddedObjectsMap,
  addedComponentOverlay?: AddedComponentOverlay,
  removalOverlay?: VariantRemovalOverlay,
  ownerInstanceId: string = '',
  originGuid: string = ''
): void {
  const inheritedChildren = findAddedObjects(addedObjectsMap, originGuid, node.transform.fileId);
  const children: LayerAddedObject[] = [
    ...node.children.map(child => ({ node: child, originGuid })),
    ...inheritedChildren,
  ];

  for (let i = 0; i < children.length; i++) {
    const childEntry = children[i];
    const child = childEntry.node;
    const childOriginGuid = childEntry.originGuid;
    const isLast = i === children.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    const compNames = appendRemovedComponentNames(
      appendAddedComponentNames(
        buildComponentNames(child.components, resolver),
        ownerInstanceId,
        childOriginGuid,
        child.fileId,
        addedComponentOverlay
      ),
      childOriginGuid,
      child.fileId,
      removalOverlay
    );
    const displayedName = variantNodeName(child.name, childOriginGuid, child.fileId, removalOverlay);
    let childLine = `${prefix}${connector} ${displayedName.startsWith('-') ? displayedName : `+${displayedName}`}`;

    if (child.nestedPrefab) {
      const sourceName = resolveSourceName(child, resolver);
      if (sourceName) childLine += ` {${sourceName}}`;
    }

    if (compNames.length > 0) childLine += ` [${compNames.join(', ')}]`;
    lines.push(childLine);

    if (child.children.length > 0 || findAddedObjects(
      addedObjectsMap, childOriginGuid, child.transform.fileId
    ).length > 0) {
      writeAddedObjectsTree(
        child, lines, prefix + childPrefix, resolver, addedObjectsMap,
        addedComponentOverlay, removalOverlay, ownerInstanceId, childOriginGuid
      );
    }
  }
}

/** Write variant details grouped by resolved GO path */
function writeVariantDetails(
  instance: PrefabInstanceInfo,
  lines: string[],
  baseMap: Map<string, BaseDocInfo> | null,
  resolver?: GuidResolver,
  nestedResolved?: Map<string, string> | null,
  preferNameOverrideHeader: boolean = false
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
    const header = resolveVariantHeader(targetId, mods, baseMap, nestedResolved, preferNameOverrideHeader);

    // Filter boilerplate modifications
    const filteredMods = mods.filter(m => !VARIANT_OMIT_PATHS.has(m.propertyPath));
    if (filteredMods.length === 0) continue;

    lines.push('');
    lines.push(`[${header}]`);
    for (const mod of filteredMods) {
      const value = formatVariantModificationValue(mod, baseMap, nestedResolved);
      lines.push(`${mod.propertyPath} = ${value}`);
    }
  }
}

/** Resolve a variant reference target to a readable path key. */
function resolveVariantReferenceKey(
  targetId: string,
  baseMap: Map<string, BaseDocInfo> | null,
  nestedResolved?: Map<string, string> | null
): string | null {
  if (baseMap) {
    const resolved = resolveTargetKey(targetId, baseMap);
    if (resolved) return resolved;
  }

  if (nestedResolved) {
    const resolved = nestedResolved.get(targetId);
    if (resolved) return resolved;
  }

  return null;
}

/** Format a variant modification value, using path refs for readable internal object references. */
function formatVariantModificationValue(
  mod: PropertyModification,
  baseMap: Map<string, BaseDocInfo> | null,
  nestedResolved?: Map<string, string> | null
): string {
  if (mod.objectReference && String(mod.objectReference.fileID) !== '0') {
    const refId = String(mod.objectReference.fileID);
    const refKey = resolveVariantReferenceKey(refId, baseMap, nestedResolved);
    if (refKey) return `->${refKey}`;
    return formatReference(mod.objectReference);
  }

  return mod.value;
}

/**
 * Resolve a variant target to a human-readable header.
 * Uses baseMap first, then nestedResolved, then inference.
 */
function resolveVariantHeader(
  targetId: string,
  mods: { propertyPath: string; value: string }[],
  baseMap: Map<string, BaseDocInfo> | null,
  nestedResolved?: Map<string, string> | null,
  preferNameOverrideHeader: boolean = false
): string {
  const nameMod = mods.find(m => m.propertyPath === 'm_Name');
  if (preferNameOverrideHeader && nameMod) return nameMod.value;

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
  nestedResolved?: Map<string, string> | null,
  preferNameOverrideHeader: boolean = false,
  ownerInstanceId?: string
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

  const emitted = new Set<string>();
  const emitRef = (key: string, targetId: string, includeOwner: boolean): void => {
    const refLine = `${key} = ${targetId}`;
    if (!emitted.has(refLine)) {
      lines.push(refLine);
      emitted.add(refLine);
    }

    if (includeOwner && ownerInstanceId) {
      const ownerLine = `${key}:__instance = ${ownerInstanceId}`;
      if (!emitted.has(ownerLine)) {
        lines.push(ownerLine);
        emitted.add(ownerLine);
      }
    }
  };

  for (const [targetId, mods] of modsByTarget) {
    const key = resolveVariantHeader(targetId, mods, baseMap, nestedResolved, preferNameOverrideHeader);
    emitRef(key, targetId, true);
  }

  // Also include readable REFS entries for objectReference values so `->path`
  // values emitted in DETAILS can be parsed back without requiring raw fileIDs.
  for (const mod of instance.modifications) {
    if (!mod.objectReference || String(mod.objectReference.fileID) === '0') continue;

    const refId = String(mod.objectReference.fileID);
    const refKey = resolveVariantReferenceKey(refId, baseMap, nestedResolved);
    if (refKey) {
      emitRef(refKey, refId, false);
    }
  }
}

/**
 * Emit every resolvable base target, not only targets that already have overrides.
 * This lets compact edits create a brand-new override or add a component without
 * requiring the user to discover raw Unity fileIDs/GUIDs.
 */
function writeVariantBaseRefs(
  baseMap: Map<string, BaseDocInfo> | null,
  lines: string[],
  ownerInstanceId: string
): void {
  if (!baseMap) return;
  const refsStart = lines.lastIndexOf('--- REFS');
  const existing = new Set(lines.slice(refsStart + 1));
  const keyCounts = new Map<string, number>();
  for (const info of baseMap.values()) {
    const key = resolveTargetPathKey(info);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }

  for (const info of baseMap.values()) {
    const key = resolveTargetPathKey(info);
    if (keyCounts.get(key) !== 1) continue;
    const refLine = `${key} = ${info.fileId}`;
    if (!existing.has(refLine)) {
      lines.push(refLine);
      existing.add(refLine);
    }

    const ownerLine = `${key}:__instance = ${ownerInstanceId}`;
    if (!existing.has(ownerLine)) {
      lines.push(ownerLine);
      existing.add(ownerLine);
    }

    if (info.sourceGuid) {
      const sourceLine = `${key}:__source = ${info.sourceGuid}`;
      if (!existing.has(sourceLine)) {
        lines.push(sourceLine);
        existing.add(sourceLine);
      }
    }
  }
}
