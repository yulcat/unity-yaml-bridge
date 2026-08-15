import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compileV3 } from './v3/compiler';
import { readV3 } from './v3/reader';
import { writeV3 } from './v3/writer';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';

let passed = 0;
let failed = 0;

function assert(condition: unknown, name: string, details = ''): void {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
    failed++;
  }
}

function sample(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, '..', 'samples', ...parts), 'utf-8');
}

function compileText(v3Text: string) {
  return parseUnityYaml(writeUnityYaml(compileV3(readV3(v3Text))));
}

function buttonV3() {
  return readV3(writeV3(parseUnityYaml(sample('prefabs', 'Button.prefab'))));
}

function rootVariantV3() {
  return readV3(writeV3(parseUnityYaml(sample('prefabs', 'RootPrefabInstance.prefab'))));
}

function sourceBackedVariantText() {
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const source = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceGuid = variant.variantSource!.guid!;
  const nameOverride = variant.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name')!;
  nameOverride.target.fileID = source.hierarchy!.fileId;
  nameOverride.target.guid = sourceGuid;
  return writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  });
}

function makeVariantSource(sourceGuid: string, sourceRootFileId: string, name?: string) {
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const instance = variant.documents.find(document => document.typeId === 1001)!;
  instance.properties.m_SourcePrefab = { fileID: 100100000, guid: sourceGuid, type: 3 };
  instance.properties.m_Modification.m_Modifications = name === undefined ? [] : [{
    target: { fileID: sourceRootFileId, guid: sourceGuid, type: 3 },
    propertyPath: 'm_Name',
    value: name,
    objectReference: { fileID: 0 },
  }];
  instance.properties.m_Modification.m_RemovedComponents = [];
  instance.properties.m_Modification.m_RemovedGameObjects = [];
  instance.properties.m_Modification.m_AddedGameObjects = [];
  instance.properties.m_Modification.m_AddedComponents = [];
  return parseUnityYaml(writeUnityYaml(variant));
}

function makeMixedVariant(sourceGuid: string) {
  const source = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
  const variant = makeVariantSource(sourceGuid, source.hierarchy!.fileId);
  const instance = variant.documents.find(document => document.typeId === 1001)!;
  const sourceTransformId = source.hierarchy!.transform.fileId;
  const gameObjectFileId = '9100000000000000001';
  const transformFileId = '9100000000000000002';
  const strippedParentFileId = '9100000000000000003';
  instance.properties.m_Modification.m_AddedGameObjects = [{
    targetCorrespondingSourceObject: { fileID: sourceTransformId, guid: sourceGuid, type: 3 },
    insertIndex: -1,
    addedObject: { fileID: transformFileId },
  }];
  variant.documents.push(
    {
      typeId: 1, typeName: 'GameObject', fileId: gameObjectFileId, stripped: false,
      properties: {
        m_ObjectHideFlags: 0, m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 }, m_PrefabAsset: { fileID: 0 },
        serializedVersion: 6, m_Component: [{ component: { fileID: transformFileId } }],
        m_Layer: 0, m_Name: 'VariantAdded', m_TagString: 'Untagged', m_Icon: { fileID: 0 },
        m_NavMeshLayer: 0, m_StaticEditorFlags: 0, m_IsActive: 1,
      },
    },
    {
      typeId: 224, typeName: 'RectTransform', fileId: transformFileId, stripped: false,
      properties: {
        m_ObjectHideFlags: 0, m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 }, m_PrefabAsset: { fileID: 0 },
        m_GameObject: { fileID: gameObjectFileId }, serializedVersion: 2,
        m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 },
        m_LocalPosition: { x: 0, y: 0, z: 0 }, m_LocalScale: { x: 1, y: 1, z: 1 },
        m_Children: [], m_Father: { fileID: strippedParentFileId }, m_RootOrder: 0,
        m_LocalEulerAnglesHint: { x: 0, y: 0, z: 0 },
        m_AnchorMin: { x: 0.5, y: 0.5 }, m_AnchorMax: { x: 0.5, y: 0.5 },
        m_AnchoredPosition: { x: 0, y: 0 }, m_SizeDelta: { x: 100, y: 100 },
        m_Pivot: { x: 0.5, y: 0.5 },
      },
    },
    {
      typeId: 224, typeName: 'RectTransform', fileId: strippedParentFileId, stripped: true,
      properties: {
        m_CorrespondingSourceObject: { fileID: sourceTransformId, guid: sourceGuid, type: 3 },
        m_PrefabInstance: { fileID: instance.fileId }, m_PrefabAsset: { fileID: 0 },
      },
    }
  );
  return parseUnityYaml(writeUnityYaml(variant));
}

function clearRefsTo(value: any, deleted: Set<string>): any {
  if (Array.isArray(value)) return value.map(item => clearRefsTo(item, deleted));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string' && deleted.has(value.$ref)) return { fileID: 0 };
  for (const [key, child] of Object.entries(value)) value[key] = clearRefsTo(child, deleted);
  return value;
}

function expectThrow(fn: () => unknown, expected: string, name: string): void {
  try {
    fn();
    assert(false, name, 'Expected an error, but none was thrown.');
  } catch (error) {
    assert(String(error).includes(expected), name, String(error));
  }
}

console.log('\n=== v3 ownership cold-boundary edits ===');

{
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
  const otherPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceResolver = { resolveFilePath: (_guid: string) => sourcePath };
  const text = writeV3(parseUnityYaml(sample('prefabs', 'Button.prefab')), { sourceResolver });
  const document = readV3(text);
  const sourceIdentities = [...document.identity.values()].filter(identity => identity.sourceGuid);
  assert(sourceIdentities.length > 0 && sourceIdentities.every(identity =>
    identity.sourceFileId && /^[a-f0-9]{64}$/.test(identity.sourceFingerprint || '')
  ), 'source GUID, source fileID, and fingerprint survive the v3 cold boundary');
  compileV3(document);
  compileV3(document, { sourceResolver });
  expectThrow(
    () => compileV3(document, { sourceResolver: { resolveFilePath: () => otherPath } }),
    'Source fingerprint mismatch',
    'project validation rejects a mismatched source fingerprint'
  );
  expectThrow(
    () => compileV3(document, { sourceResolver: { resolveFilePath: () => undefined } }),
    'cannot resolve GUID',
    'project validation rejects an unavailable source GUID'
  );
}

{
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const source = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceGuid = variant.variantSource!.guid!;
  const nameOverride = variant.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name')!;
  nameOverride.target.fileID = source.hierarchy!.fileId;
  nameOverride.target.guid = sourceGuid;
  const v3Text = writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  });
  const document = readV3(v3Text);
  const inheritedRoot = document.variantRoots?.[0];
  const inheritedIdentity = inheritedRoot && document.identity.get(inheritedRoot.machineId);
  const coldRebuilt = compileV3(document);
  assert(inheritedRoot?.name === 'Ellen' && inheritedIdentity?.origin === 'inherited' &&
         inheritedIdentity?.sourceGuid === sourceGuid &&
         inheritedIdentity?.sourceFileId === source.hierarchy!.fileId &&
         coldRebuilt.documents.length === variant.documents.length,
    'source-backed variant exposes and cold-compiles its inherited effective tree');

  assert(document.kind === 'variant' && !!document.variantRootId &&
         v3Text.includes('(variant @p1 source:a5674d01884853d4e8f2386a171e14d9)'),
    'variant source and root PrefabInstance are explicit in v3 STRUCTURE');

  const details: any = document.details.get(document.variantRootId!);
  const modifications: any[] = details.m_Modification.m_Modifications;
  const name = modifications.find(modification => modification.propertyPath === 'm_Name');
  assert(name?.value === 'Ellen', 'variant name override is present in standalone DETAILS');
  name.value = 'Ellen_v3_edited';

  // Only the parsed v3 document enters compileV3.
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rebuiltName = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name');
  assert(rebuiltName?.value === 'Ellen_v3_edited',
    'variant delta edit compiles without the original variant YAML');
  assert(rebuilt.variantSource?.guid === 'a5674d01884853d4e8f2386a171e14d9',
    'variant source GUID survives standalone compilation');
}

