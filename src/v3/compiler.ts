import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { UnityDocument, UnityFile } from '../types';
import { V3CompileOptions, V3Document, V3IdentityRecord, V3StructureNode } from './model';
import { markCanonicalFlowMappings } from './value';
import {
  resolveV3OverrideReference,
  resolveV3References,
  validateV3ExternalObjectReference,
} from './references';
import {
  isV3OverrideStructuralPath,
  pathsHaveSegmentPrefixOverlap,
  validateV3OverridePropertyPath,
} from './override-validation';

const COMMON_LOCAL_ENVELOPE: Record<string, unknown> = {
  m_ObjectHideFlags: 0,
  m_CorrespondingSourceObject: { fileID: 0 },
  m_PrefabInstance: { fileID: 0 },
  m_PrefabAsset: { fileID: 0 },
};

const SAFE_OBJECT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function flattenPrimitiveOverrideObject(
  propertyPath: string,
  value: unknown,
  context: string
): Array<{ propertyPath: string; value: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Inherited nested DETAILS ${context} requires a nonempty primitive object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Inherited nested DETAILS ${context} requires a plain JSON object.`);
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (keys.length === 0) {
    throw new Error(`Inherited nested DETAILS ${context} requires a nonempty primitive object.`);
  }
  if (keys.includes('$ref') || keys.includes('fileID')) {
    throw new Error(`Inherited nested DETAILS ${context} cannot contain a reference shape.`);
  }
  const leaves: Array<{ propertyPath: string; value: string }> = [];
  for (const key of keys) {
    if (!SAFE_OBJECT_KEY.test(key) || UNSAFE_OBJECT_KEYS.has(key)) {
      throw new Error(`Inherited nested DETAILS ${context} has an unsafe object key ${JSON.stringify(key)}.`);
    }
    const childPath = `${propertyPath}.${key}`;
    const childContext = `${context}.${key}`;
    const child = object[key];
    if (child === null || Array.isArray(child)) {
      throw new Error(`Inherited nested DETAILS ${childContext} requires a primitive leaf.`);
    }
    if (typeof child === 'object') {
      leaves.push(...flattenPrimitiveOverrideObject(childPath, child, childContext));
      continue;
    }
    if (typeof child !== 'string' && typeof child !== 'number' && typeof child !== 'boolean') {
      throw new Error(`Inherited nested DETAILS ${childContext} requires a primitive leaf.`);
    }
    if (typeof child === 'number' && !Number.isFinite(child)) {
      throw new Error(`Inherited nested DETAILS ${childContext} requires a finite number.`);
    }
    leaves.push({
      propertyPath: childPath,
      value: typeof child === 'boolean' ? (child ? '1' : '0') : String(child),
    });
  }
  return leaves;
}

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

function validateRawModificationObjectReference(value: unknown, context: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid v3 object reference at ${context}.`);
  }
  const objectReference = value as Record<string, unknown>;
  const keys = Object.keys(objectReference);
  if (keys.length === 1 && keys[0] === 'fileID') {
    const fileId = typeof objectReference.fileID === 'number'
      ? (Number.isSafeInteger(objectReference.fileID) ? String(objectReference.fileID) : '')
      : typeof objectReference.fileID === 'string' && /^(0|-?[1-9]\d*)$/.test(objectReference.fileID)
        ? objectReference.fileID
        : '';
    if (!fileId) throw new Error(`Invalid v3 object reference at ${context}.`);
    return;
  }
  validateV3ExternalObjectReference(objectReference, context);
}

function upsertModification(
  modifications: any[],
  target: any,
  propertyPath: string,
  value: string,
  objectReference: Record<string, unknown> = { fileID: 0 }
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
    existing.objectReference = clone(objectReference);
    return;
  }
  modifications.push({
    target: clone(target),
    propertyPath,
    value,
    objectReference: clone(objectReference),
  });
}

