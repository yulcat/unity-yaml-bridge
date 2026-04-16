"use strict";
/**
 * Focused regressions for variant prefab edge cases.
 *
 * Issue #1: variant STRUCTURE must include base children and root-level added GOs.
 * Issue #2: non-root nested PrefabInstance m_Modifications must appear in DETAILS.
 */
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
const guid_resolver_1 = require("./guid-resolver");
const compact_reader_1 = require("./compact-reader");
const compact_merger_1 = require("./compact-merger");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const compact_writer_1 = require("./compact-writer");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
let totalTests = 0;
let passedTests = 0;
function assert(condition, message, detail) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  PASS: ${message}`);
    }
    else {
        console.log(`  FAIL: ${message}`);
        if (detail)
            console.log(`    ${detail}`);
    }
}
function getSection(compact, section) {
    const start = compact.indexOf(`--- ${section}`);
    if (start < 0)
        return '';
    const next = compact.indexOf('\n--- ', start + 1);
    return compact.slice(start, next < 0 ? compact.length : next);
}
function writeAsset(projectRoot, relativePath, guid, content) {
    const assetPath = path.join(projectRoot, 'Assets', relativePath);
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, content);
    fs.writeFileSync(`${assetPath}.meta`, `fileFormatVersion: 2\nguid: ${guid}\n`);
}
function makeResolver(assets) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-variant-issues-'));
    fs.mkdirSync(path.join(projectRoot, 'Assets'), { recursive: true });
    for (const asset of assets) {
        writeAsset(projectRoot, asset.path, asset.guid, asset.content);
    }
    const resolver = new guid_resolver_1.GuidResolver();
    resolver.scanProject(projectRoot);
    return resolver;
}
const BASE_GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NESTED_GUID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const IMAGE_GUID = 'f70555f144d8491a825f0804e09c671c';
function basePrefabYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 200}
  m_Layer: 0
  m_Name: BaseRoot
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &200
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children:
  - {fileID: 400}
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!1 &300
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 400}
  - component: {fileID: 500}
  m_Layer: 0
  m_Name: BaseChild
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &400
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 300}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 200}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &500
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 300}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${IMAGE_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_Color: {r: 1, g: 1, b: 1, a: 1}
`;
}
function variantWithRootAddedYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &900
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 500, guid: ${BASE_GUID}, type: 3}
      propertyPath: m_Color.r
      value: 0.5
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
--- !u!1 &1000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1100}
  - component: {fileID: 1200}
  m_Layer: 0
  m_Name: AddedRoot
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &1100
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &1200
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${IMAGE_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_Color: {r: 1, g: 1, b: 1, a: 1}
`;
}
function variantWithAddedReferenceDocsYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &900
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
--- !u!1 &1000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1100}
  - component: {fileID: 1200}
  m_Layer: 0
  m_Name: Source
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &1100
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &1200
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${IMAGE_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  targetRef: {fileID: 0}
  targetRefs: []
--- !u!1 &1500
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1550}
  - component: {fileID: 1600}
  m_Layer: 0
  m_Name: Target
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &1550
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1500}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &1600
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1500}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${IMAGE_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
`;
}
function variantWithExistingAddedReferenceDocsYaml() {
    return variantWithAddedReferenceDocsYaml().replace(`  targetRef: {fileID: 0}
  targetRefs: []`, `  targetRef: {fileID: 1600}
  targetRefs:
  - {fileID: 1600}`);
}
function addedRootCompact(detailsHeader, detailsBody, refsBody) {
    return (0, compact_reader_1.readCompact)(`# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
__added_root__
├─ + Source [${IMAGE_GUID}]
└─ + Target [${IMAGE_GUID}]
--- DETAILS

[${detailsHeader}]
${detailsBody}
--- REFS
__instance = 900
${refsBody}
`);
}
function mergeAddedRootCompact(yaml, detailsHeader, detailsBody, refsBody) {
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(yaml);
    const compact = addedRootCompact(detailsHeader, detailsBody, refsBody);
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const sourceDoc = merged.documents.find(doc => doc.fileId === '1200');
    return { merged, sourceDoc };
}
function fileIdOf(value) {
    return value && typeof value === 'object' && 'fileID' in value
        ? String(value.fileID)
        : String(value);
}
function nestedMenuPrefabYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 200}
  m_Layer: 0
  m_Name: NestedMenu
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &200
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!1 &300
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component: []
  m_Layer: 0
  m_Name: Text
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!1 &301
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component: []
  m_Layer: 0
  m_Name: Text
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!1 &302
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component: []
  m_Layer: 0
  m_Name: Text
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
`;
}
function variantWithNestedPrefabOverridesYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &900
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
--- !u!1001 &901
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 200}
    m_Modifications:
    - target: {fileID: 300, guid: ${NESTED_GUID}, type: 3}
      propertyPath: m_Name
      value: Text_Logout
      objectReference: {fileID: 0}
    - target: {fileID: 301, guid: ${NESTED_GUID}, type: 3}
      propertyPath: m_Name
      value: Text_Quit
      objectReference: {fileID: 0}
    - target: {fileID: 302, guid: ${NESTED_GUID}, type: 3}
      propertyPath: m_Name
      value: Text_Restore
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
`;
}
console.log('\n=== Variant issue regressions ===\n');
{
    console.log('Issue #1: root-level added GOs are kept in STRUCTURE');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantWithRootAddedYaml());
    const compact = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compact, 'STRUCTURE');
    assert(ast.hierarchy !== undefined, 'variant parser creates a hierarchy for root-level additions');
    assert(structure.includes('BaseRoot'), 'STRUCTURE includes base root', structure);
    assert(structure.includes('BaseChild [Image*]'), 'STRUCTURE includes modified base child', structure);
    assert(structure.includes('+AddedRoot [Image]'), 'STRUCTURE includes root-level added GameObject with + marker', structure);
}
{
    console.log('\nIssue #2: nested PrefabInstance modifications are written to DETAILS');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
        { path: 'NestedMenu.prefab', guid: NESTED_GUID, content: nestedMenuPrefabYaml() },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantWithNestedPrefabOverridesYaml());
    const compact = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const details = getSection(compact, 'DETAILS');
    assert(details.includes('Text_Logout'), 'DETAILS includes Text_Logout nested override', details);
    assert(details.includes('Text_Quit'), 'DETAILS includes Text_Quit nested override', details);
    assert(details.includes('Text_Restore'), 'DETAILS includes Text_Restore nested override', details);
    assert(details.includes('[Text_Logout]'), 'DETAILS uses nested m_Name override as a readable header', details);
}
{
    console.log('\nIssue #3 follow-up: added-object component refs write to real docs');
    const { merged, sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRef = ->Target:${IMAGE_GUID}
targetRefs = [->Target:${IMAGE_GUID}, ->Target:${IMAGE_GUID}]`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
    const refs = sourceDoc?.properties.targetRefs;
    assert(String(sourceDoc?.properties.targetRef?.fileID) === '1600', 'null reference edited in an added variant component writes to component doc', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
    assert(Array.isArray(refs) && refs.length === 2 && refs.every(ref => String(ref.fileID) === '1600'), 'array references edited in an added variant component write to component doc', JSON.stringify(refs));
}
{
    console.log('\nIssue #3 follow-up: __added_root__ paths resolve for added-object docs');
    const { merged, sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `__added_root__/Source:${IMAGE_GUID}`, `targetRef = ->__added_root__/Target:${IMAGE_GUID}`, `__added_root__/Source:${IMAGE_GUID} = 1200
__added_root__/Target:${IMAGE_GUID} = 1600`);
    assert(String(sourceDoc?.properties.targetRef?.fileID) === '1600', '__added_root__ reference path writes to added variant component doc', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
}
{
    console.log('\nIssue #3 follow-up: mixed __added_root__ path normalization');
    {
        const { merged, sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRef = ->__added_root__/Target:${IMAGE_GUID}`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
        assert(fileIdOf(sourceDoc?.properties.targetRef) === '1600', 'scalar ->__added_root__/ path resolves through non-prefixed REFS', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRefs = [->__added_root__/Target:${IMAGE_GUID}, ->__added_root__/Target:${IMAGE_GUID}]`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
        const refs = sourceDoc?.properties.targetRefs;
        assert(Array.isArray(refs) && refs.length === 2 && refs.every(ref => fileIdOf(ref) === '1600'), 'array ->__added_root__/ paths resolve through non-prefixed REFS', JSON.stringify(refs));
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRef = @__added_root__/Target:${IMAGE_GUID}`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
        assert(fileIdOf(sourceDoc?.properties.targetRef) === '1600', '@__added_root__/ alias resolves through non-prefixed REFS');
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `__added_root__/Source:${IMAGE_GUID}`, `targetRef = ->__added_root__/Target:${IMAGE_GUID}`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
        assert(fileIdOf(sourceDoc?.properties.targetRef) === '1600', 'prefixed DETAILS header matches non-prefixed REFS section target');
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRef = ->Target:${IMAGE_GUID}`, `__added_root__/Source:${IMAGE_GUID} = 1200
__added_root__/Target:${IMAGE_GUID} = 1600`);
        assert(fileIdOf(sourceDoc?.properties.targetRef) === '1600', 'non-prefixed DETAILS and value paths resolve through prefixed REFS');
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRefs = [->Target:${IMAGE_GUID}, ->__added_root__/Target:${IMAGE_GUID}, @__added_root__/Target:${IMAGE_GUID}]`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
        const refs = sourceDoc?.properties.targetRefs;
        assert(Array.isArray(refs) && refs.length === 3 && refs.every(ref => fileIdOf(ref) === '1600'), 'mixed array of non-prefixed, prefixed, and @ refs resolves to one target', JSON.stringify(refs));
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `event:
  target = ->__added_root__/Target:${IMAGE_GUID}`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
        assert(fileIdOf(sourceDoc?.properties.event?.target) === '1600', 'nested object reference resolves with the same added-root aliases', JSON.stringify(sourceDoc?.properties.event));
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRef = ->__added_root__/Target:${IMAGE_GUID}`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600
__added_root__/Target:${IMAGE_GUID} = 1700`);
        assert(fileIdOf(sourceDoc?.properties.targetRef) === '1700', 'exact prefixed REFS key wins before added-root alias fallback');
    }
    {
        const { sourceDoc } = mergeAddedRootCompact(variantWithAddedReferenceDocsYaml(), `Source:${IMAGE_GUID}`, `targetRef = ->Target:${IMAGE_GUID}`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600
__added_root__/Target:${IMAGE_GUID} = 1700`);
        assert(fileIdOf(sourceDoc?.properties.targetRef) === '1600', 'exact non-prefixed REFS key wins before added-root alias fallback');
    }
}
{
    console.log('\nIssue #3 follow-up: no-edit added-root roundtrip stays stable');
    const sourceYaml = variantWithExistingAddedReferenceDocsYaml();
    const noEdit = mergeAddedRootCompact(sourceYaml, `Source:${IMAGE_GUID}`, `targetRef = ->__added_root__/Target:${IMAGE_GUID}
targetRefs = [->__added_root__/Target:${IMAGE_GUID}]`, `Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600`);
    const refs = noEdit.sourceDoc?.properties.targetRefs;
    assert(fileIdOf(noEdit.sourceDoc?.properties.targetRef) === '1600', 'no-edit scalar with released mixed-prefix compact keeps fileID 1600', (0, unity_yaml_writer_1.writeUnityYaml)(noEdit.merged));
    assert(Array.isArray(refs) && refs.length === 1 && fileIdOf(refs[0]) === '1600', 'no-edit array with released mixed-prefix compact keeps fileID 1600', JSON.stringify(refs));
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(sourceYaml);
    const compactText = (0, compact_writer_1.writeCompact)(ast);
    const rewritten = (0, compact_merger_1.mergeCompactChanges)(ast, (0, compact_reader_1.readCompact)(compactText));
    const rewrittenSourceDoc = rewritten.documents.find(doc => doc.fileId === '1200');
    assert(compactText.includes(`targetRef = ->Target:${IMAGE_GUID}`), 'writer emits canonical non-prefixed refs for added-object DETAILS', compactText);
    assert(!compactText.includes(`->__added_root__/Target:${IMAGE_GUID}`), 'writer does not reintroduce __added_root__ in added-object reference values', compactText);
    assert(fileIdOf(rewrittenSourceDoc?.properties.targetRef) === '1600', 'parse -> compact -> write keeps added-object scalar reference unchanged', (0, unity_yaml_writer_1.writeUnityYaml)(rewritten));
}
console.log(`\nSUMMARY: ${passedTests}/${totalTests} tests passed`);
process.exit(passedTests === totalTests ? 0 : 1);
//# sourceMappingURL=test-variant-issues.js.map