{
  const sourceGuid = '99999999999999999999999999999999';
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const mixed = makeMixedVariant(sourceGuid);
  const originalFileIds = new Set(mixed.documents.map(item => item.fileId));
  const document = readV3(writeV3(mixed, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  }));
  const inheritedRoot = document.variantRoots![0];
  const localChild = inheritedRoot.children.find(child => child.name === 'VariantAdded');
  const localIdentity = localChild && document.identity.get(localChild.machineId);
  const localTransform = localChild && [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === localChild.machineId
  );
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rebuiltInstance = rebuilt.documents.find(item => item.typeId === 1001)!;
  const rebuiltAdded = rebuiltInstance.properties.m_Modification.m_AddedGameObjects[0];
  const rebuiltTransform = rebuilt.documents.find(item => item.fileId === localTransform?.fileId)!;
  assert(!!localChild && localIdentity?.origin !== 'inherited' &&
         localIdentity?.prefabOwnerId === document.variantRootId &&
         rebuilt.documents.length === mixed.documents.length &&
         rebuilt.documents.every(item => originalFileIds.has(item.fileId)) &&
         String(rebuiltAdded.addedObject.fileID) === localTransform?.fileId &&
         String(rebuiltTransform.properties.m_Father.fileID) === '9100000000000000003',
    'mixed inherited and variant-added effective tree exports and cold-compiles with stable ownership');
}

{
  const sourceGuid = '99999999999999999999999999999999';
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const mixed = makeMixedVariant(sourceGuid);
  const instance = mixed.documents.find(item => item.typeId === 1001)!;
  instance.properties.m_Modification.m_AddedGameObjects[0]
    .targetCorrespondingSourceObject.fileID = 999999;
  expectThrow(
    () => writeV3(mixed, {
      sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }),
    'outside the direct source effective tree',
    'mixed effective-tree export rejects a variant-added root with ambiguous direct-source parent'
  );
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-'));
  try {
    const base = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
    const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const baseGuid = '11111111111111111111111111111111';
    const middleGuid = '22222222222222222222222222222222';
    const middle = makeVariantSource(baseGuid, base.hierarchy!.fileId, 'MiddleVariantRoot');
    const middlePath = path.join(directory, 'Middle.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    const leaf = makeVariantSource(middleGuid, base.hierarchy!.fileId);
    const text = writeV3(leaf, {
      sourceResolver: {
        resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
      },
    });
    const document = readV3(text);
    const inheritedRoot = document.variantRoots![0];
    const inheritedIdentity = document.identity.get(inheritedRoot.machineId)!;
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(inheritedRoot.name === 'MiddleVariantRoot' &&
           inheritedIdentity.sourceGuid === middleGuid &&
           inheritedIdentity.sourceFileId === base.hierarchy!.fileId,
      'variant-of-variant expands the direct source effective tree and preserves direct ownership');
    assert(rebuilt.documents.length === leaf.documents.length &&
           rebuilt.variantSource?.guid === middleGuid &&
           rebuilt.prefabInstances[0].modifications.length === 0,
      'untouched variant-of-variant cold-compiles without source YAML');

    const middleInstance = middle.documents.find(item => item.typeId === 1001)!;
    middleInstance.properties.m_Modification.m_Modifications[0].target.guid = middleGuid;
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: {
          resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
        },
      }),
      'ambiguous name ownership',
      'variant source-chain name override rejects the wrong direct-source GUID owner'
    );
    middleInstance.properties.m_Modification.m_Modifications[0].target.guid = baseGuid;
    middleInstance.properties.m_Modification.m_Modifications.push({
      target: { fileID: base.hierarchy!.fileId, guid: baseGuid, type: 3 },
      propertyPath: 'm_Name',
      value: 'ConflictingMiddleName',
      objectReference: { fileID: 0 },
    });
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: {
          resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
        },
      }),
      'ambiguous name ownership',
      'variant source-chain expansion rejects ambiguous intermediate ownership'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-added-root-'));
  try {
    const base = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
    const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const baseGuid = '30303030303030303030303030303030';
    const middleGuid = '40404040404040404040404040404040';
    const middle = makeMixedVariant(baseGuid);
    const middleAddedRoot = middle.hierarchy!.name === '__added_root__'
      ? middle.hierarchy!.children[0]
      : middle.hierarchy!;
    const middlePath = path.join(directory, 'MiddleAddedRoot.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));

    const leaf = makeVariantSource(middleGuid, base.hierarchy!.fileId);
    const document = readV3(writeV3(leaf, {
      sourceResolver: {
        resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
      },
    }));
    const inheritedAddedRoot = document.variantRoots![0].children.find(node =>
      node.name === 'VariantAdded'
    );
    const addedRootIdentity = inheritedAddedRoot && document.identity.get(inheritedAddedRoot.machineId);
    const addedTransformIdentity = inheritedAddedRoot && [...document.identity.values()].find(identity =>
      identity.kind === 'transform' && identity.ownerId === inheritedAddedRoot.machineId
    );
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(addedRootIdentity?.origin === 'inherited' &&
           addedRootIdentity.sourceGuid === middleGuid &&
           addedRootIdentity.sourceFileId === middleAddedRoot.fileId &&
           addedTransformIdentity?.sourceGuid === middleGuid &&
           addedTransformIdentity.sourceFileId === middleAddedRoot.transform.fileId &&
           rebuilt.documents.length === leaf.documents.length &&
           rebuilt.documents.find(item => item.typeId === 1001)!
             .properties.m_Modification.m_AddedGameObjects.length === 0,
      'intermediate variant-added root projects into the leaf effective tree with direct-source identity');

    const localTransformDocument = middle.documents.find(item =>
      item.fileId === middleAddedRoot.transform.fileId
    )!;
    const parentStub = middle.documents.find(item =>
      item.fileId === String(localTransformDocument.properties.m_Father.fileID)
    )!;
    parentStub.properties.m_PrefabInstance.fileID = '999999999999999999';
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: {
          resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
        },
      }),
      'ambiguous direct-owner parent identity',
      'intermediate variant-added root rejects an ambiguous direct PrefabInstance owner'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-added-component-'));
  try {
    const base = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
    const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const baseGuid = '10101010101010101010101010101010';
    const middleGuid = '20202020202020202020202020202020';
    const middleDocument = readV3(writeV3(
      makeVariantSource(baseGuid, base.hierarchy!.fileId),
      { sourceResolver: { resolveFilePath: guid => guid === baseGuid ? basePath : undefined } }
    ));
    const middleRoot = middleDocument.variantRoots![0];
    middleDocument.identity.set('middleAddedComponent', {
      machineId: 'middleAddedComponent', kind: 'component', typeId: 65,
      typeName: 'BoxCollider', displayName: 'BoxCollider', ownerId: middleRoot.machineId,
      prefabOwnerId: middleDocument.variantRootId,
    });
    middleDocument.details.set('middleAddedComponent', {
      m_Enabled: 1, serializedVersion: 3,
      m_Size: { x: 2, y: 3, z: 4 }, m_Center: { x: 0, y: 0, z: 0 },
    });
    middleRoot.components.push({ typeName: 'BoxCollider', machineId: 'middleAddedComponent' });
    const middle = parseUnityYaml(writeUnityYaml(compileV3(middleDocument)));
    const middleComponent = middle.documents.find(document => document.typeId === 65)!;
    const middlePath = path.join(directory, 'MiddleAddedComponent.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));

    const leaf = makeVariantSource(middleGuid, base.hierarchy!.fileId);
    const document = readV3(writeV3(leaf, {
      sourceResolver: {
        resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
      },
    }));
    const inheritedRoot = document.variantRoots![0];
    const projected = inheritedRoot.components.find(component => component.typeName === 'BoxCollider');
    const projectedIdentity = projected && document.identity.get(projected.machineId);
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(projectedIdentity?.origin === 'inherited' &&
           projectedIdentity.sourceGuid === middleGuid &&
           projectedIdentity.sourceFileId === middleComponent.fileId &&
           rebuilt.documents.length === leaf.documents.length &&
           rebuilt.prefabInstances[0].addedComponents.length === 0,
      'intermediate added-component delta projects into the leaf effective tree with direct-source identity');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-remove-component-'));
  try {
    const base = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
    const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const baseGuid = '12121212121212121212121212121212';
    const middleGuid = '23232323232323232323232323232323';
    const removedComponent = base.hierarchy!.components[0];
    const middle = makeVariantSource(baseGuid, base.hierarchy!.fileId);
    const middleInstance = middle.documents.find(item => item.typeId === 1001)!;
    middleInstance.properties.m_Modification.m_RemovedComponents = [{
      fileID: removedComponent.fileId,
      guid: baseGuid,
      type: 3,
    }];
    const middlePath = path.join(directory, 'MiddleRemovedComponent.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    const leaf = makeVariantSource(middleGuid, base.hierarchy!.fileId);
    const document = readV3(writeV3(leaf, {
      sourceResolver: {
        resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
      },
    }));
    const inheritedRoot = document.variantRoots![0];
    const inheritedComponents = inheritedRoot.components.map(component =>
      document.identity.get(component.machineId)!
    );
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(!inheritedComponents.some(identity => identity.sourceFileId === removedComponent.fileId) &&
           inheritedComponents.length === base.hierarchy!.components.length - 1 &&
           inheritedComponents.every(identity => identity.sourceGuid === middleGuid) &&
           rebuilt.documents.length === leaf.documents.length &&
           rebuilt.prefabInstances[0].removedComponents.length === 0,
      'intermediate removed-component delta projects into the leaf effective tree with direct-source identity');

    middleInstance.properties.m_Modification.m_RemovedComponents[0].guid = middleGuid;
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: {
          resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
        },
      }),
      'ambiguous removed-component ownership',
      'intermediate removed-component delta rejects an indirect source owner'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-remove-gameobject-'));
  try {
    const base = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
    const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const baseGuid = '34343434343434343434343434343434';
    const middleGuid = '45454545454545454545454545454545';
    const removedChild = base.hierarchy!.children[0];
    const middle = makeVariantSource(baseGuid, base.hierarchy!.fileId);
    const middleInstance = middle.documents.find(item => item.typeId === 1001)!;
    middleInstance.properties.m_Modification.m_RemovedGameObjects = [{
      fileID: removedChild.fileId,
      guid: baseGuid,
      type: 3,
    }];
    const middlePath = path.join(directory, 'MiddleRemovedGameObject.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    const leaf = makeVariantSource(middleGuid, base.hierarchy!.fileId);
    const document = readV3(writeV3(leaf, {
      sourceResolver: {
        resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
      },
    }));
    const inheritedRoot = document.variantRoots![0];
    const rootIdentity = document.identity.get(inheritedRoot.machineId)!;
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(inheritedRoot.children.length === 0 && rootIdentity.sourceGuid === middleGuid &&
           rootIdentity.sourceFileId === base.hierarchy!.fileId &&
           ![...document.identity.values()].some(identity =>
             identity.sourceFileId === removedChild.fileId
           ) && rebuilt.documents.length === leaf.documents.length &&
           rebuilt.prefabInstances[0].removedGameObjects.length === 0,
      'intermediate removed-GameObject delta projects into the leaf effective tree with direct-source identity');

    middleInstance.properties.m_Modification.m_RemovedGameObjects[0].guid = middleGuid;
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: {
          resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
        },
      }),
      'ambiguous removed-GameObject ownership',
      'intermediate removed-GameObject delta rejects an indirect source owner'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const sourceGuid = '33333333333333333333333333333333';
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
  const source = parseUnityYaml(sample('prefabs', 'Button.prefab'));
  const nestedSourceNode = source.hierarchy!.children.find(node => node.nestedPrefab)!;
  const variant = makeVariantSource(sourceGuid, source.hierarchy!.fileId);
  const document = readV3(writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  }));
  const inheritedNested = document.variantRoots![0].children.find(node => node.nestedSourceGuid);
  const inheritedNestedIdentity = inheritedNested && document.identity.get(inheritedNested.machineId);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  assert(inheritedNested?.name === nestedSourceNode.name &&
         inheritedNested?.nestedSourceGuid === nestedSourceNode.nestedPrefab!.sourceGuid &&
         inheritedNestedIdentity?.kind === 'prefabInstance' &&
         inheritedNestedIdentity?.origin === 'inherited' &&
         inheritedNestedIdentity?.sourceGuid === sourceGuid &&
         inheritedNestedIdentity?.sourceFileId === nestedSourceNode.nestedPrefab!.instanceId,
    'source-backed variant expands an inherited nested PrefabInstance with direct-source ownership');
  assert(rebuilt.documents.length === variant.documents.length &&
         rebuilt.prefabInstances.length === variant.prefabInstances.length &&
         rebuilt.variantSource?.guid === sourceGuid,
    'untouched inherited nested PrefabInstance cold-compiles without emitting source documents');
}

