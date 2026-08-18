import * as fs from 'fs';
import * as path from 'path';
import * as publicApi from './index';
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

function expectThrow(fn: () => unknown, expected: string, name: string): void {
  try {
    fn();
    assert(false, name, 'did not throw');
  } catch (error) {
    assert(String(error).includes(expected), name, String(error));
  }
}

console.log('\n=== v3 standalone compiler ===');

const samplePath = path.join(__dirname, '..', 'samples', 'v3', 'MinimalHierarchy.source.prefab');
const originalText = fs.readFileSync(samplePath, 'utf-8');
const cold = coldRoundTripV3(originalText);
const { original, v3Text, rebuiltText, rebuilt: reparsed } = cold;

const stableProfile = (publicApi as unknown as Record<string, unknown>).V3_STABLE_PROFILE;
assert(stableProfile === 'unity-generic-v1' &&
       v3Text.startsWith(`# ubridge v3 | prefab | profile:${stableProfile}\n`),
  'public stable v3 profile is the canonical writer profile');

expectThrow(
  () => readV3(v3Text.replace('profile:unity-generic-v1', 'profile:experimental')),
  'Unsupported v3 profile "experimental" in header line 1',
  'reader rejects an unknown v3 profile with header context'
);

for (const [profile, description] of [
  ['', 'empty'],
  ['Unity-Generic-V1', 'case-changed'],
  ['unity-generic-v1-beta', 'near-match'],
] as const) {
  expectThrow(
    () => readV3(v3Text.replace('profile:unity-generic-v1', `profile:${profile}`)),
    `Unsupported v3 profile ${JSON.stringify(profile)} in header line 1`,
    `reader rejects ${description} v3 profile without normalization`
  );
}

const canonicalDocument = readV3(v3Text);
assert(canonicalDocument.profile === stableProfile,
  'reader preserves the exact canonical stable profile');
expectThrow(
  () => compileV3({ ...canonicalDocument, profile: 'experimental' } as unknown as typeof canonicalDocument),
  'Unsupported v3 profile "experimental" in compileV3 document',
  'compiler rejects a programmatically constructed unknown profile'
);

expectThrow(
  () => publicApi.writeV3(original, { profile: 'experimental' } as unknown as Parameters<typeof publicApi.writeV3>[1]),
  'Unsupported v3 profile "experimental" in writeV3 options',
  'writer rejects an unknown requested profile instead of emitting or normalizing it'
);

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
