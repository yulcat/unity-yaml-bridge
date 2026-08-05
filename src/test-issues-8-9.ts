/** Regression tests for GitHub issues #8 and #9. */

import { readCompact, CompactStructureNode } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';

const SCRIPT_GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
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

function compact(structure: string, details: string, refs: string) {
  return readCompact(`# ubridge v1 | prefab
--- STRUCTURE
${structure}
--- DETAILS
${details}
--- REFS
${refs}
`);
}

function componentPrefab(referenceTarget: string = '0'): string {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Component:
  - component: {fileID: 200}
  - component: {fileID: 300}
  - component: {fileID: 400}
  - component: {fileID: 500}
  m_Name: Root
  m_IsActive: 1
--- !u!4 &200
Transform:
  m_GameObject: {fileID: 100}
  m_Children: []
  m_Father: {fileID: 0}
--- !u!65 &300
BoxCollider:
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_Size: {x: 1, y: 1, z: 1}
--- !u!114 &400
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_Script: {fileID: 11500000, guid: ${SCRIPT_GUID}, type: 3}
  value: 1
--- !u!114 &500
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_Script: {fileID: 11500000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}
  target: {fileID: ${referenceTarget}}
`;
}

function goDocument(id: number, transformId: number, name: string, componentIds: number[] = []): string {
  const components = [transformId, ...componentIds]
    .map(componentId => `  - component: {fileID: ${componentId}}`)
    .join('\n');
  return `--- !u!1 &${id}
GameObject:
  m_Component:
${components}
  m_Name: ${name}
  m_IsActive: 1
`;
}

function transformDocument(id: number, goId: number, fatherId: number, children: number[]): string {
  const childValue = children.length === 0
    ? '[]'
    : `\n${children.map(child => `  - {fileID: ${child}}`).join('\n')}`;
  return `--- !u!4 &${id}
Transform:
  m_GameObject: {fileID: ${goId}}
  m_Children: ${childValue}
  m_Father: {fileID: ${fatherId}}
`;
}

function deepPrefab(): string {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
${goDocument(100, 200, 'Root')}${transformDocument(200, 100, 0, [210])}${goDocument(110, 210, 'Container')}${transformDocument(210, 110, 200, [220, 230])}${goDocument(120, 220, 'Btn')}${transformDocument(220, 120, 210, [240])}${goDocument(140, 240, 'Frame')}${transformDocument(240, 140, 220, [])}${goDocument(130, 230, 'Star')}${transformDocument(230, 130, 210, [250])}${goDocument(150, 250, 'Gauge')}${transformDocument(250, 150, 230, [])}`;
}

function structurePaths(node: CompactStructureNode, parent: string = ''): string[] {
  const current = parent ? `${parent}/${node.name}` : node.name;
  return [current, ...node.children.flatMap(child => structurePaths(child, current))];
}

console.log('\n=== Issues #8 and #9 regressions ===');

{
  console.log('\nIssue #9: deep sibling hierarchy parsing');
  const edited = compact(
    `Root
└─ Container
   ├─ Btn
   │  └─ Frame
   └─ Star
      └─ Gauge [+CanvasGroup]`,
    `[+ Root/Container/Star/Gauge:CanvasGroup]
m_Alpha = 1`,
    `Root = 100
Root:Transform = 200
Root/Container = 110
Root/Container:Transform = 210
Root/Container/Btn = 120
Root/Container/Btn:Transform = 220
Root/Container/Btn/Frame = 140
Root/Container/Btn/Frame:Transform = 240
Root/Container/Star = 130
Root/Container/Star:Transform = 230
Root/Container/Star/Gauge = 150
Root/Container/Star/Gauge:Transform = 250`
  );
  const paths = structurePaths(edited.structure!);
  assert(paths.includes('Root/Container/Star'), 'sibling branch is retained');
  assert(paths.includes('Root/Container/Star/Gauge'), 'sibling descendant keeps its parent path');
  assert(!paths.includes('Root/Container/Btn/Gauge'), 'descendant is not reparented to preceding sibling');

  const merged = mergeCompactChanges(parseUnityYaml(deepPrefab()), edited);
  const canvasGroup = merged.documents.find(document => document.typeId === 225);
  assert(String(canvasGroup?.properties.m_GameObject?.fileID) === '150',
    'deep component addition resolves to the intended GameObject');
  const reparsed = parseUnityYaml(writeUnityYaml(merged));
  assert(reparsed.hierarchy?.children[0]?.children[1]?.children[0]?.name === 'Gauge',
    'serialized hierarchy remains stable after the edit');
}

