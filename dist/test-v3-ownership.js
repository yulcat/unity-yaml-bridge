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
    const v3Text = (0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('variants', 'Ellen_Variant.prefab')));
    const document = (0, reader_1.readV3)(v3Text);
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