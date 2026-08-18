import * as fs from 'fs';
import * as path from 'path';
import { coldRoundTripV3, describeSemanticDifference } from './test-v3-utils';
import { parseUnityYaml } from './unity-yaml-parser';

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

function findPrefabs(directory: string): string[] {
  return fs.readdirSync(directory)
    .filter(file => file.endsWith('.prefab'))
    .map(file => path.join(directory, file));
}

console.log('\n=== v3 prefab/variant cold-roundtrip corpus ===');

const candidates = [
  ...findPrefabs(path.join(__dirname, '..', 'samples', 'prefabs')),
  ...findPrefabs(path.join(__dirname, '..', 'samples', 'variants')),
  ...findPrefabs(path.join(__dirname, '..', 'samples', 'fixtures', 'PrefabWorkflows_UIDemo')),
];
let tested = 0;
let readableReferenceCount = 0;

for (const prefabPath of candidates) {
  const source = fs.readFileSync(prefabPath, 'utf-8');
  const parsed = parseUnityYaml(source);
  if (parsed.type !== 'prefab' && parsed.type !== 'variant') continue;
  tested++;
  try {
    const result = coldRoundTripV3(source);
    readableReferenceCount += (result.v3Text.match(/\{"\$ref":"[^"]+"\}/g) || []).length;
    const difference = describeSemanticDifference(result.original, result.rebuilt);
    assert(!difference, `${path.basename(prefabPath)} semantic equality`, difference || '');
    const second = coldRoundTripV3(source);
    assert(second.rebuiltText === result.rebuiltText,
      `${path.basename(prefabPath)} deterministic canonical YAML`);
  } catch (error) {
    assert(false, `${path.basename(prefabPath)} cold-roundtrip`, String(error));
  }
}

assert(tested >= 19, 'v3 corpus includes local, nested, and variant prefabs', `tested=${tested}`);
assert(readableReferenceCount > 0,
  'local internal references are exported as stable v3 machine references',
  `count=${readableReferenceCount}`);
console.log(`\nv3 prefab/variant cold-roundtrip corpus: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
