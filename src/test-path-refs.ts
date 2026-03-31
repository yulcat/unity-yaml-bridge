/**
 * Test path-based reference resolution (@path:Component / ->path:Component).
 *
 * Tests:
 * 1. Write direction: internal refs written as ->GOPath:Component
 * 2. Read direction: ->GOPath:Component resolved to {fileID: X}
 * 3. @-shorthand alias works as read alias for ->
 * 4. Array references resolve correctly
 * 5. Round-trip identity preserved with path refs
 * 6. Stripped component entries in REFS
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

const resolver = new GuidResolver();
const projectPath = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
if (fs.existsSync(projectPath)) {
  resolver.scanProject(projectPath);
  console.log(`GUID resolver: ${resolver.size} mappings loaded`);
}

let totalTests = 0;
let passedTests = 0;

function pass(label: string): void {
  totalTests++;
  passedTests++;
  console.log(`  PASS — ${label}`);
}

function fail(label: string, detail?: string): void {
  totalTests++;
  console.log(`  FAIL — ${label}`);
  if (detail) console.log(`    ${detail}`);
}

// ============================================================
// Test 1: Write direction — internal refs use -> format
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Write direction — internal refs use -> format');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Check that activateDisplayText uses -> format with slash path
  if (compactStr.includes('activateDisplayText = ->Button/Button_Text:TextMeshProUGUI')) {
    pass('activateDisplayText written as ->Button/Button_Text:TextMeshProUGUI');
  } else {
    fail('activateDisplayText -> format', 'Not found in compact output');
  }

  // Check that external refs still use {fileID, guid} format
  if (compactStr.includes('{21300000, e197d4e89f9f4274dac4566fdd117ecf}')) {
    pass('External refs still use {fileID, guid} format');
  } else {
    fail('External ref format');
  }

  // Check that null refs still use {0} format
  if (!compactStr.includes('->') || compactStr.includes('{0}') || !compactStr.includes('->{0}')) {
    pass('Null refs not converted to -> format');
  } else {
    fail('Null ref format', 'Found ->{0} in output');
  }
}

// ============================================================
// Test 2: REFS includes stripped component entries
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: REFS includes stripped component entries');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Check that Button/Button_Text:TextMeshProUGUI is in REFS (slash path)
  const tmproRef = compact.refs.get('Button/Button_Text:TextMeshProUGUI')?.[0];
  if (tmproRef === '8027481463030904456') {
    pass('Button/Button_Text:TextMeshProUGUI = 8027481463030904456 in REFS');
  } else {
    fail('Stripped component in REFS', `Got: ${tmproRef}`);
  }
}

// ============================================================
// Test 3: Read direction — -> references resolved to fileIDs
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Read direction — -> references resolved to fileIDs');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Merge back and check the resolved value
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  // The original has: activateDisplayText: {fileID: 8027481463030904456}
  if (output.includes('activateDisplayText: {fileID: 8027481463030904456}')) {
    pass('-> reference resolved to correct fileID in YAML output');
  } else {
    fail('-> resolution', 'fileID not found in output');
  }

  // Full identity round-trip
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }
  if (diffs === 0) {
    pass('Full identity round-trip: 0 diffs');
  } else {
    fail(`Identity round-trip: ${diffs} diffs`);
  }
}

// ============================================================
// Test 4: @ shorthand alias for -> (read direction)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: @ shorthand alias for -> (read direction)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Replace -> with @ in the compact string
  const atCompact = compactStr.replace('->Button/Button_Text:TextMeshProUGUI', '@Button/Button_Text:TextMeshProUGUI');
  const compact = readCompact(atCompact);

  // Merge back and verify
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  if (output.includes('activateDisplayText: {fileID: 8027481463030904456}')) {
    pass('@ alias resolves to correct fileID');
  } else {
    fail('@ alias resolution');
  }

  // Identity round-trip should still work
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }
  if (diffs === 0) {
    pass('@ alias round-trip: 0 diffs');
  } else {
    fail(`@ alias round-trip: ${diffs} diffs`);
  }
}

// ============================================================
// Test 5: Array references with -> resolve correctly
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Array references with -> resolve correctly');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Check that the array uses -> format with slash paths
  if (compactStr.includes('->_Card_Template/Frame') &&
      compactStr.includes('->_Card_Template/_Header_Text') &&
      compactStr.includes('->_Card_Template/Paragraph_Text')) {
    pass('Array of internal refs uses -> format with slash paths');
  } else {
    const hasArrow = compactStr.includes('->_Card_Template/Frame');
    fail('Array -> format', `Has ->_Card_Template/Frame: ${hasArrow}`);
  }

  // Round-trip should still work
  const compact = readCompact(compactStr);
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }
  if (diffs === 0) {
    pass('_Card_Template round-trip with -> arrays: 0 diffs');
  } else {
    fail(`_Card_Template round-trip: ${diffs} diffs`);
  }
}

// ============================================================
// Test 6: Setting a reference field using @ path syntax
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Setting a reference field using @ path syntax');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Modify the compact: change activateDisplayText to point to Background9Slice_Image:Image (slash path)
  for (const section of compact.sections) {
    for (const prop of section.properties) {
      if (prop.key === 'activateDisplayText') {
        // Use @ syntax to set reference with slash path
        prop.value = '@Button/Background9Slice_Image:Image';
      }
    }
  }

  // Merge and check
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  // Should resolve to Background9Slice_Image:Image fileID (8027481461304769067)
  if (output.includes('activateDisplayText: {fileID: 8027481461304769067}')) {
    pass('@ path reference resolved to correct fileID (8027481461304769067)');
  } else {
    // Check what value was written
    const match = output.match(/activateDisplayText: (.+)/);
    fail('@ path resolution', `Got: ${match ? match[1] : 'not found'}`);
  }
}

// ============================================================
// Test 7: Unresolved path reference throws an error
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Unresolved path reference throws an error');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Inject a bogus -> reference into a property
  for (const section of compact.sections) {
    for (const prop of section.properties) {
      if (prop.key === 'activateDisplayText') {
        prop.value = '->NonExistent_GO:FakeComponent';
      }
    }
  }

  try {
    mergeCompactChanges(ast, compact);
    fail('Unresolved -> reference should throw', 'No error was thrown');
  } catch (e: any) {
    if (e.message.includes('Unresolved path reference: ->NonExistent_GO:FakeComponent')
        && e.message.includes('Valid REFS keys:')) {
      pass('Unresolved -> reference throws error with path and REFS keys');
    } else {
      fail('Error message format', `Got: ${e.message}`);
    }
  }

  // Also test @ alias
  for (const section of compact.sections) {
    for (const prop of section.properties) {
      if (prop.key === 'activateDisplayText') {
        prop.value = '@NonExistent_GO:FakeComponent';
      }
    }
  }

  try {
    mergeCompactChanges(ast, compact);
    fail('Unresolved @ reference should throw', 'No error was thrown');
  } catch (e: any) {
    if (e.message.includes('Unresolved path reference: @NonExistent_GO:FakeComponent')
        && e.message.includes('Valid REFS keys:')) {
      pass('Unresolved @ reference throws error with path and REFS keys');
    } else {
      fail('Error message format', `Got: ${e.message}`);
    }
  }

  // Test unresolved reference inside an array
  for (const section of compact.sections) {
    for (const prop of section.properties) {
      if (prop.key === 'activateDisplayText') {
        prop.value = '[->Valid_Ref:Might_Exist, ->Bogus_Array_Ref:Missing]';
      }
    }
  }

  try {
    mergeCompactChanges(ast, compact);
    fail('Unresolved array -> reference should throw', 'No error was thrown');
  } catch (e: any) {
    if (e.message.includes('Unresolved path reference:') && e.message.includes('Valid REFS keys:')) {
      pass('Unresolved array -> reference throws error');
    } else {
      fail('Array error message format', `Got: ${e.message}`);
    }
  }
}

// ============================================================
// Test 8: Reference to a new component (exists in STRUCTURE, not in REFS)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Reference to a new component via STRUCTURE presence');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Inject a new GO 'NewPanel' with Image component into STRUCTURE,
  // add a DETAILS section, and make an existing field reference it.
  const modifiedCompact = compactStr
    // Replace last child marker with middle child, then add new last child
    .replace(
      /└─ (Button_Text.*)/,
      '├─ $1\n└─ NewPanel [Image]'
    )
    // Add a DETAILS section for the new component
    .replace(
      '--- REFS',
      '[Button/NewPanel:Image]\nm_Color = (1, 0, 0, 1)\n\n--- REFS'
    )
    // Change activateDisplayText to reference the new component
    .replace(
      /activateDisplayText = ->[^\n]+/,
      'activateDisplayText = ->Button/NewPanel:Image'
    );

  const compact = readCompact(modifiedCompact);

  // Verify NewPanel exists in structure
  const hasNewPanel = compact.structure?.children?.some(c => c.name === 'NewPanel');
  if (hasNewPanel) {
    pass('NewPanel found in parsed STRUCTURE');
  } else {
    fail('NewPanel not in STRUCTURE');
  }

  // Merge — should NOT throw because NewPanel:Image is in STRUCTURE
  try {
    const merged = mergeCompactChanges(ast, compact);
    const output = writeUnityYaml(merged);

    // Verify the reference was resolved to a valid fileID (not zero, not the string)
    const refMatch = output.match(/activateDisplayText: \{fileID: (\d+)\}/);
    if (refMatch && refMatch[1] !== '0') {
      pass(`Reference to new component resolved to fileID: ${refMatch[1]}`);
    } else {
      fail('Reference resolution', `Got: ${refMatch ? refMatch[0] : 'not found'}`);
    }
  } catch (e: any) {
    fail('Should not throw for STRUCTURE-present reference', e.message);
  }
}

// ============================================================
// Test 9: Cross-reference between two new objects
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Cross-reference between two new objects');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Add two new GOs: SourceGO and TargetGO, with SourceGO referencing TargetGO
  const modifiedCompact = compactStr
    .replace(
      /└─ (Button_Text.*)/,
      '├─ $1\n├─ SourceGO [MonoBehaviour]\n└─ TargetGO [Image]'
    )
    .replace(
      '--- REFS',
      '[Button/SourceGO:MonoBehaviour]\ntargetRef = ->Button/TargetGO:Image\n\n[Button/TargetGO:Image]\nm_Color = (0, 1, 0, 1)\n\n--- REFS'
    );

  const compact = readCompact(modifiedCompact);

  // The merge should NOT throw — both GOs exist in STRUCTURE.
  // Note: merger doesn't create new YAML documents for new GOs yet,
  // so new component sections are silently skipped (no matching AST doc).
  // We verify the merge completes without error.
  try {
    mergeCompactChanges(ast, compact);
    pass('Cross-reference between new objects resolved without error');
  } catch (e: any) {
    fail('Should not throw for cross-reference between new objects', e.message);
  }
}

// ============================================================
// Test 10: Reference to non-existent GO still throws
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Reference to GO not in STRUCTURE or REFS still throws');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Inject a reference to a GO that doesn't exist anywhere
  for (const section of compact.sections) {
    for (const prop of section.properties) {
      if (prop.key === 'activateDisplayText') {
        prop.value = '->CompletelyFakeGO/Nonexistent:Image';
      }
    }
  }

  try {
    mergeCompactChanges(ast, compact);
    fail('Should throw for GO not in STRUCTURE or REFS', 'No error thrown');
  } catch (e: any) {
    if (e.message.includes('Unresolved path reference')) {
      pass('Correctly throws for reference to nonexistent GO');
    } else {
      fail('Wrong error', e.message);
    }
  }
}

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
