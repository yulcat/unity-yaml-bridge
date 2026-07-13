/** Regression tests for creating components and PrefabInstance overrides from compact edits. */

import { readCompact } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';
import { GuidResolver } from './guid-resolver';
import { writeCompact } from './compact-writer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE_GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NESTED_GUID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NEW_SCRIPT_GUID = 'cccccccccccccccccccccccccccccccc';

let passed = 0;
let failed = 0;

function assert(condition: unknown, name: string, details: string = ''): void {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
    failed++;
  }
}

function expectThrow(fn: () => void, text: string, name: string): void {
  try {
    fn();
    assert(false, name, 'Expected an error, but none was thrown.');
  } catch (error: any) {
    assert(String(error.message).includes(text), name, String(error.message));
  }
}

function prefabYaml(): string {
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
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
`;
}

function variantYaml(includeNestedOwner: boolean = false): string {
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
      propertyPath: m_Enabled
      value: 1
      objectReference: {fileID: 0}
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
${includeNestedOwner ? `--- !u!1001 &901
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
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
` : ''}`;
}

function baseWithUntouchedComponentYaml(): string {
  return prefabYaml()
    .replace(
      '  - component: {fileID: 200}',
      '  - component: {fileID: 200}\n  - component: {fileID: 500}\n  - component: {fileID: 600}'
    ) + `--- !u!65 &500
BoxCollider:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Material: {fileID: 0}
  m_IncludeLayers:
    serializedVersion: 2
    m_Bits: 0
  m_ExcludeLayers:
    serializedVersion: 2
    m_Bits: 0
  m_LayerOverridePriority: 0
  m_IsTrigger: 0
  m_ProvidesContacts: 0
  m_Enabled: 1
  serializedVersion: 3
  m_Size: {x: 1, y: 1, z: 1}
  m_Center: {x: 0, y: 0, z: 0}
--- !u!135 &600
SphereCollider:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Material: {fileID: 0}
  m_Enabled: 1
  serializedVersion: 3
  m_Radius: 0.5
  m_Center: {x: 0, y: 0, z: 0}
`;
}

function regularPrefabWithNestedInstanceYaml(): string {
  return prefabYaml() + `--- !u!1001 &901
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
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${NESTED_GUID}, type: 3}
--- !u!1 &300 stripped
GameObject:
  m_CorrespondingSourceObject: {fileID: 310, guid: ${NESTED_GUID}, type: 3}
  m_PrefabInstance: {fileID: 901}
  m_PrefabAsset: {fileID: 0}
`;
}

function compact(body: string, refs: string, structure: string = 'Root'): ReturnType<typeof readCompact> {
  return readCompact(`# ubridge v1 | prefab
--- STRUCTURE
${structure}
--- DETAILS
${body}
--- REFS
${refs}
`);
}

function variantCompact(body: string, refs: string, structure: string = 'Root'): ReturnType<typeof readCompact> {
  return readCompact(`# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
${structure}
--- DETAILS
${body}
--- REFS
__instance = 900
${refs}
`);
}

console.log('\n=== New component and override creation ===');

{
  console.log('\nRegular prefab creates native and scripted components');
  const original = parseUnityYaml(prefabYaml());
  const edited = compact(
    `[+ Root:NewBehaviour]
m_Script = {11500000, ${NEW_SCRIPT_GUID}, 3}
m_Enabled = 1
target = ->Root:BoxCollider

[+ Root:BoxCollider]
m_Enabled = 1
m_Size = (1, 2, 3)`,
    `Root = 100
Root:Transform = 200`,
    'Root [+BoxCollider, +NewBehaviour]'
  );
  const merged = mergeCompactChanges(original, edited);
  const box = merged.documents.find(doc => doc.typeId === 65);
  const behaviour = merged.documents.find(doc =>
    doc.typeId === 114 && doc.properties.m_Script?.guid === NEW_SCRIPT_GUID
  );
  const root = merged.documents.find(doc => doc.fileId === '100');

  assert(!!box && String(box.properties.m_GameObject?.fileID) === '100',
    'native component document is created on the requested GameObject');
  assert(box?.properties.m_Size?.x === 1 && box.properties.m_Size?.z === 3,
    'new native component properties are serialized');
  assert(!!behaviour && String(behaviour.properties.m_GameObject?.fileID) === '100',
    'scripted MonoBehaviour is created from explicit m_Script');
  assert(String(behaviour?.properties.target?.fileID) === box?.fileId,
    'new components can reference one another regardless of section order');
  assert(root?.properties.m_Component?.some((entry: any) =>
    String(entry.component?.fileID) === box?.fileId) &&
    root?.properties.m_Component?.some((entry: any) =>
      String(entry.component?.fileID) === behaviour?.fileId),
    'GameObject m_Component contains both generated component IDs');

  const reparsed = parseUnityYaml(writeUnityYaml(merged));
  assert(reparsed.hierarchy?.components.length === 2,
    'created prefab components survive YAML serialization and reparsing');
}

