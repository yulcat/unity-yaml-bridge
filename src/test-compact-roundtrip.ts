/**
 * Test the full compact round-trip pipeline:
 *   Unity YAML → AST → compact → parse compact → merge with AST → Unity YAML
 *
 * This verifies:
 * 1. Identity round-trip: unmodified compact merges back to identical YAML
 * 2. Edit round-trip: modified compact produces correct YAML changes
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact } from './compact-writer';
import { writeUnityYaml } from './unity-yaml-writer';
import { readCompact, CompactFile } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import { GuidResolver } from './guid-resolver';

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

// Initialize GUID resolver
const resolver = new GuidResolver();
const projectPath = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
if (fs.existsSync(projectPath)) {
  resolver.scanProject(projectPath);
  console.log(`GUID resolver: ${resolver.size} mappings loaded`);
}

let totalTests = 0;
let passedTests = 0;

function testIdentityRoundtrip(filePath: string, label: string): void {
  totalTests++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: Identity Round-trip — ${label}`);
  console.log('='.repeat(60));

  const content = fs.readFileSync(filePath, 'utf-8');

  // Step 1: Parse Unity YAML → AST
  const ast = parseUnityYaml(content);

  // Step 2: AST → Compact string
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Step 3: Parse compact string → CompactFile
  const compactFile = readCompact(compactStr);
  console.log(`  Compact: ${compactFile.sections.length} sections, type=${compactFile.type}`);

  // Step 4: Merge compact back into original AST
  const merged = mergeCompactChanges(ast, compactFile);

  // Step 5: Write merged AST → Unity YAML
  const output = writeUnityYaml(merged);

  // Step 6: Compare with original
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());

  let diffs = 0;
  const maxLines = Math.max(origLines.length, outLines.length);
  for (let i = 0; i < maxLines; i++) {
    const orig = origLines[i] || '';
    const out = outLines[i] || '';
    if (orig !== out) {
      diffs++;
      if (diffs <= 10) {
        console.log(`  Line ${i + 1}:`);
        console.log(`    ORIG: ${orig.substring(0, 120)}`);
        console.log(`    OUT:  ${out.substring(0, 120)}`);
      }
    }
  }

  if (diffs === 0) {
    console.log(`  PASS — 0 diff lines`);
    passedTests++;
  } else {
    console.log(`  FAIL — ${diffs} diff lines`);
  }
}

function testVariantEdit(filePath: string, label: string): void {
  totalTests++;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: Variant Edit — ${label}`);
  console.log('='.repeat(60));

  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse original
  const ast = parseUnityYaml(content);
  if (ast.type !== 'variant') {
    console.log('  SKIP — not a variant file');
    return;
  }

  // Write compact
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Parse compact
  const compactFile = readCompact(compactStr);

  // Find a section with m_Name property to edit
  let editSection: typeof compactFile.sections[0] | null = null;
  let editPropIdx = -1;
  let originalName = '';

  for (const section of compactFile.sections) {
    for (let i = 0; i < section.properties.length; i++) {
      if (section.properties[i].key === 'm_Name' && typeof section.properties[i].value === 'string') {
        editSection = section;
        editPropIdx = i;
        originalName = section.properties[i].value as string;
        break;
      }
    }
    if (editSection) break;
  }

  if (!editSection || editPropIdx < 0) {
    console.log('  SKIP — no m_Name property found in variant');
    return;
  }

  // Edit: change the name
  const newName = originalName + '_edited';
  editSection.properties[editPropIdx].value = newName;
  console.log(`  Editing m_Name: "${originalName}" → "${newName}"`);

  // Merge and write
  const merged = mergeCompactChanges(ast, compactFile);
  const output = writeUnityYaml(merged);

  // Verify the change appears in the output
  const hasEdit = output.includes(`value: ${newName}`);

  // Verify everything else is unchanged
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());

  let diffs = 0;
  let editDiffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    const orig = origLines[i] || '';
    const out = outLines[i] || '';
    if (orig !== out) {
      diffs++;
      // Check if this diff is the expected name change
      if (orig.includes(`value: ${originalName}`) && out.includes(`value: ${newName}`)) {
        editDiffs++;
      } else if (diffs <= 5) {
        console.log(`  Unexpected diff at line ${i + 1}:`);
        console.log(`    ORIG: ${orig.substring(0, 120)}`);
        console.log(`    OUT:  ${out.substring(0, 120)}`);
      }
    }
  }

  if (hasEdit && editDiffs === 1 && diffs === editDiffs) {
    console.log(`  PASS — edit applied correctly, ${diffs} expected diff(s)`);
    passedTests++;
  } else if (hasEdit) {
    console.log(`  PARTIAL — edit found but ${diffs - editDiffs} unexpected diff(s)`);
  } else {
    console.log(`  FAIL — edit not found in output`);
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

  // Write and parse compact
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compactFile = readCompact(compactStr);

  // Find a transform section with pos to edit
  let editSection: typeof compactFile.sections[0] | null = null;
  let editPropIdx = -1;
  let originalValue = '';

  for (const section of compactFile.sections) {
    if (section.componentType !== 'RectTransform' && section.componentType !== 'Transform') continue;
    for (let i = 0; i < section.properties.length; i++) {
      if (section.properties[i].key === 'pos' && typeof section.properties[i].value === 'string') {
        editSection = section;
        editPropIdx = i;
        originalValue = section.properties[i].value as string;
        break;
      }
    }
    if (editSection) break;
  }

  if (!editSection || editPropIdx < 0) {
    console.log('  SKIP — no pos property found');
    return;
  }

  // Edit: change the position
  const newValue = '(100, 200)';
  editSection.properties[editPropIdx].value = newValue;
  console.log(`  Editing ${editSection.goPath}:${editSection.componentType} pos: ${originalValue} → ${newValue}`);

  // Merge and write
  const merged = mergeCompactChanges(ast, compactFile);
  const output = writeUnityYaml(merged);

  // Verify the change appears — look for x: 100 and y: 200 in the output
  const hasX = output.includes('x: 100');
  const hasY = output.includes('y: 200');

  if (hasX && hasY) {
    console.log(`  PASS — position edit applied correctly`);
    passedTests++;
  } else {
    console.log(`  FAIL — expected x:100 (${hasX}), y:200 (${hasY})`);
  }
}

// ============================================================
// Run tests
// ============================================================
console.log('Unity YAML Bridge — Compact Round-trip Test Suite');
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