{
  const sourceGuid = '33333333333333333333333333333333';
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
  const source = parseUnityYaml(sample('prefabs', 'Button.prefab'));
  const nestedSource = source.hierarchy!.children.find(node => node.nestedPrefab)!.nestedPrefab!;
  const nestedPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const nested = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
  const nestedChild = nested.hierarchy!.children[0];
  const nestedComponent = nestedChild.components[0];
  const variant = makeVariantSource(sourceGuid, source.hierarchy!.fileId);
  variant.prefabInstances[0].modifications.push(
    {
      target: { fileID: nestedChild.fileId, guid: nestedSource.sourceGuid, type: 3 },
      propertyPath: 'm_Name', value: 'ExistingLeafNestedName', objectReference: { fileID: '0' },
    },
    {
      target: { fileID: nestedComponent.fileId, guid: nestedSource.sourceGuid, type: 3 },
      propertyPath: 'm_Enabled', value: '0', objectReference: { fileID: '0' },
    }
  );
  const document = readV3(writeV3(variant, {
    sourceResolver: {
      resolveFilePath: guid => guid === sourceGuid ? sourcePath :
        guid === nestedSource.sourceGuid ? nestedPath : undefined,
    },
  }));
  const nestedBoundary = document.variantRoots![0].children.find(node => node.nestedSourceGuid)!;
  const projectedChild = nestedBoundary.children.find(node =>
    document.identity.get(node.machineId)?.sourceFileId === nestedChild.fileId
  )!;
  const projectedComponent = projectedChild.components.find(component =>
    document.identity.get(component.machineId)?.sourceFileId === nestedComponent.fileId
  )!;
  assert(projectedChild.name === 'ExistingLeafNestedName' &&
         document.details.get(projectedComponent.machineId)?.m_Enabled === 0,
    'leaf overrides targeting expanded nested-source internals project into effective STRUCTURE and DETAILS');
  projectedChild.name = 'ReplacedLeafNestedName';
  document.details.delete(projectedComponent.machineId);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const nestedOverrides = rebuilt.prefabInstances[0].modifications.filter(modification =>
    modification.target.guid === nestedSource.sourceGuid
  );
  assert(nestedOverrides.some(modification =>
           modification.propertyPath === 'm_Name' && modification.value === 'ReplacedLeafNestedName'
         ) && !nestedOverrides.some(modification => modification.propertyPath === 'm_Enabled'),
    'editing effective nested STRUCTURE replaces projected leaf overrides and removed DETAILS stay removed');
}

