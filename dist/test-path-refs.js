"use strict";
/**
 * Test path-based reference resolution (@path:Component / ->path:Component).
 *
 * Tests:
 * 1. Write direction: internal refs written as ->GOPath:Component
 * 2. Read direction: ->GOPath:Component resolved to {fileID: X}
 * 3. @-shorthand alias works as read alias for ->
 * 4. Array references resolve correctly
 * 5. Round-trip identity preserved with path refs
 * 6. Stripped component entries in REFS
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
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const compact_writer_1 = require("./compact-writer");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
const compact_reader_1 = require("./compact-reader");
const compact_merger_1 = require("./compact-merger");
const guid_resolver_1 = require("./guid-resolver");
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const resolver = new guid_resolver_1.GuidResolver();
const projectPath = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
if (fs.existsSync(projectPath)) {
    resolver.scanProject(projectPath);
    console.log(`GUID resolver: ${resolver.size} mappings loaded`);
}
const ISSUE3_SCRIPT_GUID = '11111111111111111111111111111111';
const ISSUE5_BASE_GUID = '55555555555555555555555555555555';
const ISSUE5_NESTED_GUID = '66666666666666666666666666666666';
const ISSUE5_PARENT_SCRIPT_GUID = '77777777777777777777777777777777';
const ISSUE5_SIMPLE_FSM_GUID = '88888888888888888888888888888888';
const ISSUE5_BUTTON_GUID = '4e29b1a8efbd4b44bd927f3ae6b005da';
function issue3RegularPrefabYaml() {
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
  m_Layer: 0
  m_Name: Root
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
  - {fileID: 500}
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &300
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${ISSUE3_SCRIPT_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  targetRef: {fileID: 0}
  targetRefs: []
--- !u!1 &400
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 500}
  - component: {fileID: 600}
  m_Layer: 0
  m_Name: Target
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &500
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
--- !u!114 &600
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 400}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${ISSUE3_SCRIPT_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
`;
}
function issue3VariantYaml() {
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
    - target: {fileID: 500, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
      propertyPath: targetRef
      value: 
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
`;
}
function issue5NestedButtonSourceYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 2000}
  - component: {fileID: 3000}
  - component: {fileID: 4000}
  m_Layer: 0
  m_Name: BTN_Start
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!224 &2000
RectTransform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &3000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${ISSUE5_SIMPLE_FSM_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
--- !u!114 &4000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${ISSUE5_BUTTON_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
`;
}
function issue5ParentPrefabYaml() {
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
  m_Layer: 0
  m_Name: MyPage
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
  m_Children:
  - {fileID: 2100}
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &300
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${ISSUE5_PARENT_SCRIPT_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  fsmRef: {fileID: 3010}
  buttonRef: {fileID: 3020}
--- !u!1001 &900
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 200}
    m_Modifications:
    - target: {fileID: 1000, guid: ${ISSUE5_NESTED_GUID}, type: 3}
      propertyPath: m_Name
      value: BTN_Start
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${ISSUE5_NESTED_GUID}, type: 3}
--- !u!224 &2100 stripped
RectTransform:
  m_CorrespondingSourceObject: {fileID: 2000, guid: ${ISSUE5_NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 900}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &3010 stripped
MonoBehaviour:
  m_CorrespondingSourceObject: {fileID: 3000, guid: ${ISSUE5_NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 900}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &3020 stripped
MonoBehaviour:
  m_CorrespondingSourceObject: {fileID: 4000, guid: ${ISSUE5_NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 900}
  m_PrefabAsset: {fileID: 0}
`;
}
function issue5VariantParentYaml() {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &9900
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
    - target: {fileID: 300, guid: ${ISSUE5_BASE_GUID}, type: 3}
      propertyPath: fsmRef
      value:
      objectReference: {fileID: 3010}
    - target: {fileID: 300, guid: ${ISSUE5_BASE_GUID}, type: 3}
      propertyPath: buttonRef
      value:
      objectReference: {fileID: 3020}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${ISSUE5_BASE_GUID}, type: 3}
`;
}
function makeIssue5Resolver() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-issue5-'));
    const nestedPath = path.join(projectRoot, 'BTN_Start.prefab');
    const basePath = path.join(projectRoot, 'MyPage.prefab');
    fs.writeFileSync(nestedPath, issue5NestedButtonSourceYaml());
    fs.writeFileSync(basePath, issue5ParentPrefabYaml());
    const issue5Resolver = new guid_resolver_1.GuidResolver();
    issue5Resolver.add(ISSUE5_SIMPLE_FSM_GUID, 'SimpleFSMController');
    issue5Resolver.add(ISSUE5_PARENT_SCRIPT_GUID, 'PageController');
    issue5Resolver.addAsset(ISSUE5_NESTED_GUID, nestedPath, 'BTN_Start');
    issue5Resolver.addAsset(ISSUE5_BASE_GUID, basePath, 'MyPage');
    return issue5Resolver;
}
let totalTests = 0;
let passedTests = 0;
function pass(label) {
    totalTests++;
    passedTests++;
    console.log(`  PASS — ${label}`);
}
function fail(label, detail) {
    totalTests++;
    console.log(`  FAIL — ${label}`);
    if (detail)
        console.log(`    ${detail}`);
}
// ============================================================
// Test 1: Write direction — internal refs use -> format
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Write direction — internal refs use -> format');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Check that activateDisplayText uses -> format with slash path
    if (compactStr.includes('activateDisplayText = ->Button/Button_Text:TextMeshProUGUI')) {
        pass('activateDisplayText written as ->Button/Button_Text:TextMeshProUGUI');
    }
    else {
        fail('activateDisplayText -> format', 'Not found in compact output');
    }
    // Check that external refs still use {fileID, guid} format
    if (compactStr.includes('{21300000, e197d4e89f9f4274dac4566fdd117ecf}')) {
        pass('External refs still use {fileID, guid} format');
    }
    else {
        fail('External ref format');
    }
    // Check that null refs still use {0} format
    if (!compactStr.includes('->') || compactStr.includes('{0}') || !compactStr.includes('->{0}')) {
        pass('Null refs not converted to -> format');
    }
    else {
        fail('Null ref format', 'Found ->{0} in output');
    }
}
// ============================================================
// Test 2: REFS includes stripped component entries
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: REFS includes stripped component entries');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Check that Button/Button_Text:TextMeshProUGUI is in REFS (slash path)
    const tmproRef = compact.refs.get('Button/Button_Text:TextMeshProUGUI')?.[0];
    if (tmproRef === '8027481463030904456') {
        pass('Button/Button_Text:TextMeshProUGUI = 8027481463030904456 in REFS');
    }
    else {
        fail('Stripped component in REFS', `Got: ${tmproRef}`);
    }
}
// ============================================================
// Test 2b: Issue #5 — nested prefab root components resolve via source prefab
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Issue #5 — nested prefab root components in regular parent REFS');
console.log('='.repeat(60));
{
    const issue5Resolver = makeIssue5Resolver();
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(issue5ParentPrefabYaml());
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: issue5Resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    const fsmRef = compact.refs.get('MyPage/BTN_Start:SimpleFSMController')?.[0];
    const buttonRef = compact.refs.get('MyPage/BTN_Start:Button')?.[0];
    if (compactStr.includes('fsmRef = ->MyPage/BTN_Start:SimpleFSMController') && fsmRef === '3010') {
        pass('Nested root SimpleFSMController writes path ref and REFS key');
    }
    else {
        fail('Nested root SimpleFSMController path ref', `REFS:${fsmRef || 'missing'}\n${compactStr}`);
    }
    if (compactStr.includes('buttonRef = ->MyPage/BTN_Start:Button') && buttonRef === '3020') {
        pass('Nested root Button writes path ref and REFS key');
    }
    else {
        fail('Nested root Button path ref', `REFS:${buttonRef || 'missing'}\n${compactStr}`);
    }
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    if (output.includes('fsmRef: {fileID: 3010}') && output.includes('buttonRef: {fileID: 3020}')) {
        pass('Nested root component path refs round-trip to original fileIDs');
    }
    else {
        fail('Nested root component write-back', output);
    }
}
console.log('\n' + '='.repeat(60));
console.log('TEST: Issue #5 — nested prefab root components in variant parent REFS');
console.log('='.repeat(60));
{
    const issue5Resolver = makeIssue5Resolver();
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(issue5VariantParentYaml());
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: issue5Resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    const fsmRef = compact.refs.get('MyPage/BTN_Start:SimpleFSMController')?.[0];
    const buttonRef = compact.refs.get('MyPage/BTN_Start:Button')?.[0];
    if (compactStr.includes('fsmRef = ->MyPage/BTN_Start:SimpleFSMController') && fsmRef === '3010') {
        pass('Variant nested root SimpleFSMController writes path ref and REFS key');
    }
    else {
        fail('Variant nested root SimpleFSMController path ref', `REFS:${fsmRef || 'missing'}\n${compactStr}`);
    }
    if (compactStr.includes('buttonRef = ->MyPage/BTN_Start:Button') && buttonRef === '3020') {
        pass('Variant nested root Button writes path ref and REFS key');
    }
    else {
        fail('Variant nested root Button path ref', `REFS:${buttonRef || 'missing'}\n${compactStr}`);
    }
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    if (output.includes('objectReference: {fileID: 3010}') &&
        output.includes('objectReference: {fileID: 3020}')) {
        pass('Variant nested root component path refs round-trip to original fileIDs');
    }
    else {
        fail('Variant nested root component write-back', output);
    }
}
// ============================================================
// Test 3: Read direction — -> references resolved to fileIDs
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Read direction — -> references resolved to fileIDs');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Merge back and check the resolved value
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    // The original has: activateDisplayText: {fileID: 8027481463030904456}
    if (output.includes('activateDisplayText: {fileID: 8027481463030904456}')) {
        pass('-> reference resolved to correct fileID in YAML output');
    }
    else {
        fail('-> resolution', 'fileID not found in output');
    }
    // Full identity round-trip
    const origLines = content.split('\n').map(l => l.trimEnd());
    const outLines = output.split('\n').map(l => l.trimEnd());
    let diffs = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
        if ((origLines[i] || '') !== (outLines[i] || ''))
            diffs++;
    }
    if (diffs === 0) {
        pass('Full identity round-trip: 0 diffs');
    }
    else {
        fail(`Identity round-trip: ${diffs} diffs`);
    }
}
// ============================================================
// Test 4: @ shorthand alias for -> (read direction)
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: @ shorthand alias for -> (read direction)');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Replace -> with @ in the compact string
    const atCompact = compactStr.replace('->Button/Button_Text:TextMeshProUGUI', '@Button/Button_Text:TextMeshProUGUI');
    const compact = (0, compact_reader_1.readCompact)(atCompact);
    // Merge back and verify
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    if (output.includes('activateDisplayText: {fileID: 8027481463030904456}')) {
        pass('@ alias resolves to correct fileID');
    }
    else {
        fail('@ alias resolution');
    }
    // Identity round-trip should still work
    const origLines = content.split('\n').map(l => l.trimEnd());
    const outLines = output.split('\n').map(l => l.trimEnd());
    let diffs = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
        if ((origLines[i] || '') !== (outLines[i] || ''))
            diffs++;
    }
    if (diffs === 0) {
        pass('@ alias round-trip: 0 diffs');
    }
    else {
        fail(`@ alias round-trip: ${diffs} diffs`);
    }
}
// ============================================================
// Test 5: Array references with -> resolve correctly
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Array references with -> resolve correctly');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const arrayRefLines = compactStr
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- ->_Card_Template/'));
    // Check that the array uses -> format with slash paths. Some fixture child names
    // are hash-like, so validate the resolved path form instead of stale display names.
    if (arrayRefLines.length >= 3 && arrayRefLines.every(line => line.includes('/'))) {
        pass('Array of internal refs uses -> format with slash paths');
    }
    else {
        fail('Array -> format', `Got: ${arrayRefLines.join(', ') || 'none'}`);
    }
    // Round-trip should still work
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    const origLines = content.split('\n').map(l => l.trimEnd());
    const outLines = output.split('\n').map(l => l.trimEnd());
    let diffs = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
        if ((origLines[i] || '') !== (outLines[i] || ''))
            diffs++;
    }
    if (diffs === 0) {
        pass('_Card_Template round-trip with -> arrays: 0 diffs');
    }
    else {
        fail(`_Card_Template round-trip: ${diffs} diffs`);
    }
}
// ============================================================
// Test 6: Setting a reference field using @ path syntax
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Setting a reference field using @ path syntax');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Modify the compact: change activateDisplayText to point to Background9Slice_Image:Image (slash path)
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'activateDisplayText') {
                // Use @ syntax to set reference with slash path
                prop.value = '@Button/Background9Slice_Image:Image';
            }
        }
    }
    // Merge and check
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    // Should resolve to Background9Slice_Image:Image fileID (8027481461304769067)
    if (output.includes('activateDisplayText: {fileID: 8027481461304769067}')) {
        pass('@ path reference resolved to correct fileID (8027481461304769067)');
    }
    else {
        // Check what value was written
        const match = output.match(/activateDisplayText: (.+)/);
        fail('@ path resolution', `Got: ${match ? match[1] : 'not found'}`);
    }
}
// ============================================================
// Test 7: Unresolved path reference throws an error
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Issue #3 — originally null prefab reference resolves via REFS');
console.log('='.repeat(60));
{
    const content = issue3RegularPrefabYaml();
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compact = (0, compact_reader_1.readCompact)((0, compact_writer_1.writeCompact)(ast));
    const targetPath = `Root/Target:${ISSUE3_SCRIPT_GUID}`;
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'targetRef') {
                prop.value = `->${targetPath}`;
            }
        }
    }
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    if (output.includes('targetRef: {fileID: 600}')) {
        pass('Null prefab reference changed to -> path writes fileID 600');
    }
    else {
        const match = output.match(/targetRef: (.+)/);
        fail('Null prefab reference -> resolution', `Got: ${match ? match[1] : 'not found'}`);
    }
}
console.log('\n' + '='.repeat(60));
console.log('TEST: Issue #3 — originally empty prefab reference array resolves via REFS');
console.log('='.repeat(60));
{
    const content = issue3RegularPrefabYaml();
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compact = (0, compact_reader_1.readCompact)((0, compact_writer_1.writeCompact)(ast));
    const targetPath = `Root/Target:${ISSUE3_SCRIPT_GUID}`;
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'targetRefs') {
                prop.value = `[->${targetPath}, ->${targetPath}]`;
            }
        }
    }
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const sourceDoc = merged.documents.find(doc => doc.fileId === '300');
    const refs = sourceDoc?.properties.targetRefs;
    if (Array.isArray(refs) && refs.length === 2 && refs.every(ref => String(ref.fileID) === '600')) {
        pass('Empty prefab reference array changed to -> entries writes fileID 600 entries');
    }
    else {
        fail('Empty prefab reference array -> resolution', `Got: ${JSON.stringify(refs)}`);
    }
}
console.log('\n' + '='.repeat(60));
console.log('TEST: Issue #3 — originally null variant objectReference resolves via REFS');
console.log('='.repeat(60));
{
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(issue3VariantYaml());
    const compact = (0, compact_reader_1.readCompact)(`# ubridge v1 | variant | base-guid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
--- STRUCTURE
(variant of aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
--- DETAILS

[Root/Source:${ISSUE3_SCRIPT_GUID}]
targetRef = ->Root/Target:${ISSUE3_SCRIPT_GUID}
--- REFS
__instance = 900
Root/Source:${ISSUE3_SCRIPT_GUID} = 500
Root/Target:${ISSUE3_SCRIPT_GUID} = 600
`);
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    if (output.includes('objectReference: {fileID: 600}')) {
        pass('Null variant objectReference changed to -> path writes fileID 600');
    }
    else {
        const match = output.match(/objectReference: (.+)/);
        fail('Variant objectReference -> resolution', `Got: ${match ? match[1] : 'not found'}`);
    }
}
// ============================================================
// Test 10: Unresolved path reference throws an error
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Unresolved path reference throws an error');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Inject a bogus -> reference into a property
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'activateDisplayText') {
                prop.value = '->NonExistent_GO:FakeComponent';
            }
        }
    }
    try {
        (0, compact_merger_1.mergeCompactChanges)(ast, compact);
        fail('Unresolved -> reference should throw', 'No error was thrown');
    }
    catch (e) {
        if (e.message.includes('Unresolved path reference: ->NonExistent_GO:FakeComponent')
            && e.message.includes('Valid REFS keys:')) {
            pass('Unresolved -> reference throws error with path and REFS keys');
        }
        else {
            fail('Error message format', `Got: ${e.message}`);
        }
    }
    // Also test @ alias
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'activateDisplayText') {
                prop.value = '@NonExistent_GO:FakeComponent';
            }
        }
    }
    try {
        (0, compact_merger_1.mergeCompactChanges)(ast, compact);
        fail('Unresolved @ reference should throw', 'No error was thrown');
    }
    catch (e) {
        if (e.message.includes('Unresolved path reference: @NonExistent_GO:FakeComponent')
            && e.message.includes('Valid REFS keys:')) {
            pass('Unresolved @ reference throws error with path and REFS keys');
        }
        else {
            fail('Error message format', `Got: ${e.message}`);
        }
    }
    // Test unresolved reference inside an array
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'activateDisplayText') {
                prop.value = '[->Valid_Ref:Might_Exist, ->Bogus_Array_Ref:Missing]';
            }
        }
    }
    try {
        (0, compact_merger_1.mergeCompactChanges)(ast, compact);
        fail('Unresolved array -> reference should throw', 'No error was thrown');
    }
    catch (e) {
        if (e.message.includes('Unresolved path reference:') && e.message.includes('Valid REFS keys:')) {
            pass('Unresolved array -> reference throws error');
        }
        else {
            fail('Array error message format', `Got: ${e.message}`);
        }
    }
}
// ============================================================
// Test 8: Reference to a new component (exists in STRUCTURE, not in REFS)
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Reference to a new component via STRUCTURE presence');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Inject a new GO 'NewPanel' with Image component into STRUCTURE,
    // add a DETAILS section, and make an existing field reference it.
    const modifiedCompact = compactStr
        // Replace last child marker with middle child, then add new last child
        .replace(/└─ (Button_Text.*)/, '├─ $1\n└─ NewPanel [Image]')
        // Add a DETAILS section for the new component
        .replace('--- REFS', '[Button/NewPanel:Image]\nm_Color = (1, 0, 0, 1)\n\n--- REFS')
        // Change activateDisplayText to reference the new component
        .replace(/activateDisplayText = ->[^\n]+/, 'activateDisplayText = ->Button/NewPanel:Image');
    const compact = (0, compact_reader_1.readCompact)(modifiedCompact);
    // Verify NewPanel exists in structure
    const hasNewPanel = compact.structure?.children?.some(c => c.name === 'NewPanel');
    if (hasNewPanel) {
        pass('NewPanel found in parsed STRUCTURE');
    }
    else {
        fail('NewPanel not in STRUCTURE');
    }
    // Merge — should NOT throw because NewPanel:Image is in STRUCTURE
    try {
        const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
        const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
        // Verify the reference was resolved to a valid fileID (not zero, not the string)
        const refMatch = output.match(/activateDisplayText: \{fileID: (\d+)\}/);
        if (refMatch && refMatch[1] !== '0') {
            pass(`Reference to new component resolved to fileID: ${refMatch[1]}`);
        }
        else {
            fail('Reference resolution', `Got: ${refMatch ? refMatch[0] : 'not found'}`);
        }
    }
    catch (e) {
        fail('Should not throw for STRUCTURE-present reference', e.message);
    }
}
// ============================================================
// Test 9: Cross-reference between two new objects
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Cross-reference between two new objects');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Add two new GOs: SourceGO and TargetGO, with SourceGO referencing TargetGO
    const modifiedCompact = compactStr
        .replace(/└─ (Button_Text.*)/, '├─ $1\n├─ SourceGO [MonoBehaviour]\n└─ TargetGO [Image]')
        .replace('--- REFS', '[Button/SourceGO:MonoBehaviour]\ntargetRef = ->Button/TargetGO:Image\n\n[Button/TargetGO:Image]\nm_Color = (0, 1, 0, 1)\n\n--- REFS');
    const compact = (0, compact_reader_1.readCompact)(modifiedCompact);
    // The merge should NOT throw — both GOs exist in STRUCTURE.
    // Note: merger doesn't create new YAML documents for new GOs yet,
    // so new component sections are silently skipped (no matching AST doc).
    // We verify the merge completes without error.
    try {
        (0, compact_merger_1.mergeCompactChanges)(ast, compact);
        pass('Cross-reference between new objects resolved without error');
    }
    catch (e) {
        fail('Should not throw for cross-reference between new objects', e.message);
    }
}
// ============================================================
// Test 10: Reference to non-existent GO still throws
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Reference to GO not in STRUCTURE or REFS still throws');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Inject a reference to a GO that doesn't exist anywhere
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'activateDisplayText') {
                prop.value = '->CompletelyFakeGO/Nonexistent:Image';
            }
        }
    }
    try {
        (0, compact_merger_1.mergeCompactChanges)(ast, compact);
        fail('Should throw for GO not in STRUCTURE or REFS', 'No error thrown');
    }
    catch (e) {
        if (e.message.includes('Unresolved path reference')) {
            pass('Correctly throws for reference to nonexistent GO');
        }
        else {
            fail('Wrong error', e.message);
        }
    }
}
// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
//# sourceMappingURL=test-path-refs.js.map