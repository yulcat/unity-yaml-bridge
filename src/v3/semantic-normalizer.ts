import { UnityDocument, UnityFile } from '../types';

const LOCAL_LINK_FIELDS = [
  'm_CorrespondingSourceObject',
  'm_PrefabInstance',
  'm_PrefabAsset',
] as const;

export interface SemanticDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

/** Canonical semantic view for regular prefabs. Local structural links are
 * represented explicitly; ownership documents are compared as serialized
 * semantic records. */
export function normalizeLocalPrefab(file: UnityFile): unknown {
  if (file.type === 'variant') {
    return {
      kind: 'variant',
      documents: file.documents.map(document => ({
        fileId: document.fileId,
        typeId: document.typeId,
        typeName: document.typeName,
        stripped: document.stripped,
        properties: stable(clone(document.properties)),
      })).sort((left, right) => compareFileIds(left.fileId, right.fileId)),
    };
  }
  if (file.type !== 'prefab') throw new Error('v3 semantic normalization supports prefabs and variants only.');

  const byId = new Map(file.documents.map(document => [document.fileId, document]));
  const transformByGameObject = new Map<string, UnityDocument>();
  for (const document of file.documents) {
    if (document.typeId !== 4 && document.typeId !== 224) continue;
    const owner = referenceId(document.properties.m_GameObject);
    if (owner !== '0') transformByGameObject.set(owner, document);
  }

  const documents = file.documents.map(document => {
    if (document.stripped || document.typeId === 1001) {
      return {
        fileId: document.fileId,
        typeId: document.typeId,
        typeName: document.typeName,
        stripped: document.stripped,
        structural: {},
        properties: stable(clone(document.properties)),
      };
    }
    const properties = canonicalProperties(document);
    const structural: Record<string, unknown> = {};

    if (document.typeId === 1) {
      structural.name = String(document.properties.m_Name ?? '');
      structural.components = (document.properties.m_Component || [])
        .map((entry: any) => referenceId(entry?.component || entry));
      const transform = transformByGameObject.get(document.fileId);
      structural.transform = transform?.fileId || null;
      delete properties.m_Name;
      delete properties.m_Component;
    } else if (document.typeId === 4 || document.typeId === 224) {
      structural.owner = referenceId(document.properties.m_GameObject);
      structural.parent = referenceId(document.properties.m_Father);
      structural.children = (document.properties.m_Children || []).map(referenceId);
      delete properties.m_GameObject;
      delete properties.m_Father;
      delete properties.m_Children;
      delete properties.m_RootOrder;
    } else {
      structural.owner = referenceId(document.properties.m_GameObject);
      delete properties.m_GameObject;
    }

    return {
      fileId: document.fileId,
      typeId: document.typeId,
      typeName: document.typeName,
      stripped: false,
      structural: stable(structural),
      properties: stable(properties),
    };
  }).sort((left, right) => compareFileIds(left.fileId, right.fileId));

  return { kind: 'local-prefab', documents };
}

export function compareLocalPrefabSemantics(
  expected: UnityFile,
  actual: UnityFile
): SemanticDifference | null {
  return firstDifference(normalizeLocalPrefab(expected), normalizeLocalPrefab(actual), '$');
}

function canonicalProperties(document: UnityDocument): Record<string, any> {
  const properties = clone(document.properties);
  for (const field of LOCAL_LINK_FIELDS) {
    const value = properties[field];
    if (value === undefined || referenceId(value) === '0') delete properties[field];
  }
  properties.m_ObjectHideFlags ??= 0;

  if (document.typeId === 1) {
    properties.serializedVersion ??= 6;
    properties.m_Layer ??= 0;
    properties.m_TagString ??= 'Untagged';
    properties.m_Icon ??= { fileID: 0 };
    properties.m_NavMeshLayer ??= 0;
    properties.m_StaticEditorFlags ??= 0;
    properties.m_IsActive ??= 1;
  } else if (document.typeId === 4 || document.typeId === 224) {
    properties.serializedVersion ??= 2;
    properties.m_LocalRotation ??= { x: 0, y: 0, z: 0, w: 1 };
    properties.m_LocalPosition ??= { x: 0, y: 0, z: 0 };
    properties.m_LocalScale ??= { x: 1, y: 1, z: 1 };
    properties.m_LocalEulerAnglesHint ??= { x: 0, y: 0, z: 0 };
    if (document.typeId === 224) {
      properties.m_AnchorMin ??= { x: 0.5, y: 0.5 };
      properties.m_AnchorMax ??= { x: 0.5, y: 0.5 };
      properties.m_AnchoredPosition ??= { x: 0, y: 0 };
      properties.m_SizeDelta ??= { x: 100, y: 100 };
      properties.m_Pivot ??= { x: 0.5, y: 0.5 };
    }
  } else if (document.typeId === 114) {
    properties.m_Enabled ??= 1;
    properties.m_EditorHideFlags ??= 0;
    properties.m_Name ??= '';
    properties.m_EditorClassIdentifier ??= '';
  }
  return properties;
}

function referenceId(value: any): string {
  if (!value || value.fileID === undefined || value.fileID === null) return '0';
  return String(value.fileID);
}

function compareFileIds(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function firstDifference(expected: any, actual: any, path: string): SemanticDifference | null {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null) {
    return { path, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return { path, expected, actual };
    }
    for (let index = 0; index < expected.length; index++) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof expected === 'object') {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    if (expectedKeys.length !== actualKeys.length ||
        expectedKeys.some((key, index) => key !== actualKeys[index])) {
      return { path, expected: expectedKeys, actual: actualKeys };
    }
    for (const key of expectedKeys) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, expected, actual };
}