{
  const sourceGuid = '33333333333333333333333333333333';
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
  const source = parseUnityYaml(sample('prefabs', 'Button.prefab'));
  const inheritedNestedSource = source.hierarchy!.children.find(node => node.nestedPrefab)!.nestedPrefab!;
  const nestedPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const nested = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
  const nestedRoot = nested.hierarchy!;
  const nestedChild = nestedRoot.children[0];
  const variant = makeVariantSource(sourceGuid, source.hierarchy!.fileId);
  const nestedV3Text = writeV3(variant, {
    sourceResolver: {
      resolveFilePath: guid => guid === sourceGuid ? sourcePath :
        guid === inheritedNestedSource.sourceGuid ? nestedPath : undefined,
    },
  });
  const document = readV3(nestedV3Text);
  const inheritedNested = document.variantRoots![0].children.find(node => node.nestedSourceGuid)!;
  const inheritedNestedMetadata = inheritedNested;
  const nestedRootIdentity = document.identity.get(inheritedNested.machineId);
  const nestedInstanceIdentity = inheritedNestedMetadata.prefabInstanceId
    ? document.identity.get(inheritedNestedMetadata.prefabInstanceId)
    : undefined;
  const nestedRootComponents = inheritedNested.components.map(component =>
    document.identity.get(component.machineId)!
  );
  const internalChild = inheritedNested.children[0];
  const internalGameObject = internalChild && document.identity.get(internalChild.machineId);
  const internalComponent = internalChild && document.identity.get(internalChild.components[0]?.machineId);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  assert(nestedRootIdentity?.kind === 'gameObject' &&
         nestedRootIdentity.origin === 'inherited' &&
         nestedRootIdentity.sourceGuid === inheritedNestedSource.sourceGuid &&
         nestedRootIdentity.sourceFileId === nestedRoot.fileId &&
         nestedRootIdentity.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId &&
         nestedInstanceIdentity?.kind === 'prefabInstance' &&
         nestedInstanceIdentity.prefabOwnerId === document.variantRootId &&
         nestedInstanceIdentity.sourceGuid === sourceGuid &&
         nestedInstanceIdentity.sourceFileId === inheritedNestedSource.instanceId &&
         nestedV3Text.includes(
           `@${inheritedNested.machineId} {prefab:@${inheritedNestedMetadata.prefabInstanceId} ` +
           `source:${inheritedNestedSource.sourceGuid}}`
         ) &&
         inheritedNested.components.length === nestedRoot.components.length &&
         nestedRootComponents.every((identity, index) =>
           identity.ownerId === inheritedNested.machineId &&
           identity.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId &&
           identity.sourceGuid === inheritedNestedSource.sourceGuid &&
           identity.sourceFileId === nestedRoot.components[index].fileId
         ),
    'inherited nested STRUCTURE uses the source-root GameObject with explicit PrefabInstance metadata and root components');
  assert(inheritedNested.nestedSourceGuid === inheritedNestedSource.sourceGuid &&
         inheritedNested.children.length === 1 && internalChild.name === nestedChild.name &&
         internalGameObject?.origin === 'inherited' &&
         internalGameObject.sourceGuid === inheritedNestedSource.sourceGuid &&
         internalGameObject.sourceFileId === nestedChild.fileId &&
         internalGameObject.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId &&
         internalComponent?.origin === 'inherited' &&
         internalComponent.ownerId === internalChild.machineId &&
         internalComponent.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId,
    'inherited nested PrefabInstance exposes read-only internal children and components with nested ownership');
  assert(rebuilt.documents.length === variant.documents.length &&
         rebuilt.prefabInstances.length === variant.prefabInstances.length,
    'expanded inherited nested internals cold-compile without emitting nested source documents');
  expectThrow(
    () => readV3(nestedV3Text.replace(
      `prefab:@${inheritedNestedMetadata.prefabInstanceId}`,
      `prefab:@${document.variantRootId}`
    )),
    'is not directly owned by',
    'nested source-root metadata rejects a mismatched PrefabInstance owner'
  );
  internalChild.name = 'NestedInternalRenamed';
  const renamed = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const renameDelta = renamed.prefabInstances[0].modifications.find(modification =>
    modification.propertyPath === 'm_Name' &&
    String(modification.target.fileID) === internalGameObject?.sourceFileId &&
    modification.target.guid === internalGameObject?.sourceGuid
  );
  assert(renameDelta?.value === 'NestedInternalRenamed' &&
         renamed.documents.length === variant.documents.length,
    'renaming an inherited nested internal emits a source-targeted delta on the owning variant PrefabInstance');
  internalChild.name = nestedChild.name;
  inheritedNested.name = 'NestedSourceRootRenamed';
  const rootRenamed = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rootRenameDelta = rootRenamed.prefabInstances[0].modifications.find(modification =>
    modification.propertyPath === 'm_Name' &&
    String(modification.target.fileID) === nestedRootIdentity?.sourceFileId &&
    modification.target.guid === nestedRootIdentity?.sourceGuid
  );
  assert(rootRenameDelta?.value === 'NestedSourceRootRenamed',
    'renaming an inherited nested source root emits a delta for the nested source GameObject');
  inheritedNested.name = nestedRootIdentity!.displayName!;
  document.details.set(internalComponent!.machineId, { m_Enabled: 0 });
  const propertyEdited = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const propertyDelta = propertyEdited.prefabInstances[0].modifications.find(modification =>
    modification.propertyPath === 'm_Enabled' &&
    String(modification.target.fileID) === internalComponent?.sourceFileId &&
    modification.target.guid === internalComponent?.sourceGuid
  );
  assert(propertyDelta?.value === '0' &&
         propertyEdited.documents.length === variant.documents.length,
    'DETAILS on an inherited nested component emits a source-targeted property delta on the owning variant PrefabInstance');
  document.details.delete(internalComponent!.machineId);
  const duplicateTarget = nestedRootComponents[0];
  const originalDuplicateFileId = duplicateTarget.sourceFileId;
  duplicateTarget.sourceFileId = internalComponent!.sourceFileId;
  document.details.set(duplicateTarget.machineId, { m_Enabled: 1 });
  document.details.set(internalComponent!.machineId, { m_Enabled: 0 });
  expectThrow(
    () => compileV3(document),
    'ambiguous owner/source path',
    'duplicate inherited nested override targets fail closed instead of overwriting one another'
  );
  duplicateTarget.sourceFileId = originalDuplicateFileId;
  document.details.delete(duplicateTarget.machineId);
  document.details.delete(internalComponent!.machineId);
  inheritedNested.children = [];
  expectThrow(
    () => compileV3(document),
    'is missing from variant STRUCTURE',
    'removing an inherited nested internal fails closed instead of compiling as a no-op'
  );
  inheritedNested.children = [internalChild, internalChild];
  expectThrow(
    () => compileV3(document),
    'Structural editing of inherited nested PrefabInstance',
    'ambiguous duplicate addition of an inherited nested internal fails closed'
  );
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-recursive-nested-'));
  try {
    const outerGuid = '56565656565656565656565656565656';
    const innerGuid = '78787878787878787878787878787878';
    const outerPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const outer = parseUnityYaml(sample('prefabs', 'Button.prefab'));
    const middleGuid = outer.hierarchy!.children.find(node => node.nestedPrefab)!.nestedPrefab!.sourceGuid;
    const middle = parseUnityYaml(sample('prefabs', 'Button.prefab'));
    const middleInstance = middle.documents.find(document => document.typeId === 1001)!;
    middleInstance.properties.m_SourcePrefab.guid = innerGuid;
    const middlePath = path.join(directory, 'MiddleNested.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    const reparsedMiddle = parseUnityYaml(fs.readFileSync(middlePath, 'utf-8'));
    const middleNested = reparsedMiddle.hierarchy!.children.find(node => node.nestedPrefab)!.nestedPrefab!;
    const innerPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const inner = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
    const variant = makeVariantSource(outerGuid, outer.hierarchy!.fileId);
    const text = writeV3(variant, {
      sourceResolver: {
        resolveFilePath: guid => guid === outerGuid ? outerPath :
          guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
      },
    });
    const document = readV3(text);
    const outerBoundary = document.variantRoots![0].children.find(
      node => node.nestedSourceGuid === middleGuid
    )!;
    const innerBoundary = outerBoundary.children.find(
      node => node.nestedSourceGuid === innerGuid
    )!;
    const outerPrefab = document.identity.get(outerBoundary.prefabInstanceId!)!;
    const innerPrefab = document.identity.get(innerBoundary.prefabInstanceId!)!;
    const innerRoot = document.identity.get(innerBoundary.machineId)!;
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(!!innerBoundary &&
           text.includes(`@${outerBoundary.machineId} {prefab:@${outerBoundary.prefabInstanceId} source:${middleGuid}}`) &&
           text.includes(`@${innerBoundary.machineId} {prefab:@${innerBoundary.prefabInstanceId} source:${innerGuid}}`) &&
           innerPrefab.kind === 'prefabInstance' && innerPrefab.origin === 'inherited' &&
           innerPrefab.prefabOwnerId === outerPrefab.machineId &&
           innerPrefab.sourceGuid === middleGuid &&
           innerPrefab.sourceFileId === middleNested.instanceId &&
           innerRoot.kind === 'gameObject' && innerRoot.prefabOwnerId === innerPrefab.machineId &&
           innerRoot.sourceGuid === innerGuid && innerRoot.sourceFileId === inner.hierarchy!.fileId,
      'nested-in-nested sources recursively expose source roots with direct PrefabInstance ownership');
    assert(rebuilt.documents.length === variant.documents.length &&
           rebuilt.prefabInstances.length === variant.prefabInstances.length,
      'recursive expanded nested internals cold-compile without source documents');
    const ambiguousOwnershipText = text.replace(
      `prefabOwner:${outerPrefab.machineId} | displayName:${innerPrefab.displayName}`,
      `prefabOwner:${document.variantRootId} | displayName:${innerPrefab.displayName}`
    );
    assert(ambiguousOwnershipText !== text,
      'nested-in-nested ownership ambiguity fixture changes the direct owner');
    expectThrow(
      () => readV3(ambiguousOwnershipText),
      'is not directly owned by',
      'nested-in-nested PrefabInstance metadata rejects an ambiguous direct owner'
    );
    innerBoundary.name = 'DeepNestedRenamed';
    const deepComponent = document.identity.get(innerBoundary.components[0].machineId)!;
    document.details.set(deepComponent.machineId, { m_Enabled: 0 });
    const deeplyEdited = parseUnityYaml(writeUnityYaml(compileV3(document)));
    const deepRenameDelta = deeplyEdited.prefabInstances[0].modifications.find(modification =>
      modification.propertyPath === 'm_Name' &&
      String(modification.target.fileID) === innerRoot.sourceFileId &&
      modification.target.guid === innerRoot.sourceGuid
    );
    const deepPropertyDelta = deeplyEdited.prefabInstances[0].modifications.find(modification =>
      modification.propertyPath === 'm_Enabled' &&
      String(modification.target.fileID) === deepComponent.sourceFileId &&
      modification.target.guid === deepComponent.sourceGuid
    );
    assert(deepRenameDelta?.value === 'DeepNestedRenamed' &&
           deepPropertyDelta?.value === '0' &&
           deeplyEdited.documents.length === variant.documents.length,
      'rename and DETAILS overrides follow the PrefabInstance owner chain at arbitrary nested depth');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-recursive-cycle-'));
  try {
    const outerGuid = '89898989898989898989898989898989';
    const outerPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const outer = parseUnityYaml(sample('prefabs', 'Button.prefab'));
    const middleGuid = outer.hierarchy!.children.find(node => node.nestedPrefab)!.nestedPrefab!.sourceGuid;
    const cyclicMiddle = parseUnityYaml(sample('prefabs', 'Button.prefab'));
    cyclicMiddle.documents.find(document => document.typeId === 1001)!
      .properties.m_SourcePrefab.guid = middleGuid;
    const middlePath = path.join(directory, 'CyclicMiddle.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(cyclicMiddle));
    const variant = makeVariantSource(outerGuid, outer.hierarchy!.fileId);
    expectThrow(
      () => writeV3(variant, {
        sourceResolver: {
          resolveFilePath: guid => guid === outerGuid ? outerPath :
            guid === middleGuid ? middlePath : undefined,
        },
      }),
      `contains a cycle at ${middleGuid}`,
      'recursive nested source expansion rejects cycles'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-nested-chain-'));
  try {
    const base = parseUnityYaml(sample('prefabs', 'Button.prefab'));
    const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const baseGuid = '44444444444444444444444444444444';
    const middleGuid = '55555555555555555555555555555555';
    const middle = makeVariantSource(baseGuid, base.hierarchy!.fileId);
    const middlePath = path.join(directory, 'MiddleNested.prefab');
    fs.writeFileSync(middlePath, writeUnityYaml(middle));
    const leaf = makeVariantSource(middleGuid, base.hierarchy!.fileId);
    const document = readV3(writeV3(leaf, {
      sourceResolver: {
        resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
      },
    }));
    const inheritedNested = document.variantRoots![0].children.find(node => node.nestedSourceGuid)!;
    const inheritedIdentity = document.identity.get(inheritedNested.machineId)!;
    const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
    assert(inheritedIdentity.sourceGuid === middleGuid &&
           inheritedIdentity.sourceFileId === base.hierarchy!.children.find(node => node.nestedPrefab)!.nestedPrefab!.instanceId &&
           rebuilt.documents.length === leaf.documents.length,
      'variant source chain expands inherited nested PrefabInstance with direct-source ownership');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-source-failures-'));
  try {
    const rootFileId = parseUnityYaml(sample('prefabs', 'Button.prefab')).hierarchy!.fileId;
    const firstGuid = '66666666666666666666666666666666';
    const secondGuid = '77777777777777777777777777777777';
    const missingGuid = '88888888888888888888888888888888';
    const firstPath = path.join(directory, 'First.prefab');
    const secondPath = path.join(directory, 'Second.prefab');
    fs.writeFileSync(firstPath, writeUnityYaml(makeVariantSource(secondGuid, rootFileId)));
    fs.writeFileSync(secondPath, writeUnityYaml(makeVariantSource(firstGuid, rootFileId)));
    const leaf = makeVariantSource(firstGuid, rootFileId);
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: {
          resolveFilePath: guid => guid === firstGuid ? firstPath : guid === secondGuid ? secondPath : undefined,
        },
      }),
      'contains a cycle',
      'variant source-chain expansion rejects cycles'
    );

    fs.writeFileSync(firstPath, writeUnityYaml(makeVariantSource(missingGuid, rootFileId)));
    expectThrow(
      () => writeV3(leaf, {
        sourceResolver: { resolveFilePath: guid => guid === firstGuid ? firstPath : undefined },
      }),
      `cannot resolve GUID ${missingGuid}`,
      'variant source-chain expansion rejects a missing intermediate source'
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

{
  const directInherited = readV3(sourceBackedVariantText());
  const root = directInherited.variantRoots![0];
  const child = root.children[0];
  child.name = 'SilentlyIgnoredDirectRename';
  expectThrow(
    () => compileV3(directInherited),
    'Structural editing of direct inherited',
    'direct inherited rename fails closed instead of compiling as a no-op'
  );
  child.name = directInherited.identity.get(child.machineId)!.displayName!;
  root.children = root.children.filter(node => node.machineId !== child.machineId);
  directInherited.variantRoots!.push(child);
  expectThrow(
    () => compileV3(directInherited),
    'Structural editing of direct inherited',
    'direct inherited reparent fails closed instead of compiling as a no-op'
  );
  directInherited.variantRoots!.pop();
  root.children.push(child);
  root.components.reverse();
  expectThrow(
    () => compileV3(directInherited),
    'Structural editing of direct inherited',
    'direct inherited component reorder fails closed instead of compiling as a no-op'
  );
  root.components.reverse();
  directInherited.details.set(child.machineId, { m_IsActive: 0 });
  expectThrow(
    () => compileV3(directInherited),
    'Structural editing of direct inherited',
    'direct inherited semantic DETAILS fail closed instead of compiling as a no-op'
  );
}

{
  const document = readV3(sourceBackedVariantText());
  const root = document.variantRoots![0];
  const removedChild = root.children.shift()!;
  const removedIdentity = document.identity.get(removedChild.machineId)!;
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const removed = rebuilt.prefabInstances[0].removedGameObjects;
  assert(removed.length === 1 &&
         String(removed[0].fileID) === removedIdentity.sourceFileId &&
         removed[0].guid === removedIdentity.sourceGuid,
    'omitting a direct inherited child compiles to m_RemovedGameObjects');
}

{
  const document = readV3(sourceBackedVariantText());
  const removedRoot = document.variantRoots![0];
  const removedIdentity = document.identity.get(removedRoot.machineId)!;
  document.variantRoots = [];
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const removed = rebuilt.prefabInstances[0].removedGameObjects;
  assert(removed.length === 1 &&
         String(removed[0].fileID) === removedIdentity.sourceFileId &&
         removed[0].guid === removedIdentity.sourceGuid,
    'omitting the direct inherited root compiles one explicit root removal');
}

{
  const sourceGuid = '33333333333333333333333333333333';
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
  const source = parseUnityYaml(sample('prefabs', 'Button.prefab'));
  const variant = makeVariantSource(sourceGuid, source.hierarchy!.fileId);
  const document = readV3(writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  }));
  const inheritedNested = document.variantRoots![0].children.find(node => node.nestedSourceGuid)!;
  inheritedNested.name = 'SilentlyIgnoredRename';
  expectThrow(
    () => compileV3(document),
    'Structural editing of inherited nested PrefabInstance',
    'inherited nested PrefabInstance edits fail closed instead of compiling as no-ops'
  );
  inheritedNested.name = document.identity.get(inheritedNested.machineId)!.displayName!;
  document.variantRoots![0].children = document.variantRoots![0].children.filter(
    node => node.machineId !== inheritedNested.machineId
  );
  expectThrow(
    () => compileV3(document),
    'is missing from variant STRUCTURE',
    'removing an inherited nested PrefabInstance fails closed instead of compiling as a no-op'
  );
}

{
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const source = parseUnityYaml(sample('prefabs', 'Amount.prefab'));
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceGuid = variant.variantSource!.guid!;
  const removedChild = source.hierarchy!.children[0];
  variant.prefabInstances[0].removedGameObjects = [{
    fileID: removedChild.fileId, type: 3,
  }];
  expectThrow(
    () => writeV3(variant, {
      sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }),
    'ambiguous removed-GameObject ownership',
    'root-owner export rejects GUID-less removed GameObject targets'
  );
  variant.prefabInstances[0].removedGameObjects = [
    { fileID: removedChild.fileId, guid: sourceGuid, type: 3 },
    { fileID: removedChild.fileId, guid: sourceGuid, type: 3 },
  ];
  expectThrow(
    () => writeV3(variant, {
      sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }),
    'ambiguous removed-GameObject ownership',
    'root-owner export rejects duplicate removed GameObject targets'
  );

  const duplicateNames = makeVariantSource(sourceGuid, source.hierarchy!.fileId, 'FirstName');
  duplicateNames.prefabInstances[0].modifications.push({
    target: { fileID: source.hierarchy!.fileId, guid: sourceGuid, type: 3 },
    propertyPath: 'm_Name', value: 'SecondName', objectReference: { fileID: '0' },
  });
  expectThrow(
    () => writeV3(duplicateNames, {
      sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }),
    'ambiguous name ownership',
    'root-owner export rejects duplicate name override targets'
  );
}

{
  const baselineText = sourceBackedVariantText();
  const baseline = readV3(baselineText);
  const inheritedChild = baseline.variantRoots![0].children[0];
  const sourceIdentity = baseline.identity.get(inheritedChild.machineId)!;
  const tombstoneText = baselineText.replace(
    `${inheritedChild.name} @${inheritedChild.machineId}`,
    `- ${inheritedChild.name} @${inheritedChild.machineId}`
  );
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(readV3(tombstoneText))));
  const removed = rebuilt.prefabInstances[0].removedGameObjects;
  assert(removed.length === 1 &&
         String(removed[0].fileID) === sourceIdentity.sourceFileId &&
         removed[0].guid === sourceIdentity.sourceGuid,
    'an inherited GameObject tombstone compiles to m_RemovedGameObjects');
}

{
  const baseline = readV3(sourceBackedVariantText());
  const inheritedChild = baseline.variantRoots![0].children[0];
  const sourceIdentity = baseline.identity.get(inheritedChild.machineId)!;
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceGuid = variant.variantSource!.guid!;
  variant.prefabInstances[0].removedGameObjects = [{
    fileID: sourceIdentity.sourceFileId!, guid: sourceGuid, type: 3,
  }];
  const text = writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  });
  assert(text.includes(`- ${inheritedChild.name} @${inheritedChild.machineId}`),
    'an existing removed GameObject delta is exported as an explicit tombstone');
}

