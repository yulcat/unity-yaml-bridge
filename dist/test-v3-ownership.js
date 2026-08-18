"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const compiler_1 = require("./v3/compiler");
const reader_1 = require("./v3/reader");
const writer_1 = require("./v3/writer");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
let passed = 0;
let failed = 0;
function assert(condition, name, details = '') {
    if (condition) {
        console.log(`  PASS: ${name}`);
        passed++;
    }
    else {
        console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
        failed++;
    }
}
function sample(...parts) {
    return fs.readFileSync(path.join(__dirname, '..', 'samples', ...parts), 'utf-8');
}
function compileText(v3Text) {
    return (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(v3Text))));
}
function buttonV3() {
    return (0, reader_1.readV3)((0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'))));
}
function rootVariantV3() {
    return (0, reader_1.readV3)((0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'RootPrefabInstance.prefab'))));
}
function sourceBackedVariant() {
    const variant = (0, unity_yaml_parser_1.parseUnityYaml)(sample('variants', 'Ellen_Variant.prefab'));
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const sourceGuid = variant.variantSource.guid;
    for (const modification of variant.prefabInstances[0].modifications) {
        modification.target.fileID = modification.propertyPath === 'm_Name'
            ? source.hierarchy.fileId
            : source.hierarchy.transform.fileId;
        modification.target.guid = sourceGuid;
    }
    return variant;
}
function sourceBackedVariantText() {
    const variant = sourceBackedVariant();
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceGuid = variant.variantSource.guid;
    return (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    });
}
function makeVariantSource(sourceGuid, sourceRootFileId, name) {
    const variant = (0, unity_yaml_parser_1.parseUnityYaml)(sample('variants', 'Ellen_Variant.prefab'));
    const instance = variant.documents.find(document => document.typeId === 1001);
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
    return (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)(variant));
}
function makeMixedVariant(sourceGuid) {
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const variant = makeVariantSource(sourceGuid, source.hierarchy.fileId);
    const instance = variant.documents.find(document => document.typeId === 1001);
    const sourceTransformId = source.hierarchy.transform.fileId;
    const gameObjectFileId = '9100000000000000001';
    const transformFileId = '9100000000000000002';
    const strippedParentFileId = '9100000000000000003';
    instance.properties.m_Modification.m_AddedGameObjects = [{
            targetCorrespondingSourceObject: { fileID: sourceTransformId, guid: sourceGuid, type: 3 },
            insertIndex: -1,
            addedObject: { fileID: transformFileId },
        }];
    variant.documents.push({
        typeId: 1, typeName: 'GameObject', fileId: gameObjectFileId, stripped: false,
        properties: {
            m_ObjectHideFlags: 0, m_CorrespondingSourceObject: { fileID: 0 },
            m_PrefabInstance: { fileID: 0 }, m_PrefabAsset: { fileID: 0 },
            serializedVersion: 6, m_Component: [{ component: { fileID: transformFileId } }],
            m_Layer: 0, m_Name: 'VariantAdded', m_TagString: 'Untagged', m_Icon: { fileID: 0 },
            m_NavMeshLayer: 0, m_StaticEditorFlags: 0, m_IsActive: 1,
        },
    }, {
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
    }, {
        typeId: 224, typeName: 'RectTransform', fileId: strippedParentFileId, stripped: true,
        properties: {
            m_CorrespondingSourceObject: { fileID: sourceTransformId, guid: sourceGuid, type: 3 },
            m_PrefabInstance: { fileID: instance.fileId }, m_PrefabAsset: { fileID: 0 },
        },
    });
    return (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)(variant));
}
function clearRefsTo(value, deleted) {
    if (Array.isArray(value))
        return value.map(item => clearRefsTo(item, deleted));
    if (!value || typeof value !== 'object')
        return value;
    if (typeof value.$ref === 'string' && deleted.has(value.$ref))
        return { fileID: 0 };
    for (const [key, child] of Object.entries(value))
        value[key] = clearRefsTo(child, deleted);
    return value;
}
function expectThrow(fn, expected, name) {
    try {
        fn();
        assert(false, name, 'Expected an error, but none was thrown.');
    }
    catch (error) {
        assert(String(error).includes(expected), name, String(error));
    }
}
console.log('\n=== v3 ownership cold-boundary edits ===');
{
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const otherPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceResolver = { resolveFilePath: (_guid) => sourcePath };
    const text = (0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab')), { sourceResolver });
    const document = (0, reader_1.readV3)(text);
    const sourceIdentities = [...document.identity.values()].filter(identity => identity.sourceGuid);
    assert(sourceIdentities.length > 0 && sourceIdentities.every(identity => identity.sourceFileId && /^[a-f0-9]{64}$/.test(identity.sourceFingerprint || '')), 'source GUID, source fileID, and fingerprint survive the v3 cold boundary');
    (0, compiler_1.compileV3)(document);
    (0, compiler_1.compileV3)(document, { sourceResolver });
    expectThrow(() => (0, compiler_1.compileV3)(document, { sourceResolver: { resolveFilePath: () => otherPath } }), 'Source fingerprint mismatch', 'project validation rejects a mismatched source fingerprint');
    expectThrow(() => (0, compiler_1.compileV3)(document, { sourceResolver: { resolveFilePath: () => undefined } }), 'cannot resolve GUID', 'project validation rejects an unavailable source GUID');
}
{
    const variant = sourceBackedVariant();
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceGuid = variant.variantSource.guid;
    const v3Text = (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    });
    const document = (0, reader_1.readV3)(v3Text);
    const inheritedRoot = document.variantRoots?.[0];
    const inheritedIdentity = inheritedRoot && document.identity.get(inheritedRoot.machineId);
    const coldRebuilt = (0, compiler_1.compileV3)(document);
    assert(inheritedRoot?.name === 'Ellen' && inheritedIdentity?.origin === 'inherited' &&
        inheritedIdentity?.sourceGuid === sourceGuid &&
        inheritedIdentity?.sourceFileId === source.hierarchy.fileId &&
        coldRebuilt.documents.length === variant.documents.length, 'source-backed variant exposes and cold-compiles its inherited effective tree');
    assert(document.kind === 'variant' && !!document.variantRootId &&
        v3Text.includes('(variant @p1 source:a5674d01884853d4e8f2386a171e14d9)'), 'variant source and root PrefabInstance are explicit in v3 STRUCTURE');
    const details = document.details.get(document.variantRootId);
    const modifications = details.m_Modification.m_Modifications;
    const name = modifications.find(modification => modification.propertyPath === 'm_Name');
    assert(name?.value === 'Ellen', 'variant name override is present in standalone DETAILS');
    name.value = 'Ellen_v3_edited';
    // Only the parsed v3 document enters compileV3.
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rebuiltName = rebuilt.prefabInstances[0].modifications
        .find(modification => modification.propertyPath === 'm_Name');
    assert(rebuiltName?.value === 'Ellen_v3_edited', 'variant delta edit compiles without the original variant YAML');
    assert(rebuilt.variantSource?.guid === 'a5674d01884853d4e8f2386a171e14d9', 'variant source GUID survives standalone compilation');
}
{
    const sourceGuid = '99999999999999999999999999999999';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const variant = makeVariantSource(sourceGuid, '999999', 'UnknownTargetName');
    expectThrow(() => (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'direct-source modification target', 'variant export rejects an unknown direct-source m_Name target fileID');
}
{
    const sourceGuid = '99999999999999999999999999999999';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const variant = makeVariantSource(sourceGuid, '0');
    variant.prefabInstances[0].modifications.push({
        target: { fileID: '999999', guid: sourceGuid, type: 3 },
        propertyPath: 'm_Enabled', value: '0', objectReference: { fileID: '0' },
    });
    expectThrow(() => (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'direct-source modification target', 'variant export rejects an unknown direct-source scalar target fileID');
}
{
    const sourceGuid = '99999999999999999999999999999999';
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const variant = makeVariantSource(sourceGuid, '0');
    const target = { fileID: source.hierarchy.components[0].fileId, guid: sourceGuid, type: 3 };
    variant.prefabInstances[0].modifications.push({ target: { ...target }, propertyPath: 'm_Enabled', value: '0', objectReference: { fileID: '0' } }, { target: { ...target }, propertyPath: 'm_Enabled', value: '1', objectReference: { fileID: '0' } });
    expectThrow(() => (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'duplicate direct-source modification', 'variant export rejects a duplicate direct-source scalar target tuple');
}
{
    const sourceGuid = '99999999999999999999999999999999';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const mixed = makeMixedVariant(sourceGuid);
    const originalFileIds = new Set(mixed.documents.map(item => item.fileId));
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(mixed, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }));
    const inheritedRoot = document.variantRoots[0];
    const localChild = inheritedRoot.children.find(child => child.name === 'VariantAdded');
    const localIdentity = localChild && document.identity.get(localChild.machineId);
    const localTransform = localChild && [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === localChild.machineId);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rebuiltInstance = rebuilt.documents.find(item => item.typeId === 1001);
    const rebuiltAdded = rebuiltInstance.properties.m_Modification.m_AddedGameObjects[0];
    const rebuiltTransform = rebuilt.documents.find(item => item.fileId === localTransform?.fileId);
    assert(!!localChild && localIdentity?.origin !== 'inherited' &&
        localIdentity?.prefabOwnerId === document.variantRootId &&
        rebuilt.documents.length === mixed.documents.length &&
        rebuilt.documents.every(item => originalFileIds.has(item.fileId)) &&
        String(rebuiltAdded.addedObject.fileID) === localTransform?.fileId &&
        String(rebuiltTransform.properties.m_Father.fileID) === '9100000000000000003', 'mixed inherited and variant-added effective tree exports and cold-compiles with stable ownership');
}
{
    const sourceGuid = '99999999999999999999999999999999';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const mixed = makeMixedVariant(sourceGuid);
    const instance = mixed.documents.find(item => item.typeId === 1001);
    instance.properties.m_Modification.m_AddedGameObjects[0]
        .targetCorrespondingSourceObject.fileID = 999999;
    expectThrow(() => (0, writer_1.writeV3)(mixed, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'outside the direct source effective tree', 'mixed effective-tree export rejects a variant-added root with ambiguous direct-source parent');
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-'));
    try {
        const base = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
        const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
        const baseGuid = '11111111111111111111111111111111';
        const middleGuid = '22222222222222222222222222222222';
        const middle = makeVariantSource(baseGuid, base.hierarchy.fileId, 'MiddleVariantRoot');
        const middlePath = path.join(directory, 'Middle.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const leaf = makeVariantSource(middleGuid, base.hierarchy.fileId);
        const text = (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        });
        const document = (0, reader_1.readV3)(text);
        const inheritedRoot = document.variantRoots[0];
        const inheritedIdentity = document.identity.get(inheritedRoot.machineId);
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(inheritedRoot.name === 'MiddleVariantRoot' &&
            inheritedIdentity.sourceGuid === middleGuid &&
            inheritedIdentity.sourceFileId === base.hierarchy.fileId, 'variant-of-variant expands the direct source effective tree and preserves direct ownership');
        assert(rebuilt.documents.length === leaf.documents.length &&
            rebuilt.variantSource?.guid === middleGuid &&
            rebuilt.prefabInstances[0].modifications.length === 0, 'untouched variant-of-variant cold-compiles without source YAML');
        const middleInstance = middle.documents.find(item => item.typeId === 1001);
        middleInstance.properties.m_Modification.m_Modifications[0].target.guid = middleGuid;
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }), 'ambiguous name ownership', 'variant source-chain name override rejects the wrong direct-source GUID owner');
        middleInstance.properties.m_Modification.m_Modifications[0].target.guid = baseGuid;
        middleInstance.properties.m_Modification.m_Modifications.push({
            target: { fileID: base.hierarchy.fileId, guid: baseGuid, type: 3 },
            propertyPath: 'm_Name',
            value: 'ConflictingMiddleName',
            objectReference: { fileID: 0 },
        });
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }), 'ambiguous name ownership', 'variant source-chain expansion rejects ambiguous intermediate ownership');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-added-root-'));
    try {
        const base = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
        const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
        const baseGuid = '30303030303030303030303030303030';
        const middleGuid = '40404040404040404040404040404040';
        const middle = makeMixedVariant(baseGuid);
        const middleAddedRoot = middle.hierarchy.name === '__added_root__'
            ? middle.hierarchy.children[0]
            : middle.hierarchy;
        const middlePath = path.join(directory, 'MiddleAddedRoot.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const leaf = makeVariantSource(middleGuid, base.hierarchy.fileId);
        const document = (0, reader_1.readV3)((0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }));
        const inheritedAddedRoot = document.variantRoots[0].children.find(node => node.name === 'VariantAdded');
        const addedRootIdentity = inheritedAddedRoot && document.identity.get(inheritedAddedRoot.machineId);
        const addedTransformIdentity = inheritedAddedRoot && [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === inheritedAddedRoot.machineId);
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(addedRootIdentity?.origin === 'inherited' &&
            addedRootIdentity.sourceGuid === middleGuid &&
            addedRootIdentity.sourceFileId === middleAddedRoot.fileId &&
            addedTransformIdentity?.sourceGuid === middleGuid &&
            addedTransformIdentity.sourceFileId === middleAddedRoot.transform.fileId &&
            rebuilt.documents.length === leaf.documents.length &&
            rebuilt.documents.find(item => item.typeId === 1001)
                .properties.m_Modification.m_AddedGameObjects.length === 0, 'intermediate variant-added root projects into the leaf effective tree with direct-source identity');
        const localTransformDocument = middle.documents.find(item => item.fileId === middleAddedRoot.transform.fileId);
        const parentStub = middle.documents.find(item => item.fileId === String(localTransformDocument.properties.m_Father.fileID));
        parentStub.properties.m_PrefabInstance.fileID = '999999999999999999';
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }), 'ambiguous direct-owner parent identity', 'intermediate variant-added root rejects an ambiguous direct PrefabInstance owner');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-added-component-'));
    try {
        const base = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
        const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
        const baseGuid = '10101010101010101010101010101010';
        const middleGuid = '20202020202020202020202020202020';
        const middleDocument = (0, reader_1.readV3)((0, writer_1.writeV3)(makeVariantSource(baseGuid, base.hierarchy.fileId), { sourceResolver: { resolveFilePath: guid => guid === baseGuid ? basePath : undefined } }));
        const middleRoot = middleDocument.variantRoots[0];
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
        const middle = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(middleDocument)));
        const middleComponent = middle.documents.find(document => document.typeId === 65);
        const middlePath = path.join(directory, 'MiddleAddedComponent.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const leaf = makeVariantSource(middleGuid, base.hierarchy.fileId);
        const document = (0, reader_1.readV3)((0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }));
        const inheritedRoot = document.variantRoots[0];
        const projected = inheritedRoot.components.find(component => component.typeName === 'BoxCollider');
        const projectedIdentity = projected && document.identity.get(projected.machineId);
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(projectedIdentity?.origin === 'inherited' &&
            projectedIdentity.sourceGuid === middleGuid &&
            projectedIdentity.sourceFileId === middleComponent.fileId &&
            rebuilt.documents.length === leaf.documents.length &&
            rebuilt.prefabInstances[0].addedComponents.length === 0, 'intermediate added-component delta projects into the leaf effective tree with direct-source identity');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-remove-component-'));
    try {
        const base = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
        const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
        const baseGuid = '12121212121212121212121212121212';
        const middleGuid = '23232323232323232323232323232323';
        const removedComponent = base.hierarchy.components[0];
        const middle = makeVariantSource(baseGuid, base.hierarchy.fileId);
        const middleInstance = middle.documents.find(item => item.typeId === 1001);
        middleInstance.properties.m_Modification.m_RemovedComponents = [{
                fileID: removedComponent.fileId,
                guid: baseGuid,
                type: 3,
            }];
        const middlePath = path.join(directory, 'MiddleRemovedComponent.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const leaf = makeVariantSource(middleGuid, base.hierarchy.fileId);
        const document = (0, reader_1.readV3)((0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }));
        const inheritedRoot = document.variantRoots[0];
        const inheritedComponents = inheritedRoot.components.map(component => document.identity.get(component.machineId));
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(!inheritedComponents.some(identity => identity.sourceFileId === removedComponent.fileId) &&
            inheritedComponents.length === base.hierarchy.components.length - 1 &&
            inheritedComponents.every(identity => identity.sourceGuid === middleGuid) &&
            rebuilt.documents.length === leaf.documents.length &&
            rebuilt.prefabInstances[0].removedComponents.length === 0, 'intermediate removed-component delta projects into the leaf effective tree with direct-source identity');
        middleInstance.properties.m_Modification.m_RemovedComponents[0].guid = middleGuid;
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }), 'ambiguous removed-component ownership', 'intermediate removed-component delta rejects an indirect source owner');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-chain-remove-gameobject-'));
    try {
        const base = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
        const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
        const baseGuid = '34343434343434343434343434343434';
        const middleGuid = '45454545454545454545454545454545';
        const removedChild = base.hierarchy.children[0];
        const middle = makeVariantSource(baseGuid, base.hierarchy.fileId);
        const middleInstance = middle.documents.find(item => item.typeId === 1001);
        middleInstance.properties.m_Modification.m_RemovedGameObjects = [{
                fileID: removedChild.fileId,
                guid: baseGuid,
                type: 3,
            }];
        const middlePath = path.join(directory, 'MiddleRemovedGameObject.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const leaf = makeVariantSource(middleGuid, base.hierarchy.fileId);
        const document = (0, reader_1.readV3)((0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }));
        const inheritedRoot = document.variantRoots[0];
        const rootIdentity = document.identity.get(inheritedRoot.machineId);
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(inheritedRoot.children.length === 0 && rootIdentity.sourceGuid === middleGuid &&
            rootIdentity.sourceFileId === base.hierarchy.fileId &&
            ![...document.identity.values()].some(identity => identity.sourceFileId === removedChild.fileId) && rebuilt.documents.length === leaf.documents.length &&
            rebuilt.prefabInstances[0].removedGameObjects.length === 0, 'intermediate removed-GameObject delta projects into the leaf effective tree with direct-source identity');
        middleInstance.properties.m_Modification.m_RemovedGameObjects[0].guid = middleGuid;
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }), 'ambiguous removed-GameObject ownership', 'intermediate removed-GameObject delta rejects an indirect source owner');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const sourceGuid = '33333333333333333333333333333333';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
    const nestedSourceNode = source.hierarchy.children.find(node => node.nestedPrefab);
    const variant = makeVariantSource(sourceGuid, source.hierarchy.fileId);
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }));
    const inheritedNested = document.variantRoots[0].children.find(node => node.nestedSourceGuid);
    const inheritedNestedIdentity = inheritedNested && document.identity.get(inheritedNested.machineId);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    assert(inheritedNested?.name === nestedSourceNode.name &&
        inheritedNested?.nestedSourceGuid === nestedSourceNode.nestedPrefab.sourceGuid &&
        inheritedNestedIdentity?.kind === 'prefabInstance' &&
        inheritedNestedIdentity?.origin === 'inherited' &&
        inheritedNestedIdentity?.sourceGuid === sourceGuid &&
        inheritedNestedIdentity?.sourceFileId === nestedSourceNode.nestedPrefab.instanceId, 'source-backed variant expands an inherited nested PrefabInstance with direct-source ownership');
    assert(rebuilt.documents.length === variant.documents.length &&
        rebuilt.prefabInstances.length === variant.prefabInstances.length &&
        rebuilt.variantSource?.guid === sourceGuid, 'untouched inherited nested PrefabInstance cold-compiles without emitting source documents');
}
{
    const sourceGuid = '33333333333333333333333333333333';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
    const nestedSource = source.hierarchy.children.find(node => node.nestedPrefab).nestedPrefab;
    const nestedPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const nested = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const nestedChild = nested.hierarchy.children[0];
    const nestedComponent = nestedChild.components[0];
    const variant = makeVariantSource(sourceGuid, source.hierarchy.fileId);
    variant.prefabInstances[0].modifications.push({
        target: { fileID: nestedChild.fileId, guid: nestedSource.sourceGuid, type: 3 },
        propertyPath: 'm_Name', value: 'ExistingLeafNestedName', objectReference: { fileID: '0' },
    }, {
        target: { fileID: nestedComponent.fileId, guid: nestedSource.sourceGuid, type: 3 },
        propertyPath: 'm_Enabled', value: '0', objectReference: { fileID: '0' },
    });
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(variant, {
        sourceResolver: {
            resolveFilePath: guid => guid === sourceGuid ? sourcePath :
                guid === nestedSource.sourceGuid ? nestedPath : undefined,
        },
    }));
    const nestedBoundary = document.variantRoots[0].children.find(node => node.nestedSourceGuid);
    const projectedChild = nestedBoundary.children.find(node => document.identity.get(node.machineId)?.sourceFileId === nestedChild.fileId);
    const projectedComponent = projectedChild.components.find(component => document.identity.get(component.machineId)?.sourceFileId === nestedComponent.fileId);
    assert(projectedChild.name === 'ExistingLeafNestedName' &&
        document.details.get(projectedComponent.machineId)?.m_Enabled === 0, 'leaf overrides targeting expanded nested-source internals project into effective STRUCTURE and DETAILS');
    projectedChild.name = 'ReplacedLeafNestedName';
    document.details.delete(projectedComponent.machineId);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const nestedOverrides = rebuilt.prefabInstances[0].modifications.filter(modification => modification.target.guid === nestedSource.sourceGuid);
    assert(nestedOverrides.some(modification => modification.propertyPath === 'm_Name' && modification.value === 'ReplacedLeafNestedName') && !nestedOverrides.some(modification => modification.propertyPath === 'm_Enabled'), 'editing effective nested STRUCTURE replaces projected leaf overrides and removed DETAILS stay removed');
}
{
    const sourceGuid = '33333333333333333333333333333333';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
    const inheritedNestedSource = source.hierarchy.children.find(node => node.nestedPrefab).nestedPrefab;
    const nestedPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const nested = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const nestedRoot = nested.hierarchy;
    const nestedChild = nestedRoot.children[0];
    const variant = makeVariantSource(sourceGuid, source.hierarchy.fileId);
    const nestedV3Text = (0, writer_1.writeV3)(variant, {
        sourceResolver: {
            resolveFilePath: guid => guid === sourceGuid ? sourcePath :
                guid === inheritedNestedSource.sourceGuid ? nestedPath : undefined,
        },
    });
    const document = (0, reader_1.readV3)(nestedV3Text);
    const inheritedNested = document.variantRoots[0].children.find(node => node.nestedSourceGuid);
    const inheritedNestedMetadata = inheritedNested;
    const nestedRootIdentity = document.identity.get(inheritedNested.machineId);
    const nestedInstanceIdentity = inheritedNestedMetadata.prefabInstanceId
        ? document.identity.get(inheritedNestedMetadata.prefabInstanceId)
        : undefined;
    const nestedRootComponents = inheritedNested.components.map(component => document.identity.get(component.machineId));
    const internalChild = inheritedNested.children[0];
    const internalGameObject = internalChild && document.identity.get(internalChild.machineId);
    const internalComponent = internalChild && document.identity.get(internalChild.components[0]?.machineId);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    assert(nestedRootIdentity?.kind === 'gameObject' &&
        nestedRootIdentity.origin === 'inherited' &&
        nestedRootIdentity.sourceGuid === inheritedNestedSource.sourceGuid &&
        nestedRootIdentity.sourceFileId === nestedRoot.fileId &&
        nestedRootIdentity.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId &&
        nestedInstanceIdentity?.kind === 'prefabInstance' &&
        nestedInstanceIdentity.prefabOwnerId === document.variantRootId &&
        nestedInstanceIdentity.sourceGuid === sourceGuid &&
        nestedInstanceIdentity.sourceFileId === inheritedNestedSource.instanceId &&
        nestedV3Text.includes(`@${inheritedNested.machineId} {prefab:@${inheritedNestedMetadata.prefabInstanceId} ` +
            `source:${inheritedNestedSource.sourceGuid}}`) &&
        inheritedNested.components.length === nestedRoot.components.length &&
        nestedRootComponents.every((identity, index) => identity.ownerId === inheritedNested.machineId &&
            identity.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId &&
            identity.sourceGuid === inheritedNestedSource.sourceGuid &&
            identity.sourceFileId === nestedRoot.components[index].fileId), 'inherited nested STRUCTURE uses the source-root GameObject with explicit PrefabInstance metadata and root components');
    assert(inheritedNested.nestedSourceGuid === inheritedNestedSource.sourceGuid &&
        inheritedNested.children.length === 1 && internalChild.name === nestedChild.name &&
        internalGameObject?.origin === 'inherited' &&
        internalGameObject.sourceGuid === inheritedNestedSource.sourceGuid &&
        internalGameObject.sourceFileId === nestedChild.fileId &&
        internalGameObject.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId &&
        internalComponent?.origin === 'inherited' &&
        internalComponent.ownerId === internalChild.machineId &&
        internalComponent.prefabOwnerId === inheritedNestedMetadata.prefabInstanceId, 'inherited nested PrefabInstance exposes read-only internal children and components with nested ownership');
    assert(rebuilt.documents.length === variant.documents.length &&
        rebuilt.prefabInstances.length === variant.prefabInstances.length, 'expanded inherited nested internals cold-compile without emitting nested source documents');
    expectThrow(() => (0, reader_1.readV3)(nestedV3Text.replace(`prefab:@${inheritedNestedMetadata.prefabInstanceId}`, `prefab:@${document.variantRootId}`)), 'is not directly owned by', 'nested source-root metadata rejects a mismatched PrefabInstance owner');
    internalChild.name = 'NestedInternalRenamed';
    const renamed = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const renameDelta = renamed.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Name' &&
        String(modification.target.fileID) === internalGameObject?.sourceFileId &&
        modification.target.guid === internalGameObject?.sourceGuid);
    assert(renameDelta?.value === 'NestedInternalRenamed' &&
        renamed.documents.length === variant.documents.length, 'renaming an inherited nested internal emits a source-targeted delta on the owning variant PrefabInstance');
    internalChild.name = nestedChild.name;
    inheritedNested.name = 'NestedSourceRootRenamed';
    const rootRenamed = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rootRenameDelta = rootRenamed.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Name' &&
        String(modification.target.fileID) === nestedRootIdentity?.sourceFileId &&
        modification.target.guid === nestedRootIdentity?.sourceGuid);
    assert(rootRenameDelta?.value === 'NestedSourceRootRenamed', 'renaming an inherited nested source root emits a delta for the nested source GameObject');
    inheritedNested.name = nestedRootIdentity.displayName;
    document.details.set(internalComponent.machineId, { m_Enabled: 0 });
    const propertyEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const propertyDelta = propertyEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Enabled' &&
        String(modification.target.fileID) === internalComponent?.sourceFileId &&
        modification.target.guid === internalComponent?.sourceGuid);
    assert(propertyDelta?.value === '0' &&
        propertyEdited.documents.length === variant.documents.length, 'DETAILS on an inherited nested component emits a source-targeted property delta on the owning variant PrefabInstance');
    document.details.delete(internalComponent.machineId);
    const duplicateTarget = nestedRootComponents[0];
    const originalDuplicateFileId = duplicateTarget.sourceFileId;
    duplicateTarget.sourceFileId = internalComponent.sourceFileId;
    document.details.set(duplicateTarget.machineId, { m_Enabled: true });
    document.details.set(internalComponent.machineId, { m_Enabled: false });
    expectThrow(() => (0, compiler_1.compileV3)(document), 'ambiguous owner/source path', 'duplicate inherited nested override targets fail closed instead of overwriting one another');
    duplicateTarget.sourceFileId = originalDuplicateFileId;
    document.details.delete(duplicateTarget.machineId);
    document.details.delete(internalComponent.machineId);
    inheritedNested.children = [];
    const removedInternal = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const removedInternalDelta = removedInternal.prefabInstances[0].removedGameObjects;
    assert(removedInternalDelta.length === 1 &&
        String(removedInternalDelta[0].fileID) === internalGameObject?.sourceFileId &&
        removedInternalDelta[0].guid === internalGameObject?.sourceGuid, 'removing an inherited nested internal emits its nested-source GameObject delta');
    inheritedNested.children = [internalChild];
    internalChild.tombstone = true;
    internalChild.children = [];
    const tombstonedInternal = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const tombstonedInternalDelta = tombstonedInternal.prefabInstances[0].removedGameObjects;
    assert(tombstonedInternalDelta.length === 1 &&
        String(tombstonedInternalDelta[0].fileID) === internalGameObject?.sourceFileId &&
        tombstonedInternalDelta[0].guid === internalGameObject?.sourceGuid, 'an explicit inherited nested internal tombstone emits its nested-source GameObject delta');
    delete internalChild.tombstone;
    inheritedNested.children = [internalChild, internalChild];
    expectThrow(() => (0, compiler_1.compileV3)(document), 'Structural editing of inherited nested PrefabInstance', 'ambiguous duplicate addition of an inherited nested internal fails closed');
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-recursive-nested-'));
    try {
        const outerGuid = '56565656565656565656565656565656';
        const innerGuid = '78787878787878787878787878787878';
        const outerPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
        const outer = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
        const middleGuid = outer.hierarchy.children.find(node => node.nestedPrefab).nestedPrefab.sourceGuid;
        const middle = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
        const middleInstance = middle.documents.find(document => document.typeId === 1001);
        middleInstance.properties.m_SourcePrefab.guid = innerGuid;
        const middlePath = path.join(directory, 'MiddleNested.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const reparsedMiddle = (0, unity_yaml_parser_1.parseUnityYaml)(fs.readFileSync(middlePath, 'utf-8'));
        const middleNested = reparsedMiddle.hierarchy.children.find(node => node.nestedPrefab).nestedPrefab;
        const innerPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
        const inner = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
        const variant = makeVariantSource(outerGuid, outer.hierarchy.fileId);
        const text = (0, writer_1.writeV3)(variant, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        });
        const document = (0, reader_1.readV3)(text);
        const outerBoundary = document.variantRoots[0].children.find(node => node.nestedSourceGuid === middleGuid);
        const innerBoundary = outerBoundary.children.find(node => node.nestedSourceGuid === innerGuid);
        const outerPrefab = document.identity.get(outerBoundary.prefabInstanceId);
        const innerPrefab = document.identity.get(innerBoundary.prefabInstanceId);
        const innerRoot = document.identity.get(innerBoundary.machineId);
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(!!innerBoundary &&
            text.includes(`@${outerBoundary.machineId} {prefab:@${outerBoundary.prefabInstanceId} source:${middleGuid}}`) &&
            text.includes(`@${innerBoundary.machineId} {prefab:@${innerBoundary.prefabInstanceId} source:${innerGuid}}`) &&
            innerPrefab.kind === 'prefabInstance' && innerPrefab.origin === 'inherited' &&
            innerPrefab.prefabOwnerId === outerPrefab.machineId &&
            innerPrefab.sourceGuid === middleGuid &&
            innerPrefab.sourceFileId === middleNested.instanceId &&
            innerRoot.kind === 'gameObject' && innerRoot.prefabOwnerId === innerPrefab.machineId &&
            innerRoot.sourceGuid === innerGuid && innerRoot.sourceFileId === inner.hierarchy.fileId, 'nested-in-nested sources recursively expose source roots with direct PrefabInstance ownership');
        assert(rebuilt.documents.length === variant.documents.length &&
            rebuilt.prefabInstances.length === variant.prefabInstances.length, 'recursive expanded nested internals cold-compile without source documents');
        const ambiguousOwnershipText = text.replace(`prefabOwner:${outerPrefab.machineId} | displayName:${innerPrefab.displayName}`, `prefabOwner:${document.variantRootId} | displayName:${innerPrefab.displayName}`);
        assert(ambiguousOwnershipText !== text, 'nested-in-nested ownership ambiguity fixture changes the direct owner');
        expectThrow(() => (0, reader_1.readV3)(ambiguousOwnershipText), 'is not directly owned by', 'nested-in-nested PrefabInstance metadata rejects an ambiguous direct owner');
        const deepComponent = document.identity.get(innerBoundary.components[0].machineId);
        document.details.set(deepComponent.machineId, { m_Enabled: true });
        const booleanEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const booleanDelta = booleanEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Enabled' &&
            String(modification.target.fileID) === deepComponent.sourceFileId &&
            modification.target.guid === deepComponent.sourceGuid);
        assert(booleanDelta?.value === '1' &&
            String(booleanDelta.objectReference.fileID) === '0' &&
            booleanEdited.documents.length === variant.documents.length, 'boolean DETAILS override compiles canonically at arbitrary inherited nested depth');
        const exportedBoolean = (0, reader_1.readV3)((0, writer_1.writeV3)(booleanEdited, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedBooleanOuter = exportedBoolean.variantRoots[0].children.find(node => node.nestedSourceGuid === middleGuid);
        const exportedBooleanInner = exportedBooleanOuter.children.find(node => node.nestedSourceGuid === innerGuid);
        const exportedBooleanComponent = exportedBooleanInner.components.find(component => exportedBoolean.identity.get(component.machineId)?.sourceFileId === deepComponent.sourceFileId);
        const exportedBooleanValue = exportedBoolean.details.get(exportedBooleanComponent.machineId)?.m_Enabled;
        const coldBoolean = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedBoolean)));
        const coldBooleanDelta = coldBoolean.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Enabled' &&
            String(modification.target.fileID) === deepComponent.sourceFileId &&
            modification.target.guid === deepComponent.sourceGuid);
        assert(exportedBooleanValue === 1 && typeof exportedBooleanValue === 'number' &&
            coldBooleanDelta?.value === '1' &&
            String(coldBooleanDelta.objectReference.fileID) === '0', 'existing Unity boolean scalar exports canonically as numeric 1 and cold-roundtrips');
        exportedBoolean.details.set(exportedBooleanComponent.machineId, { m_Enabled: false });
        const falseBoolean = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedBoolean)));
        const falseBooleanDelta = falseBoolean.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Enabled' &&
            String(modification.target.fileID) === deepComponent.sourceFileId &&
            modification.target.guid === deepComponent.sourceGuid);
        assert(falseBooleanDelta?.value === '0' &&
            String(falseBooleanDelta.objectReference.fileID) === '0', 'editing a projected numeric boolean override to false emits canonical Unity scalar 0');
        exportedBoolean.details.delete(exportedBooleanComponent.machineId);
        const removedBoolean = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedBoolean)));
        assert(!removedBoolean.prefabInstances[0].modifications.some(modification => modification.propertyPath === 'm_Enabled' &&
            String(modification.target.fileID) === deepComponent.sourceFileId &&
            modification.target.guid === deepComponent.sourceGuid), 'removing a projected boolean override removes its leaf modification');
        document.details.set(innerRoot.machineId, { m_IsActive: false });
        const gameObjectBoolean = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const gameObjectBooleanDelta = gameObjectBoolean.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_IsActive' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        assert(gameObjectBooleanDelta?.value === '0' &&
            String(gameObjectBooleanDelta.objectReference.fileID) === '0', 'false boolean DETAILS on an inherited nested GameObject emits canonical Unity scalar 0');
        document.details.set(innerRoot.machineId, { m_Icon: null });
        const nullEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const nullDelta = nullEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        assert(nullDelta?.value === '' &&
            String(nullDelta.objectReference.fileID) === '0', 'null DETAILS override compiles as an explicit null object reference at arbitrary nested depth');
        const exportedNull = (0, reader_1.readV3)((0, writer_1.writeV3)(nullEdited, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedNullIdentity = [...exportedNull.identity.values()].find(identity => identity.kind === 'gameObject' && identity.sourceGuid === innerRoot.sourceGuid &&
            identity.sourceFileId === innerRoot.sourceFileId);
        assert(exportedNull.details.get(exportedNullIdentity.machineId)?.m_Icon === null, 'existing null reference override exports as JSON null when the source baseline is a reference');
        document.details.set(innerRoot.machineId, { m_CustomEmpty: '' });
        const emptyScalarEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const exportedEmptyScalar = (0, reader_1.readV3)((0, writer_1.writeV3)(emptyScalarEdited, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedEmptyScalarIdentity = [...exportedEmptyScalar.identity.values()].find(identity => identity.kind === 'gameObject' && identity.sourceGuid === innerRoot.sourceGuid &&
            identity.sourceFileId === innerRoot.sourceFileId);
        assert(exportedEmptyScalar.details.get(exportedEmptyScalarIdentity.machineId)?.m_CustomEmpty === '', 'empty scalar override remains an empty string when the source baseline is not a reference');
        const externalReference = {
            fileID: 21300000,
            guid: 'abcdefabcdefabcdefabcdefabcdefab',
            type: 3,
        };
        document.details.set(innerRoot.machineId, { m_Icon: externalReference });
        const externalEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const externalDelta = externalEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        assert(externalDelta?.value === '' &&
            String(externalDelta.objectReference.fileID) === '21300000' &&
            externalDelta.objectReference.guid === externalReference.guid &&
            externalDelta.objectReference.type === 3, 'explicit external DETAILS reference compiles unchanged at arbitrary nested depth');
        const exportedExternal = (0, reader_1.readV3)((0, writer_1.writeV3)(externalEdited, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedExternalIdentity = [...exportedExternal.identity.values()].find(identity => identity.kind === 'gameObject' && identity.sourceGuid === innerRoot.sourceGuid &&
            identity.sourceFileId === innerRoot.sourceFileId);
        assert(JSON.stringify(exportedExternal.details.get(exportedExternalIdentity.machineId)?.m_Icon) ===
            JSON.stringify({ fileID: '21300000', guid: externalReference.guid, type: 3 }), 'existing external reference override exports explicitly without guessing an identity');
        document.details.set(innerRoot.machineId, {
            m_Icon: { ...externalReference, fileID: '21300000' },
        });
        const stringFileIdExternal = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const stringFileIdDelta = stringFileIdExternal.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        assert(String(stringFileIdDelta?.objectReference.fileID) === '21300000', 'explicit external reference accepts a canonical string fileID');
        document.details.set(innerRoot.machineId, { m_Icon: { $ref: deepComponent.machineId } });
        const inheritedReferenceEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const inheritedReferenceDelta = inheritedReferenceEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        assert(inheritedReferenceDelta?.value === '' &&
            String(inheritedReferenceDelta.objectReference.fileID) === deepComponent.sourceFileId &&
            inheritedReferenceDelta.objectReference.guid === deepComponent.sourceGuid &&
            inheritedReferenceDelta.objectReference.type === 3, 'stable reference to an inherited identity uses its exact source GUID and fileID');
        const exportedInheritedReference = (0, reader_1.readV3)((0, writer_1.writeV3)(inheritedReferenceEdited, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedInheritedOwner = [...exportedInheritedReference.identity.values()].find(identity => identity.kind === 'gameObject' && identity.sourceGuid === innerRoot.sourceGuid &&
            identity.sourceFileId === innerRoot.sourceFileId);
        const exportedInheritedTarget = [...exportedInheritedReference.identity.values()].find(identity => identity.kind === 'component' && identity.sourceGuid === deepComponent.sourceGuid &&
            identity.sourceFileId === deepComponent.sourceFileId);
        assert(JSON.stringify(exportedInheritedReference.details.get(exportedInheritedOwner.machineId)?.m_Icon) ===
            JSON.stringify({ $ref: exportedInheritedTarget.machineId }), 'existing inherited object reference exports as one unambiguous stable machine reference');
        const coldInheritedReference = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedInheritedReference)));
        const coldInheritedDelta = coldInheritedReference.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === exportedInheritedOwner.sourceFileId &&
            modification.target.guid === exportedInheritedOwner.sourceGuid);
        assert(String(coldInheritedDelta?.objectReference.fileID) === exportedInheritedTarget.sourceFileId &&
            coldInheritedDelta?.objectReference.guid === exportedInheritedTarget.sourceGuid, 'exported inherited stable reference cold-roundtrips without nested source documents');
        exportedInheritedReference.details.set(exportedInheritedOwner.machineId, {
            m_Icon: { fileID: 21300000, guid: externalReference.guid, type: 3 },
        });
        const replacedInheritedReference = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedInheritedReference)));
        const replacedInheritedDelta = replacedInheritedReference.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === exportedInheritedOwner.sourceFileId &&
            modification.target.guid === exportedInheritedOwner.sourceGuid);
        assert(replacedInheritedDelta?.objectReference.guid === externalReference.guid, 'exported inherited reference can be replaced by an explicit external reference');
        exportedInheritedReference.details.delete(exportedInheritedOwner.machineId);
        const removedInheritedReference = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedInheritedReference)));
        assert(!removedInheritedReference.prefabInstances[0].modifications.some(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === exportedInheritedOwner.sourceFileId &&
            modification.target.guid === exportedInheritedOwner.sourceGuid), 'removing exported reference DETAILS removes the leaf modification');
        document.details.set(innerRoot.machineId, { m_Icon: { $ref: document.variantRootId } });
        const localReferenceEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const localReferenceDelta = localReferenceEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Icon' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        assert(localReferenceDelta?.value === '' &&
            String(localReferenceDelta.objectReference.fileID) ===
                document.identity.get(document.variantRootId).fileId &&
            !localReferenceDelta.objectReference.guid, 'stable reference to an emitted local identity uses its allocated local fileID');
        const exportedLocalReference = (0, reader_1.readV3)((0, writer_1.writeV3)(localReferenceEdited, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedLocalOwner = [...exportedLocalReference.identity.values()].find(identity => identity.kind === 'gameObject' && identity.sourceGuid === innerRoot.sourceGuid &&
            identity.sourceFileId === innerRoot.sourceFileId);
        assert(JSON.stringify(exportedLocalReference.details.get(exportedLocalOwner.machineId)?.m_Icon) ===
            JSON.stringify({ $ref: exportedLocalReference.variantRootId }), 'existing local object reference exports as its unique stable machine identity');
        document.details.set(innerRoot.machineId, {
            m_Icon: { fileID: 21300000, guid: externalReference.guid, type: 3, extra: true },
        });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'Invalid v3 object reference', 'external reference override rejects extra keys');
        document.details.set(innerRoot.machineId, {
            m_Icon: { $ref: deepComponent.machineId, extra: true },
        });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'Invalid v3 machine reference', 'stable reference override rejects extra keys');
        document.details.set(innerRoot.machineId, { m_Icon: [] });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'Invalid v3 object reference', 'nested override rejects array values as unsupported references');
        document.details.set(innerRoot.machineId, { m_Icon: { arbitrary: 'object' } });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'Invalid v3 object reference', 'nested override rejects unsupported arbitrary object values');
        document.details.set(innerRoot.machineId, { m_Icon: { $ref: 'missingIdentity' } });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'not an effective identity', 'nested override rejects dangling stable references');
        document.details.set(innerRoot.machineId, { m_Icon: { $ref: deepComponent.machineId } });
        const deepComponentEntry = innerBoundary.components.find(component => component.machineId === deepComponent.machineId);
        innerBoundary.components = innerBoundary.components.filter(component => component.machineId !== deepComponent.machineId);
        expectThrow(() => (0, compiler_1.compileV3)(document), 'not an effective identity', 'nested override rejects references to omitted inherited targets');
        innerBoundary.components.unshift(deepComponentEntry);
        const ambiguousReferenceTarget = document.identity.get(innerBoundary.components[1].machineId);
        const originalAmbiguousSourceGuid = ambiguousReferenceTarget.sourceGuid;
        const originalAmbiguousSourceFileId = ambiguousReferenceTarget.sourceFileId;
        ambiguousReferenceTarget.sourceGuid = deepComponent.sourceGuid;
        ambiguousReferenceTarget.sourceFileId = deepComponent.sourceFileId;
        expectThrow(() => (0, compiler_1.compileV3)(document), 'Ambiguous inherited v3 reference', 'nested override rejects ambiguous inherited stable references');
        ambiguousReferenceTarget.sourceGuid = originalAmbiguousSourceGuid;
        ambiguousReferenceTarget.sourceFileId = originalAmbiguousSourceFileId;
        document.details.delete(innerRoot.machineId);
        document.details.delete(deepComponent.machineId);
        innerBoundary.name = 'DeepNestedRenamed';
        document.details.set(deepComponent.machineId, { m_Enabled: 0 });
        const deeplyEdited = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const deepRenameDelta = deeplyEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Name' &&
            String(modification.target.fileID) === innerRoot.sourceFileId &&
            modification.target.guid === innerRoot.sourceGuid);
        const deepPropertyDelta = deeplyEdited.prefabInstances[0].modifications.find(modification => modification.propertyPath === 'm_Enabled' &&
            String(modification.target.fileID) === deepComponent.sourceFileId &&
            modification.target.guid === deepComponent.sourceGuid);
        assert(deepRenameDelta?.value === 'DeepNestedRenamed' &&
            deepPropertyDelta?.value === '0' &&
            deeplyEdited.documents.length === variant.documents.length, 'rename and DETAILS overrides follow the PrefabInstance owner chain at arbitrary nested depth');
        document.identity.set('gDeepAdded', {
            machineId: 'gDeepAdded', kind: 'gameObject', typeId: 1, typeName: 'GameObject',
            prefabOwnerId: document.variantRootId,
        });
        document.identity.set('tDeepAdded', {
            machineId: 'tDeepAdded', kind: 'transform', typeId: 224, typeName: 'RectTransform',
            ownerId: 'gDeepAdded', prefabOwnerId: document.variantRootId,
        });
        const deepAdded = {
            name: 'DeepAdded', machineId: 'gDeepAdded', components: [], children: [],
        };
        innerBoundary.children.push(deepAdded);
        const deepAddedFirst = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const deepAddedSecond = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const deepAddedModification = deepAddedFirst.documents.find(item => item.typeId === 1001)
            .properties.m_Modification;
        const deepAddedDelta = deepAddedModification.m_AddedGameObjects[0];
        const deepAddedGameObject = deepAddedFirst.documents.find(item => item.properties.m_Name === 'DeepAdded');
        const deepAddedTransform = deepAddedFirst.documents.find(item => String(item.properties.m_GameObject?.fileID) === deepAddedGameObject.fileId);
        const deepParentTransform = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === innerBoundary.machineId);
        const deepParentStub = deepAddedFirst.documents.find(item => item.stripped && (item.typeId === 4 || item.typeId === 224) &&
            item.fileId === String(deepAddedTransform.properties.m_Father.fileID));
        assert(String(deepAddedDelta.targetCorrespondingSourceObject.fileID) === deepParentTransform.sourceFileId &&
            deepAddedDelta.targetCorrespondingSourceObject.guid === deepParentTransform.sourceGuid &&
            String(deepAddedDelta.addedObject.fileID) === deepAddedTransform.fileId &&
            deepParentStub.properties.m_CorrespondingSourceObject.guid === deepParentTransform.sourceGuid &&
            String(deepParentStub.properties.m_CorrespondingSourceObject.fileID) === deepParentTransform.sourceFileId &&
            String(deepParentStub.properties.m_PrefabInstance.fileID) ===
                document.identity.get(document.variantRootId).fileId &&
            deepAddedSecond.documents.some(item => item.fileId === deepAddedGameObject.fileId) &&
            !deepAddedFirst.documents.some(item => item.fileId === innerRoot.sourceFileId), 'adding a GameObject below a recursively expanded inherited parent emits a deterministic leaf-owned delta and stripped parent proxy');
        const exportedDeepGameObject = (0, reader_1.readV3)((0, writer_1.writeV3)(deepAddedFirst, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedOuterBoundary = exportedDeepGameObject.variantRoots[0].children.find(node => node.nestedSourceGuid === middleGuid);
        const exportedInnerBoundary = exportedOuterBoundary.children.find(node => node.nestedSourceGuid === innerGuid);
        const exportedDeepAdded = exportedInnerBoundary.children.find(node => node.name === 'DeepAdded');
        const exportedDeepAddedIdentity = exportedDeepGameObject.identity.get(exportedDeepAdded.machineId);
        const exportedDeepAddedTransform = [...exportedDeepGameObject.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === exportedDeepAdded.machineId);
        const recompiledDeepGameObject = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedDeepGameObject)));
        const recompiledDeepGameObjectDelta = recompiledDeepGameObject.documents.find(item => item.typeId === 1001)
            .properties.m_Modification.m_AddedGameObjects[0];
        assert(exportedDeepAddedIdentity.origin !== 'inherited' &&
            exportedDeepAddedIdentity.fileId === deepAddedGameObject.fileId &&
            exportedDeepAddedIdentity.prefabOwnerId === exportedDeepGameObject.variantRootId &&
            exportedDeepAddedTransform.fileId === deepAddedTransform.fileId &&
            String(recompiledDeepGameObjectDelta.targetCorrespondingSourceObject.fileID) ===
                deepParentTransform.sourceFileId &&
            recompiledDeepGameObjectDelta.targetCorrespondingSourceObject.guid ===
                deepParentTransform.sourceGuid, 'an existing deep m_AddedGameObjects delta projects into the same effective STRUCTURE and cold-roundtrips');
        exportedInnerBoundary.children = exportedInnerBoundary.children.filter(node => node.machineId !== exportedDeepAdded.machineId);
        const removedExportedDeepGameObject = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedDeepGameObject)));
        assert(removedExportedDeepGameObject.documents.find(item => item.typeId === 1001)
            .properties.m_Modification.m_AddedGameObjects.length === 0 &&
            !removedExportedDeepGameObject.documents.some(item => item.fileId === exportedDeepAddedIdentity.fileId ||
                item.fileId === exportedDeepAddedTransform.fileId), 'removing an exported deep added GameObject removes its delta and local documents');
        innerBoundary.children.pop();
        document.identity.set('cDeepAdded', {
            machineId: 'cDeepAdded', kind: 'component', typeId: 65, typeName: 'BoxCollider',
            displayName: 'BoxCollider', ownerId: innerBoundary.machineId,
            prefabOwnerId: document.variantRootId,
        });
        document.details.set('cDeepAdded', {
            m_Enabled: 1,
            serializedVersion: 3,
            m_Size: { x: 1, y: 1, z: 1 },
            m_Center: { x: 0, y: 0, z: 0 },
        });
        innerBoundary.components.push({ typeName: 'BoxCollider', machineId: 'cDeepAdded' });
        const deepComponentFirst = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const deepComponentSecond = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const addedComponentDelta = deepComponentFirst.prefabInstances[0].addedComponents[0];
        const addedComponentDocument = deepComponentFirst.documents.find(item => item.typeId === 65 && !item.stripped);
        const addedComponentStub = deepComponentFirst.documents.find(item => item.typeId === 1 && item.stripped &&
            item.fileId === String(addedComponentDocument.properties.m_GameObject.fileID));
        assert(String(addedComponentDelta.targetGameObject.fileID) === innerRoot.sourceFileId &&
            addedComponentDelta.targetGameObject.guid === innerRoot.sourceGuid &&
            String(addedComponentDelta.addedComponent.fileID) === addedComponentDocument.fileId &&
            String(addedComponentStub.properties.m_CorrespondingSourceObject.fileID) === innerRoot.sourceFileId &&
            addedComponentStub.properties.m_CorrespondingSourceObject.guid === innerRoot.sourceGuid &&
            String(addedComponentStub.properties.m_PrefabInstance.fileID) ===
                document.identity.get(document.variantRootId).fileId &&
            deepComponentSecond.documents.some(item => item.fileId === addedComponentDocument.fileId) &&
            !deepComponentFirst.documents.some(item => item.fileId === innerRoot.sourceFileId), 'adding a component to a recursively expanded inherited GameObject emits a deterministic leaf-owned delta and stripped GameObject proxy');
        const exportedDeepComponent = (0, reader_1.readV3)((0, writer_1.writeV3)(deepComponentFirst, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const exportedComponentOuter = exportedDeepComponent.variantRoots[0].children.find(node => node.nestedSourceGuid === middleGuid);
        const exportedComponentInner = exportedComponentOuter.children.find(node => node.nestedSourceGuid === innerGuid);
        const exportedAddedComponent = exportedComponentInner.components.find(component => exportedDeepComponent.identity.get(component.machineId)?.fileId === addedComponentDocument.fileId);
        const exportedAddedComponentIdentity = exportedDeepComponent.identity.get(exportedAddedComponent.machineId);
        const recompiledDeepComponent = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedDeepComponent)));
        const recompiledDeepComponentDelta = recompiledDeepComponent.prefabInstances[0].addedComponents[0];
        assert(exportedAddedComponentIdentity.origin !== 'inherited' &&
            exportedAddedComponentIdentity.ownerId === exportedComponentInner.machineId &&
            exportedAddedComponentIdentity.prefabOwnerId === exportedDeepComponent.variantRootId &&
            exportedAddedComponentIdentity.fileId === addedComponentDocument.fileId &&
            String(recompiledDeepComponentDelta.targetGameObject.fileID) === innerRoot.sourceFileId &&
            recompiledDeepComponentDelta.targetGameObject.guid === innerRoot.sourceGuid, 'an existing deep m_AddedComponents delta projects into the same effective STRUCTURE and cold-roundtrips');
        exportedComponentInner.components = exportedComponentInner.components.filter(component => component.machineId !== exportedAddedComponent.machineId);
        const removedExportedDeepComponent = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedDeepComponent)));
        assert(removedExportedDeepComponent.prefabInstances[0].addedComponents.length === 0 &&
            !removedExportedDeepComponent.documents.some(item => item.fileId === exportedAddedComponentIdentity.fileId) &&
            !removedExportedDeepComponent.documents.some(item => item.stripped && item.typeId === 1 &&
                String(item.properties.m_CorrespondingSourceObject?.fileID) === innerRoot.sourceFileId &&
                item.properties.m_CorrespondingSourceObject?.guid === innerRoot.sourceGuid), 'removing an exported deep added component removes its delta, document, and stripped proxy');
        innerBoundary.components.pop();
        document.details.delete('cDeepAdded');
        innerBoundary.components.push({ typeName: 'BoxCollider', machineId: 'cDeepAdded' });
        document.details.set('cDeepAdded', { m_Enabled: 1 });
        document.identity.set('ambiguousDeepTargetGo', {
            ...innerRoot,
            machineId: 'ambiguousDeepTargetGo',
        });
        const innerTransform = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === innerBoundary.machineId);
        document.identity.set('ambiguousDeepTargetTransform', {
            ...innerTransform,
            machineId: 'ambiguousDeepTargetTransform',
            ownerId: 'ambiguousDeepTargetGo',
        });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'ambiguous owner/source path', 'deep component addition rejects an ambiguous repeated nested-source GameObject target');
        innerBoundary.components.pop();
        document.details.delete('cDeepAdded');
        document.identity.delete('ambiguousDeepTargetGo');
        document.identity.delete('ambiguousDeepTargetTransform');
        innerBoundary.name = innerRoot.displayName;
        document.details.delete(deepComponent.machineId);
        const removedDeepComponent = innerBoundary.components.pop();
        const removedDeepComponentIdentity = document.identity.get(removedDeepComponent.machineId);
        const componentRemoved = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const deepRemovedComponents = componentRemoved.prefabInstances[0].removedComponents;
        assert(deepRemovedComponents.length === 1 &&
            String(deepRemovedComponents[0].fileID) === removedDeepComponentIdentity.sourceFileId &&
            deepRemovedComponents[0].guid === removedDeepComponentIdentity.sourceGuid &&
            document.identity.has(removedDeepComponent.machineId) &&
            componentRemoved.documents.length === variant.documents.length, 'removing a recursively expanded inherited nested component emits one leaf-owned source delta and preserves identity');
        const exportedComponentRemoval = (0, reader_1.readV3)((0, writer_1.writeV3)(componentRemoved, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const recompiledComponentRemoval = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedComponentRemoval)));
        const recompiledComponentRemovalDeltas = recompiledComponentRemoval.prefabInstances[0].removedComponents;
        const exportedRemovedComponentIdentity = [...exportedComponentRemoval.identity.values()].find(identity => identity.kind === 'component' &&
            identity.sourceGuid === removedDeepComponentIdentity.sourceGuid &&
            identity.sourceFileId === removedDeepComponentIdentity.sourceFileId);
        const exportedEffectiveComponentIds = new Set();
        const collectEffectiveComponentIds = (node) => {
            node.components.forEach(component => exportedEffectiveComponentIds.add(component.machineId));
            node.children.forEach(collectEffectiveComponentIds);
        };
        exportedComponentRemoval.variantRoots.forEach(collectEffectiveComponentIds);
        assert(recompiledComponentRemovalDeltas.length === 1 &&
            String(recompiledComponentRemovalDeltas[0].fileID) ===
                removedDeepComponentIdentity.sourceFileId &&
            recompiledComponentRemovalDeltas[0].guid === removedDeepComponentIdentity.sourceGuid &&
            !!exportedRemovedComponentIdentity &&
            !exportedEffectiveComponentIds.has(exportedRemovedComponentIdentity.machineId) &&
            recompiledComponentRemoval.documents.length === variant.documents.length &&
            !recompiledComponentRemoval.documents.some(item => item.fileId === removedDeepComponentIdentity.sourceFileId), 'an existing deep nested component removal exports and cold-roundtrips without source documents');
        innerBoundary.components.push(removedDeepComponent);
        document.identity.set('singleSidedDuplicateNestedComponent', {
            ...removedDeepComponentIdentity,
            machineId: 'singleSidedDuplicateNestedComponent',
            baselineOrder: (removedDeepComponentIdentity.baselineOrder ?? 0) + 1,
        });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'ambiguous owner/source path', 'single-sided duplicate nested component removal target fails closed');
        document.identity.delete('singleSidedDuplicateNestedComponent');
        const outerComponentIndex = outerBoundary.components.findIndex(component => component.machineId !== removedDeepComponent.machineId);
        const ambiguousOuterComponent = outerBoundary.components[outerComponentIndex];
        const ambiguousOuterComponentIdentity = document.identity.get(ambiguousOuterComponent.machineId);
        const originalOuterComponentSource = {
            guid: ambiguousOuterComponentIdentity.sourceGuid,
            fileId: ambiguousOuterComponentIdentity.sourceFileId,
        };
        ambiguousOuterComponentIdentity.sourceGuid = removedDeepComponentIdentity.sourceGuid;
        ambiguousOuterComponentIdentity.sourceFileId = removedDeepComponentIdentity.sourceFileId;
        outerBoundary.components.splice(outerComponentIndex, 1);
        innerBoundary.components.pop();
        expectThrow(() => (0, compiler_1.compileV3)(document), 'ambiguous owner/source path', 'duplicate recursively expanded inherited nested component removal targets fail closed');
        outerBoundary.components.splice(outerComponentIndex, 0, ambiguousOuterComponent);
        innerBoundary.components.push(removedDeepComponent);
        ambiguousOuterComponentIdentity.sourceGuid = originalOuterComponentSource.guid;
        ambiguousOuterComponentIdentity.sourceFileId = originalOuterComponentSource.fileId;
        outerBoundary.components.splice(outerComponentIndex, 1);
        const originalOuterPrefabOwner = outerPrefab.prefabOwnerId;
        outerPrefab.prefabOwnerId = 'missingPrefabOwner';
        expectThrow(() => (0, compiler_1.compileV3)(document), 'is not a prefabInstance identity', 'recursively expanded inherited nested removal rejects a missing PrefabInstance owner chain');
        outerPrefab.prefabOwnerId = outerPrefab.machineId;
        expectThrow(() => (0, compiler_1.compileV3)(document), 'cyclic PrefabInstance owner path', 'recursively expanded inherited nested removal rejects a cyclic PrefabInstance owner chain');
        outerPrefab.prefabOwnerId = originalOuterPrefabOwner;
        outerBoundary.components.splice(outerComponentIndex, 0, ambiguousOuterComponent);
        const removedDeepChild = innerBoundary.children.shift();
        const removedDeepIdentity = document.identity.get(removedDeepChild.machineId);
        const removedDeepDescendantIds = new Set();
        const collectRemovedIdentity = (node) => {
            removedDeepDescendantIds.add(node.machineId);
            node.components.forEach(component => removedDeepDescendantIds.add(component.machineId));
            const transform = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === node.machineId);
            if (transform)
                removedDeepDescendantIds.add(transform.machineId);
            node.children.forEach(collectRemovedIdentity);
        };
        collectRemovedIdentity(removedDeepChild);
        const removedDeepTransformIdentity = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === removedDeepChild.machineId);
        document.identity.set('ambiguousRemovedNestedGo', {
            ...removedDeepIdentity,
            machineId: 'ambiguousRemovedNestedGo',
        });
        document.identity.set('ambiguousRemovedNestedTransform', {
            ...removedDeepTransformIdentity,
            machineId: 'ambiguousRemovedNestedTransform',
            ownerId: 'ambiguousRemovedNestedGo',
        });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'ambiguous owner/source path', 'duplicate recursively expanded inherited nested GameObject removal targets fail closed');
        document.identity.delete('ambiguousRemovedNestedGo');
        document.identity.delete('ambiguousRemovedNestedTransform');
        const deeplyRemoved = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const deepRemovedDeltas = deeplyRemoved.prefabInstances[0].removedGameObjects;
        assert(deepRemovedDeltas.length === 1 &&
            String(deepRemovedDeltas[0].fileID) === removedDeepIdentity.sourceFileId &&
            deepRemovedDeltas[0].guid === removedDeepIdentity.sourceGuid &&
            [...removedDeepDescendantIds].every(machineId => document.identity.has(machineId)) &&
            deeplyRemoved.documents.length === variant.documents.length, 'removing a recursively expanded inherited nested subtree emits one leaf-owned source delta and preserves identities');
        const exportedDeepRemoval = (0, reader_1.readV3)((0, writer_1.writeV3)(deeplyRemoved, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : guid === innerGuid ? innerPath : undefined,
            },
        }));
        const recompiledDeepRemoval = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exportedDeepRemoval)));
        const recompiledDeepRemovalDeltas = recompiledDeepRemoval.prefabInstances[0].removedGameObjects;
        const exportedRemovedIdentity = [...exportedDeepRemoval.identity.values()].find(identity => identity.kind === 'gameObject' && identity.sourceGuid === removedDeepIdentity.sourceGuid &&
            identity.sourceFileId === removedDeepIdentity.sourceFileId);
        const exportedNodes = new Map();
        const collectExportedNodes = (node) => {
            exportedNodes.set(node.machineId, node);
            node.children.forEach(collectExportedNodes);
        };
        exportedDeepRemoval.variantRoots.forEach(collectExportedNodes);
        const exportedRemovalNode = exportedRemovedIdentity &&
            exportedNodes.get(exportedRemovedIdentity.machineId);
        assert(recompiledDeepRemovalDeltas.length === 1 &&
            String(recompiledDeepRemovalDeltas[0].fileID) === removedDeepIdentity.sourceFileId &&
            recompiledDeepRemovalDeltas[0].guid === removedDeepIdentity.sourceGuid &&
            exportedRemovalNode?.tombstone === true && exportedRemovalNode.children.length === 0 &&
            recompiledDeepRemoval.documents.length === variant.documents.length &&
            !recompiledDeepRemoval.documents.some(item => item.fileId === removedDeepIdentity.sourceFileId ||
                item.fileId === removedDeepTransformIdentity.sourceFileId), 'an existing deep nested GameObject removal exports and cold-roundtrips without source documents');
        innerBoundary.children.unshift(removedDeepChild);
        document.identity.set('singleSidedDuplicateNestedGo', {
            ...removedDeepIdentity,
            machineId: 'singleSidedDuplicateNestedGo',
        });
        document.identity.set('singleSidedDuplicateNestedTransform', {
            ...removedDeepTransformIdentity,
            machineId: 'singleSidedDuplicateNestedTransform',
            ownerId: 'singleSidedDuplicateNestedGo',
        });
        innerBoundary.children.push({
            name: removedDeepChild.name,
            machineId: 'singleSidedDuplicateNestedGo',
            components: [],
            children: [],
            tombstone: true,
        });
        expectThrow(() => (0, compiler_1.compileV3)(document), 'ambiguous owner/source path', 'single-sided duplicate nested GameObject removal target fails closed');
        innerBoundary.children.pop();
        document.identity.delete('singleSidedDuplicateNestedGo');
        document.identity.delete('singleSidedDuplicateNestedTransform');
        const innerBoundaryIndex = outerBoundary.children.indexOf(innerBoundary);
        outerBoundary.children.splice(innerBoundaryIndex, 1);
        const sourceRootRemoved = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        const sourceRootRemovalDeltas = sourceRootRemoved.prefabInstances[0].removedGameObjects;
        assert(sourceRootRemovalDeltas.length === 1 &&
            String(sourceRootRemovalDeltas[0].fileID) === innerRoot.sourceFileId &&
            sourceRootRemovalDeltas[0].guid === innerRoot.sourceGuid &&
            document.identity.has(innerPrefab.machineId) &&
            document.identity.has(innerRoot.machineId) &&
            sourceRootRemoved.documents.length === variant.documents.length, 'removing a recursively expanded inherited nested source root emits one leaf-owned source delta');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-recursive-cycle-'));
    try {
        const outerGuid = '89898989898989898989898989898989';
        const outerPath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
        const outer = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
        const middleGuid = outer.hierarchy.children.find(node => node.nestedPrefab).nestedPrefab.sourceGuid;
        const cyclicMiddle = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
        cyclicMiddle.documents.find(document => document.typeId === 1001)
            .properties.m_SourcePrefab.guid = middleGuid;
        const middlePath = path.join(directory, 'CyclicMiddle.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(cyclicMiddle));
        const variant = makeVariantSource(outerGuid, outer.hierarchy.fileId);
        expectThrow(() => (0, writer_1.writeV3)(variant, {
            sourceResolver: {
                resolveFilePath: guid => guid === outerGuid ? outerPath :
                    guid === middleGuid ? middlePath : undefined,
            },
        }), `contains a cycle at ${middleGuid}`, 'recursive nested source expansion rejects cycles');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-nested-chain-'));
    try {
        const base = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
        const basePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
        const baseGuid = '44444444444444444444444444444444';
        const middleGuid = '55555555555555555555555555555555';
        const middle = makeVariantSource(baseGuid, base.hierarchy.fileId);
        const middlePath = path.join(directory, 'MiddleNested.prefab');
        fs.writeFileSync(middlePath, (0, unity_yaml_writer_1.writeUnityYaml)(middle));
        const leaf = makeVariantSource(middleGuid, base.hierarchy.fileId);
        const document = (0, reader_1.readV3)((0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === middleGuid ? middlePath : guid === baseGuid ? basePath : undefined,
            },
        }));
        const inheritedNested = document.variantRoots[0].children.find(node => node.nestedSourceGuid);
        const inheritedIdentity = document.identity.get(inheritedNested.machineId);
        const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
        assert(inheritedIdentity.sourceGuid === middleGuid &&
            inheritedIdentity.sourceFileId === base.hierarchy.children.find(node => node.nestedPrefab).nestedPrefab.instanceId &&
            rebuilt.documents.length === leaf.documents.length, 'variant source chain expands inherited nested PrefabInstance with direct-source ownership');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-v3-source-failures-'));
    try {
        const rootFileId = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab')).hierarchy.fileId;
        const firstGuid = '66666666666666666666666666666666';
        const secondGuid = '77777777777777777777777777777777';
        const missingGuid = '88888888888888888888888888888888';
        const firstPath = path.join(directory, 'First.prefab');
        const secondPath = path.join(directory, 'Second.prefab');
        fs.writeFileSync(firstPath, (0, unity_yaml_writer_1.writeUnityYaml)(makeVariantSource(secondGuid, rootFileId)));
        fs.writeFileSync(secondPath, (0, unity_yaml_writer_1.writeUnityYaml)(makeVariantSource(firstGuid, rootFileId)));
        const leaf = makeVariantSource(firstGuid, rootFileId);
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: {
                resolveFilePath: guid => guid === firstGuid ? firstPath : guid === secondGuid ? secondPath : undefined,
            },
        }), 'contains a cycle', 'variant source-chain expansion rejects cycles');
        fs.writeFileSync(firstPath, (0, unity_yaml_writer_1.writeUnityYaml)(makeVariantSource(missingGuid, rootFileId)));
        expectThrow(() => (0, writer_1.writeV3)(leaf, {
            sourceResolver: { resolveFilePath: guid => guid === firstGuid ? firstPath : undefined },
        }), `cannot resolve GUID ${missingGuid}`, 'variant source-chain expansion rejects a missing intermediate source');
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
{
    const directInherited = (0, reader_1.readV3)(sourceBackedVariantText());
    const root = directInherited.variantRoots[0];
    const child = root.children[0];
    child.name = 'SilentlyIgnoredDirectRename';
    expectThrow(() => (0, compiler_1.compileV3)(directInherited), 'Structural editing of direct inherited', 'direct inherited rename fails closed instead of compiling as a no-op');
    child.name = directInherited.identity.get(child.machineId).displayName;
    root.children = root.children.filter(node => node.machineId !== child.machineId);
    directInherited.variantRoots.push(child);
    expectThrow(() => (0, compiler_1.compileV3)(directInherited), 'Structural editing of direct inherited', 'direct inherited reparent fails closed instead of compiling as a no-op');
    directInherited.variantRoots.pop();
    root.children.push(child);
    root.components.reverse();
    expectThrow(() => (0, compiler_1.compileV3)(directInherited), 'Structural editing of direct inherited', 'direct inherited component reorder fails closed instead of compiling as a no-op');
    root.components.reverse();
    directInherited.details.set(child.machineId, { m_IsActive: 0 });
    expectThrow(() => (0, compiler_1.compileV3)(directInherited), 'Structural editing of direct inherited', 'direct inherited semantic DETAILS fail closed instead of compiling as a no-op');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    const root = document.variantRoots[0];
    const removedChild = root.children.shift();
    const removedIdentity = document.identity.get(removedChild.machineId);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const removed = rebuilt.prefabInstances[0].removedGameObjects;
    assert(removed.length === 1 &&
        String(removed[0].fileID) === removedIdentity.sourceFileId &&
        removed[0].guid === removedIdentity.sourceGuid, 'omitting a direct inherited child compiles to m_RemovedGameObjects');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    const removedRoot = document.variantRoots[0];
    const removedIdentity = document.identity.get(removedRoot.machineId);
    document.variantRoots = [];
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const removed = rebuilt.prefabInstances[0].removedGameObjects;
    assert(removed.length === 1 &&
        String(removed[0].fileID) === removedIdentity.sourceFileId &&
        removed[0].guid === removedIdentity.sourceGuid, 'omitting the direct inherited root compiles one explicit root removal');
}
{
    const sourceGuid = '33333333333333333333333333333333';
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab'));
    const variant = makeVariantSource(sourceGuid, source.hierarchy.fileId);
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }));
    const inheritedNested = document.variantRoots[0].children.find(node => node.nestedSourceGuid);
    inheritedNested.name = 'SilentlyIgnoredRename';
    expectThrow(() => (0, compiler_1.compileV3)(document), 'Structural editing of inherited nested PrefabInstance', 'inherited nested PrefabInstance edits fail closed instead of compiling as no-ops');
    inheritedNested.name = document.identity.get(inheritedNested.machineId).displayName;
    document.variantRoots[0].children = document.variantRoots[0].children.filter(node => node.machineId !== inheritedNested.machineId);
    expectThrow(() => (0, compiler_1.compileV3)(document), 'is missing from variant STRUCTURE', 'removing an inherited nested PrefabInstance fails closed instead of compiling as a no-op');
}
{
    const variant = (0, unity_yaml_parser_1.parseUnityYaml)(sample('variants', 'Ellen_Variant.prefab'));
    const source = (0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Amount.prefab'));
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceGuid = variant.variantSource.guid;
    const removedChild = source.hierarchy.children[0];
    variant.prefabInstances[0].removedGameObjects = [{
            fileID: removedChild.fileId, type: 3,
        }];
    expectThrow(() => (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'ambiguous removed-GameObject ownership', 'root-owner export rejects GUID-less removed GameObject targets');
    variant.prefabInstances[0].removedGameObjects = [
        { fileID: removedChild.fileId, guid: sourceGuid, type: 3 },
        { fileID: removedChild.fileId, guid: sourceGuid, type: 3 },
    ];
    expectThrow(() => (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'ambiguous removed-GameObject ownership', 'root-owner export rejects duplicate removed GameObject targets');
    const duplicateNames = makeVariantSource(sourceGuid, source.hierarchy.fileId, 'FirstName');
    duplicateNames.prefabInstances[0].modifications.push({
        target: { fileID: source.hierarchy.fileId, guid: sourceGuid, type: 3 },
        propertyPath: 'm_Name', value: 'SecondName', objectReference: { fileID: '0' },
    });
    expectThrow(() => (0, writer_1.writeV3)(duplicateNames, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }), 'ambiguous name ownership', 'root-owner export rejects duplicate name override targets');
}
{
    const baselineText = sourceBackedVariantText();
    const baseline = (0, reader_1.readV3)(baselineText);
    const inheritedChild = baseline.variantRoots[0].children[0];
    const sourceIdentity = baseline.identity.get(inheritedChild.machineId);
    const tombstoneText = baselineText.replace(`${inheritedChild.name} @${inheritedChild.machineId}`, `- ${inheritedChild.name} @${inheritedChild.machineId}`);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(tombstoneText))));
    const removed = rebuilt.prefabInstances[0].removedGameObjects;
    assert(removed.length === 1 &&
        String(removed[0].fileID) === sourceIdentity.sourceFileId &&
        removed[0].guid === sourceIdentity.sourceGuid, 'an inherited GameObject tombstone compiles to m_RemovedGameObjects');
}
{
    const baseline = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedChild = baseline.variantRoots[0].children[0];
    const sourceIdentity = baseline.identity.get(inheritedChild.machineId);
    const variant = sourceBackedVariant();
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceGuid = variant.variantSource.guid;
    variant.prefabInstances[0].removedGameObjects = [{
            fileID: sourceIdentity.sourceFileId, guid: sourceGuid, type: 3,
        }];
    const text = (0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    });
    assert(text.includes(`- ${inheritedChild.name} @${inheritedChild.machineId}`), 'an existing removed GameObject delta is exported as an explicit tombstone');
}
{
    const baseline = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedRoot = baseline.variantRoots[0];
    const rootIdentity = baseline.identity.get(inheritedRoot.machineId);
    const childIdentity = baseline.identity.get(inheritedRoot.children[0].machineId);
    const variant = sourceBackedVariant();
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceGuid = variant.variantSource.guid;
    variant.prefabInstances[0].removedGameObjects = [{
            fileID: rootIdentity.sourceFileId, guid: sourceGuid, type: 3,
        }];
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }));
    assert(document.variantRoots[0].tombstone === true &&
        document.variantRoots[0].children.length === 0 &&
        [...document.identity.values()].some(identity => identity.kind === 'gameObject' && identity.sourceFileId === childIdentity.sourceFileId), 'a subtree tombstone retains inherited descendant identities outside the effective tree');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    document.variantRoots[0].tombstone = true;
    expectThrow(() => (0, compiler_1.compileV3)(document), 'cannot have effective children', 'a tombstone with effective children fails closed instead of ignoring the subtree');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedRoot = document.variantRoots[0];
    const removedComponent = inheritedRoot.components.pop();
    const sourceIdentity = document.identity.get(removedComponent.machineId);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const removed = rebuilt.prefabInstances[0].removedComponents;
    assert(removed.length === 1 &&
        String(removed[0].fileID) === sourceIdentity.sourceFileId &&
        removed[0].guid === sourceIdentity.sourceGuid, 'removing an inherited component compiles to m_RemovedComponents');
}
{
    const baseline = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedRoot = baseline.variantRoots[0];
    const removedComponent = inheritedRoot.components[0];
    const sourceIdentity = baseline.identity.get(removedComponent.machineId);
    const variant = sourceBackedVariant();
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const sourceGuid = variant.variantSource.guid;
    variant.prefabInstances[0].removedComponents = [{
            fileID: sourceIdentity.sourceFileId, guid: sourceGuid, type: 3,
        }];
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(variant, {
        sourceResolver: { resolveFilePath: guid => guid === sourceGuid ? sourcePath : undefined },
    }));
    assert(!document.variantRoots[0].components.some(component => component.machineId === removedComponent.machineId) && document.identity.has(removedComponent.machineId), 'an existing removed component delta is absent from effective components but keeps identity');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedRoot = document.variantRoots[0];
    const inheritedIdentity = document.identity.get(inheritedRoot.machineId);
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
    const first = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const second = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const instance = first.documents.find(item => item.fileId ===
        document.identity.get(document.variantRootId).fileId);
    const added = instance.properties.m_Modification.m_AddedComponents[0];
    const component = first.documents.find(item => item.typeId === 65);
    const strippedGameObject = first.documents.find(item => item.stripped && item.typeId === 1 &&
        item.fileId === String(component.properties.m_GameObject.fileID));
    const secondComponent = second.documents.find(item => item.typeId === 65);
    assert(String(added.targetCorrespondingSourceObject.fileID) === inheritedIdentity.sourceFileId &&
        added.targetCorrespondingSourceObject.guid === inheritedIdentity.sourceGuid &&
        String(added.addedObject.fileID) === component.fileId &&
        String(strippedGameObject.properties.m_PrefabInstance.fileID) === instance.fileId &&
        String(strippedGameObject.properties.m_CorrespondingSourceObject.fileID) === inheritedIdentity.sourceFileId &&
        strippedGameObject.properties.m_CorrespondingSourceObject.guid === inheritedIdentity.sourceGuid &&
        component.fileId === secondComponent.fileId, 'adding a local component to an inherited GameObject emits direct-owner m_AddedComponents deterministically');
    const sourcePath = path.join(__dirname, '..', 'samples', 'prefabs', 'Amount.prefab');
    const exported = (0, reader_1.readV3)((0, writer_1.writeV3)(first, {
        sourceResolver: {
            resolveFilePath: guid => guid === inheritedIdentity.sourceGuid ? sourcePath : undefined,
        },
    }));
    const exportedRoot = exported.variantRoots[0];
    const exportedComponent = exportedRoot.components.find(item => item.typeName === 'BoxCollider');
    const exportedIdentity = exportedComponent && exported.identity.get(exportedComponent.machineId);
    const recompiled = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exported)));
    const recompiledAdded = recompiled.prefabInstances[0].addedComponents[0];
    const recompiledComponent = recompiled.documents.find(item => item.fileId === exportedIdentity?.fileId);
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
        String(recompiledComponent.properties.m_GameObject.fileID) === strippedGameObject.fileId, 'existing m_AddedComponents exports into inherited STRUCTURE and cold-roundtrips');
    exportedRoot.components = exportedRoot.components.filter(item => item.machineId !== exportedIdentity?.machineId);
    const removedAgain = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(exported)));
    const removedAgainInstance = removedAgain.prefabInstances[0];
    assert(removedAgainInstance.addedComponents.length === 0 &&
        !removedAgain.documents.some(item => item.fileId === exportedIdentity?.fileId) &&
        !removedAgain.documents.some(item => item.stripped && item.typeId === 1 &&
            String(item.properties.m_CorrespondingSourceObject?.fileID) === inheritedIdentity.sourceFileId &&
            item.properties.m_CorrespondingSourceObject?.guid === inheritedIdentity.sourceGuid), 'removing an exported local added component removes its delta, document, and unused stripped stub');
    const unmatchedTarget = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)(first));
    const unmatchedInstance = unmatchedTarget.documents.find(item => item.typeId === 1001);
    unmatchedInstance.properties.m_Modification.m_AddedComponents[0]
        .targetCorrespondingSourceObject.fileID = 999999;
    const unmatchedComponent = unmatchedTarget.documents.find(item => item.typeId === 65);
    const unmatchedStub = unmatchedTarget.documents.find(item => item.fileId ===
        String(unmatchedComponent.properties.m_GameObject.fileID));
    unmatchedStub.properties.m_CorrespondingSourceObject.fileID = 999999;
    expectThrow(() => (0, writer_1.writeV3)(unmatchedTarget, {
        sourceResolver: {
            resolveFilePath: guid => guid === inheritedIdentity.sourceGuid ? sourcePath : undefined,
        },
    }), 'missing from the direct source', 'added-component export fails closed when its source GameObject target is unknown');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedRoot = document.variantRoots[0];
    const inheritedTransform = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === inheritedRoot.machineId);
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
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const instance = rebuilt.documents.find(item => item.typeId === 1001);
    const added = instance.properties.m_Modification.m_AddedGameObjects[0];
    const addedGameObject = rebuilt.documents.find(item => item.properties.m_Name === 'AddedChild');
    const addedTransform = rebuilt.documents.find(item => String(item.properties.m_GameObject?.fileID) === addedGameObject.fileId);
    assert(String(added.targetCorrespondingSourceObject.fileID) === inheritedTransform.sourceFileId &&
        added.targetCorrespondingSourceObject.guid === inheritedTransform.sourceGuid &&
        String(added.addedObject.fileID) === addedTransform.fileId, 'adding a local child beneath inherited hierarchy compiles to m_AddedGameObjects');
}
{
    const document = (0, reader_1.readV3)(sourceBackedVariantText());
    const inheritedRoot = document.variantRoots[0];
    document.identity.set('gCombinedAdded', {
        machineId: 'gCombinedAdded', kind: 'gameObject', typeId: 1, typeName: 'GameObject',
        prefabOwnerId: document.variantRootId,
    });
    document.identity.set('tCombinedAdded', {
        machineId: 'tCombinedAdded', kind: 'transform', typeId: 224, typeName: 'RectTransform',
        ownerId: 'gCombinedAdded', prefabOwnerId: document.variantRootId,
    });
    document.identity.set('cCombinedAdded', {
        machineId: 'cCombinedAdded', kind: 'component', typeId: 65, typeName: 'BoxCollider',
        displayName: 'BoxCollider', ownerId: 'gCombinedAdded', prefabOwnerId: document.variantRootId,
    });
    document.details.set('cCombinedAdded', {
        m_Enabled: 1, serializedVersion: 3,
        m_Size: { x: 1, y: 1, z: 1 }, m_Center: { x: 0, y: 0, z: 0 },
    });
    inheritedRoot.children.push({
        name: 'CombinedAdded', machineId: 'gCombinedAdded',
        components: [{ typeName: 'BoxCollider', machineId: 'cCombinedAdded' }], children: [],
    });
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const instance = rebuilt.documents.find(item => item.typeId === 1001);
    const modification = instance.properties.m_Modification;
    const addedGameObject = rebuilt.documents.find(item => item.properties.m_Name === 'CombinedAdded');
    const addedComponent = rebuilt.documents.find(item => item.typeId === 65 &&
        String(item.properties.m_GameObject?.fileID) === addedGameObject.fileId);
    assert(modification.m_AddedGameObjects.length === 1 &&
        modification.m_AddedComponents.length === 0 && !!addedComponent, 'one edit can add a local child with a local component below inherited hierarchy');
}
{
    const v3Text = (0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'RootPrefabInstance.prefab')));
    const document = (0, reader_1.readV3)(v3Text);
    const unowned = [...document.identity.values()].filter(identity => identity.kind === 'owned' && !identity.ownerId);
    assert(unowned.length === 0, 'variant added-object documents have explicit PrefabInstance ownership');
    assert(document.variantRoots?.[0]?.name === 'Btns' &&
        document.variantRoots[0].children.length === 4, 'variant added-object hierarchy is explicit in v3 STRUCTURE');
}
{
    const document = rootVariantV3();
    const root = document.variantRoots[0];
    root.children.reverse();
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const transformIdentity = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === root.machineId);
    const rootTransform = rebuilt.documents.find(item => item.fileId === transformIdentity.fileId);
    const expectedFirst = document.identity.get(root.children[0].machineId)?.kind === 'prefabInstance'
        ? [...document.identity.values()].find(identity => identity.kind === 'stripped' && identity.ownerId === root.children[0].machineId && identity.nestedRoot).fileId
        : [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === root.children[0].machineId).fileId;
    assert(String(rootTransform.properties.m_Children[0].fileID) === expectedFirst, 'variant local sibling order is authoritative across the cold boundary');
}
{
    const document = rootVariantV3();
    const root = document.variantRoots[0];
    const textBg = root.children.find(child => child.name === 'TextBg');
    const noStage = root.children.find(child => child.name === 'NoStage');
    const [text] = textBg.children.splice(0, 1);
    text.name = 'MovedText';
    noStage.children.push(text);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const movedTransformIdentity = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === text.machineId);
    const newParentTransformIdentity = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === noStage.machineId);
    const movedTransform = rebuilt.documents.find(item => item.fileId === movedTransformIdentity.fileId);
    const movedGameObject = rebuilt.documents.find(item => item.fileId === document.identity.get(text.machineId).fileId);
    assert(String(movedTransform.properties.m_Father.fileID) === newParentTransformIdentity.fileId &&
        movedGameObject.properties.m_Name === 'MovedText', 'variant local rename and reparent are compiled from STRUCTURE');
}
{
    const document = rootVariantV3();
    const root = document.variantRoots[0];
    document.identity.set('gNew', {
        machineId: 'gNew', kind: 'gameObject', typeId: 1, typeName: 'GameObject',
        prefabOwnerId: document.variantRootId,
    });
    document.identity.set('tNew', {
        machineId: 'tNew', kind: 'transform', typeId: 224, typeName: 'RectTransform', ownerId: 'gNew',
    });
    root.children.push({ name: 'NewLocalChild', machineId: 'gNew', components: [], children: [] });
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const newGameObject = rebuilt.documents.find(item => item.properties.m_Name === 'NewLocalChild');
    const rootTransformId = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === root.machineId).fileId;
    const newTransform = rebuilt.documents.find(item => String(item.properties.m_GameObject?.fileID) === newGameObject.fileId);
    assert(String(newTransform.properties.m_Father.fileID) === rootTransformId, 'variant can create a new local child beneath an existing local parent');
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
    document.variantRoots.push({
        name: 'UnsupportedRoot', machineId: 'gNewRoot', components: [], children: [],
    });
    expectThrow(() => (0, compiler_1.compileV3)(document), 'requires an inherited source-parent identity', 'variant root creation fails closed until its inherited parent target is explicit');
}
{
    const document = rootVariantV3();
    const root = document.variantRoots[0];
    const removed = root.children.find(child => child.name === 'TextBg');
    const deleted = new Set();
    const collect = (node) => {
        deleted.add(node.machineId);
        node.components.forEach(component => deleted.add(component.machineId));
        const transform = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === node.machineId);
        if (transform)
            deleted.add(transform.machineId);
        node.children.forEach(collect);
    };
    collect(removed);
    root.children = root.children.filter(child => child !== removed);
    for (const details of document.details.values())
        clearRefsTo(details, deleted);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    assert([...deleted].every(machineId => {
        const fileId = document.identity.get(machineId)?.fileId;
        return !fileId || !rebuilt.documents.some(item => item.fileId === fileId);
    }), 'deleting a variant local subtree removes all owned Unity documents');
}
{
    const document = buttonV3();
    const nested = document.structure.children.find(child => !!child.nestedSourceGuid);
    nested.name = 'Button_Text_Renamed';
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const nameOverride = rebuilt.prefabInstances[0].modifications
        .find(modification => modification.propertyPath === 'm_Name');
    assert(nameOverride?.value === 'Button_Text_Renamed', 'renaming a nested STRUCTURE node rewrites its PrefabInstance name override');
}
{
    const document = buttonV3();
    document.structure.children.reverse();
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rootTransform = rebuilt.documents.find(item => (item.typeId === 4 || item.typeId === 224) && String(item.properties.m_Father?.fileID) === '0');
    const nestedRoot = rebuilt.documents.find(item => item.stripped &&
        item.typeId === 224 && item.properties.m_PrefabInstance?.fileID !== 0);
    const rootOrder = rebuilt.prefabInstances[0].modifications
        .find(modification => modification.propertyPath === 'm_RootOrder');
    assert(String(rootTransform.properties.m_Children[0].fileID) === nestedRoot.fileId &&
        rootOrder?.value === '0', 'reordering nested STRUCTURE rewrites parent children and m_RootOrder');
}
{
    const document = buttonV3();
    const root = document.structure;
    const nestedIndex = root.children.findIndex(child => !!child.nestedSourceGuid);
    const [nested] = root.children.splice(nestedIndex, 1);
    const background = root.children[0];
    background.children.push(nested);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const backgroundIdentity = document.identity.get(background.machineId);
    const backgroundTransform = [...document.identity.values()].find(identity => identity.kind === 'transform' && identity.ownerId === backgroundIdentity.machineId);
    const instance = rebuilt.documents.find(item => item.typeId === 1001);
    assert(String(instance.properties.m_Modification.m_TransformParent.fileID) === backgroundTransform.fileId, 'reparenting nested STRUCTURE rewrites PrefabInstance m_TransformParent');
}
{
    const document = buttonV3();
    document.structure.children = document.structure.children.filter(child => !child.nestedSourceGuid);
    document.details.get('c1').activateDisplayText = { fileID: 0 };
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    assert(!rebuilt.documents.some(item => item.typeId === 1001 || item.stripped), 'deleting nested STRUCTURE removes its PrefabInstance and stripped ownership documents');
}
{
    const v3Text = (0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab')));
    const document = (0, reader_1.readV3)(v3Text);
    const instance = [...document.identity.values()]
        .find(identity => identity.kind === 'prefabInstance');
    assert(!!instance && v3Text.includes(`Button_Text @${instance?.machineId} {source:`), 'nested PrefabInstance is visible in regular-prefab STRUCTURE');
    const details = document.details.get(instance.machineId);
    const modifications = details.m_Modification.m_Modifications;
    const name = modifications.find(modification => modification.propertyPath === 'm_Name');
    name.value = 'Button_Text_v3';
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rebuiltName = rebuilt.prefabInstances[0].modifications
        .find(modification => modification.propertyPath === 'm_Name');
    assert(rebuiltName?.value === 'Button_Text_v3', 'nested PrefabInstance override edit compiles across the cold boundary');
    assert(rebuilt.documents.filter(item => item.stripped).length === 2, 'nested stripped identity documents are reconstructed');
}
{
    const original = sample('prefabs', 'RootPrefabInstance.prefab');
    const first = compileText((0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(original)));
    const secondText = (0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)((0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(original)))));
    assert(first.type === 'variant' && first.hierarchy?.children.length === 4 &&
        first.documents.length === 53, 'variant with added root objects is independently reconstructed');
    assert((0, unity_yaml_writer_1.writeUnityYaml)(first) === secondText, 'variant ownership compilation is deterministic');
}
console.log(`\nv3 ownership tests: ${passed} passed, ${failed} failed`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=test-v3-ownership.js.map