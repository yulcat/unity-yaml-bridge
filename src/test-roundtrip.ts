/**
 * Round-trip test: Unity YAML → v3 text → cold standalone compile → YAML.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';
import { writeV3 } from './v3/writer';
import { readV3 } from './v3/reader';
import { compileV3 } from './v3/compiler';
import { compareLocalPrefabSemantics } from './v3/semantic-normalizer';

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

let failures = 0;

function testFile(filePath: string, label: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log(`File: ${filePath}`);
  console.log('='.repeat(60));

  const content = fs.readFileSync(filePath, 'utf-8');
  const originalSize = Buffer.byteLength(content, 'utf-8');

  // Step 1: Parse Unity YAML → AST
  console.log('\n[1] Parsing Unity YAML...');
  const ast = parseUnityYaml(content);
  console.log(`    Type: ${ast.type}`);
  console.log(`    Documents: ${ast.documents.length}`);
  console.log(`    PrefabInstances: ${ast.prefabInstances.length}`);
  if (ast.hierarchy) {
    console.log(`    Root GO: ${ast.hierarchy.name}`);
    console.log(`    Components: ${ast.hierarchy.components.length}`);
    console.log(`    Children: ${countDescendants(ast.hierarchy)}`);
  }

  // Step 2: AST → standalone v3 text
  console.log('\n[2] Writing v3 standalone format...');
  const compact = writeV3(ast);
  const compactSize = Buffer.byteLength(compact, 'utf-8');
  console.log(`    v3 size: ${compactSize} bytes`);
  console.log(`    Reduction: ${((1 - compactSize / originalSize) * 100).toFixed(1)}%`);

  // Step 3: serialized v3 only → fresh parse → compile → Unity YAML
  console.log('\n[3] Cold-compiling v3 without original YAML...');
  const roundTripped = writeUnityYaml(compileV3(readV3(String(compact))));
  const roundTrippedSize = Buffer.byteLength(roundTripped, 'utf-8');
  console.log(`    Round-tripped size: ${roundTrippedSize} bytes`);

  // Step 4: semantic comparison and deterministic output
  console.log('\n[4] Comparing semantic graphs...');
  const rebuilt = parseUnityYaml(roundTripped);
  const difference = compareLocalPrefabSemantics(ast, rebuilt);
  const deterministic = writeUnityYaml(compileV3(readV3(compact))) === roundTripped;
  if (!difference && deterministic) {
    console.log('    PASS: semantic equality and deterministic canonical YAML');
  } else {
    failures++;
    console.log(`    FAIL: ${difference ? `${difference.path}: ${JSON.stringify(difference.expected)} != ${JSON.stringify(difference.actual)}` : 'non-deterministic output'}`);
  }
}

function countDescendants(node: { children: any[] }): number {
  return node.children.length + node.children.reduce((sum: number, child: any) => sum + countDescendants(child), 0);
}

// Run tests
console.log('Unity YAML Bridge — v3 Cold Round-trip Test Suite');
console.log('=========================================');

// Test 1: Simple prefab (Button)
testFile(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'Simple UI Prefab (Button)');

// Test 2: Complex prefab with nested prefab instances (Card Template)
testFile(path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'), 'Complex Prefab (_Card_Template)');

// Test 3: Prefab variant
testFile(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'Prefab Variant (Card_Explorer)');

// Test 4: Ellen variant (3D character variant)
testFile(path.join(SAMPLES_DIR, 'variants', 'Ellen_Variant.prefab'), 'Prefab Variant (Ellen)');

// Test 5: Variant with root PrefabInstance + added objects
testFile(path.join(SAMPLES_DIR, 'prefabs', 'RootPrefabInstance.prefab'), 'Variant with added objects (RootPrefabInstance)');

console.log('\n\nAll tests complete.');
if (failures > 0) process.exit(1);