{
  const baseline = readV3(sourceBackedVariantText());
  const inheritedRoot = baseline.variantRoots![0];
  const rootIdentity = baseline.identity.get(inheritedRoot.machineId)!;
  const childIdentity = baseline.identity.get(inheritedRoot.children[0].machineId)!;
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceGuid = variant.variantSource!.guid!;
  variant.prefabInstances[0].removedGameObjects = [{
    fileID: rootIdentity.sourceFileId!, guid: sourceGuid, type: 3,
  }];
  const document = readV3(writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  }));
  assert(document.variantRoots![0].tombstone === true &&
         document.variantRoots![0].children.length === 0 &&
         [...document.identity.values()].some(identity =>
           identity.kind === 'gameObject' && identity.sourceFileId === childIdentity.sourceFileId
         ),
    'a subtree tombstone retains inherited descendant identities outside the effective tree');
}

{
  const document = readV3(sourceBackedVariantText());
  document.variantRoots![0].tombstone = true;
  expectThrow(
    () => compileV3(document),
    'cannot have effective children',
    'a tombstone with effective children fails closed instead of ignoring the subtree'
  );
}

{
  const document = readV3(sourceBackedVariantText());
  const inheritedRoot = document.variantRoots![0];
  const removedComponent = inheritedRoot.components.pop()!;
  const sourceIdentity = document.identity.get(removedComponent.machineId)!;
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const removed = rebuilt.prefabInstances[0].removedComponents;
  assert(removed.length === 1 &&
         String(removed[0].fileID) === sourceIdentity.sourceFileId &&
         removed[0].guid === sourceIdentity.sourceGuid,
    'removing an inherited component compiles to m_RemovedComponents');
}

