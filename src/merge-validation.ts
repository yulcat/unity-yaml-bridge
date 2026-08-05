/** Validation helpers shared by the compact merge pipeline. */

import { CompactFile, CompactProperty, CompactSection, CompactStructureNode } from './compact-reader';
import { UnityFile } from './types';

function cloneProperties(properties: CompactProperty[]): CompactProperty[] {
  return properties.map(property => ({
    key: property.key,
    value: typeof property.value === 'string'
      ? property.value
      : cloneProperties(property.value),
    indent: property.indent,
  }));
}

function cloneStructure(node: CompactStructureNode | null): CompactStructureNode | null {
  if (!node) return null;
  return {
    name: node.name,
    nestedPrefab: node.nestedPrefab,
    components: [...node.components],
    children: node.children.map(child => cloneStructure(child)!),
    marker: node.marker,
  };
}

function cloneSection(section: CompactSection): CompactSection {
  return {
    goPath: section.goPath,
    componentType: section.componentType,
    properties: cloneProperties(section.properties),
    isAdded: section.isAdded,
  };
}

/** Keep merge transactional: callers can safely reuse the parsed compact input. */
export function cloneCompactFile(compact: CompactFile): CompactFile {
  return {
    version: compact.version,
    type: compact.type,
    baseGuid: compact.baseGuid,
    structure: cloneStructure(compact.structure),
    sections: compact.sections.map(cloneSection),
    refs: new Map([...compact.refs].map(([key, values]) => [key, [...values]])),
  };
}

/** Reject a compact file that clearly belongs to another Unity YAML input. */
export function assertCompactSourceCompatible(original: UnityFile, compact: CompactFile): void {
  if (original.type !== compact.type) {
    throw new Error(
      `Compact/YAML type mismatch: compact is ${compact.type}, original YAML is ${original.type}.`
    );
  }

  if (compact.type === 'variant' && compact.baseGuid && compact.baseGuid !== 'unknown') {
    const sourceGuid = original.variantSource?.guid;
    if (sourceGuid && sourceGuid !== compact.baseGuid) {
      throw new Error(
        `Compact/YAML source mismatch: base GUID ${compact.baseGuid} does not match ${sourceGuid}.`
      );
    }
  }

  if (compact.type === 'variant' || !compact.structure || !original.hierarchy) return;
  if (compact.structure.name !== original.hierarchy.name) {
    throw new Error(
      `Compact/YAML root mismatch: ${compact.structure.name} does not match ${original.hierarchy.name}.`
    );
  }

  const rootRefs = compact.refs.get(compact.structure.name);
  if (rootRefs && original.hierarchy.fileId !== '0' && !rootRefs.includes(original.hierarchy.fileId)) {
    throw new Error(
      `Compact/YAML root identity mismatch: ${compact.structure.name} expects ` +
      `${rootRefs.map(id => `&${id}`).join(', ')}, original uses &${original.hierarchy.fileId}.`
    );
  }
}

/** Collect structural issues without rejecting pre-existing tolerated Unity YAML quirks. */
export function collectUnityIntegrityIssues(file: UnityFile): Set<string> {
  const issues = new Set<string>();
  const ids = new Set<string>();
  const docsById = new Map<string, typeof file.documents[number]>();

  for (const document of file.documents) {
    if (ids.has(document.fileId)) issues.add(`duplicate document &${document.fileId}`);
    ids.add(document.fileId);
    docsById.set(document.fileId, document);
  }

  for (const document of file.documents) {
    if (document.typeId === 1 && !document.stripped) {
      const entries = Array.isArray(document.properties.m_Component)
        ? document.properties.m_Component
        : [];
      for (const entry of entries) {
        const componentId = String(entry?.component?.fileID ?? entry?.fileID ?? '0');
        if (componentId === '0') continue;
        const component = docsById.get(componentId);
        if (!component) {
          issues.add(`GameObject &${document.fileId} references missing component &${componentId}`);
          continue;
        }
        const ownerId = String(component.properties.m_GameObject?.fileID ?? '0');
        if (ownerId !== '0' && ownerId !== document.fileId) {
          issues.add(
            `GameObject &${document.fileId} attaches &${componentId}, owned by &${ownerId}`
          );
        }
      }
    }

    if (![1, 1001].includes(document.typeId) && !document.stripped &&
        document.properties.m_GameObject !== undefined) {
      const ownerId = String(document.properties.m_GameObject?.fileID ?? '0');
      if (ownerId !== '0') {
        const owner = docsById.get(ownerId);
        if (!owner || owner.typeId !== 1) {
          issues.add(`Component &${document.fileId} references missing GameObject &${ownerId}`);
        }
      }
    }

    if (document.typeId === 1001) {
      const added = document.properties.m_Modification?.m_AddedComponents;
      if (Array.isArray(added)) {
        for (const entry of added) {
          const componentId = String(entry?.addedObject?.fileID ?? '0');
          if (componentId !== '0' && !docsById.has(componentId)) {
            issues.add(`PrefabInstance &${document.fileId} adds missing component &${componentId}`);
          }
        }
      }
    }
  }

  return issues;
}

/** Fail only for integrity damage introduced by this merge. */
export function assertNoNewIntegrityIssues(
  baseline: Set<string>,
  merged: UnityFile
): void {
  const introduced = [...collectUnityIntegrityIssues(merged)]
    .filter(issue => !baseline.has(issue));
  if (introduced.length > 0) {
    throw new Error(`Merge produced invalid Unity YAML: ${introduced.join('; ')}`);
  }
}
