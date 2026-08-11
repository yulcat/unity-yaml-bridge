import { createHash } from 'crypto';
import { UnityDocument, UnityFile } from '../types';
import { V3Document, V3IdentityRecord, V3StructureNode } from './model';
import { markCanonicalFlowMappings } from './value';
import { resolveV3References } from './references';

const COMMON_LOCAL_ENVELOPE: Record<string, unknown> = {
  m_ObjectHideFlags: 0,
  m_CorrespondingSourceObject: { fileID: 0 },
  m_PrefabInstance: { fileID: 0 },
  m_PrefabAsset: { fileID: 0 },
};

export function compileV3(document: V3Document): UnityFile {
  if (document.version !== 3) throw new Error('compileV3 accepts v3 documents only.');
  if (document.kind === 'variant') return compileVariant(document);
  if (!document.structure) throw new Error('v3 prefab requires STRUCTURE.');

  const allocated = allocateFileIds(document);
  const documents: UnityDocument[] = [];
  const emittedMachineIds = new Set<string>();

  const buildNode = (node: V3StructureNode, parentTransformId: string, siblingIndex: number): void => {
    if (node.nestedSourceGuid) return;
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

    node.children.forEach((child, index) => buildNode(child, transformId, index));
  };

  buildNode(document.structure, '0', 0);
  for (const identity of document.identity.values()) {
    if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned') continue;
    const properties = document.details.get(identity.machineId);
    if (!properties) throw new Error(`Raw ownership identity ${identity.machineId} requires DETAILS.`);
    documents.push(makeDocument(identity, allocated.get(identity.machineId)!, clone(properties)));
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

function compileVariant(document: V3Document): UnityFile {
  const allocated = allocateFileIds(document);
  const emitted = new Set(document.identity.keys());
  const documents: UnityDocument[] = [];
  for (const identity of document.identity.values()) {
    if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned') {
      throw new Error(`Unsupported variant identity kind ${identity.kind} on ${identity.machineId}.`);
    }
    const details = document.details.get(identity.machineId);
    if (!details) throw new Error(`Variant identity ${identity.machineId} requires DETAILS.`);
    const properties = markCanonicalFlowMappings(resolveV3References(
      clone(details), allocated, emitted, `${identity.typeName}&${identity.fileId || identity.machineId}`
    )) as Record<string, any>;
    documents.push(makeDocument(identity, allocated.get(identity.machineId)!, properties));
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
