import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { UnityDocument, UnityFile } from '../types';
import { V3CompileOptions, V3Document, V3IdentityRecord, V3StructureNode } from './model';
import { markCanonicalFlowMappings } from './value';
import { resolveV3References } from './references';

const COMMON_LOCAL_ENVELOPE: Record<string, unknown> = {
  m_ObjectHideFlags: 0,
  m_CorrespondingSourceObject: { fileID: 0 },
  m_PrefabInstance: { fileID: 0 },
  m_PrefabAsset: { fileID: 0 },
};

export function compileV3(document: V3Document, options: V3CompileOptions = {}): UnityFile {
  if (document.version !== 3) throw new Error('compileV3 accepts v3 documents only.');
  validateSourceFingerprints(document, options);
  if (document.kind === 'variant') return compileVariant(document);
  if (!document.structure) throw new Error('v3 prefab requires STRUCTURE.');

  const allocated = allocateFileIds(document);
  const documents: UnityDocument[] = [];
  const emittedMachineIds = new Set<string>();
  const nestedPlans = new Map<string, NestedInstancePlan>();

  const buildNode = (
    node: V3StructureNode,
    parentTransformId: string,
    siblingIndex: number,
    parentTransformMachineId?: string
  ): void => {
    if (node.nestedSourceGuid) {
      if (nestedPlans.has(node.machineId)) {
        throw new Error(`Nested PrefabInstance ${node.machineId} appears more than once in STRUCTURE.`);
      }
      nestedPlans.set(node.machineId, {
        machineId: node.machineId,
        name: node.name,
        parentTransformId,
        parentTransformMachineId,
        siblingIndex,
      });
      return;
    }
    const goIdentity = requireIdentity(document, node.machineId, 'gameObject');
    const transformIdentity = findOwnedTransform(document, node.machineId);
    const goId = allocated.get(goIdentity.machineId)!;
    const transformId = allocated.get(transformIdentity.machineId)!;
    const componentIds = node.components.map(component => {
      const identity = requireIdentity(document, component.machineId, 'component');
      return allocated.get(identity.machineId)!;
    });
    emittedMachineIds.add(goIdentity.machineId);
    emittedMachineIds.add(transformIdentity.machineId);
    node.components.forEach(component => emittedMachineIds.add(component.machineId));

    const gameObjectProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(node.machineId));
    gameObjectProperties.serializedVersion ??= 6;
    gameObjectProperties.m_Component = [transformId, ...componentIds]
      .map(fileID => ({ component: { fileID } }));
    gameObjectProperties.m_Layer ??= 0;
    gameObjectProperties.m_Name = node.name;
    gameObjectProperties.m_TagString ??= 'Untagged';
    gameObjectProperties.m_Icon ??= { fileID: 0 };
    gameObjectProperties.m_NavMeshLayer ??= 0;
    gameObjectProperties.m_StaticEditorFlags ??= 0;
    gameObjectProperties.m_IsActive ??= 1;
    documents.push(makeDocument(goIdentity, goId, gameObjectProperties));

    const transformProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(transformIdentity.machineId));
    transformProperties.m_GameObject = { fileID: goId };
    transformProperties.serializedVersion ??= 2;
    transformProperties.m_LocalRotation ??= flow({ x: 0, y: 0, z: 0, w: 1 });
    transformProperties.m_LocalPosition ??= flow({ x: 0, y: 0, z: 0 });
    transformProperties.m_LocalScale ??= flow({ x: 1, y: 1, z: 1 });
    transformProperties.m_Children = node.children.map(child => ({
      fileID: allocated.get(findDesiredRootTransform(document, child).machineId)!,
    }));
    transformProperties.m_Father = { fileID: parentTransformId };
    transformProperties.m_RootOrder = siblingIndex;
    transformProperties.m_LocalEulerAnglesHint ??= flow({ x: 0, y: 0, z: 0 });
    if (transformIdentity.typeId === 224) {
      transformProperties.m_AnchorMin ??= flow({ x: 0.5, y: 0.5 });
      transformProperties.m_AnchorMax ??= flow({ x: 0.5, y: 0.5 });
      transformProperties.m_AnchoredPosition ??= flow({ x: 0, y: 0 });
      transformProperties.m_SizeDelta ??= flow({ x: 100, y: 100 });
      transformProperties.m_Pivot ??= flow({ x: 0.5, y: 0.5 });
    }
    documents.push(makeDocument(transformIdentity, transformId, transformProperties));

    node.components.forEach(component => {
      const identity = requireIdentity(document, component.machineId, 'component');
      const properties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(identity.machineId));
      properties.m_GameObject = { fileID: goId };
      if (identity.typeId === 114) {
        if (!identity.scriptGuid) throw new Error(`MonoBehaviour ${identity.machineId} requires script GUID identity.`);
        properties.m_Enabled ??= 1;
        properties.m_EditorHideFlags ??= 0;
        properties.m_Script = {
          fileID: identity.scriptFileId ?? 11500000,
          guid: identity.scriptGuid,
          type: identity.scriptType ?? 3,
        };
        properties.m_Name ??= '';
        properties.m_EditorClassIdentifier ??= '';
      }
      documents.push(makeDocument(identity, allocated.get(identity.machineId)!, properties));
    });

    node.children.forEach((child, index) =>
      buildNode(child, transformId, index, transformIdentity.machineId));
  };

  buildNode(document.structure, '0', 0);
  const desiredOwnership = new Map<string, boolean>();
  const isDesiredOwnership = (machineId: string): boolean => {
    if (desiredOwnership.has(machineId)) return desiredOwnership.get(machineId)!;
    const identity = document.identity.get(machineId);
    if (!identity) return false;
    desiredOwnership.set(machineId, false);
    const desired = identity.kind === 'prefabInstance' && nestedPlans.has(machineId) ||
      !!identity.ownerId && isDesiredOwnership(identity.ownerId);
    desiredOwnership.set(machineId, desired);
    return desired;
  };
  for (const identity of document.identity.values()) {
    if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned') continue;
    if (identity.ownerId || identity.kind === 'prefabInstance') {
      if (!isDesiredOwnership(identity.machineId)) continue;
    }
    const properties = document.details.get(identity.machineId);
    if (!properties) throw new Error(`Raw ownership identity ${identity.machineId} requires DETAILS.`);
    let compiledProperties = clone(properties);
    if (identity.kind === 'prefabInstance' && nestedPlans.has(identity.machineId)) {
      compiledProperties = applyNestedInstancePlan(
        document,
        identity,
        nestedPlans.get(identity.machineId)!,
        compiledProperties
      );
    }
    documents.push(makeDocument(identity, allocated.get(identity.machineId)!, compiledProperties));
    emittedMachineIds.add(identity.machineId);
  }
  for (const unityDocument of documents) {
    unityDocument.properties = markCanonicalFlowMappings(resolveV3References(
      unityDocument.properties,
      allocated,
      emittedMachineIds,
      `${unityDocument.typeName}&${unityDocument.fileId}`
    )) as Record<string, any>;
  }
  assertUniqueFileIds(documents);
  return { type: 'prefab', documents, prefabInstances: [] };
}

