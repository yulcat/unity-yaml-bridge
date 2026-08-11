import * as fs from 'fs';
import * as path from 'path';
import { compileV3 } from './v3/compiler';
import { readV3 } from './v3/reader';
import { writeV3 } from './v3/writer';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';
import { UnityFile } from './types';

let failed = 0;
function assert(condition: unknown, name: string, details = ''): void {
  if (condition) console.log(`  PASS: ${name}`);
  else {
    console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
    failed++;
  }
}

function semanticSnapshot(file: UnityFile): string {
  const documents = [...file.documents]
    .sort((left, right) => left.fileId.localeCompare(right.fileId))
    .map(document => ({
      typeId: document.typeId,
      typeName: document.typeName,
      fileId: document.fileId,
      stripped: document.stripped,
      properties: sortObject(document.properties),
    }));
  return JSON.stringify({ type: file.type, documents });
}

function sortObject(value: any): any {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
}

console.log('\n=== v3 standalone compiler ===');

const samplePath = path.join(__dirname, '..', 'samples', 'v3', 'MinimalHierarchy.source.prefab');
const originalText = fs.readFileSync(samplePath, 'utf-8');
const original = parseUnityYaml(originalText);
const v3Text = writeV3(original, { profile: 'unity-generic-v1' });

assert(v3Text.includes('Root @g1 [BoxCollider @c1]') && v3Text.includes('Child @g2'),
  'writer emits authoritative hierarchy and stable machine identities');
assert(v3Text.includes('--- IDENTITY') && v3Text.includes('t2 = transform'),
  'writer emits a separate identity graph');

// Cold boundary: only serialized v3 text crosses into the compiler. The
// original UnityFile and original YAML are not compiler inputs.
const parsedV3 = readV3(v3Text);
const rebuilt = compileV3(parsedV3);
const rebuiltText = writeUnityYaml(rebuilt);
const reparsed = parseUnityYaml(rebuiltText);

assert(semanticSnapshot(reparsed) === semanticSnapshot(original),
  'YAML -> v3 -> discard original -> prefab preserves the semantic document graph');
assert(writeUnityYaml(compileV3(readV3(v3Text))) === rebuiltText,
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