function compileVariant(document: V3Document): UnityFile {
  const allocated = allocateFileIds(document);
  const effectiveReferenceIds = collectEffectiveReferenceIds(document);
  const emitted = new Set<string>();
  const documents: UnityDocument[] = [];
  const nestedPlans = new Map<string, NestedInstancePlan>();
  const removedGameObjects: Array<Record<string, unknown>> = [];
  const removedComponents: Array<Record<string, unknown>> = [];
  const addedGameObjects: Array<Record<string, unknown>> = [];
  const addedComponents: Array<Record<string, unknown>> = [];
  const inheritedGameObjectStubs = new Map<string, string>();
  const inheritedTransformStubs = new Map<string, string>();
  const usedInheritedStubIds = new Set<string>();
  const desiredInheritedNestedInstances = new Set<string>();
  const desiredInheritedNestedInternals = new Set<string>();
  const removedInheritedNestedGameObjects = new Set<string>();
  const removedInheritedNestedComponents = new Set<string>();
  const effectiveDirectInheritedGameObjects = new Set<string>();
  const explicitRemovedDirectInheritedGameObjects = new Set<string>();
  const inheritedNestedOverrides: Array<{
    machineId: string;
    ownerId: string;
    target: Record<string, unknown>;
    propertyPath: string;
    value: string;
    objectReference: Record<string, unknown>;
  }> = [];
  const hasInheritedStructure = [...document.identity.values()].some(identity =>
    identity.origin === 'inherited'
  );

  const requireEmittedPrefabOwner = (identity: V3IdentityRecord, operation: string): string => {
    if (!identity.sourceGuid || !identity.sourceFileId) {
      throw new Error(`Inherited nested identity ${identity.machineId} has incomplete ${operation} ownership.`);
    }
    if (!identity.prefabOwnerId) {
      if (identity.origin !== 'inherited' || identity.sourceGuid !== document.baseGuid ||
          !document.variantRootId) {
        throw new Error(`Direct inherited identity ${identity.machineId} has incomplete ${operation} ownership.`);
      }
      return document.variantRootId;
    }
    const visited = new Set<string>();
    let ownerId = identity.prefabOwnerId;
    while (ownerId !== document.variantRootId) {
      if (visited.has(ownerId)) {
        throw new Error(`Inherited nested identity ${identity.machineId} has a cyclic PrefabInstance owner path.`);
      }
      visited.add(ownerId);
      const owner = requireIdentity(document, ownerId, 'prefabInstance');
      if (owner.origin !== 'inherited' || !owner.prefabOwnerId) {
        throw new Error(`Inherited nested identity ${identity.machineId} has no direct emitted PrefabInstance owner.`);
      }
      ownerId = owner.prefabOwnerId;
    }
    return ownerId;
  };

  const queueInheritedNestedGameObjectRemoval = (identity: V3IdentityRecord): void => {
    const ownerId = requireEmittedPrefabOwner(identity, 'removal');
    const duplicate = [...document.identity.values()].find(candidate =>
      candidate.machineId !== identity.machineId && candidate.kind === 'gameObject' &&
      candidate.origin === 'inherited' && candidate.prefabOwnerId &&
      candidate.sourceGuid === identity.sourceGuid && candidate.sourceFileId === identity.sourceFileId &&
      requireEmittedPrefabOwner(candidate, 'removal') === ownerId
    );
    if (duplicate) {
      throw new Error(
        `Inherited nested removals ${duplicate.machineId} and ${identity.machineId} have an ambiguous owner/source path.`
      );
    }
    if (removedInheritedNestedGameObjects.has(identity.machineId)) return;
    removedInheritedNestedGameObjects.add(identity.machineId);
    removedGameObjects.push({
      fileID: identity.sourceFileId!,
      guid: identity.sourceGuid!,
      type: 3,
    });
  };

  const queueInheritedNestedComponentRemoval = (identity: V3IdentityRecord): void => {
    const ownerId = requireEmittedPrefabOwner(identity, 'removal');
    const duplicate = [...document.identity.values()].find(candidate =>
      candidate.machineId !== identity.machineId && candidate.kind === 'component' &&
      candidate.origin === 'inherited' && candidate.prefabOwnerId &&
      candidate.sourceGuid === identity.sourceGuid && candidate.sourceFileId === identity.sourceFileId &&
      requireEmittedPrefabOwner(candidate, 'removal') === ownerId
    );
    if (duplicate) {
      throw new Error(
        `Inherited nested removals ${duplicate.machineId} and ${identity.machineId} have an ambiguous owner/source path.`
      );
    }
    if (removedInheritedNestedComponents.has(identity.machineId)) return;
    removedInheritedNestedComponents.add(identity.machineId);
    removedComponents.push({
      fileID: identity.sourceFileId!,
      guid: identity.sourceGuid!,
      type: 3,
    });
  };

  const queueInheritedNestedOverride = (
    identity: V3IdentityRecord,
    propertyPath: string,
    value: string,
    objectReference: Record<string, unknown> = { fileID: 0 }
  ): void => {
    const ownerId = requireEmittedPrefabOwner(identity, 'override');
    const duplicate = inheritedNestedOverrides.find(override =>
      override.ownerId === ownerId && override.propertyPath === propertyPath &&
      String(override.target.fileID) === identity.sourceFileId &&
      String(override.target.guid) === identity.sourceGuid
    );
    if (duplicate) {
      throw new Error(
        `Inherited nested overrides ${duplicate.machineId} and ${identity.machineId} have an ambiguous owner/source path.`
      );
    }
    const overlap = inheritedNestedOverrides.find(override =>
      override.ownerId === ownerId &&
      String(override.target.fileID) === identity.sourceFileId &&
      String(override.target.guid) === identity.sourceGuid &&
      pathsHaveSegmentPrefixOverlap(override.propertyPath, propertyPath)
    );
    if (overlap) {
      throw new Error(
        `Inherited nested override ${identity.machineId}.${propertyPath} overlaps another property path ` +
        `${overlap.propertyPath}.`
      );
    }
    inheritedNestedOverrides.push({
      machineId: identity.machineId,
      ownerId,
      target: { fileID: identity.sourceFileId, guid: identity.sourceGuid, type: 3 },
      propertyPath,
      value,
      objectReference,
    });
  };

  const queueInheritedNestedDetails = (identity: V3IdentityRecord): void => {
    const details = document.details.get(identity.machineId);
    if (!details) return;
    const baselineAt = (propertyPath: string): unknown => {
      let value: unknown = identity.baselineDetails;
      for (const segment of propertyPath.split('.')) {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            !Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
        value = (value as Record<string, unknown>)[segment];
      }
      return value;
    };
    const equalsBaseline = (propertyPath: string, value: unknown): boolean =>
      JSON.stringify(baselineAt(propertyPath)) === JSON.stringify(value);
    for (const [propertyPath, value] of Object.entries(details).sort(([left], [right]) =>
      left.localeCompare(right))) {
      if (propertyPath.length === 0) {
        throw new Error(`Inherited nested DETAILS ${identity.machineId} has an empty property path.`);
      }
      validateV3OverridePropertyPath(propertyPath, `${identity.machineId}.${propertyPath}`);
      if (isV3OverrideStructuralPath(propertyPath) &&
          !(identity.kind === 'component' && propertyPath === 'm_Name')) {
        throw new Error(
          `Inherited nested DETAILS ${identity.machineId}.${propertyPath} is structural and not supported.`
        );
      }
      if (equalsBaseline(propertyPath, value)) continue;
      if (value === null) {
        queueInheritedNestedOverride(identity, propertyPath, '', { fileID: 0 });
        continue;
      }
      if (typeof value === 'object') {
        const object = value as Record<string, unknown>;
        const keys = Object.keys(object);
        const isReferenceShape = keys.includes('$ref') || keys.includes('fileID');
        if (!isReferenceShape) {
          for (const leaf of flattenPrimitiveOverrideObject(
            propertyPath, value, `${identity.machineId}.${propertyPath}`
          )) {
            if (equalsBaseline(leaf.propertyPath,
              typeof baselineAt(leaf.propertyPath) === 'boolean'
                ? leaf.value === '1'
                : typeof baselineAt(leaf.propertyPath) === 'number'
                  ? Number(leaf.value)
                  : leaf.value)) continue;
            queueInheritedNestedOverride(identity, leaf.propertyPath, leaf.value);
          }
          continue;
        }
        const objectReference = resolveV3OverrideReference(
          value,
          machineId => {
            const target = document.identity.get(machineId);
            if (!target || !effectiveReferenceIds.has(machineId)) return undefined;
            if (target.origin === 'inherited') {
              if (!target.sourceGuid || !target.sourceFileId) return undefined;
              const matches = [...effectiveReferenceIds].filter(candidateId => {
                const candidate = document.identity.get(candidateId);
                return candidate?.origin === 'inherited' &&
                  candidate.sourceGuid === target.sourceGuid &&
                  candidate.sourceFileId === target.sourceFileId;
              });
              if (matches.length !== 1) {
                throw new Error(
                  `Ambiguous inherited v3 reference at ${identity.machineId}.${propertyPath}: ${machineId}.`
                );
              }
              return { fileID: target.sourceFileId, guid: target.sourceGuid, type: 3 };
            }
            const fileID = allocated.get(machineId);
            return fileID ? { fileID } : undefined;
          },
          `${identity.machineId}.${propertyPath}`
        );
        queueInheritedNestedOverride(identity, propertyPath, '', objectReference!);
        continue;
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(
          `Inherited nested DETAILS ${identity.machineId}.${propertyPath} requires a scalar, null, stable reference, or explicit external reference.`
        );
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(
          `Inherited nested DETAILS ${identity.machineId}.${propertyPath} requires a finite number.`
        );
      }
      queueInheritedNestedOverride(
        identity,
        propertyPath,
        typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
      );
    }
  };

  const assertUniqueInheritedSourceTarget = (
    identity: V3IdentityRecord,
    operation: string
  ): void => {
    const matches = [...document.identity.values()].filter(candidate =>
      candidate.kind === identity.kind && candidate.origin === 'inherited' &&
      candidate.sourceGuid === identity.sourceGuid &&
      candidate.sourceFileId === identity.sourceFileId
    );
    if (matches.length !== 1 || matches[0].machineId !== identity.machineId) {
      throw new Error(
        `Inherited nested ${operation} target ${identity.sourceGuid}:${identity.sourceFileId} ` +
        'has an ambiguous owner/source path.'
      );
    }
  };

  const requireLeafOwnedTransformStub = (transform: V3IdentityRecord): string => {
    requireEmittedPrefabOwner(transform, 'addition');
    assertUniqueInheritedSourceTarget(transform, 'GameObject addition');
    const cached = inheritedTransformStubs.get(transform.machineId);
    if (cached) return cached;
    const existing = findInheritedTransformStub(document, transform);
    if (existing) {
      const fileId = allocated.get(existing.machineId)!;
      inheritedTransformStubs.set(transform.machineId, fileId);
      return fileId;
    }
    const leafOwner = requireIdentity(document, document.variantRootId!, 'prefabInstance');
    const fileId = allocateSyntheticFileId(
      document, `inherited-transform:${transform.machineId}`, allocated
    );
    documents.push({
      typeId: transform.typeId,
      typeName: transform.typeName,
      fileId,
      stripped: true,
      properties: {
        m_CorrespondingSourceObject: {
          fileID: transform.sourceFileId,
          guid: transform.sourceGuid,
          type: 3,
        },
        m_PrefabInstance: { fileID: allocated.get(leafOwner.machineId)! },
        m_PrefabAsset: { fileID: 0 },
      },
    });
    inheritedTransformStubs.set(transform.machineId, fileId);
    return fileId;
  };

  const emitLocalComponentOnInheritedGameObject = (
    gameObject: V3IdentityRecord,
    component: V3IdentityRecord
  ): void => {
    if (component.ownerId !== gameObject.machineId ||
        component.prefabOwnerId !== document.variantRootId) {
      throw new Error(
        `Local component ${component.machineId} on inherited GameObject ${gameObject.machineId} ` +
        'requires the emitted leaf PrefabInstance owner.'
      );
    }
    requireEmittedPrefabOwner(gameObject, 'component addition');
    assertUniqueInheritedSourceTarget(gameObject, 'component addition');
    const leafOwner = requireIdentity(document, document.variantRootId!, 'prefabInstance');
    let strippedGameObjectId = inheritedGameObjectStubs.get(gameObject.machineId);
    if (!strippedGameObjectId) {
      const existingStub = findInheritedGameObjectStub(document, gameObject, leafOwner);
      if (existingStub) {
        strippedGameObjectId = allocated.get(existingStub.machineId)!;
        usedInheritedStubIds.add(existingStub.machineId);
      } else {
        strippedGameObjectId = allocateSyntheticFileId(
          document, `inherited-game-object:${gameObject.machineId}`, allocated
        );
        documents.push({
          typeId: 1,
          typeName: 'GameObject',
          fileId: strippedGameObjectId,
          stripped: true,
          properties: {
            m_CorrespondingSourceObject: {
              fileID: gameObject.sourceFileId,
              guid: gameObject.sourceGuid,
              type: 3,
            },
            m_PrefabInstance: { fileID: allocated.get(leafOwner.machineId)! },
            m_PrefabAsset: { fileID: 0 },
          },
        });
      }
      inheritedGameObjectStubs.set(gameObject.machineId, strippedGameObjectId);
    }
    const properties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(component.machineId));
    properties.m_GameObject = { fileID: strippedGameObjectId };
    if (component.typeId === 114) {
      if (!component.scriptGuid) {
        throw new Error(`MonoBehaviour ${component.machineId} requires script GUID identity.`);
      }
      properties.m_Enabled ??= 1;
      properties.m_EditorHideFlags ??= 0;
      properties.m_Script = {
        fileID: component.scriptFileId ?? 11500000,
        guid: component.scriptGuid,
        type: component.scriptType ?? 3,
      };
      properties.m_Name ??= '';
      properties.m_EditorClassIdentifier ??= '';
    }
    documents.push(makeDocument(component, allocated.get(component.machineId)!, properties));
    emitted.add(component.machineId);
    addedComponents.push({
      targetCorrespondingSourceObject: {
        fileID: gameObject.sourceFileId,
        guid: gameObject.sourceGuid,
        type: 3,
      },
      insertIndex: -1,
      addedObject: { $ref: component.machineId },
    });
  };

  const validateInheritedNestedInternal = (
    node: V3StructureNode,
    prefabOwnerId: string,
    nestedSourceGuid: string,
    parentTransformMachineId: string | undefined,
    siblingIndex: number,
    sourceRoot = false
  ): void => {
    if (node.tombstone) {
      if (node.children.length > 0) {
        throw new Error(`GameObject tombstone ${node.machineId} cannot have effective children.`);
      }
      const identity = requireIdentity(document, node.machineId, 'gameObject');
      if (identity.origin !== 'inherited' || identity.prefabOwnerId !== prefabOwnerId ||
          identity.sourceGuid !== nestedSourceGuid || !identity.sourceFileId) {
        throw new Error(`GameObject tombstone ${node.machineId} has ambiguous inherited nested ownership.`);
      }
      queueInheritedNestedGameObjectRemoval(identity);
      return;
    }
    if (node.nestedSourceGuid && !sourceRoot) {
      if (node.prefabInstanceId) {
        const nestedPrefab = requireIdentity(document, node.prefabInstanceId, 'prefabInstance');
        if (nestedPrefab.origin !== 'inherited' || nestedPrefab.prefabOwnerId !== prefabOwnerId ||
            nestedPrefab.sourceGuid !== nestedSourceGuid || !nestedPrefab.sourceFileId ||
            nestedPrefab.baselineParentId !== parentTransformMachineId ||
            nestedPrefab.baselineOrder !== siblingIndex) {
          throw new Error(
            `Structural editing of inherited nested PrefabInstance ${node.prefabInstanceId} internals is not implemented.`
          );
        }
        desiredInheritedNestedInstances.add(nestedPrefab.machineId);
        validateInheritedNestedInternal(
          node,
          nestedPrefab.machineId,
          node.nestedSourceGuid,
          parentTransformMachineId,
          siblingIndex,
          true
        );
        return;
      }
      const unresolvedPrefab = requireIdentity(document, node.machineId, 'prefabInstance');
      if (unresolvedPrefab.origin !== 'inherited' || unresolvedPrefab.prefabOwnerId !== prefabOwnerId ||
          unresolvedPrefab.sourceGuid !== nestedSourceGuid || !unresolvedPrefab.sourceFileId ||
          unresolvedPrefab.displayName !== node.name ||
          unresolvedPrefab.baselineParentId !== parentTransformMachineId ||
          unresolvedPrefab.baselineOrder !== siblingIndex || node.components.length > 0 ||
          node.children.length > 0) {
        throw new Error(
          `Structural editing of inherited nested PrefabInstance ${node.machineId} internals is not implemented.`
        );
      }
      desiredInheritedNestedInstances.add(unresolvedPrefab.machineId);
      return;
    }
    if (sourceRoot && node.prefabInstanceId !== prefabOwnerId) {
      throw new Error(
        `Nested source-root ${node.machineId} is not directly owned by ${prefabOwnerId}.`
      );
    }
    const gameObject = requireIdentity(document, node.machineId, 'gameObject');
    const transform = findOwnedTransform(document, node.machineId);
    if (gameObject.origin !== 'inherited' || gameObject.prefabOwnerId !== prefabOwnerId ||
        gameObject.sourceGuid !== nestedSourceGuid || !gameObject.sourceFileId ||
        transform.origin !== 'inherited' ||
        transform.prefabOwnerId !== prefabOwnerId || transform.sourceGuid !== nestedSourceGuid ||
        !transform.sourceFileId || transform.baselineParentId !== parentTransformMachineId ||
        transform.baselineOrder !== siblingIndex) {
      throw new Error(
        `Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`
      );
    }
    if (gameObject.displayName !== node.name) {
      queueInheritedNestedOverride(gameObject, 'm_Name', node.name);
    }
    queueInheritedNestedDetails(gameObject);
    desiredInheritedNestedInternals.add(gameObject.machineId);
    desiredInheritedNestedInternals.add(transform.machineId);
    const baselineComponents = [...document.identity.values()]
      .filter(identity => identity.kind === 'component' && identity.origin === 'inherited' &&
        identity.prefabOwnerId === prefabOwnerId && identity.ownerId === gameObject.machineId)
      .sort((left, right) => (left.baselineOrder ?? -1) - (right.baselineOrder ?? -1));
    const desiredComponentIds = new Set(node.components.map(component => component.machineId));
    if (desiredComponentIds.size !== node.components.length) {
      throw new Error(
        `Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`
      );
    }
    const desiredInheritedComponents = node.components.filter(component =>
      document.identity.get(component.machineId)?.origin === 'inherited'
    );
    const desiredBaselineComponents = baselineComponents.filter(identity =>
      desiredComponentIds.has(identity.machineId)
    );
    if (desiredBaselineComponents.length !== desiredInheritedComponents.length) {
      throw new Error(
        `Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`
      );
    }
    let inheritedComponentIndex = 0;
    node.components.forEach(component => {
      const identity = requireIdentity(document, component.machineId, 'component');
      if (identity.origin !== 'inherited') {
        if ((identity.displayName || identity.typeName) !== component.typeName) {
          throw new Error(`Invalid component binding ${component.typeName} @${component.machineId}.`);
        }
        emitLocalComponentOnInheritedGameObject(gameObject, identity);
        return;
      }
      if (identity !== desiredBaselineComponents[inheritedComponentIndex++] ||
          identity.ownerId !== gameObject.machineId ||
          identity.prefabOwnerId !== prefabOwnerId || identity.sourceGuid !== nestedSourceGuid ||
          !identity.sourceFileId ||
          (identity.displayName || identity.typeName) !== component.typeName) {
        throw new Error(
          `Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`
        );
      }
      desiredInheritedNestedInternals.add(identity.machineId);
      queueInheritedNestedDetails(identity);
    });
    for (const identity of baselineComponents) {
      if (!desiredComponentIds.has(identity.machineId)) {
        queueInheritedNestedComponentRemoval(identity);
      }
    }
    let inheritedChildIndex = 0;
    node.children.forEach((child, index) => {
      const childIdentity = document.identity.get(child.machineId);
      if (!childIdentity) throw new Error(`Missing identity ${child.machineId}.`);
      if (childIdentity.origin === 'inherited' || child.nestedSourceGuid) {
        validateInheritedNestedInternal(
          child, prefabOwnerId, nestedSourceGuid, transform.machineId, inheritedChildIndex++
        );
        return;
      }
      if (childIdentity.kind !== 'gameObject' ||
          childIdentity.prefabOwnerId !== document.variantRootId) {
        throw new Error(
          `Local GameObject ${child.machineId} below inherited nested ${node.machineId} ` +
          'requires the emitted leaf PrefabInstance owner.'
        );
      }
      const childTransform = findOwnedTransform(document, child.machineId);
      if (childTransform.origin === 'inherited' ||
          childTransform.prefabOwnerId !== document.variantRootId) {
        throw new Error(`Local GameObject ${child.machineId} has ambiguous Transform ownership.`);
      }
      buildNode(
        child,
        requireLeafOwnedTransformStub(transform),
        index,
        transform.machineId
      );
    });
  };

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
      if (identity.prefabOwnerId) queueInheritedNestedGameObjectRemoval(identity);
      else {
        removedGameObjects.push({
          fileID: identity.sourceFileId,
          guid: identity.sourceGuid,
          type: 3,
        });
        explicitRemovedDirectInheritedGameObjects.add(identity.machineId);
      }
      return;
    }
    if (node.nestedSourceGuid && node.prefabInstanceId) {
      const identity = requireIdentity(document, node.prefabInstanceId, 'prefabInstance');
      if (identity.origin !== 'inherited' || !identity.sourceGuid || !identity.sourceFileId) {
        throw new Error(`Inherited nested PrefabInstance ${node.prefabInstanceId} has no direct source identity.`);
      }
      validateInheritedNestedInternal(
        node, identity.machineId, node.nestedSourceGuid, parentTransformMachineId, siblingIndex, true
      );
      desiredInheritedNestedInstances.add(identity.machineId);
      return;
    }
    if (node.nestedSourceGuid) {
      const identity = requireIdentity(document, node.machineId, 'prefabInstance');
      if (identity.origin === 'inherited') {
        if (!identity.sourceGuid || !identity.sourceFileId) {
          throw new Error(`Inherited nested PrefabInstance ${node.machineId} has no direct source identity.`);
        }
        if (node.components.length > 0 ||
            node.name !== identity.displayName ||
            identity.baselineParentId !== parentTransformMachineId ||
            identity.baselineOrder !== siblingIndex) {
          throw new Error(
            `Structural editing of inherited nested PrefabInstance ${node.machineId} is not implemented.`
          );
        }
        node.children.forEach((child, index) => validateInheritedNestedInternal(
          child, node.machineId, node.nestedSourceGuid!, node.machineId, index
        ));
        desiredInheritedNestedInstances.add(node.machineId);
        return;
      }
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
      if (!goIdentity.prefabOwnerId) effectiveDirectInheritedGameObjects.add(goIdentity.machineId);
      const desiredInheritedComponentIds = new Set<string>();
      let previousInheritedOrder = -Infinity;
      const directComponentStructureChanged = node.components.some(component => {
        const identity = requireIdentity(document, component.machineId, 'component');
        if (identity.origin !== 'inherited') return false;
        const baselineOrder = identity.baselineOrder;
        const changed = desiredInheritedComponentIds.has(identity.machineId) ||
          identity.ownerId !== goIdentity.machineId || baselineOrder === undefined ||
          baselineOrder <= previousInheritedOrder ||
          (identity.displayName || identity.typeName) !== component.typeName;
        desiredInheritedComponentIds.add(identity.machineId);
        if (baselineOrder !== undefined) previousInheritedOrder = baselineOrder;
        return changed;
      });
      const directStructuralChange = transformIdentity.baselineParentId !== parentTransformMachineId ||
        transformIdentity.baselineOrder !== siblingIndex || directComponentStructureChanged;
      if (!goIdentity.prefabOwnerId && directStructuralChange) {
        throw new Error(
          `Structural editing of direct inherited GameObject ${goIdentity.machineId} is not implemented.`
        );
      }
      if (!goIdentity.prefabOwnerId && goIdentity.displayName !== node.name) {
        queueInheritedNestedOverride(goIdentity, 'm_Name', node.name);
      }
      if (!goIdentity.prefabOwnerId) {
        queueInheritedNestedDetails(goIdentity);
        if (document.details.has(transformIdentity.machineId)) {
          throw new Error(
            `Structural editing of direct inherited Transform ${transformIdentity.machineId} is not implemented.`
          );
        }
      }
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
      if (transformIdentity.origin !== 'inherited') {
        throw new Error(`Inherited STRUCTURE node ${node.machineId} has mixed local ownership.`);
      }
      for (const component of node.components) {
        const identity = requireIdentity(document, component.machineId, 'component');
        if (identity.origin === 'inherited') {
          if (!goIdentity.prefabOwnerId) queueInheritedNestedDetails(identity);
          continue;
        }
        if (identity.ownerId !== goIdentity.machineId ||
            !identity.prefabOwnerId || identity.prefabOwnerId !== document.variantRootId) {
          throw new Error(
            `Local component ${identity.machineId} on inherited GameObject ${goIdentity.machineId} ` +
            'requires its direct PrefabInstance owner.'
          );
        }
        if (!goIdentity.sourceGuid || !goIdentity.sourceFileId) {
          throw new Error(`Inherited GameObject ${goIdentity.machineId} has no source identity.`);
        }
        const ownerIdentity = requireIdentity(document, identity.prefabOwnerId, 'prefabInstance');
        let strippedGameObjectId = inheritedGameObjectStubs.get(goIdentity.machineId);
        if (!strippedGameObjectId) {
          const existingStub = findInheritedGameObjectStub(
            document, goIdentity, ownerIdentity
          );
          if (existingStub) {
            strippedGameObjectId = allocated.get(existingStub.machineId)!;
            usedInheritedStubIds.add(existingStub.machineId);
          } else {
            strippedGameObjectId = allocateSyntheticFileId(
              document, `inherited-game-object:${goIdentity.machineId}`, allocated
            );
            documents.push({
              typeId: 1,
              typeName: 'GameObject',
              fileId: strippedGameObjectId,
              stripped: true,
              properties: {
                m_CorrespondingSourceObject: {
                  fileID: goIdentity.sourceFileId,
                  guid: goIdentity.sourceGuid,
                  type: 3,
                },
                m_PrefabInstance: { fileID: allocated.get(ownerIdentity.machineId)! },
                m_PrefabAsset: { fileID: 0 },
              },
            });
          }
          inheritedGameObjectStubs.set(goIdentity.machineId, strippedGameObjectId);
        }
        const componentProperties = mergeDetails(
          COMMON_LOCAL_ENVELOPE, document.details.get(identity.machineId)
        );
        componentProperties.m_GameObject = { fileID: strippedGameObjectId };
        if (identity.typeId === 114) {
          if (!identity.scriptGuid) {
            throw new Error(`MonoBehaviour ${identity.machineId} requires script GUID identity.`);
          }
          componentProperties.m_Enabled ??= 1;
          componentProperties.m_EditorHideFlags ??= 0;
          componentProperties.m_Script = {
            fileID: identity.scriptFileId ?? 11500000,
            guid: identity.scriptGuid,
            type: identity.scriptType ?? 3,
          };
          componentProperties.m_Name ??= '';
          componentProperties.m_EditorClassIdentifier ??= '';
        }
        documents.push(makeDocument(identity, allocated.get(identity.machineId)!, componentProperties));
        emitted.add(identity.machineId);
        addedComponents.push({
          targetCorrespondingSourceObject: {
            fileID: goIdentity.sourceFileId,
            guid: goIdentity.sourceGuid,
            type: 3,
          },
          insertIndex: -1,
          addedObject: { $ref: identity.machineId },
        });
      }
      node.children.forEach((child, index) => {
        const childIdentity = document.identity.get(child.machineId);
        if (!childIdentity) throw new Error(`Missing identity ${child.machineId}.`);
        if (child.nestedSourceGuid) {
          const prefabIdentity = document.identity.get(child.prefabInstanceId || child.machineId);
          const validNested = child.prefabInstanceId
            ? childIdentity.kind === 'gameObject' && childIdentity.origin === 'inherited' &&
              prefabIdentity?.kind === 'prefabInstance' && prefabIdentity.origin === 'inherited'
            : childIdentity.kind === 'prefabInstance' && childIdentity.origin === 'inherited';
          if (!validNested) {
            throw new Error(
              `Adding nested PrefabInstance ${child.prefabInstanceId || child.machineId} ` +
              'below an inherited parent is not implemented.'
            );
          }
        } else if (childIdentity.kind !== 'gameObject') {
          throw new Error(`${child.machineId} is not a gameObject identity.`);
        } else if (childIdentity.origin !== 'inherited' &&
                   (!transformIdentity.sourceGuid || !transformIdentity.sourceFileId)) {
          throw new Error(`Inherited parent ${transformIdentity.machineId} has no source identity.`);
        }
        let inheritedParentTransformId = '0';
        if (!child.nestedSourceGuid && childIdentity.origin !== 'inherited') {
          const existingParentStub = findInheritedTransformStub(document, transformIdentity);
          if (existingParentStub) {
            inheritedParentTransformId = allocated.get(existingParentStub.machineId)!;
          }
        }
        buildNode(child, inheritedParentTransformId, index, transformIdentity.machineId);
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
  for (const identity of document.identity.values()) {
    if (identity.kind !== 'gameObject' || identity.origin !== 'inherited' || identity.prefabOwnerId ||
        effectiveDirectInheritedGameObjects.has(identity.machineId) ||
        explicitRemovedDirectInheritedGameObjects.has(identity.machineId)) continue;
    const transform = findOwnedTransform(document, identity.machineId);
    const parentTransform = transform.baselineParentId
      ? document.identity.get(transform.baselineParentId)
      : undefined;
    const isMissingRoot = !transform.baselineParentId;
    const isMissingChildOfEffectiveParent = parentTransform?.kind === 'transform' &&
      !!parentTransform.ownerId && effectiveDirectInheritedGameObjects.has(parentTransform.ownerId);
    if (!isMissingRoot && !isMissingChildOfEffectiveParent) continue;
    if (!identity.sourceGuid || !identity.sourceFileId) {
      throw new Error(`Removed inherited GameObject ${identity.machineId} has no source identity.`);
    }
    removedGameObjects.push({
      fileID: identity.sourceFileId,
      guid: identity.sourceGuid,
      type: 3,
    });
  }
  const nestedGameObjects = [...document.identity.values()].filter(identity =>
    identity.kind === 'gameObject' && identity.origin === 'inherited' && identity.prefabOwnerId &&
    document.identity.get(identity.prefabOwnerId)?.kind === 'prefabInstance' &&
    document.identity.get(identity.prefabOwnerId)?.origin === 'inherited'
  );
  const missingNestedGameObjects = new Set(nestedGameObjects
    .filter(identity => !desiredInheritedNestedInternals.has(identity.machineId))
    .map(identity => identity.machineId));
  const baselineParentGameObject = (identity: V3IdentityRecord): string | undefined => {
    const transform = findOwnedTransform(document, identity.machineId);
    if (!transform.baselineParentId) return undefined;
    const parentTransform = document.identity.get(transform.baselineParentId);
    return parentTransform?.kind === 'transform' ? parentTransform.ownerId : undefined;
  };
  for (const identity of nestedGameObjects) {
    if (!missingNestedGameObjects.has(identity.machineId)) continue;
    const parentGameObjectId = baselineParentGameObject(identity);
    if (parentGameObjectId && missingNestedGameObjects.has(parentGameObjectId)) continue;
    queueInheritedNestedGameObjectRemoval(identity);
  }
  const removalSuppressesIdentity = (identity: V3IdentityRecord): boolean => {
    if (identity.kind === 'gameObject') {
      return missingNestedGameObjects.has(identity.machineId);
    }
    if (identity.kind === 'component' && removedInheritedNestedComponents.has(identity.machineId)) {
      return true;
    }
    if ((identity.kind === 'transform' || identity.kind === 'component') && identity.ownerId) {
      return missingNestedGameObjects.has(identity.ownerId);
    }
    if (identity.kind !== 'prefabInstance') return false;
    const parentTransform = identity.baselineParentId
      ? document.identity.get(identity.baselineParentId)
      : undefined;
    if (parentTransform?.kind === 'transform' && parentTransform.ownerId &&
        missingNestedGameObjects.has(parentTransform.ownerId)) return true;
    const missingSourceRoots = nestedGameObjects.filter(candidate => {
      if (candidate.prefabOwnerId !== identity.machineId ||
          !missingNestedGameObjects.has(candidate.machineId)) return false;
      const transform = findOwnedTransform(document, candidate.machineId);
      const parent = transform.baselineParentId
        ? document.identity.get(transform.baselineParentId)
        : undefined;
      return parent?.kind !== 'transform' || parent.prefabOwnerId !== identity.machineId;
    });
    if (missingSourceRoots.length > 1) {
      throw new Error(`Inherited nested PrefabInstance ${identity.machineId} has ambiguous source-root ownership.`);
    }
    return missingSourceRoots.length === 1;
  };
  for (const identity of document.identity.values()) {
    if (identity.kind === 'prefabInstance' && identity.origin === 'inherited' &&
        !desiredInheritedNestedInstances.has(identity.machineId) &&
        !removalSuppressesIdentity(identity)) {
      throw new Error(`Inherited nested PrefabInstance ${identity.machineId} is missing from variant STRUCTURE.`);
    }
    if ((identity.kind === 'gameObject' || identity.kind === 'transform' || identity.kind === 'component') &&
        identity.origin === 'inherited' && identity.prefabOwnerId &&
        document.identity.get(identity.prefabOwnerId)?.kind === 'prefabInstance' &&
        document.identity.get(identity.prefabOwnerId)?.origin === 'inherited' &&
        !desiredInheritedNestedInternals.has(identity.machineId) &&
        !removalSuppressesIdentity(identity)) {
      throw new Error(
        `Inherited nested PrefabInstance ${identity.prefabOwnerId} internal ${identity.machineId} ` +
        'is missing from variant STRUCTURE.'
      );
    }
  }
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
    if (identity.kind === 'stripped' && identity.typeId === 1 &&
        isDirectInheritedGameObjectStub(document, identity) &&
        !usedInheritedStubIds.has(identity.machineId)) continue;
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
      modification.m_AddedComponents = addedComponents;
      const inheritedSourceTargets = new Map<string, number>();
      const inheritedSourceGuids = new Set<string>();
      const nestedSourceGuids = new Set<string>();
      const nestedTargets = new Set<string>();
      for (const candidate of document.identity.values()) {
        if (candidate.origin !== 'inherited' || !candidate.sourceGuid) continue;
        inheritedSourceGuids.add(candidate.sourceGuid);
        if (!candidate.sourceFileId) continue;
        const sourceKey = `${candidate.sourceGuid}:${candidate.sourceFileId}`;
        inheritedSourceTargets.set(sourceKey, (inheritedSourceTargets.get(sourceKey) ?? 0) + 1);
        if (candidate.prefabOwnerId) {
          nestedSourceGuids.add(candidate.sourceGuid);
          nestedTargets.add(sourceKey);
        }
      }
      if (document.baseGuid) inheritedSourceGuids.add(document.baseGuid);
      const preservedRawSourcePaths = new Map<string, string[]>();
      if (Array.isArray(modification.m_Modifications)) {
        const rawSourcePaths = new Map<string, string[]>();
        modification.m_Modifications = (modification.m_Modifications as any[]).filter(entry => {
          const targetGuid = String(entry?.target?.guid ?? '');
          const targetKey = `${targetGuid}:${String(entry?.target?.fileID ?? '0')}`;
          const propertyPath = String(entry?.propertyPath ?? '');
          if (inheritedSourceGuids.has(targetGuid)) {
            validateV3OverridePropertyPath(propertyPath, `${targetKey}.${propertyPath}`);
            if (nestedSourceGuids.has(targetGuid) && propertyPath !== 'm_Name' &&
                isV3OverrideStructuralPath(propertyPath)) {
              throw new Error(
                `Raw inherited nested modification ${targetKey}.${propertyPath} is structural and not supported.`
              );
            }
            validateRawModificationObjectReference(
              entry?.objectReference,
              `${targetKey}.${propertyPath}`
            );
            const existingPaths = rawSourcePaths.get(targetKey) ?? [];
            const conflict = existingPaths.find(existing =>
              existing === propertyPath || pathsHaveSegmentPrefixOverlap(existing, propertyPath)
            );
            if (conflict) {
              throw new Error(
                `Raw inherited modification ${targetKey}.${propertyPath} overlaps another property path ${conflict}.`
              );
            }
            existingPaths.push(propertyPath);
            rawSourcePaths.set(targetKey, existingPaths);
            const targetCount = inheritedSourceTargets.get(targetKey) ?? 0;
            if (targetCount === 0) {
              throw new Error(
                `Raw inherited modification target ${targetKey} does not resolve to an inherited source identity.`
              );
            }
            if (targetCount !== 1) {
              throw new Error(
                `Raw inherited modification target ${targetKey} resolves ambiguously to inherited source identities.`
              );
            }
          }
          if (!nestedTargets.has(targetKey)) {
            const paths = preservedRawSourcePaths.get(targetKey) ?? [];
            paths.push(propertyPath);
            preservedRawSourcePaths.set(targetKey, paths);
            return true;
          }
          return false;
        });
      }
      for (const override of inheritedNestedOverrides) {
        if (override.ownerId !== identity.machineId) continue;
        const targetKey = `${String(override.target.guid)}:${String(override.target.fileID)}`;
        const rawConflict = (preservedRawSourcePaths.get(targetKey) ?? []).find(propertyPath =>
          propertyPath === override.propertyPath ||
          pathsHaveSegmentPrefixOverlap(propertyPath, override.propertyPath)
        );
        if (rawConflict) {
          throw new Error(
            `Preserved raw modification ${targetKey}.${rawConflict} overlaps newly authored semantic ` +
            `modification ${override.propertyPath}.`
          );
        }
        if (!Array.isArray(modification.m_Modifications)) modification.m_Modifications = [];
        upsertModification(
          modification.m_Modifications as any[],
          override.target,
          override.propertyPath,
          override.value,
          override.objectReference
        );
      }
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

function collectEffectiveReferenceIds(document: V3Document): Set<string> {
  const result = new Set<string>();
  const visit = (node: V3StructureNode): void => {
    if (node.tombstone) return;
    result.add(node.machineId);
    if (node.prefabInstanceId) result.add(node.prefabInstanceId);
    for (const component of node.components) result.add(component.machineId);
    for (const identity of document.identity.values()) {
      if (identity.kind === 'transform' && identity.ownerId === node.machineId) {
        result.add(identity.machineId);
      }
    }
    node.children.forEach(visit);
  };
  if (document.structure) visit(document.structure);
  document.variantRoots?.forEach(visit);
  if (document.variantRootId) result.add(document.variantRootId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const identity of document.identity.values()) {
      if (identity.origin === 'inherited' || result.has(identity.machineId)) continue;
      const emittedRawRoot = identity.kind === 'owned' && !identity.ownerId;
      if (emittedRawRoot || (identity.ownerId && result.has(identity.ownerId))) {
        result.add(identity.machineId);
        changed = true;
      }
    }
  }
  return result;
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

function allocateSyntheticFileId(
  document: V3Document,
  key: string,
  allocated: Map<string, string>
): string {
  const existing = allocated.get(key);
  if (existing) return existing;
  const occupied = new Set(allocated.values());
  let salt = 0;
  while (true) {
    const seed = `${document.assetGuid || document.profile}|${key}|stripped|${salt}`;
    const digest = createHash('sha256').update(seed).digest();
    const candidate = (digest.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
    if (candidate !== '0' && !occupied.has(candidate)) {
      allocated.set(key, candidate);
      return candidate;
    }
    salt++;
  }
}

function findInheritedTransformStub(
  document: V3Document,
  transform: V3IdentityRecord
): V3IdentityRecord | undefined {
  const sourceMatches = [...document.identity.values()].filter(identity => {
    if (identity.kind !== 'stripped' || (identity.typeId !== 4 && identity.typeId !== 224)) {
      return false;
    }
    const details: any = document.details.get(identity.machineId);
    const source = details?.m_CorrespondingSourceObject;
    return String(source?.fileID ?? '0') === transform.sourceFileId &&
      String(source?.guid ?? '') === transform.sourceGuid;
  });
  const directMatches = sourceMatches.filter(identity => {
    if (identity.ownerId !== document.variantRootId) return false;
    const owner: any = document.details.get(identity.machineId)?.m_PrefabInstance;
    const root = document.variantRootId
      ? document.identity.get(document.variantRootId)
      : undefined;
    return owner?.$ref === document.variantRootId ||
      (!!root?.fileId && String(owner?.fileID ?? '0') === root.fileId);
  });
  if (sourceMatches.length > 0 && directMatches.length !== 1) {
    throw new Error(
      `Inherited Transform ${transform.machineId} has ambiguous stripped Transform ownership.`
    );
  }
  return directMatches[0];
}

function findInheritedGameObjectStub(
  document: V3Document,
  gameObject: V3IdentityRecord,
  owner: V3IdentityRecord
): V3IdentityRecord | undefined {
  const sourceMatches = [...document.identity.values()].filter(identity => {
    if (identity.kind !== 'stripped' || identity.typeId !== 1) return false;
    const details: any = document.details.get(identity.machineId);
    const source = details?.m_CorrespondingSourceObject;
    return String(source?.fileID ?? '0') === gameObject.sourceFileId &&
      String(source?.guid ?? '') === gameObject.sourceGuid;
  });
  const directMatches = sourceMatches.filter(identity => {
    if (identity.ownerId !== owner.machineId) return false;
    const prefabInstance: any = document.details.get(identity.machineId)?.m_PrefabInstance;
    return prefabInstance?.$ref === owner.machineId ||
      (!!owner.fileId && String(prefabInstance?.fileID ?? '0') === owner.fileId);
  });
  if (sourceMatches.length > 0 && directMatches.length !== 1) {
    throw new Error(
      `Inherited GameObject ${gameObject.machineId} has ambiguous stripped GameObject ownership.`
    );
  }
  return directMatches[0];
}

function isDirectInheritedGameObjectStub(
  document: V3Document,
  identity: V3IdentityRecord
): boolean {
  if (!document.variantRootId || identity.ownerId !== document.variantRootId) return false;
  const details: any = document.details.get(identity.machineId);
  const source = details?.m_CorrespondingSourceObject;
  const prefabInstance = details?.m_PrefabInstance;
  const root = document.identity.get(document.variantRootId);
  const hasDirectOwner = prefabInstance?.$ref === document.variantRootId ||
    (!!root?.fileId && String(prefabInstance?.fileID ?? '0') === root.fileId);
  if (!hasDirectOwner) return false;
  return [...document.identity.values()].some(candidate =>
    candidate.kind === 'gameObject' && candidate.origin === 'inherited' &&
    candidate.sourceFileId === String(source?.fileID ?? '0') &&
    candidate.sourceGuid === String(source?.guid ?? '')
  );
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