function validateSourceFingerprints(document: V3Document, options: V3CompileOptions): void {
  if (!options.sourceResolver) return;
  const checked = new Set<string>();
  for (const identity of document.identity.values()) {
    if (!identity.sourceGuid || !identity.sourceFingerprint) continue;
    const key = `${identity.sourceGuid}:${identity.sourceFingerprint}`;
    if (checked.has(key)) continue;
    const sourcePath = options.sourceResolver.resolveFilePath(identity.sourceGuid);
    if (!sourcePath) {
      throw new Error(`Source project cannot resolve GUID ${identity.sourceGuid}.`);
    }
    const actual = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
    if (actual !== identity.sourceFingerprint) {
      throw new Error(`Source fingerprint mismatch for GUID ${identity.sourceGuid}.`);
    }
    checked.add(key);
  }
}

interface NestedInstancePlan {
  machineId: string;
  name: string;
  parentTransformId: string;
  parentTransformMachineId?: string;
  siblingIndex: number;
}

function applyNestedInstancePlan(
  document: V3Document,
  identity: V3IdentityRecord,
  plan: NestedInstancePlan,
  properties: Record<string, any>
): Record<string, any> {
  const modification = properties.m_Modification;
  if (!modification || typeof modification !== 'object') {
    throw new Error(`PrefabInstance ${identity.machineId} has no m_Modification DETAILS.`);
  }
  if (plan.parentTransformMachineId || !modification.m_TransformParent) {
    modification.m_TransformParent = { fileID: plan.parentTransformId };
  }
  if (!Array.isArray(modification.m_Modifications)) modification.m_Modifications = [];

  const rootTransform = [...document.identity.values()].find(record =>
    record.kind === 'stripped' && record.ownerId === identity.machineId && record.nestedRoot
  );
  const rootTransformDetails = rootTransform
    ? document.details.get(rootTransform.machineId)
    : undefined;
  const rootTransformSource = rootTransformDetails?.m_CorrespondingSourceObject;
  if (!rootTransformSource || typeof rootTransformSource !== 'object') {
    throw new Error(`PrefabInstance ${identity.machineId} has no source root Transform identity.`);
  }
  const placementChanged = identity.baselineParentId !== plan.parentTransformMachineId ||
    identity.baselineOrder !== plan.siblingIndex;
  if (placementChanged) {
    upsertModification(
      modification.m_Modifications,
      rootTransformSource,
      'm_RootOrder',
      String(plan.siblingIndex)
    );
  }

  if (identity.displayName !== undefined && plan.name !== identity.displayName) {
    const existingName = modification.m_Modifications.find((entry: any) =>
      entry?.propertyPath === 'm_Name'
    );
    if (existingName) {
      existingName.value = plan.name;
      existingName.objectReference = { fileID: 0 };
    } else {
      const strippedGameObject = [...document.identity.values()].find(record =>
        record.kind === 'stripped' && record.ownerId === identity.machineId && record.typeId === 1
      );
      const source = strippedGameObject
        ? document.details.get(strippedGameObject.machineId)?.m_CorrespondingSourceObject
        : undefined;
      if (!source || typeof source !== 'object') {
        throw new Error(`Cannot rename nested PrefabInstance ${identity.machineId}: source GameObject identity is unavailable.`);
      }
      upsertModification(modification.m_Modifications, source, 'm_Name', plan.name);
    }
  }
  return properties;
}