{
  console.log('\nScript name resolution and invalid additions');
  const resolver = new GuidResolver();
  resolver.add(NEW_SCRIPT_GUID, 'NewBehaviour');
  const original = parseUnityYaml(prefabYaml());
  const edited = compact(
    `[+ Root:NewBehaviour]
value = 7`,
    'Root = 100',
    'Root [+NewBehaviour]'
  );
  const merged = mergeCompactChanges(original, edited, { guidResolver: resolver });
  const created = merged.documents.find(doc => doc.typeId === 114);
  assert(created?.properties.m_Script?.guid === NEW_SCRIPT_GUID,
    'project resolver maps a script name back to its GUID');

  expectThrow(
    () => mergeCompactChanges(original, compact(
      '[+ Root:UnknownBehaviour]\nvalue = 1', 'Root = 100', 'Root [+UnknownBehaviour]'
    )),
    'Cannot determine Unity type',
    'unknown component without m_Script fails clearly'
  );
  expectThrow(
    () => mergeCompactChanges(original, compact(
      '[+ Root/Missing:BoxCollider]\nm_Enabled = 1', 'Root = 100', 'Root\n└─ Missing [+BoxCollider]'
    )),
    'GameObject not found',
    'component addition to a missing GameObject is rejected'
  );
}

{
  console.log('\nVariant creates m_AddedComponents for an inherited GameObject');
  const original = parseUnityYaml(variantYaml());
  const edited = variantCompact(
    `[+ Root:BoxCollider]
m_Enabled = 1
m_Size = (4, 5, 6)`,
    `Root = 100
Root:__source = ${BASE_GUID}
Root:__instance = 900`,
    'Root [+BoxCollider]'
  );
  const merged = mergeCompactChanges(original, edited);
  const box = merged.documents.find(doc => doc.typeId === 65);
  const strippedGo = merged.documents.find(doc => doc.typeId === 1 && doc.stripped);
  const owner = merged.documents.find(doc => doc.fileId === '900');
  const added = owner?.properties.m_Modification?.m_AddedComponents?.[0];

  assert(!!box && !!strippedGo &&
    String(box.properties.m_GameObject?.fileID) === strippedGo.fileId,
    'variant component points to a generated stripped GameObject');
  assert(String(strippedGo?.properties.m_CorrespondingSourceObject?.fileID) === '100' &&
    strippedGo?.properties.m_CorrespondingSourceObject?.guid === BASE_GUID,
    'stripped GameObject retains inherited source identity');
  assert(String(added?.targetCorrespondingSourceObject?.fileID) === '100' &&
    added?.targetCorrespondingSourceObject?.guid === BASE_GUID &&
    String(added?.addedObject?.fileID) === box?.fileId,
    'PrefabInstance m_AddedComponents links source GameObject and local component');
  assert(merged.prefabInstances[0].addedComponents.length === 1,
    'mutated AST PrefabInstance view includes the created component');

  const reparsed = parseUnityYaml(writeUnityYaml(merged));
  assert(reparsed.prefabInstances[0].addedComponents.length === 1,
    'created variant component survives YAML serialization and reparsing');
}

{
  console.log('\nRegular prefab adds a component to a nested prefab object');
  const original = parseUnityYaml(regularPrefabWithNestedInstanceYaml());
  const edited = compact(
    `[+ Root/Nested:BoxCollider]
m_Enabled = 1`,
    `Root = 100
Root/Nested = 300
Root/Nested:__instance = 901
Root/Nested:__source = ${NESTED_GUID}`,
    'Root\n└─ Nested {Nested} [+BoxCollider]'
  );
  const merged = mergeCompactChanges(original, edited);
  const owner = merged.documents.find(doc => doc.fileId === '901');
  const box = merged.documents.find(doc => doc.typeId === 65);
  const added = owner?.properties.m_Modification?.m_AddedComponents?.[0];

  assert(String(box?.properties.m_GameObject?.fileID) === '300',
    'new nested component uses the existing stripped GameObject');
  assert(String(added?.targetCorrespondingSourceObject?.fileID) === '310' &&
    added?.targetCorrespondingSourceObject?.guid === NESTED_GUID &&
    String(added?.addedObject?.fileID) === box?.fileId,
    'nested PrefabInstance receives the correct m_AddedComponents entry');
}