{
  console.log('\nIssue #8: remove local components');
  const edited = compact('Root [-BoxCollider]', '', `Root = 100
Root:Transform = 200
Root:BoxCollider = 300`);
  const merged = mergeCompactChanges(parseUnityYaml(componentPrefab()), edited);
  const root = merged.documents.find(document => document.fileId === '100');
  assert(!merged.documents.some(document => document.fileId === '300'),
    'built-in component document is removed');
  assert(!root?.properties.m_Component.some((entry: any) => String(entry.component?.fileID) === '300'),
    'owning GameObject attachment is removed');
  assert(!parseUnityYaml(writeUnityYaml(merged)).documents.some(document => document.fileId === '300'),
    'component removal survives YAML serialization and reparsing');
}

{
  console.log('\nIssue #8: remove scripted component');
  const edited = compact('Root [-OldBehaviour]', '', `Root = 100
Root:OldBehaviour = 400`);
  const merged = mergeCompactChanges(parseUnityYaml(componentPrefab()), edited);
  assert(!merged.documents.some(document => document.fileId === '400'),
    'scripted MonoBehaviour document is removed through its REFS name');
}

{
  console.log('\nIssue #8: atomic component replacement');
  const edited = compact(
    'Root [-BoxCollider, +CanvasGroup]',
    `[+ Root:CanvasGroup]
m_Alpha = 0.5
m_Interactable = 1`,
    `Root = 100
Root:BoxCollider = 300`
  );
  const merged = mergeCompactChanges(parseUnityYaml(componentPrefab()), edited);
  const replacement = merged.documents.find(document => document.typeId === 225);
  assert(!merged.documents.some(document => document.fileId === '300') && !!replacement,
    'old component is removed while replacement is created');
  assert(replacement?.properties.m_Alpha === 0.5,
    'replacement DETAILS are applied in the same write');
}

{
  console.log('\nIssue #8: dangling reference diagnostics');
  const removal = compact('Root [-BoxCollider]', '', `Root = 100
Root:BoxCollider = 300`);
  expectThrow(
    () => mergeCompactChanges(parseUnityYaml(componentPrefab('300')), removal),
    'Clear or replace those references',
    'removal fails while another component still references the target'
  );

  const cleared = compact(
    'Root [-BoxCollider]',
    `[Root:Holder]
target = {0}`,
    `Root = 100
Root:BoxCollider = 300
Root:Holder = 500`
  );
  const merged = mergeCompactChanges(parseUnityYaml(componentPrefab('300')), cleared);
  assert(!merged.documents.some(document => document.fileId === '300') &&
    String(merged.documents.find(document => document.fileId === '500')?.properties.target?.fileID) === '0',
    'reference can be cleared atomically with component removal');
}

{
  console.log('\nIssue #8: required component guard and no-op behavior');
  expectThrow(
    () => mergeCompactChanges(
      parseUnityYaml(componentPrefab()),
      compact('Root [-Transform]', '', 'Root = 100\nRoot:Transform = 200')
    ),
    'Cannot remove required component',
    'Transform removal is rejected clearly'
  );

  const original = parseUnityYaml(componentPrefab());
  const merged = mergeCompactChanges(original, compact('Root [BoxCollider]', '', 'Root = 100'));
  assert(merged.documents.length === original.documents.length,
    'absence of a removal marker preserves all documents');
}

console.log(`\nSUMMARY: ${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);