function upsertModification(
  modifications: any[],
  target: any,
  propertyPath: string,
  value: string
): void {
  const targetFileId = String(target.fileID ?? '0');
  const targetGuid = String(target.guid ?? '');
  const existing = modifications.find(entry =>
    entry?.propertyPath === propertyPath &&
    String(entry?.target?.fileID ?? '0') === targetFileId &&
    String(entry?.target?.guid ?? '') === targetGuid
  );
  if (existing) {
    existing.value = value;
    existing.objectReference = { fileID: 0 };
    return;
  }
  modifications.push({
    target: clone(target),
    propertyPath,
    value,
    objectReference: { fileID: 0 },
  });
}

function compileVariant(document: V3Document): UnityFile {
  const allocated = allocateFileIds(document);
  const emitted = new Set<string>();
  const documents: UnityDocument[] = [];
  const nestedPlans = new Map<string, NestedInstancePlan>();
  const removedGameObjects: Array<Record<string, unknown>> = [];
  const removedComponents: Array<Record<string, unknown>> = [];
  const addedGameObjects: Array<Record<string, unknown>> = [];
  const hasInheritedStructure = [...document.identity.values()].some(identity =>
    identity.origin === 'inherited'
  );

  const buildNode = (
    node: V3StructureNode,
    parentTransformId: string,
    siblingIndex: number,
    parentTransformMachineId?: string
  ): void => {
    if (node.tombstone) {
      if (node.children.length > 0) {
        throw new Error(`GameObject tombstone ${node.machineId} cannot have effective children.`);
      }
      const identity = requireIdentity(document, node.machineId, 'gameObject');
      if (identity.origin !== 'inherited' || !identity.sourceGuid || !identity.sourceFileId) {
        throw new Error(`GameObject tombstone ${node.machineId} requires inherited source identity.`);
      }
      removedGameObjects.push({
        fileID: identity.sourceFileId,
        guid: identity.sourceGuid,
        type: 3,
      });
      return;
    }
    if (node.nestedSourceGuid) {
      if (nestedPlans.has(node.machineId)) {
        throw new Error(`Nested PrefabInstance ${node.machineId} appears more than once in variant STRUCTURE.`);
      }
      nestedPlans.set(node.machineId, {
        machineId: node.machineId,
        name: node.name,
        parentTransformId,
        parentTransformMachineId,
        siblingIndex,
      });
      return;
    }
    const goIdentity = requireIdentity(document, node.machineId, 'gameObject');
    const transformIdentity = findOwnedTransform(document, node.machineId);
    if (goIdentity.origin === 'inherited') {
      const desiredComponents = new Set(node.components.map(component => component.machineId));
      for (const identity of document.identity.values()) {
        if (identity.kind !== 'component' || identity.origin !== 'inherited' ||
            identity.ownerId !== goIdentity.machineId || desiredComponents.has(identity.machineId)) continue;
        if (!identity.sourceGuid || !identity.sourceFileId) {
          throw new Error(`Removed inherited component ${identity.machineId} has no source identity.`);
        }
        removedComponents.push({
          fileID: identity.sourceFileId,
          guid: identity.sourceGuid,
          type: 3,
        });
      }
      if (transformIdentity.origin !== 'inherited' || node.components.some(component =>
        requireIdentity(document, component.machineId, 'component').origin !== 'inherited'
      )) {
        throw new Error(`Inherited STRUCTURE node ${node.machineId} has mixed local ownership.`);
      }
      node.children.forEach((child, index) => {
        const childIdentity = requireIdentity(document, child.machineId, 'gameObject');
        if (childIdentity.origin !== 'inherited' &&
            (!transformIdentity.sourceGuid || !transformIdentity.sourceFileId)) {
          throw new Error(`Inherited parent ${transformIdentity.machineId} has no source identity.`);
        }
        buildNode(child, '0', index, transformIdentity.machineId);
      });
      return;
    }
    if (!parentTransformMachineId && !goIdentity.fileId) {
      throw new Error(`New variant root ${node.machineId} requires an inherited source-parent identity.`);
    }
    if (!parentTransformMachineId && transformIdentity.baselineParentId) {
      throw new Error(`Moving ${node.machineId} to the variant root requires an inherited source-parent identity.`);
    }
    const goId = allocated.get(goIdentity.machineId)!;
    const transformId = allocated.get(transformIdentity.machineId)!;
    if (parentTransformMachineId) {
      const parentIdentity = document.identity.get(parentTransformMachineId);
      if (parentIdentity?.origin === 'inherited') {
        if (!parentIdentity.sourceGuid || !parentIdentity.sourceFileId) {
          throw new Error(`Inherited parent ${parentTransformMachineId} has no source identity.`);
        }
        addedGameObjects.push({
          targetCorrespondingSourceObject: {
            fileID: parentIdentity.sourceFileId,
            guid: parentIdentity.sourceGuid,
            type: 3,
          },
          insertIndex: siblingIndex,
          addedObject: { $ref: transformIdentity.machineId },
        });
      }
    }
    const componentIds = node.components.map(component =>
      allocated.get(requireIdentity(document, component.machineId, 'component').machineId)!
    );
    emitted.add(goIdentity.machineId);
    emitted.add(transformIdentity.machineId);
    node.components.forEach(component => emitted.add(component.machineId));

    const gameObjectProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(node.machineId));
    gameObjectProperties.serializedVersion ??= 6;
    gameObjectProperties.m_Component = [transformId, ...componentIds]
      .map(fileID => ({ component: { fileID } }));
    gameObjectProperties.m_Layer ??= 0;
    gameObjectProperties.m_Name = node.name;
    gameObjectProperties.m_TagString ??= 'Untagged';
    gameObjectProperties.m_Icon ??= { fileID: 0 };
    gameObjectProperties.m_NavMeshLayer ??= 0;
    gameObjectProperties.m_StaticEditorFlags ??= 0;
    gameObjectProperties.m_IsActive ??= 1;
    documents.push(makeDocument(goIdentity, goId, gameObjectProperties));

    const transformProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(transformIdentity.machineId));
    transformProperties.m_GameObject = { fileID: goId };
    transformProperties.m_LocalRotation ??= flow({ x: 0, y: 0, z: 0, w: 1 });
    transformProperties.m_LocalPosition ??= flow({ x: 0, y: 0, z: 0 });
    transformProperties.m_LocalScale ??= flow({ x: 1, y: 1, z: 1 });
    transformProperties.m_Children = node.children.map(child => ({
      fileID: allocated.get(findDesiredRootTransform(document, child).machineId)!,
    }));
    if (parentTransformMachineId) transformProperties.m_Father = { fileID: parentTransformId };
    else transformProperties.m_Father ??= { fileID: parentTransformId };
    const placementChanged = transformIdentity.baselineParentId !== parentTransformMachineId ||
      transformIdentity.baselineOrder !== siblingIndex;
    if (Object.prototype.hasOwnProperty.call(transformProperties, 'm_RootOrder') || placementChanged) {
      transformProperties.m_RootOrder = siblingIndex;
    }
    transformProperties.m_LocalEulerAnglesHint ??= flow({ x: 0, y: 0, z: 0 });
    documents.push(makeDocument(transformIdentity, transformId, transformProperties));

    node.components.forEach(component => {
      const identity = requireIdentity(document, component.machineId, 'component');
      const properties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(identity.machineId));
      properties.m_GameObject = { fileID: goId };
      if (identity.typeId === 114) {
        if (!identity.scriptGuid) throw new Error(`MonoBehaviour ${identity.machineId} requires script GUID identity.`);
        properties.m_Enabled ??= 1;
        properties.m_EditorHideFlags ??= 0;
        properties.m_Script = {
          fileID: identity.scriptFileId ?? 11500000,
          guid: identity.scriptGuid,
          type: identity.scriptType ?? 3,
        };
        properties.m_Name ??= '';
        properties.m_EditorClassIdentifier ??= '';
      }
      documents.push(makeDocument(identity, allocated.get(identity.machineId)!, properties));
    });
    node.children.forEach((child, index) =>
      buildNode(child, transformId, index, transformIdentity.machineId));
  };

  (document.variantRoots ?? []).forEach((root, index) => buildNode(root, '0', index));
  const desiredOwnership = new Map<string, boolean>();
  const isDesiredOwnership = (machineId: string): boolean => {
    if (desiredOwnership.has(machineId)) return desiredOwnership.get(machineId)!;
    const identity = document.identity.get(machineId);
    if (!identity) return false;
    desiredOwnership.set(machineId, false);
    const desired = machineId === document.variantRootId || nestedPlans.has(machineId) ||
      !!identity.ownerId && isDesiredOwnership(identity.ownerId);
    desiredOwnership.set(machineId, desired);
    return desired;
  };

  for (const identity of document.identity.values()) {
    if (identity.kind === 'gameObject' || identity.kind === 'transform' || identity.kind === 'component') continue;
    if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned') continue;
    if ((identity.ownerId || identity.kind === 'prefabInstance') && !isDesiredOwnership(identity.machineId)) continue;
    const details = document.details.get(identity.machineId);
    if (!details) throw new Error(`Variant identity ${identity.machineId} requires DETAILS.`);
    let properties = clone(details);
    if (identity.machineId === document.variantRootId && hasInheritedStructure) {
      if (!properties.m_Modification || typeof properties.m_Modification !== 'object') {
        throw new Error(`Variant root ${identity.machineId} has no m_Modification DETAILS.`);
      }
      const modification = properties.m_Modification as Record<string, unknown>;
      modification.m_RemovedGameObjects = removedGameObjects;
      modification.m_RemovedComponents = removedComponents;
      modification.m_AddedGameObjects = addedGameObjects;
    }
    if (identity.kind === 'prefabInstance' && nestedPlans.has(identity.machineId)) {
      properties = applyNestedInstancePlan(document, identity, nestedPlans.get(identity.machineId)!, properties);
    }
    documents.push(makeDocument(identity, allocated.get(identity.machineId)!, properties));
    emitted.add(identity.machineId);
  }
  for (const unityDocument of documents) {
    if (unityDocument.typeId === 1001) pruneAbsentAddedObjects(unityDocument.properties, emitted);
    unityDocument.properties = markCanonicalFlowMappings(resolveV3References(
      unityDocument.properties, allocated, emitted, `${unityDocument.typeName}&${unityDocument.fileId}`
    )) as Record<string, any>;
  }
  assertUniqueFileIds(documents);
  return {
    type: 'variant',
    documents,
    prefabInstances: [],
    variantSource: document.baseGuid
      ? { fileID: '100100000', guid: document.baseGuid, type: 3 }
      : undefined,
  };
}

