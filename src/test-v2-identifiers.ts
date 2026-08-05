import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact } from './compact-writer';
import { readCompact } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;
function assert(condition: unknown, name: string, details = ''): void {
  if (condition) { console.log(`  PASS: ${name}`); passed++; }
  else { console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`); failed++; }
}

function fixture(childOrder = ['120', '110', '130'], componentOrder = ['900', '800']): string {
  const childRefs = childOrder.map(id => `  - {fileID: ${Number(id) + 1000}}`).join('\n');
  const panelComponents = componentOrder.map(id => `  - component: {fileID: ${id}}`).join('\n');
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Component:
  - component: {fileID: 1100}
  m_Name: Inventory
--- !u!4 &1100
Transform:
  m_GameObject: {fileID: 100}
  m_Children:
${childRefs}
  m_Father: {fileID: 0}
--- !u!1 &120
GameObject:
  m_Component:
  - component: {fileID: 1120}
  - component: {fileID: 220}
  m_Name: Item
--- !u!4 &1120
Transform:
  m_GameObject: {fileID: 120}
  m_Children: []
  m_Father: {fileID: 1100}
--- !u!225 &220
CanvasGroup:
  m_GameObject: {fileID: 120}
  m_Alpha: 0.2
--- !u!1 &110
GameObject:
  m_Component:
  - component: {fileID: 1110}
  - component: {fileID: 210}
  m_Name: Item
--- !u!4 &1110
Transform:
  m_GameObject: {fileID: 110}
  m_Children: []
  m_Father: {fileID: 1100}
--- !u!225 &210
CanvasGroup:
  m_GameObject: {fileID: 110}
  m_Alpha: 0.1
--- !u!1 &130
GameObject:
  m_Component:
  - component: {fileID: 1130}
${panelComponents}
  m_Name: Panel
--- !u!4 &1130
Transform:
  m_GameObject: {fileID: 130}
  m_Children: []
  m_Father: {fileID: 1100}
--- !u!225 &900
CanvasGroup:
  m_GameObject: {fileID: 130}
  m_Alpha: 0.9
  m_Target: {fileID: 210}
--- !u!225 &800
CanvasGroup:
  m_GameObject: {fileID: 130}
  m_Alpha: 0.8
`;
}

console.log('\n=== v2 snapshot selectors ===');

const ast = parseUnityYaml(fixture());
const v1 = writeCompact(ast);
const v2 = writeCompact(ast, { version: 2 });
assert(v2.startsWith('# ubridge v2 | prefab'), 'writer emits an explicit v2 header');
assert(v2.includes('├─ Item#2 [CanvasGroup]') && v2.includes('├─ Item#1 [CanvasGroup]'),
  'duplicate siblings are numbered by fileID, not display order', v2);
assert(v2.includes('Panel [CanvasGroup#2, CanvasGroup#1]'),
  'duplicate components are numbered by fileID, not component order', v2);
assert(v2.includes('Inventory/Item#1:CanvasGroup = 210') &&
  v2.includes('Inventory/Item#2:CanvasGroup = 220'),
  'REFS bind each sibling selector to one document');
assert(v2.includes('Inventory/Panel:CanvasGroup#1 = 800') &&
  v2.includes('Inventory/Panel:CanvasGroup#2 = 900'),
  'REFS bind each component selector to one document');
assert(v2.includes('m_Target = ->Inventory/Item#1:CanvasGroup'),
  'internal references use the same numbered selector');

const reordered = writeCompact(parseUnityYaml(fixture(['110', '120', '130'], ['800', '900'])), { version: 2 });
for (const expected of [
  'Inventory/Item#1 = 110', 'Inventory/Item#2 = 120',
  'Inventory/Panel:CanvasGroup#1 = 800', 'Inventory/Panel:CanvasGroup#2 = 900',
]) {
  assert(reordered.includes(expected), `selector remains stable after reorder: ${expected}`);
}

const edited = v2
  .replace('[Inventory/Item#1:CanvasGroup]\nm_Alpha = 0.1', '[Inventory/Item#1:CanvasGroup]\nm_Alpha = 0.31')
  .replace('[Inventory/Item#2:CanvasGroup]\nm_Alpha = 0.2', '[Inventory/Item#2:CanvasGroup]\nm_Alpha = 0.32')
  .replace('[Inventory/Panel:CanvasGroup#1]\nm_Alpha = 0.8', '[Inventory/Panel:CanvasGroup#1]\nm_Alpha = 0.41')
  .replace('[Inventory/Panel:CanvasGroup#2]\nm_Alpha = 0.9', '[Inventory/Panel:CanvasGroup#2]\nm_Alpha = 0.42');
const merged = mergeCompactChanges(ast, readCompact(edited));
const values = new Map(merged.documents.map(doc => [doc.fileId, doc.properties.m_Alpha]));
assert(values.get('210') === 0.31 && values.get('220') === 0.32,
  'write-back edits the intended duplicate sibling components');
assert(values.get('800') === 0.41 && values.get('900') === 0.42,
  'write-back edits the intended same-type components');

const literal = writeCompact(parseUnityYaml(fixture().replace(/m_Name: Item/g, 'm_Name: Item#1')), { version: 2 });
assert(literal.includes('Item#1#1') && literal.includes('Item#1#2'),
  'a literal name ending in #N receives a separate final discriminator');

try {
  readCompact(v2.replace('Inventory/Item#1:CanvasGroup = 210\n', ''));
  assert(false, 'v2 numbered DETAILS require an exact REFS binding');
} catch (error: any) {
  assert(String(error.message).includes('exactly one matching REFS'),
    'v2 numbered DETAILS require an exact REFS binding');
}

try {
  const redirected = v2.replace(
    'Inventory/Item#1:CanvasGroup = 210',
    'Inventory/Item#1:CanvasGroup = 220'
  );
  mergeCompactChanges(ast, readCompact(redirected));
  assert(false, 'v2 REFS cannot redirect an alias to another sibling');
} catch (error: any) {
  assert(String(error.message).includes('target GameObject not found') ||
    String(error.message).includes('ownership mismatch'),
    'v2 REFS cannot redirect an alias to another sibling');
}

const uniqueYaml = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1
GameObject:
  m_Component:
  - component: {fileID: 2}
  - component: {fileID: 3}
  m_Name: Root
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_Children: []
  m_Father: {fileID: 0}
--- !u!225 &3
CanvasGroup:
  m_GameObject: {fileID: 1}
  m_Alpha: 0.5
`;
const uniqueAst = parseUnityYaml(uniqueYaml);
const uniqueV1 = writeCompact(uniqueAst);
const uniqueV2 = writeCompact(uniqueAst, { version: 2 });
assert(uniqueV1.split('\n').slice(1).join('\n') === uniqueV2.split('\n').slice(1).join('\n'),
  'collision-free v2 body is byte-identical to v1');

const arenaPath = path.join(__dirname, '..', 'samples', 'prefabs', 'ArenaStart.prefab');
if (fs.existsSync(arenaPath)) {
  try {
    writeCompact(parseUnityYaml(fs.readFileSync(arenaPath, 'utf8')), { version: 2 });
    assert(false, 'unresolved multi-owner nested selectors fail closed');
  } catch (error: any) {
    assert(String(error.message).includes('owner identity'),
      'unresolved multi-owner nested selectors fail closed');
  }
}

console.log(`\nv2 identifier tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
