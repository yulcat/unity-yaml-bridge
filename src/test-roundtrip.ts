/**
 * Round-trip test: Unity YAML → compact → back to YAML
 * Compare original vs round-tripped to measure fidelity.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact } from './compact-writer';
import { writeUnityYaml } from './unity-yaml-writer';
import { GuidResolver } from './guid-resolver';

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

// Initialize GUID resolver with project scripts
const resolver = new GuidResolver();
const projectPath = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
if (fs.existsSync(projectPath)) {
  resolver.scanProject(projectPath);
  console.log(`GUID resolver: ${resolver.size} mappings loaded`);
}

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

  // Step 2: AST → Compact (with GUID resolution)
  console.log('\n[2] Writing compact format...');
  const compact = writeCompact(ast, { guidResolver: resolver });
  const compactSize = Buffer.byteLength(compact, 'utf-8');
  console.log(`    Compact size: ${compactSize} bytes`);
  console.log(`    Reduction: ${((1 - compactSize / originalSize) * 100).toFixed(1)}%`);
  console.log('\n--- COMPACT OUTPUT ---');
  console.log(compact);
  console.log('--- END ---');

  // Step 3: AST → Unity YAML (round-trip)
  console.log('\n[3] Writing back to Unity YAML...');
  const roundTripped = writeUnityYaml(ast);
  const roundTrippedSize = Buffer.byteLength(roundTripped, 'utf-8');
  console.log(`    Round-tripped size: ${roundTrippedSize} bytes`);

  // Step 4: Compare
  console.log('\n[4] Comparing original vs round-tripped...');
  const origLines = content.split('\n').map(l => l.trimEnd());
  const rtLines = roundTripped.split('\n').map(l => l.trimEnd());

  let diffs = 0;
  const maxLines = Math.max(origLines.length, rtLines.length);
  for (let i = 0; i < maxLines; i++) {
    const orig = origLines[i] || '';
    const rt = rtLines[i] || '';
    if (orig !== rt) {
      diffs++;
      if (diffs <= 20) {
        console.log(`    Line ${i + 1}:`);
        console.log(`      ORIG: ${orig.substring(0, 100)}`);
        console.log(`      RT:   ${rt.substring(0, 100)}`);
      }
    }
  }
  console.log(`    Total differing lines: ${diffs} / ${maxLines}`);

  // Save outputs
  const baseName = path.basename(filePath, path.extname(filePath));
  const outDir = path.join(SAMPLES_DIR, 'test-output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, `${baseName}.ubridge`), compact);
  fs.writeFileSync(path.join(outDir, `${baseName}.roundtrip.yaml`), roundTripped);
  console.log(`\n    Outputs saved to samples/test-output/`);
}

function countDescendants(node: { children: any[] }): number {
  return node.children.length + node.children.reduce((sum: number, child: any) => sum + countDescendants(child), 0);
}

// Run tests
console.log('Unity YAML Bridge — Round-trip Test Suite');
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