function pruneAbsentAddedObjects(properties: Record<string, any>, emitted: Set<string>): void {
  const modification = properties.m_Modification;
  if (!modification || typeof modification !== 'object') return;
  const keep = (entry: any): boolean => {
    const reference = entry?.addedObject;
    return !reference?.$ref || emitted.has(String(reference.$ref));
  };
  if (Array.isArray(modification.m_AddedGameObjects)) {
    modification.m_AddedGameObjects = modification.m_AddedGameObjects.filter(keep);
  }
  if (Array.isArray(modification.m_AddedComponents)) {
    modification.m_AddedComponents = modification.m_AddedComponents.filter(keep);
  }
}

function allocateFileIds(document: V3Document): Map<string, string> {
  const result = new Map<string, string>();
  const occupied = new Set<string>();
  for (const identity of document.identity.values()) {
    if (!identity.fileId) continue;
    if (identity.fileId === '0' || occupied.has(identity.fileId)) {
      throw new Error(`Invalid or duplicate fileID ${identity.fileId} on ${identity.machineId}.`);
    }
    occupied.add(identity.fileId);
    result.set(identity.machineId, identity.fileId);
  }
  for (const identity of document.identity.values()) {
    if (result.has(identity.machineId)) continue;
    let salt = 0;
    while (true) {
      const seed = `${document.assetGuid || document.profile}|${identity.machineId}|${identity.kind}|${salt}`;
      const digest = createHash('sha256').update(seed).digest();
      const candidate = (digest.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
      if (candidate !== '0' && !occupied.has(candidate)) {
        occupied.add(candidate);
        result.set(identity.machineId, candidate);
        break;
      }
      salt++;
    }
  }
  return result;
}

function requireIdentity(
  document: V3Document,
  machineId: string,
  kind: V3IdentityRecord['kind']
): V3IdentityRecord {
  const identity = document.identity.get(machineId);
  if (!identity || identity.kind !== kind) throw new Error(`${machineId} is not a ${kind} identity.`);
  return identity;
}

function findOwnedTransform(document: V3Document, ownerId: string): V3IdentityRecord {
  const matches = [...document.identity.values()].filter(identity =>
    identity.kind === 'transform' && identity.ownerId === ownerId
  );
  if (matches.length !== 1) throw new Error(`${ownerId} must own exactly one Transform identity.`);
  return matches[0];
}

function findDesiredRootTransform(document: V3Document, node: V3StructureNode): V3IdentityRecord {
  if (!node.nestedSourceGuid) return findOwnedTransform(document, node.machineId);
  const matches = [...document.identity.values()].filter(identity =>
    identity.kind === 'stripped' && identity.ownerId === node.machineId && identity.nestedRoot &&
    (identity.typeId === 4 || identity.typeId === 224)
  );
  if (matches.length !== 1) {
    throw new Error(`${node.machineId} must own exactly one stripped root Transform identity.`);
  }
  return matches[0];
}

function mergeDetails(
  base: Record<string, unknown>,
  details?: Record<string, unknown>
): Record<string, any> {
  return markCanonicalFlowMappings({ ...clone(base), ...clone(details || {}) }) as Record<string, any>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function flow<T extends Record<string, unknown>>(value: T): T {
  Object.defineProperty(value, '__flow', { value: true, enumerable: false });
  return value;
}

function makeDocument(
  identity: V3IdentityRecord,
  fileId: string,
  properties: Record<string, any>
): UnityDocument {
  return {
    typeId: identity.typeId,
    typeName: identity.typeName,
    fileId,
    stripped: identity.stripped === true,
    properties,
  };
}

function assertUniqueFileIds(documents: UnityDocument[]): void {
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.fileId)) throw new Error(`Compiler produced duplicate fileID ${document.fileId}.`);
    ids.add(document.fileId);
  }
}
