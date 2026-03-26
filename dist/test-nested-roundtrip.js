"use strict";
/**
 * Test nested YAML property roundtrip through compact format.
 * Verifies Bug 1 fix: stack-based indent parser preserves nesting.
 * Verifies Bug 2 fix: objects in arrays serialize correctly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const compact_reader_1 = require("./compact-reader");
const compact_writer_1 = require("./compact-writer");
const compact_merger_1 = require("./compact-merger");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
let totalTests = 0;
let passedTests = 0;
function assert(condition, message) {
    totalTests++;
    if (condition) {
        console.log(`  PASS: ${message}`);
        passedTests++;
    }
    else {
        console.log(`  FAIL: ${message}`);
    }
}
// ============================================================
// Bug 1: Nested property parsing
// ============================================================
console.log('\n=== Bug 1: Stack-based indent parser for nested properties ===\n');
// Test 1: Basic nested properties are parsed correctly
{
    console.log('Test 1: Basic nested property parsing');
    const compact = `# ubridge v1 | prefab
--- STRUCTURE
TestGO [MonoBehaviour]
--- DETAILS

[TestGO:MonoBehaviour]
Model:
  CombatProperty:
    HealthPoint = 720
    AttackPoint = 1
m_FontData:
  m_Font = {12800000, abc123}
  m_FontSize = 40
--- REFS
TestGO:MonoBehaviour = 100
`;
    const parsed = (0, compact_reader_1.readCompact)(compact);
    const section = parsed.sections[0];
    assert(section.properties.length === 2, 'Top-level has 2 properties (Model, m_FontData)');
    // Check Model nesting
    const model = section.properties[0];
    assert(model.key === 'Model', 'First prop is Model');
    assert(Array.isArray(model.value), 'Model value is array (nested block)');
    const modelChildren = model.value;
    assert(modelChildren.length === 1, 'Model has 1 child (CombatProperty)');
    assert(modelChildren[0].key === 'CombatProperty', 'Child is CombatProperty');
    const combatChildren = modelChildren[0].value;
    assert(Array.isArray(combatChildren), 'CombatProperty value is array');
    assert(combatChildren.length === 2, 'CombatProperty has 2 children');
    assert(combatChildren[0].key === 'HealthPoint' && combatChildren[0].value === '720', 'HealthPoint = 720');
    assert(combatChildren[1].key === 'AttackPoint' && combatChildren[1].value === '1', 'AttackPoint = 1');
    // Check m_FontData nesting
    const fontData = section.properties[1];
    assert(fontData.key === 'm_FontData', 'Second prop is m_FontData');
    const fontChildren = fontData.value;
    assert(fontChildren.length === 2, 'm_FontData has 2 children');
    assert(fontChildren[0].key === 'm_Font', 'm_Font is child of m_FontData');
    assert(fontChildren[1].key === 'm_FontSize' && fontChildren[1].value === '40', 'm_FontSize = 40');
}
// Test 2: Nested properties merge correctly into AST
{
    console.log('\nTest 2: Nested property merge into AST');
    // Create a minimal Unity YAML with nested properties
    const yaml = `%YAML 1.1
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
  m_Name: TestGO
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
  m_ConstrainProportionsScale: 0
  m_Children: []
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
  m_Script: {fileID: 11500000, guid: abc123, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  Model:
    CombatProperty:
      HealthPoint: 720
      AttackPoint: 1
  m_FontData:
    m_Font: {fileID: 12800000, guid: def456, type: 3}
    m_FontSize: 40
`;
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(yaml);
    // Write to compact, parse back, merge, write YAML
    const compactStr = (0, compact_writer_1.writeCompact)(ast);
    const compactFile = (0, compact_reader_1.readCompact)(compactStr);
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compactFile);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    // Verify nested structure is preserved
    const monoBehaviour = merged.documents.find(d => d.typeId === 114);
    assert(monoBehaviour !== undefined, 'MonoBehaviour document found');
    if (monoBehaviour) {
        const model = monoBehaviour.properties.Model;
        assert(model !== undefined && typeof model === 'object', 'Model is an object');
        assert(model?.CombatProperty !== undefined, 'Model.CombatProperty exists');
        assert(model?.CombatProperty?.HealthPoint === 720, 'Model.CombatProperty.HealthPoint = 720');
        assert(model?.CombatProperty?.AttackPoint === 1, 'Model.CombatProperty.AttackPoint = 1');
        const fontData = monoBehaviour.properties.m_FontData;
        assert(fontData !== undefined && typeof fontData === 'object', 'm_FontData is an object');
        assert(fontData?.m_FontSize === 40, 'm_FontData.m_FontSize = 40');
    }
    // Verify YAML output preserves nesting
    assert(output.includes('    CombatProperty:'), 'Output has CombatProperty nested');
    assert(output.includes('      HealthPoint: 720'), 'Output has HealthPoint under CombatProperty');
    assert(output.includes('      AttackPoint: 1'), 'Output has AttackPoint under CombatProperty');
    assert(output.includes('    m_Font:'), 'Output has m_Font under m_FontData');
    assert(output.includes('    m_FontSize: 40'), 'Output has m_FontSize under m_FontData');
}
// Test 3: Editing nested properties roundtrip
{
    console.log('\nTest 3: Editing nested property values');
    const yaml = `%YAML 1.1
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
  m_Name: TestGO
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
  m_ConstrainProportionsScale: 0
  m_Children: []
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
  m_Script: {fileID: 11500000, guid: abc123, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  Model:
    CombatProperty:
      HealthPoint: 720
      AttackPoint: 1
`;
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(yaml);
    const compactStr = (0, compact_writer_1.writeCompact)(ast);
    const compactFile = (0, compact_reader_1.readCompact)(compactStr);
    // Edit: change HealthPoint from 720 to 999
    for (const section of compactFile.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'Model' && Array.isArray(prop.value)) {
                for (const child of prop.value) {
                    if (child.key === 'CombatProperty' && Array.isArray(child.value)) {
                        for (const grandchild of child.value) {
                            if (grandchild.key === 'HealthPoint') {
                                grandchild.value = '999';
                            }
                        }
                    }
                }
            }
        }
    }
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compactFile);
    const mono = merged.documents.find(d => d.typeId === 114);
    assert(mono?.properties.Model?.CombatProperty?.HealthPoint === 999, 'Edited HealthPoint = 999');
    assert(mono?.properties.Model?.CombatProperty?.AttackPoint === 1, 'AttackPoint unchanged = 1');
}
// ============================================================
// Bug 2: Array of objects serialization
// ============================================================
console.log('\n=== Bug 2: Array of objects serialization ===\n');
// Test 4: Objects in arrays don't become [object Object]
{
    console.log('Test 4: Objects in arrays serialize correctly');
    const yaml = `%YAML 1.1
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
  m_Name: TestGO
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
  m_ConstrainProportionsScale: 0
  m_Children: []
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
  m_Script: {fileID: 11500000, guid: abc123, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  m_Items:
  - name: Sword
    damage: 50
    weight: 3
  - name: Shield
    damage: 0
    weight: 10
`;
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(yaml);
    const compactStr = (0, compact_writer_1.writeCompact)(ast);
    // Verify no [object Object] in compact output
    assert(!compactStr.includes('[object Object]'), 'No [object Object] in compact output');
    // Verify array items are properly serialized
    assert(compactStr.includes('name = Sword') || compactStr.includes('name: Sword'), 'Sword item serialized correctly');
    assert(compactStr.includes('damage = 50') || compactStr.includes('damage: 50'), 'damage = 50 serialized correctly');
    // Roundtrip
    const compactFile = (0, compact_reader_1.readCompact)(compactStr);
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compactFile);
    const mono = merged.documents.find(d => d.typeId === 114);
    const items = mono?.properties.m_Items;
    assert(Array.isArray(items) && items.length === 2, 'm_Items has 2 items after roundtrip');
    if (Array.isArray(items) && items.length === 2) {
        assert(items[0].name === 'Sword', 'First item name = Sword');
        assert(items[0].damage === 50, 'First item damage = 50');
        assert(items[1].name === 'Shield', 'Second item name = Shield');
        assert(items[1].weight === 10, 'Second item weight = 10');
    }
}
// Summary
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
//# sourceMappingURL=test-nested-roundtrip.js.map