{
  const baseline = readV3(sourceBackedVariantText());
  const inheritedRoot = baseline.variantRoots![0];
  const removedComponent = inheritedRoot.components[0];
  const sourceIdentity = baseline.identity.get(removedComponent.machineId)!;
  const variant = parseUnityYaml(sample('variants', 'Ellen_Variant.prefab'));
  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const sourceGuid = variant.variantSource!.guid!;
  variant.prefabInstances[0].removedComponents = [{
    fileID: sourceIdentity.sourceFileId!, guid: sourceGuid, type: 3,
  }];
  const document = readV3(writeV3(variant, {
    sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
  }));
  assert(!document.variantRoots![0].components.some(component =>
    component.machineId === removedComponent.machineId
  ) && document.identity.has(removedComponent.machineId),
  'an existing removed component delta is absent from effective components but keeps identity');
}

{
  const document = readV3(sourceBackedVariantText());
  const inheritedRoot = document.variantRoots![0];
  const inheritedIdentity = document.identity.get(inheritedRoot.machineId)!;
  document.identity.set('cAdded', {
    machineId: 'cAdded', kind: 'component', typeId: 65, typeName: 'BoxCollider',
    displayName: 'BoxCollider', ownerId: inheritedRoot.machineId,
    prefabOwnerId: document.variantRootId,
  });
  document.details.set('cAdded', {
    m_Enabled: 1,
    serializedVersion: 3,
    m_Size: { x: 1, y: 1, z: 1 },
    m_Center: { x: 0, y: 0, z: 0 },
  });
  inheritedRoot.components.push({ typeName: 'BoxCollider', machineId: 'cAdded' });

  const first = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const second = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const instance = first.documents.find(item => item.fileId ===
    document.identity.get(document.variantRootId!)!.fileId)!;
  const added = instance.properties.m_Modification.m_AddedComponents[0];
  const component = first.documents.find(item => item.typeId === 65)!;
  const strippedGameObject = first.documents.find(item => item.stripped && item.typeId === 1 &&
    item.fileId === String(component.properties.m_GameObject.fileID))!;
  const secondComponent = second.documents.find(item => item.typeId === 65)!;
  assert(String(added.targetCorrespondingSourceObject.fileID) === inheritedIdentity.sourceFileId &&
         added.targetCorrespondingSourceObject.guid === inheritedIdentity.sourceGuid &&
         String(added.addedObject.fileID) === component.fileId &&
         String(strippedGameObject.properties.m_PrefabInstance.fileID) === instance.fileId &&
         String(strippedGameObject.properties.m_CorrespondingSourceObject.fileID) === inheritedIdentity.sourceFileId &&
         strippedGameObject.properties.m_CorrespondingSourceObject.guid === inheritedIdentity.sourceGuid &&
         component.fileId === secondComponent.fileId,
    'adding a local component to an inherited GameObject emits direct-owner m_AddedComponents deterministically');

  const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
  const exported = readV3(writeV3(first, {
    sourceResolver: {
      resolveFilePath: guid => guid === inheritedIdentity.sourceGuid ? sourcePath : undefined,
    },
  }));
  const exportedRoot = exported.variantRoots![0];
  const exportedComponent = exportedRoot.components.find(item => item.typeName === 'BoxCollider');
  const exportedIdentity = exportedComponent && exported.identity.get(exportedComponent.machineId);
  const recompiled = parseUnityYaml(writeUnityYaml(compileV3(exported)));
  const recompiledAdded = recompiled.prefabInstances[0].addedComponents[0];
  const recompiledComponent = recompiled.documents.find(item => item.fileId === exportedIdentity?.fileId)!;
  const sourceStubs = recompiled.documents.filter(item => item.stripped && item.typeId === 1 &&
    String(item.properties.m_CorrespondingSourceObject?.fileID) === inheritedIdentity.sourceFileId &&
    item.properties.m_CorrespondingSourceObject?.guid === inheritedIdentity.sourceGuid);
  assert(exportedIdentity?.origin !== 'inherited' &&
         exportedIdentity?.ownerId === exportedRoot.machineId &&
         exportedIdentity?.prefabOwnerId === exported.variantRootId &&
         exportedIdentity?.fileId === component.fileId &&
         exported.details.has(exportedIdentity.machineId) &&
         String(recompiledAdded.targetGameObject.fileID) === inheritedIdentity.sourceFileId &&
         recompiledAdded.targetGameObject.guid === inheritedIdentity.sourceGuid &&
         sourceStubs.length === 1 &&
         String(recompiledComponent.properties.m_GameObject.fileID) === strippedGameObject.fileId,
    'existing m_AddedComponents exports into inherited STRUCTURE and cold-roundtrips');

  exportedRoot.components = exportedRoot.components.filter(item =>
    item.machineId !== exportedIdentity?.machineId
  );
  const removedAgain = parseUnityYaml(writeUnityYaml(compileV3(exported)));
  const removedAgainInstance = removedAgain.prefabInstances[0];
  assert(removedAgainInstance.addedComponents.length === 0 &&
         !removedAgain.documents.some(item => item.fileId === exportedIdentity?.fileId) &&
         !removedAgain.documents.some(item => item.stripped && item.typeId === 1 &&
           String(item.properties.m_CorrespondingSourceObject?.fileID) === inheritedIdentity.sourceFileId &&
           item.properties.m_CorrespondingSourceObject?.guid === inheritedIdentity.sourceGuid),
    'removing an exported local added component removes its delta, document, and unused stripped stub');

  const unmatchedTarget = parseUnityYaml(writeUnityYaml(first));
  const unmatchedInstance = unmatchedTarget.documents.find(item => item.typeId === 1001)!;
  unmatchedInstance.properties.m_Modification.m_AddedComponents[0]
    .targetCorrespondingSourceObject.fileID = 999999;
  const unmatchedComponent = unmatchedTarget.documents.find(item => item.typeId === 65)!;
  const unmatchedStub = unmatchedTarget.documents.find(item => item.fileId ===
    String(unmatchedComponent.properties.m_GameObject.fileID))!;
  unmatchedStub.properties.m_CorrespondingSourceObject.fileID = 999999;
  expectThrow(
    () => writeV3(unmatchedTarget, {
      sourceResolver: {
        resolveFilePath: guid => guid === inheritedIdentity.sourceGuid ? sourcePath : undefined,
      },
    }),
    'missing from the direct source',
    'added-component export fails closed when its source GameObject target is unknown'
  );
}