{
  console.log('\nVariant creates new scalar and object-reference overrides');
  const original = parseUnityYaml(variantYaml());
  const edited = variantCompact(
    `[Root:ExistingBehaviour]
m_Enabled = 0
newScalar = 42
targetRef = ->Root

[Root:UntouchedBehaviour]
freshOverride = hello`,
    `Root = 100
Root:ExistingBehaviour = 500
Root:ExistingBehaviour:__source = ${BASE_GUID}
Root:ExistingBehaviour:__instance = 900
Root:UntouchedBehaviour = 600
Root:UntouchedBehaviour:__source = ${BASE_GUID}
Root:UntouchedBehaviour:__instance = 900`
  );
  const merged = mergeCompactChanges(original, edited);
  const owner = merged.documents.find(doc => doc.fileId === '900');
  const mods = owner?.properties.m_Modification?.m_Modifications || [];
  const find = (target: string, path: string) => mods.find((mod: any) =>
    String(mod.target?.fileID) === target && mod.propertyPath === path
  );

  assert(find('500', 'm_Enabled')?.value === '0',
    'existing override is still updated');
  assert(find('500', 'newScalar')?.value === '42',
    'new scalar property creates a modification entry');
  assert(String(find('500', 'targetRef')?.objectReference?.fileID) === '100' &&
    find('500', 'targetRef')?.value === '',
    'new object-reference override creates objectReference instead of a string value');
  assert(find('600', 'freshOverride')?.value === 'hello' &&
    find('600', 'freshOverride')?.target?.guid === BASE_GUID,
    'entirely new DETAILS section can override a previously untouched component');
  assert(merged.prefabInstances[0].modifications.some(mod =>
    String(mod.target.fileID) === '600' && mod.propertyPath === 'freshOverride'),
    'mutated AST PrefabInstance view includes newly created overrides');
}

{
  console.log('\nNew nested override is written to the selected PrefabInstance');
  const original = parseUnityYaml(variantYaml(true));
  const edited = variantCompact(
    `[Nested/Label:Text]
m_Text = changed`,
    `Nested/Label:Text = 700
Nested/Label:Text:__source = ${NESTED_GUID}
Nested/Label:Text:__instance = 901`
  );
  const merged = mergeCompactChanges(original, edited);
  const rootMods = merged.documents.find(doc => doc.fileId === '900')
    ?.properties.m_Modification?.m_Modifications || [];
  const nestedMods = merged.documents.find(doc => doc.fileId === '901')
    ?.properties.m_Modification?.m_Modifications || [];

  assert(rootMods.length === 1 && nestedMods.length === 1,
    'new nested override does not leak into the root PrefabInstance');
  assert(String(nestedMods[0].target?.fileID) === '700' &&
    nestedMods[0].target?.guid === NESTED_GUID && nestedMods[0].value === 'changed',
    'new nested override retains target source GUID and owner');
}

{
  console.log('\nVariant writer exposes untouched base targets for new edits');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-create-'));
  try {
    const basePath = path.join(tempDir, 'Base.prefab');
    fs.writeFileSync(basePath, baseWithUntouchedComponentYaml(), 'utf-8');
    const resolver = new GuidResolver();
    resolver.addAsset(BASE_GUID, basePath, 'Base');
    const original = parseUnityYaml(variantYaml());
    const compactText = writeCompact(original, { guidResolver: resolver });

    assert(compactText.includes('Root:SphereCollider = 600'),
      'REFS includes a component with no existing override');
    assert(compactText.includes(`Root:SphereCollider:__source = ${BASE_GUID}`) &&
      compactText.includes('Root:SphereCollider:__instance = 900'),
      'untouched target REFS includes source GUID and owner metadata');

    const edited = compactText.replace(
      '--- REFS',
      '[Root:SphereCollider]\nm_Radius = 2.5\n\n--- REFS'
    );
    const merged = mergeCompactChanges(original, readCompact(edited));
    const mods = merged.documents.find(doc => doc.fileId === '900')
      ?.properties.m_Modification?.m_Modifications || [];
    assert(mods.some((mod: any) => String(mod.target?.fileID) === '600' &&
      mod.target?.guid === BASE_GUID && mod.propertyPath === 'm_Radius' && mod.value === '2.5'),
      'writer output can be edited to create an override without manual REFS changes');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log(`\nSUMMARY: ${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
