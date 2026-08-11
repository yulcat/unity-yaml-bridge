import * as fs from 'fs';
import * as path from 'path';
import { compileV3 } from './v3/compiler';
import { readV3 } from './v3/reader';
import { coldRoundTripV3, describeSemanticDifference } from './test-v3-utils';

let failed = 0;
function assert(condition: unknown, name: string, details = ''): void {
  if (condition) console.log(`  PASS: ${name}`);
  else {
    console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
    failed++;
  }
}

console.log('\n=== v3 standalone compiler ===');

const samplePath = path.join(__dirname, '..', 'samples', 'v3', 'MinimalHierarchy.source.prefab');
const originalText = fs.readFileSync(samplePath, 'utf-8');
const cold = coldRoundTripV3(originalText);
const { original, v3Text, rebuiltText, rebuilt: reparsed } = cold;

assert(v3Text.includes('Root @g1 [BoxCollider @c1]') && v3Text.includes('Child @g2'),
  'writer emits authoritative hierarchy and stable machine identities');
assert(v3Text.includes('--- IDENTITY') && v3Text.includes('t2 = transform'),
  'writer emits a separate identity graph');

const semanticDifference = describeSemanticDifference(original, reparsed);
assert(!semanticDifference,
  'YAML -> v3 -> discard original -> prefab preserves the semantic document graph',
  semanticDifference || '');
assert(coldRoundTripV3(originalText).rebuiltText === rebuiltText,
  'same standalone v3 input produces byte-identical canonical YAML');
assert(reparsed.hierarchy?.children[0]?.name === 'Child' &&
       reparsed.hierarchy.transform.fileId === '200' &&
       reparsed.hierarchy.children[0].transform.fileId === '500',
  'compiled hierarchy and existing fileIDs survive reparsing');

const scriptedV3 = `# ubridge v3 | prefab | profile:unity-generic-v1
--- STRUCTURE
ScriptedRoot @g1 [ExampleBehaviour @c1]
--- DETAILS
[g1 | ScriptedRoot]
m_IsActive = 1
[t1 | ScriptedRoot:Transform]
m_LocalPosition = {"x":0,"y":0,"z":0}
[c1 | ScriptedRoot:ExampleBehaviour]
answer = 42
--- IDENTITY
g1 = gameObject | fileID:10 | type:1 | typeName:GameObject
t1 = transform | fileID:20 | type:4 | typeName:Transform | owner:g1
c1 = component | fileID:30 | type:114 | typeName:MonoBehaviour | owner:g1 | displayName:ExampleBehaviour | script:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;
const scripted = compileV3(readV3(scriptedV3));
const behaviour = scripted.documents.find(document => document.fileId === '30');
assert(behaviour?.typeName === 'MonoBehaviour' &&
       behaviour.properties.m_Script?.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' &&
       behaviour.properties.answer === 42,
  'readable script name remains separate from serialized MonoBehaviour identity');

try {
  readV3(v3Text.replace('Root @g1', 'Root @missing'));
  assert(false, 'unbound structure identity fails closed');
} catch (error) {
  assert(String(error).includes('not bound to a GameObject'),
    'unbound structure identity fails closed', String(error));
}

console.log(`\nv3 standalone tests: ${failed === 0 ? 'all passed' : `${failed} failed`}`);
if (failed > 0) process.exit(1);
