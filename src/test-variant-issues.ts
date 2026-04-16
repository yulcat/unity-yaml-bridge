/**
 * Focused regressions for variant prefab edge cases.
 *
 * Issue #1: variant STRUCTURE must include base children and root-level added GOs.
 * Issue #2: non-root nested PrefabInstance m_Modifications must appear in DETAILS.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GuidResolver } from './guid-resolver';
import { readCompact } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact } from './compact-writer';
import { writeUnityYaml } from './unity-yaml-writer';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string, detail?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  PASS: ${message}`);
  } else {
    console.log(`  FAIL: ${message}`);
    if (detail) console.log(`    ${detail}`);
  }
}

function getSection(compact: string, section: string): string {
  const start = compact.indexOf(`--- ${section}`);
  if (start < 0) return '';
  const next = compact.indexOf('\n--- ', start + 1);
  return compact.slice(start, next < 0 ? compact.length : next);
}

function writeAsset(projectRoot: string, relativePath: string, guid: string, content: string): void {
  const assetPath = path.join(projectRoot, 'Assets', relativePath);
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, content);
  fs.writeFileSync(`${assetPath}.meta`, `fileFormatVersion: 2\nguid: ${guid}\n`);
}

function makeResolver(assets: { path: string; guid: string; content: string }[]): GuidResolver {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-variant-issues-'));
  fs.mkdirSync(path.join(projectRoot, 'Assets'), { recursive: true });

  for (const asset of assets) {
    writeAsset(projectRoot, asset.path, asset.guid, asset.content);
  }

  const resolver = new GuidResolver();
  resolver.scanProject(projectRoot);
  return resolver;
}

const BASE_GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NESTED_GUID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const IMAGE_GUID = 'f70555f144d8491a825f0804e09c671c';

function basePrefabYaml(): string {
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

function variantWithRootAddedYaml(): string {
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

function variantWithAddedReferenceDocsYaml(): string {
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

function nestedMenuPrefabYaml(): string {
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

function variantWithNestedPrefabOverridesYaml(): string {
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
  const ast = parseUnityYaml(variantWithRootAddedYaml());
  const compact = writeCompact(ast, { guidResolver: resolver });
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
  const ast = parseUnityYaml(variantWithNestedPrefabOverridesYaml());
  const compact = writeCompact(ast, { guidResolver: resolver });
  const details = getSection(compact, 'DETAILS');

  assert(details.includes('Text_Logout'), 'DETAILS includes Text_Logout nested override', details);
  assert(details.includes('Text_Quit'), 'DETAILS includes Text_Quit nested override', details);
  assert(details.includes('Text_Restore'), 'DETAILS includes Text_Restore nested override', details);
  assert(details.includes('[Text_Logout]'), 'DETAILS uses nested m_Name override as a readable header', details);
}

{
  console.log('\nIssue #3 follow-up: added-object component refs write to real docs');
  const ast = parseUnityYaml(variantWithAddedReferenceDocsYaml());
  const compact = readCompact(`# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
__added_root__
├─ + Source [${IMAGE_GUID}]
└─ + Target [${IMAGE_GUID}]
--- DETAILS

[Source:${IMAGE_GUID}]
targetRef = ->Target:${IMAGE_GUID}
targetRefs = [->Target:${IMAGE_GUID}, ->Target:${IMAGE_GUID}]
--- REFS
__instance = 900
Source:${IMAGE_GUID} = 1200
Target:${IMAGE_GUID} = 1600
`);

  const merged = mergeCompactChanges(ast, compact);
  const sourceDoc = merged.documents.find(doc => doc.fileId === '1200');
  const refs = sourceDoc?.properties.targetRefs;

  assert(String(sourceDoc?.properties.targetRef?.fileID) === '1600',
    'null reference edited in an added variant component writes to component doc',
    writeUnityYaml(merged));
  assert(Array.isArray(refs) && refs.length === 2 && refs.every(ref => String(ref.fileID) === '1600'),
    'array references edited in an added variant component write to component doc',
    JSON.stringify(refs));
}

{
  console.log('\nIssue #3 follow-up: __added_root__ paths resolve for added-object docs');
  const ast = parseUnityYaml(variantWithAddedReferenceDocsYaml());
  const compact = readCompact(`# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
__added_root__
├─ + Source [${IMAGE_GUID}]
└─ + Target [${IMAGE_GUID}]
--- DETAILS

[__added_root__/Source:${IMAGE_GUID}]
targetRef = ->__added_root__/Target:${IMAGE_GUID}
--- REFS
__instance = 900
__added_root__/Source:${IMAGE_GUID} = 1200
__added_root__/Target:${IMAGE_GUID} = 1600
`);

  const merged = mergeCompactChanges(ast, compact);
  const sourceDoc = merged.documents.find(doc => doc.fileId === '1200');

  assert(String(sourceDoc?.properties.targetRef?.fileID) === '1600',
    '__added_root__ reference path writes to added variant component doc',
    writeUnityYaml(merged));
}

console.log(`\nSUMMARY: ${passedTests}/${totalTests} tests passed`);
process.exit(passedTests === totalTests ? 0 : 1);