{
  const document = readV3(sourceBackedVariantText());
  const inheritedRoot = document.variantRoots![0];
  const inheritedTransform = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === inheritedRoot.machineId
  )!;
  document.identity.set('gAdded', {
    machineId: 'gAdded', kind: 'gameObject', typeId: 1, typeName: 'GameObject',
    prefabOwnerId: document.variantRootId,
  });
  document.identity.set('tAdded', {
    machineId: 'tAdded', kind: 'transform', typeId: 224, typeName: 'RectTransform', ownerId: 'gAdded',
  });
  inheritedRoot.children.push({
    name: 'AddedChild', machineId: 'gAdded', components: [], children: [],
  });
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const instance = rebuilt.documents.find(item => item.typeId === 1001)!;
  const added = instance.properties.m_Modification.m_AddedGameObjects[0];
  const addedGameObject = rebuilt.documents.find(item => item.properties.m_Name === 'AddedChild')!;
  const addedTransform = rebuilt.documents.find(item =>
    String(item.properties.m_GameObject?.fileID) === addedGameObject.fileId
  )!;
  assert(String(added.targetCorrespondingSourceObject.fileID) === inheritedTransform.sourceFileId &&
         added.targetCorrespondingSourceObject.guid === inheritedTransform.sourceGuid &&
         String(added.addedObject.fileID) === addedTransform.fileId,
    'adding a local child beneath inherited hierarchy compiles to m_AddedGameObjects');
}

{
  const v3Text = writeV3(parseUnityYaml(sample('prefabs', 'RootPrefabInstance.prefab')));
  const document = readV3(v3Text);
  const unowned = [...document.identity.values()].filter(identity =>
    identity.kind === 'owned' && !identity.ownerId
  );
  assert(unowned.length === 0,
    'variant added-object documents have explicit PrefabInstance ownership');
  assert(document.variantRoots?.[0]?.name === 'Btns' &&
         document.variantRoots[0].children.length === 4,
    'variant added-object hierarchy is explicit in v3 STRUCTURE');
}

