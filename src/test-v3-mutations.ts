import { compileV3 } from './v3/compiler';
import { readV3 } from './v3/reader';
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

function expectThrow(fn: () => unknown, expected: string, name: string): void {
  try {
    fn();
    assert(false, name, 'Expected an error, but none was thrown.');
  } catch (error) {
    assert(String(error).includes(expected), name, String(error));
  }
}

const baselineStructure = `Root @g1 [BoxCollider @c1]
├─ ParentA @g2
│  └─ Leaf @g4
└─ ParentB @g3`;

function v3(
  structure = baselineStructure,
  target = '{"$ref":"g4"}',
  extraIdentity = ''
): string {
  return `# ubridge v3 | prefab | profile:unity-generic-v1 | asset-guid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
--- STRUCTURE
${structure}
--- DETAILS
[c1 | Root:BoxCollider]
target = ${target}
m_Size = {"x":1,"y":2,"z":3}
--- IDENTITY
g1 = gameObject | fileID:10 | type:1 | typeName:GameObject
t1 = transform | fileID:11 | type:4 | typeName:Transform | owner:g1
c1 = component | fileID:12 | type:65 | typeName:BoxCollider | owner:g1
g2 = gameObject | fileID:20 | type:1 | typeName:GameObject
t2 = transform | fileID:21 | type:4 | typeName:Transform | owner:g2
g3 = gameObject | fileID:30 | type:1 | typeName:GameObject
t3 = transform | fileID:31 | type:4 | typeName:Transform | owner:g3
g4 = gameObject | fileID:40 | type:1 | typeName:GameObject
t4 = transform | fileID:41 | type:4 | typeName:Transform | owner:g4
${extraIdentity}`;
}

function compile(text: string) {
  return parseUnityYaml(writeUnityYaml(compileV3(readV3(text))));
}

function document(file: ReturnType<typeof compile>, fileId: string) {
  return file.documents.find(item => item.fileId === fileId);
}

console.log('\n=== v3 desired-state local mutations ===');

expectThrow(
  () => readV3(v3().replace(
    'g1 = gameObject | fileID:10',
    'g1 = gameObject | origin:local | fileID:10'
  )),
  'Invalid v3 identity origin',
  'unknown IDENTITY origin values are rejected instead of normalized'
);

{
  const file = compile(v3());
  assert(file.hierarchy?.children[0]?.children[0]?.name === 'Leaf',
    'baseline desired hierarchy is compiled');
  assert(String(document(file, '12')?.properties.target?.fileID) === '40',
    'machine reference resolves to the target GameObject fileID');
}

{
  const renamed = compile(v3(baselineStructure.replace('Leaf @g4', 'RenamedLeaf @g4')));
  assert(document(renamed, '40')?.properties.m_Name === 'RenamedLeaf',
    'rename changes display state while preserving GameObject fileID');
  assert(document(renamed, '41')?.properties.m_GameObject?.fileID === 40,
    'rename preserves Transform fileID and ownership');
}

{
  const movedStructure = `Root @g1 [BoxCollider @c1]
├─ ParentA @g2
└─ ParentB @g3
   └─ Leaf @g4`;
  const moved = compile(v3(movedStructure));
  assert(String(document(moved, '41')?.properties.m_Father?.fileID) === '31',
    'reparent rewrites m_Father while preserving child identity');
  assert((document(moved, '31')?.properties.m_Children || [])
    .some((entry: any) => String(entry.fileID) === '41'),
    'reparent rewrites the desired parent m_Children list');
}

{
  const reorderedStructure = `Root @g1 [BoxCollider @c1]
├─ ParentB @g3
└─ ParentA @g2
   └─ Leaf @g4`;
  const reordered = compile(v3(reorderedStructure));
  const rootChildren = document(reordered, '11')?.properties.m_Children || [];
  assert(rootChildren.map((entry: any) => String(entry.fileID)).join(',') === '31,21',
    'STRUCTURE sibling order is authoritative');
}

{
  const deletedStructure = `Root @g1 [BoxCollider @c1]
├─ ParentA @g2
└─ ParentB @g3`;
  const deleted = compile(v3(deletedStructure, '{"fileID":0}'));
  assert(!document(deleted, '40') && !document(deleted, '41'),
    'removing a subtree from STRUCTURE removes its Unity documents');
  assert(readV3(v3(deletedStructure, '{"fileID":0}')).identity.has('g4'),
    'deleted entity identity remains available as baseline metadata');
  expectThrow(
    () => compile(v3(deletedStructure)),
    'Dangling v3 reference',
    'deleting a referenced entity fails unless the reference changes atomically'
  );
}

{
  const withoutComponent = compile(v3(baselineStructure.replace(' [BoxCollider @c1]', ''), '{"fileID":0}'));
  assert(!document(withoutComponent, '12') &&
         document(withoutComponent, '10')?.properties.m_Component.length === 1,
    'removing a component binding removes its document and attachment');
}

{
  const addedStructure = `${baselineStructure}
└─ Added @g5`;
  const addedIdentity = `g5 = gameObject | type:1 | typeName:GameObject
t5 = transform | type:4 | typeName:Transform | owner:g5
`;
  const first = compile(v3(addedStructure, '{"$ref":"g4"}', addedIdentity));
  const second = compile(v3(addedStructure, '{"$ref":"g4"}', addedIdentity));
  const addedFirst = first.documents.find(item => item.properties.m_Name === 'Added');
  const addedSecond = second.documents.find(item => item.properties.m_Name === 'Added');
  assert(!!addedFirst && addedFirst.fileId === addedSecond?.fileId,
    'new GameObject receives a deterministic fileID without original YAML');
  const addedTransform = first.documents.find(item =>
    (item.typeId === 4 || item.typeId === 224) &&
    String(item.properties.m_GameObject?.fileID) === addedFirst?.fileId
  );
  assert(!!addedTransform,
    'new GameObject receives its structural Transform document');
}

{
  const withLight = baselineStructure.replace(
    '[BoxCollider @c1]',
    '[BoxCollider @c1, Light @c2]'
  );
  const light = compile(v3(
    withLight,
    '{"$ref":"g4"}',
    'c2 = component | type:108 | typeName:Light | owner:g1\n'
  ));
  const lightDocument = light.documents.find(item => item.typeId === 108);
  assert(!!lightDocument && String(lightDocument.properties.m_GameObject?.fileID) === '10',
    'new native component is compiled and attached without original YAML');
}

console.log(`\nv3 mutation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
