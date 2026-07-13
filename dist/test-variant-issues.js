"use strict";
/**
 * Focused regressions for variant prefab edge cases.
 *
 * Issue #1: variant STRUCTURE must include base children and root-level added GOs.
 * Issue #2: non-root nested PrefabInstance m_Modifications must appear in DETAILS.
 * Nested PrefabInstance internals must also write back to their owning instance.
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
const MIDDLE_VARIANT_GUID = 'dddddddddddddddddddddddddddddddd';
const IMAGE_GUID = 'f70555f144d8491a825f0804e09c671c';
const TMP_GUID = 'f4688fdb7df04437aeb418b961361dc5';
const SIMPLE_FSM_GUID = 'cccccccccccccccccccccccccccccccc';
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
function prefabWithComponentListOnlyMonoBehaviourYaml() {
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
  - component: {fileID: 300}
  - component: {fileID: 400}
  m_Layer: 5
  m_Name: PopupSize
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!224 &200
RectTransform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 100, y: 100}
  m_Pivot: {x: 0.5, y: 0.5}
--- !u!225 &300
CanvasGroup:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_Alpha: 1
  m_Interactable: 1
  m_BlocksRaycasts: 1
  m_IgnoreParentGroups: 0
--- !u!114 &400
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 0}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SIMPLE_FSM_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier: Crumble.Feature::Crumble.UI.SimpleFSMController
  _currentState: 1
`;
}
function variantOfComponentListOnlyMonoBehaviourYaml() {
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
    - target: {fileID: 300, guid: ${BASE_GUID}, type: 3}
      propertyPath: m_Alpha
      value: 0.5
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
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
function nestedTextPrefabYaml() {
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
  - component: {fileID: 500}
  m_Layer: 0
  m_Name: NestedWidget
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
  - {fileID: 310}
  - {fileID: 410}
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &500
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${TMP_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_text: Source text
  linkRef: {fileID: 0}
--- !u!1 &300
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 310}
  - component: {fileID: 800}
  m_Layer: 0
  m_Name: TargetLabel
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &310
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
--- !u!114 &800
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 300}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${TMP_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_text: Target
--- !u!1 &400
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 410}
  - component: {fileID: 850}
  m_Layer: 0
  m_Name: AltLabel
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &410
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 400}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 200}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &850
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 400}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${TMP_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_text: Alternate
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
function variantWithNestedPrefabComponentOverridesYaml() {
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
      propertyPath: m_text
      value: Root instance must not change
      objectReference: {fileID: 0}
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
    - target: {fileID: 500, guid: ${NESTED_GUID}, type: 3}
      propertyPath: m_text
      value: Original nested text
      objectReference: {fileID: 0}
    - target: {fileID: 500, guid: ${NESTED_GUID}, type: 3}
      propertyPath: linkRef
      value:
      objectReference: {fileID: 800, guid: ${NESTED_GUID}, type: 3}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
`;
}
function variantWithAddedComponentYaml(nested) {
    const nestedInstance = nested ? `--- !u!1001 &901
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 200}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents:
    - targetCorrespondingSourceObject: {fileID: 100, guid: ${NESTED_GUID}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 700}
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
` : '';
    const mainAdded = nested ? '    m_AddedComponents: []' : `    m_AddedComponents:
    - targetCorrespondingSourceObject: {fileID: 100, guid: ${BASE_GUID}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 700}`;
    const ownerInstance = nested ? '901' : '900';
    const sourceGuid = nested ? NESTED_GUID : BASE_GUID;
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
${mainAdded}
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
${nestedInstance}--- !u!1 &600 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 100, guid: ${sourceGuid}, type: 3}
  m_PrefabInstance: {fileID: ${ownerInstance}}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &700
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 600}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SIMPLE_FSM_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  currentState: 3
  label: Original added component
`;
}
function variantWithRemovalsYaml() {
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
    m_RemovedComponents:
    - {fileID: 500, guid: ${BASE_GUID}, type: 3}
    m_RemovedGameObjects:
    - {fileID: 300, guid: ${BASE_GUID}, type: 3}
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
`;
}
function chainedVariantYaml(sourceGuid, value) {
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
    - target: {fileID: 500, guid: ${sourceGuid}, type: 3}
      propertyPath: m_Color.a
      value: ${value}
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${sourceGuid}, type: 3}
`;
}
function structuralMiddleVariantYaml() {
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
    m_RemovedComponents:
    - {fileID: 500, guid: ${BASE_GUID}, type: 3}
    m_RemovedGameObjects: []
    m_AddedGameObjects:
    - targetCorrespondingSourceObject: {fileID: 200, guid: ${BASE_GUID}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 720}
    m_AddedComponents:
    - targetCorrespondingSourceObject: {fileID: 100, guid: ${BASE_GUID}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 700}
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
--- !u!1 &600 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 100, guid: ${BASE_GUID}, type: 3}
  m_PrefabInstance: {fileID: 900}
  m_PrefabAsset: {fileID: 0}
--- !u!4 &610 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 200, guid: ${BASE_GUID}, type: 3}
  m_PrefabInstance: {fileID: 900}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &700
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 600}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SIMPLE_FSM_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  label: inherited middle component
--- !u!1 &710
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 720}
  - component: {fileID: 730}
  m_Layer: 0
  m_Name: MiddleAdded
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &720
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 710}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 610}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &730
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 710}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SIMPLE_FSM_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  label: component on middle-added object
`;
}
function emptyLeafVariantYaml(removedMiddleObject = false) {
    const removed = removedMiddleObject
        ? `\n    - {fileID: 710, guid: ${MIDDLE_VARIANT_GUID}, type: 3}`
        : ' []';
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &950
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects:${removed}
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${MIDDLE_VARIANT_GUID}, type: 3}
`;
}
function leafRemovingMiddleComponentYaml() {
    return emptyLeafVariantYaml().replace('    m_RemovedComponents: []', `    m_RemovedComponents:\n    - {fileID: 700, guid: ${MIDDLE_VARIANT_GUID}, type: 3}`);
}
function leafExtendingMiddleObjectYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &950
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents:
    - {fileID: 730, guid: ${MIDDLE_VARIANT_GUID}, type: 3}
    m_RemovedGameObjects: []
    m_AddedGameObjects:
    - targetCorrespondingSourceObject: {fileID: 720, guid: ${MIDDLE_VARIANT_GUID}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 970}
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${MIDDLE_VARIANT_GUID}, type: 3}
--- !u!4 &965 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 720, guid: ${MIDDLE_VARIANT_GUID}, type: 3}
  m_PrefabInstance: {fileID: 950}
  m_PrefabAsset: {fileID: 0}
--- !u!1 &971
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 970}
  m_Layer: 0
  m_Name: LeafAddedUnderMiddle
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &970
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 971}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 965}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
`;
}
function regularPrefabWithNestedAddedComponentYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &10
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 20}
  m_Layer: 0
  m_Name: Host
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &20
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 10}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children:
  - {fileID: 610}
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!1001 &901
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 20}
    m_Modifications:
    - target: {fileID: 100, guid: ${NESTED_GUID}, type: 3}
      propertyPath: m_Name
      value: NestedWidget
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents:
    - targetCorrespondingSourceObject: {fileID: 100, guid: ${NESTED_GUID}, type: 3}
      insertIndex: -1
      addedObject: {fileID: 700}
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
--- !u!1 &600 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 100, guid: ${NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 901}
  m_PrefabAsset: {fileID: 0}
--- !u!4 &610 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 200, guid: ${NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 901}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &700
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 600}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SIMPLE_FSM_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  label: Nested regular original
`;
}
function regularPrefabWithDuplicateNestedSourceYaml() {
    const secondInstance = `--- !u!1001 &902
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 20}
    m_Modifications:
    - target: {fileID: 100, guid: ${NESTED_GUID}, type: 3}
      propertyPath: m_Name
      value: NestedWidget2
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
--- !u!1 &601 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 100, guid: ${NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 902}
  m_PrefabAsset: {fileID: 0}
--- !u!4 &620 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 200, guid: ${NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 902}
  m_PrefabAsset: {fileID: 0}
`;
    return regularPrefabWithNestedAddedComponentYaml()
        .replace('  - {fileID: 610}\n', '  - {fileID: 610}\n  - {fileID: 620}\n')
        .replace('--- !u!1 &600 stripped\n', `${secondInstance}--- !u!1 &600 stripped\n`);
}
function regularPrefabWithNestedRemovalsYaml() {
    return regularPrefabWithNestedAddedComponentYaml()
        .replace('    m_RemovedComponents: []\n    m_RemovedGameObjects: []\n', `    m_RemovedComponents:\n    - {fileID: 500, guid: ${NESTED_GUID}, type: 3}\n    m_RemovedGameObjects:\n    - {fileID: 300, guid: ${NESTED_GUID}, type: 3}\n`);
}
console.log('\n=== Variant issue regressions ===\n');
{
    console.log('Added component on an inherited root-variant GameObject');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantWithAddedComponentYaml(false));
    const compactText = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compactText, 'STRUCTURE');
    const details = getSection(compactText, 'DETAILS');
    const refs = getSection(compactText, 'REFS');
    assert(ast.prefabInstances[0].addedComponents.length === 1, 'parser preserves root PrefabInstance m_AddedComponents');
    assert(structure.includes('BaseRoot [+SimpleFSMController]'), 'STRUCTURE marks a component added to an inherited GameObject', structure);
    assert(details.includes('[+ BaseRoot:SimpleFSMController]') &&
        details.includes('label = Original added component'), 'DETAILS contains properties from the real added-component document', details);
    assert(refs.includes('BaseRoot:SimpleFSMController = 700'), 'REFS maps the added component to its local document', refs);
    const edited = compactText.replace('label = Original added component', 'label = Edited added component');
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, (0, compact_reader_1.readCompact)(edited));
    const component = merged.documents.find(doc => doc.fileId === '700');
    assert(component?.properties.label === 'Edited added component', 'editing added-component DETAILS updates the real local document', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
}
{
    console.log('\nAdded component owned by a non-root nested PrefabInstance');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
        { path: 'Nested.prefab', guid: NESTED_GUID, content: nestedTextPrefabYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantWithAddedComponentYaml(true));
    const compactText = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const details = getSection(compactText, 'DETAILS');
    const refs = getSection(compactText, 'REFS');
    const nestedInstance = ast.prefabInstances.find(instance => instance.fileId === '901');
    assert(nestedInstance?.addedComponents.length === 1, 'parser preserves nested PrefabInstance m_AddedComponents');
    assert(details.includes('[+ NestedWidget:SimpleFSMController]') &&
        details.includes('currentState = 3'), 'DETAILS includes a nested instance added component', details);
    assert(refs.includes('NestedWidget:SimpleFSMController = 700') &&
        refs.includes('NestedWidget:SimpleFSMController:__instance = 901'), 'REFS records nested added-component identity and owner', refs);
    const edited = compactText.replace('currentState = 3', 'currentState = 8');
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, (0, compact_reader_1.readCompact)(edited));
    const component = merged.documents.find(doc => doc.fileId === '700');
    assert(component?.properties.currentState === 8, 'nested added-component edit updates its real local document', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
}
{
    console.log('\nAdded component in a nested instance of a regular prefab');
    const resolver = makeResolver([
        { path: 'Nested.prefab', guid: NESTED_GUID, content: nestedTextPrefabYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(regularPrefabWithNestedAddedComponentYaml());
    const compactText = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compactText, 'STRUCTURE');
    const details = getSection(compactText, 'DETAILS');
    assert(ast.type === 'prefab', 'fixture remains a regular prefab rather than a variant');
    assert(structure.includes('NestedWidget {Nested} [TextMeshProUGUI, +SimpleFSMController]'), 'regular prefab STRUCTURE overlays nested added component', structure);
    assert(details.includes('[+ NestedWidget:SimpleFSMController]') &&
        details.includes('label = Nested regular original'), 'regular prefab DETAILS includes nested added-component properties', details);
    const edited = compactText.replace('label = Nested regular original', 'label = Nested regular edited');
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, (0, compact_reader_1.readCompact)(edited));
    const component = merged.documents.find(doc => doc.fileId === '700');
    assert(component?.properties.label === 'Nested regular edited', 'regular prefab nested added-component edit writes to local document', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
}
{
    console.log('\nSame source prefab instantiated twice does not leak added-component overlays');
    const resolver = makeResolver([
        { path: 'Nested.prefab', guid: NESTED_GUID, content: nestedTextPrefabYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(regularPrefabWithDuplicateNestedSourceYaml());
    const structure = getSection((0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver }), 'STRUCTURE');
    const markerCount = (structure.match(/\+SimpleFSMController/g) || []).length;
    assert(structure.includes('NestedWidget {Nested} [TextMeshProUGUI, +SimpleFSMController]'), 'added component appears on its owning nested instance', structure);
    assert(structure.includes('NestedWidget2 {Nested} [TextMeshProUGUI]') && markerCount === 1, 'added component does not leak to another instance of the same source prefab', structure);
}
{
    console.log('\nNested removals in a regular prefab are visible in STRUCTURE');
    const resolver = makeResolver([
        { path: 'Nested.prefab', guid: NESTED_GUID, content: nestedTextPrefabYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(regularPrefabWithNestedRemovalsYaml());
    const structure = getSection((0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver }), 'STRUCTURE');
    assert(structure.includes('NestedWidget {Nested} [+SimpleFSMController, -TextMeshProUGUI]'), 'regular prefab marks a component removed from a nested instance', structure);
    assert(structure.includes('-TargetLabel [TextMeshProUGUI]'), 'regular prefab marks a GameObject removed from a nested instance', structure);
}
{
    console.log('\nRemoved GameObjects and components are visible in STRUCTURE');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantWithRemovalsYaml());
    const compactText = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compactText, 'STRUCTURE');
    const parsedCompact = (0, compact_reader_1.readCompact)(compactText);
    const removedChild = parsedCompact.structure?.children.find(child => child.name === 'BaseChild');
    assert(ast.prefabInstances[0].removedGameObjects.length === 1, 'parser preserves m_RemovedGameObjects');
    assert(structure.includes('-BaseChild [-Image]'), 'STRUCTURE marks removed GameObject and removed component', structure);
    assert(removedChild?.marker === '-', 'compact reader preserves writer-style no-space removal marker', JSON.stringify(removedChild));
}
{
    console.log('\nWriter-style added marker survives compact parsing');
    const compact = (0, compact_reader_1.readCompact)(`# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
BaseRoot
└─ +AddedChild [Image]
--- DETAILS
--- REFS
`);
    assert(compact.structure?.children[0]?.marker === '+' &&
        compact.structure.children[0].name === 'AddedChild', 'compact reader accepts +AddedChild emitted by the writer', JSON.stringify(compact.structure));
}
{
    console.log('\nVariant-of-variant resolves through to the concrete base hierarchy');
    const middle = chainedVariantYaml(BASE_GUID, '0.5');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
        { path: 'Middle.prefab', guid: MIDDLE_VARIANT_GUID, content: middle },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(chainedVariantYaml(MIDDLE_VARIANT_GUID, '0.25'));
    const compactText = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compactText, 'STRUCTURE');
    const details = getSection(compactText, 'DETAILS');
    assert(structure.includes('BaseRoot') && structure.includes('BaseChild [Image*]'), 'variant chain emits the ultimate base tree with inherited override marker', structure);
    assert(details.includes('[BaseChild:Image]') && details.includes('m_Color.a = 0.25'), 'leaf variant override resolves against the ultimate base component', details);
    const edited = compactText.replace('m_Color.a = 0.25', 'm_Color.a = 0.75');
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, (0, compact_reader_1.readCompact)(edited));
    const modifications = merged.documents.find(doc => doc.fileId === '900')
        ?.properties.m_Modification?.m_Modifications || [];
    const modification = modifications.find((mod) => mod.propertyPath === 'm_Color.a');
    assert(String(modification?.value) === '0.75', 'editing a chained variant writes to the leaf PrefabInstance', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
}
{
    console.log('\nLeaf variant inherits structural additions/removals from a middle variant');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
        { path: 'Middle.prefab', guid: MIDDLE_VARIANT_GUID, content: structuralMiddleVariantYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(emptyLeafVariantYaml());
    const structure = getSection((0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver }), 'STRUCTURE');
    assert(structure.includes('BaseRoot [+SimpleFSMController]'), 'middle-variant added component is visible in leaf STRUCTURE', structure);
    assert(structure.includes('BaseChild [-Image]'), 'middle-variant removed component is visible in leaf STRUCTURE', structure);
    assert(structure.includes('+MiddleAdded'), 'middle-variant added GameObject is visible in leaf STRUCTURE', structure);
    const removingLeaf = (0, unity_yaml_parser_1.parseUnityYaml)(emptyLeafVariantYaml(true));
    const removingStructure = getSection((0, compact_writer_1.writeCompact)(removingLeaf, { guidResolver: resolver }), 'STRUCTURE');
    assert(removingStructure.includes('-MiddleAdded'), 'leaf removal can target a GameObject added by the middle variant', removingStructure);
    const componentRemovingLeaf = (0, unity_yaml_parser_1.parseUnityYaml)(leafRemovingMiddleComponentYaml());
    const componentRemovingStructure = getSection((0, compact_writer_1.writeCompact)(componentRemovingLeaf, { guidResolver: resolver }), 'STRUCTURE');
    assert(componentRemovingStructure.includes('BaseRoot [-SimpleFSMController]'), 'leaf removal can target a component added by the middle variant', componentRemovingStructure);
    const extendingLeaf = (0, unity_yaml_parser_1.parseUnityYaml)(leafExtendingMiddleObjectYaml());
    const extendingStructure = getSection((0, compact_writer_1.writeCompact)(extendingLeaf, { guidResolver: resolver }), 'STRUCTURE');
    assert(extendingStructure.includes('+MiddleAdded [-SimpleFSMController]'), 'leaf removal applies to a component on a middle-added GameObject', extendingStructure);
    assert(extendingStructure.includes('└─ +LeafAddedUnderMiddle'), 'leaf can add a child beneath a middle-added GameObject', extendingStructure);
}
{
    console.log('Issue #4: STRUCTURE uses GameObject m_Component entries for prefab components');
    const resolver = makeResolver([
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(prefabWithComponentListOnlyMonoBehaviourYaml());
    const compact = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compact, 'STRUCTURE');
    assert(structure.includes('PopupSize [CanvasGroup, SimpleFSMController]'), 'STRUCTURE includes SimpleFSMController from the GameObject component list', structure);
}
{
    console.log('\nIssue #4: variant STRUCTURE keeps base component-list MonoBehaviours');
    const resolver = makeResolver([
        { path: 'PopupBase.prefab', guid: BASE_GUID, content: prefabWithComponentListOnlyMonoBehaviourYaml() },
        { path: 'SimpleFSMController.cs', guid: SIMPLE_FSM_GUID, content: 'public class SimpleFSMController {}\n' },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantOfComponentListOnlyMonoBehaviourYaml());
    const compact = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const structure = getSection(compact, 'STRUCTURE');
    assert(structure.includes('PopupSize [CanvasGroup*, SimpleFSMController]'), 'variant STRUCTURE includes SimpleFSMController from the base prefab component list', structure);
}
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
    console.log('\nNested PrefabInstance internal edits write back to the owning instance');
    const resolver = makeResolver([
        { path: 'Base.prefab', guid: BASE_GUID, content: basePrefabYaml() },
        { path: 'NestedText.prefab', guid: NESTED_GUID, content: nestedTextPrefabYaml() },
    ]);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(variantWithNestedPrefabComponentOverridesYaml());
    const compactText = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const details = getSection(compactText, 'DETAILS');
    const refs = getSection(compactText, 'REFS');
    assert(details.includes('[NestedWidget:TextMeshProUGUI]'), 'DETAILS includes readable nested internal component header', details);
    assert(details.includes('m_text = Original nested text'), 'DETAILS includes nested internal component property override', details);
    assert(details.includes('linkRef = ->TargetLabel:TextMeshProUGUI'), 'DETAILS emits nested internal objectReference as a path ref', details);
    assert(refs.includes('NestedWidget:TextMeshProUGUI = 500'), 'REFS includes nested internal component target', refs);
    assert(refs.includes('NestedWidget:TextMeshProUGUI:__instance = 901'), 'REFS records the owning nested PrefabInstance for edited internals', refs);
    assert(refs.includes('TargetLabel:TextMeshProUGUI = 800'), 'REFS includes nested objectReference target path', refs);
    const editedText = compactText
        .replace('m_text = Original nested text', 'm_text = Edited nested text')
        .replace('linkRef = ->TargetLabel:TextMeshProUGUI', 'linkRef = ->AltLabel:TextMeshProUGUI')
        .replace('TargetLabel:TextMeshProUGUI = 800', 'TargetLabel:TextMeshProUGUI = 800\nAltLabel:TextMeshProUGUI = 850');
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, (0, compact_reader_1.readCompact)(editedText));
    const rootInstanceDoc = merged.documents.find(doc => doc.fileId === '900');
    const nestedInstanceDoc = merged.documents.find(doc => doc.fileId === '901');
    const rootMods = rootInstanceDoc?.properties.m_Modification?.m_Modifications || [];
    const nestedMods = nestedInstanceDoc?.properties.m_Modification?.m_Modifications || [];
    const rootTextMod = rootMods.find((m) => m.propertyPath === 'm_text');
    const nestedTextMod = nestedMods.find((m) => m.propertyPath === 'm_text');
    const nestedRefMod = nestedMods.find((m) => m.propertyPath === 'linkRef');
    assert(nestedTextMod?.value === 'Edited nested text', 'edited nested internal property writes to non-root PrefabInstance modifications', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
    assert(rootTextMod?.value === 'Root instance must not change', 'same fileID/property on root PrefabInstance is not edited by nested section', (0, unity_yaml_writer_1.writeUnityYaml)(merged));
    assert(fileIdOf(nestedRefMod?.objectReference) === '850', 'edited nested internal objectReference path writes to non-root PrefabInstance modifications', JSON.stringify(nestedRefMod));
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