{
  const document = rootVariantV3();
  const root = document.variantRoots![0];
  root.children.reverse();
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const transformIdentity = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === root.machineId
  )!;
  const rootTransform = rebuilt.documents.find(item => item.fileId === transformIdentity.fileId)!;
  const expectedFirst = document.identity.get(root.children[0].machineId)?.kind === 'prefabInstance'
    ? [...document.identity.values()].find(identity =>
        identity.kind === 'stripped' && identity.ownerId === root.children[0].machineId && identity.nestedRoot
      )!.fileId
    : [...document.identity.values()].find(identity =>
        identity.kind === 'transform' && identity.ownerId === root.children[0].machineId
      )!.fileId;
  assert(String(rootTransform.properties.m_Children[0].fileID) === expectedFirst,
    'variant local sibling order is authoritative across the cold boundary');
}

{
  const document = rootVariantV3();
  const root = document.variantRoots![0];
  const textBg = root.children.find(child => child.name === 'TextBg')!;
  const noStage = root.children.find(child => child.name === 'NoStage')!;
  const [text] = textBg.children.splice(0, 1);
  text.name = 'MovedText';
  noStage.children.push(text);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const movedTransformIdentity = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === text.machineId
  )!;
  const newParentTransformIdentity = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === noStage.machineId
  )!;
  const movedTransform = rebuilt.documents.find(item => item.fileId === movedTransformIdentity.fileId)!;
  const movedGameObject = rebuilt.documents.find(item => item.fileId === document.identity.get(text.machineId)!.fileId)!;
  assert(String(movedTransform.properties.m_Father.fileID) === newParentTransformIdentity.fileId &&
         movedGameObject.properties.m_Name === 'MovedText',
    'variant local rename and reparent are compiled from STRUCTURE');
}

{
  const document = rootVariantV3();
  const root = document.variantRoots![0];
  document.identity.set('gNew', {
    machineId: 'gNew', kind: 'gameObject', typeId: 1, typeName: 'GameObject',
    prefabOwnerId: document.variantRootId,
  });
  document.identity.set('tNew', {
    machineId: 'tNew', kind: 'transform', typeId: 224, typeName: 'RectTransform', ownerId: 'gNew',
  });
  root.children.push({ name: 'NewLocalChild', machineId: 'gNew', components: [], children: [] });
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const newGameObject = rebuilt.documents.find(item => item.properties.m_Name === 'NewLocalChild')!;
  const rootTransformId = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === root.machineId
  )!.fileId;
  const newTransform = rebuilt.documents.find(item =>
    String(item.properties.m_GameObject?.fileID) === newGameObject.fileId
  )!;
  assert(String(newTransform.properties.m_Father.fileID) === rootTransformId,
    'variant can create a new local child beneath an existing local parent');
}

{
  const document = rootVariantV3();
  document.identity.set('gNewRoot', {
    machineId: 'gNewRoot', kind: 'gameObject', typeId: 1, typeName: 'GameObject',
    prefabOwnerId: document.variantRootId,
  });
  document.identity.set('tNewRoot', {
    machineId: 'tNewRoot', kind: 'transform', typeId: 224, typeName: 'RectTransform', ownerId: 'gNewRoot',
  });
  document.variantRoots!.push({
    name: 'UnsupportedRoot', machineId: 'gNewRoot', components: [], children: [],
  });
  expectThrow(
    () => compileV3(document),
    'requires an inherited source-parent identity',
    'variant root creation fails closed until its inherited parent target is explicit'
  );
}

{
  const document = rootVariantV3();
  const root = document.variantRoots![0];
  const removed = root.children.find(child => child.name === 'TextBg')!;
  const deleted = new Set<string>();
  const collect = (node: typeof removed): void => {
    deleted.add(node.machineId);
    node.components.forEach(component => deleted.add(component.machineId));
    const transform = [...document.identity.values()].find(identity =>
      identity.kind === 'transform' && identity.ownerId === node.machineId
    );
    if (transform) deleted.add(transform.machineId);
    node.children.forEach(collect);
  };
  collect(removed);
  root.children = root.children.filter(child => child !== removed);
  for (const details of document.details.values()) clearRefsTo(details, deleted);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  assert([...deleted].every(machineId => {
    const fileId = document.identity.get(machineId)?.fileId;
    return !fileId || !rebuilt.documents.some(item => item.fileId === fileId);
  }), 'deleting a variant local subtree removes all owned Unity documents');
}

{
  const document = buttonV3();
  const nested = document.structure!.children.find(child => !!child.nestedSourceGuid)!;
  nested.name = 'Button_Text_Renamed';
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const nameOverride = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name');
  assert(nameOverride?.value === 'Button_Text_Renamed',
    'renaming a nested STRUCTURE node rewrites its PrefabInstance name override');
}

{
  const document = buttonV3();
  document.structure!.children.reverse();
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rootTransform = rebuilt.documents.find(item =>
    (item.typeId === 4 || item.typeId === 224) && String(item.properties.m_Father?.fileID) === '0'
  )!;
  const nestedRoot = rebuilt.documents.find(item => item.stripped &&
    item.typeId === 224 && item.properties.m_PrefabInstance?.fileID !== 0)!;
  const rootOrder = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_RootOrder');
  assert(String(rootTransform.properties.m_Children[0].fileID) === nestedRoot.fileId &&
         rootOrder?.value === '0',
    'reordering nested STRUCTURE rewrites parent children and m_RootOrder');
}

{
  const document = buttonV3();
  const root = document.structure!;
  const nestedIndex = root.children.findIndex(child => !!child.nestedSourceGuid);
  const [nested] = root.children.splice(nestedIndex, 1);
  const background = root.children[0];
  background.children.push(nested);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const backgroundIdentity = document.identity.get(background.machineId)!;
  const backgroundTransform = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === backgroundIdentity.machineId
  )!;
  const instance = rebuilt.documents.find(item => item.typeId === 1001)!;
  assert(String(instance.properties.m_Modification.m_TransformParent.fileID) === backgroundTransform.fileId,
    'reparenting nested STRUCTURE rewrites PrefabInstance m_TransformParent');
}

{
  const document = buttonV3();
  document.structure!.children = document.structure!.children.filter(child => !child.nestedSourceGuid);
  (document.details.get('c1') as any).activateDisplayText = { fileID: 0 };
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  assert(!rebuilt.documents.some(item => item.typeId === 1001 || item.stripped),
    'deleting nested STRUCTURE removes its PrefabInstance and stripped ownership documents');
}

{
  const v3Text = writeV3(parseUnityYaml(sample('prefabs', 'Button.prefab')));
  const document = readV3(v3Text);
  const instance = [...document.identity.values()]
    .find(identity => identity.kind === 'prefabInstance');
  assert(!!instance && v3Text.includes(`Button_Text @${instance?.machineId} {source:`),
    'nested PrefabInstance is visible in regular-prefab STRUCTURE');

  const details: any = document.details.get(instance!.machineId);
  const modifications: any[] = details.m_Modification.m_Modifications;
  const name = modifications.find(modification => modification.propertyPath === 'm_Name');
  name.value = 'Button_Text_v3';
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rebuiltName = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name');
  assert(rebuiltName?.value === 'Button_Text_v3',
    'nested PrefabInstance override edit compiles across the cold boundary');
  assert(rebuilt.documents.filter(item => item.stripped).length === 2,
    'nested stripped identity documents are reconstructed');
}

{
  const original = sample('prefabs', 'RootPrefabInstance.prefab');
  const first = compileText(writeV3(parseUnityYaml(original)));
  const secondText = writeUnityYaml(compileV3(readV3(writeV3(parseUnityYaml(original)))));
  assert(first.type === 'variant' && first.hierarchy?.children.length === 4 &&
         first.documents.length === 53,
    'variant with added root objects is independently reconstructed');
  assert(writeUnityYaml(first) === secondText,
    'variant ownership compilation is deterministic');
}

console.log(`\nv3 ownership tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
