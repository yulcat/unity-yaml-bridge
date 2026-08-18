/**
 * Test the v3 standalone round-trip pipeline:
 *   Unity YAML → v3 text → fresh v3 parse → standalone compile → Unity YAML
 *
 * This verifies:
 * The original YAML/AST never enters the compile stage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';
import { coldRoundTripV3, describeSemanticDifference } from './test-v3-utils';
import { writeV3 } from './v3/writer';
import { readV3 } from './v3/reader';
import { compileV3 } from './v3/compiler';

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

let totalTests = 0;
let passedTests = 0;

function testIdentityRoundtrip(filePath: string, label: string): void {
  totalTests++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: Identity Round-trip — ${label}`);
  console.log('='.repeat(60));

  const content = fs.readFileSync(filePath, 'utf-8');

  const cold = coldRoundTripV3(content);
  const difference = describeSemanticDifference(cold.original, cold.rebuilt);
  const deterministic = coldRoundTripV3(content).rebuiltText === cold.rebuiltText;
  console.log(`  v3 bytes: ${cold.v3Text.length}, type=${cold.original.type}`);

  if (!difference && deterministic) {
    console.log('  PASS — semantic equality, deterministic standalone output');
    passedTests++;
  } else {
    console.log(`  FAIL — ${difference || 'non-deterministic output'}`);
  }
}

function testVariantEdit(filePath: string, label: string): void {
  totalTests++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: Variant Edit — ${label}`);
  console.log('='.repeat(60));

  const content = fs.readFileSync(filePath, 'utf-8');

  const ast = parseUnityYaml(content);
  if (ast.type !== 'variant') {
    console.log('  SKIP — not a variant file');
    return;
  }

  const document = readV3(writeV3(ast));
  let editedModification: any;
  for (const identity of document.identity.values()) {
    if (identity.kind !== 'prefabInstance') continue;
    const details: any = document.details.get(identity.machineId);
    const modifications: any[] = details?.m_Modification?.m_Modifications || [];
    editedModification = modifications.find(item => item.propertyPath === 'm_Name');
    if (editedModification) break;
  }
  if (!editedModification) {
    console.log('  SKIP — no m_Name property found in variant');
    return;
  }
  const originalName = String(editedModification.value);
  const newName = `${originalName}_edited`;
  editedModification.value = newName;
  console.log(`  Editing m_Name: "${originalName}" → "${newName}"`);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rebuiltName = rebuilt.prefabInstances.flatMap(instance => instance.modifications)
    .find(modification => modification.propertyPath === 'm_Name' && modification.value === newName);
  if (rebuiltName) {
    console.log('  PASS — standalone variant delta edit applied');
    passedTests++;
  } else {
    console.log('  FAIL — edit not found in compiled variant');
  }
}

function testPrefabEdit(filePath: string, label: string): void {
  totalTests++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: Prefab Edit — ${label}`);
  console.log('='.repeat(60));

  const content = fs.readFileSync(filePath, 'utf-8');
  const ast = parseUnityYaml(content);
  if (ast.type !== 'prefab') {
    console.log('  SKIP — not a prefab file');
    return;
  }

  const document = readV3(writeV3(ast));
  let targetIdentity: string | undefined;
  let targetKey: 'm_AnchoredPosition' | 'm_LocalPosition' | undefined;
  for (const identity of document.identity.values()) {
    if (identity.kind !== 'transform') continue;
    const details: any = document.details.get(identity.machineId);
    if (details?.m_AnchoredPosition) targetKey = 'm_AnchoredPosition';
    else if (details?.m_LocalPosition) targetKey = 'm_LocalPosition';
    if (targetKey) {
      targetIdentity = identity.machineId;
      details[targetKey] = { ...details[targetKey], x: 100, y: 200 };
      break;
    }
  }
  if (!targetIdentity || !targetKey) {
    console.log('  SKIP — no pos property found');
    return;
  }
  const targetFileId = document.identity.get(targetIdentity)!.fileId;
  const rebuilt = compileV3(document);
  const position = rebuilt.documents.find(item => item.fileId === targetFileId)
    ?.properties[targetKey];
  if (position?.x === 100 && position?.y === 200) {
    console.log('  PASS — standalone position edit applied correctly');
    passedTests++;
  } else {
    console.log(`  FAIL — expected x:100, y:200; got ${JSON.stringify(position)}`);
  }
}

// ============================================================
// Run tests
// ============================================================
console.log('Unity YAML Bridge — v3 Standalone Round-trip Test Suite');
console.log('=================================================');

// Identity round-trip tests (should produce 0 diff lines)
testIdentityRoundtrip(
  path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'),
  'Simple UI Prefab (Button)'
);

testIdentityRoundtrip(
  path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'),
  'Complex Prefab (_Card_Template)'
);

testIdentityRoundtrip(
  path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'),
  'Variant (Card_Explorer)'
);

testIdentityRoundtrip(
  path.join(SAMPLES_DIR, 'variants', 'Ellen_Variant.prefab'),
  'Variant (Ellen)'
);

testIdentityRoundtrip(
  path.join(SAMPLES_DIR, 'prefabs', 'RootPrefabInstance.prefab'),
  'Variant with added objects (RootPrefabInstance)'
);

// Edit tests
testVariantEdit(
  path.join(SAMPLES_DIR, 'variants', 'Ellen_Variant.prefab'),
  'Ellen Variant name edit'
);

testVariantEdit(
  path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'),
  'Card Explorer Variant name edit'
);

testPrefabEdit(
  path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'),
  'Button position edit'
);

// Summary
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
