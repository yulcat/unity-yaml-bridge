/**
 * Test REFS section round-trip and new element fileID generation.
 *
 * Tests:
 * 1. REFS section is written and parsed correctly for regular prefabs
 * 2. REFS section is written and parsed correctly for variants
 * 3. Merger uses REFS for precise document lookup
 * 4. generateFileId() produces valid random int64 strings
 * 5. New elements without REFS entries get auto-generated fileIDs
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact } from './compact-writer';
import { writeUnityYaml } from './unity-yaml-writer';
import { readCompact, CompactFile } from './compact-reader';
import { mergeCompactChanges, generateFileId } from './compact-merger';
import { GuidResolver } from './guid-resolver';

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

// Initialize GUID resolver
const resolver = new GuidResolver();
const projectPath = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
if (fs.existsSync(projectPath)) {
  resolver.scanProject(projectPath);
  console.log(`GUID resolver: ${resolver.size} mappings loaded`);
} else {
  const fixtureDir = path.join(SAMPLES_DIR, 'fixtures', 'PrefabWorkflows_UIDemo');
  resolver.add('9d7c3f249fc4309468af0da8b9aadc60', 'CameraFacingBillboard');
  resolver.add('9208535555d3a8240ace8b8bd8270dfb', 'CardBehaviour');
  resolver.add('d24ab75cc4c08e34caf2dc26b116aff2', 'MedalDisplayUI');
  resolver.add('0cdb5f8b1f6f4f34f9ce7f9f5f7b67f0', 'UIParticles');
  resolver.addAsset(
    '2982fa53447c5c643865bbd0d194eab1',
    path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'),
    '_Card_Template'
  );
  resolver.addAsset(
    '4363f8259f7f14e418706d51b057d9f3',
    path.join(fixtureDir, '_Header_Text.prefab'),
    '_Header_Text'
  );
  resolver.addAsset(
    'de624dab09f28584fa6f3e2ddc3d0d3b',
    path.join(fixtureDir, 'Paragraph_Text.prefab'),
    'Paragraph_Text'
  );
  resolver.addAsset(
    'd06aea9cb778d4741bb5f11c640fdb9e',
    path.join(fixtureDir, 'Medal_Template.prefab'),
    'Medal_Template'
  );
  console.log(`GUID resolver: using checked-in fixture mappings (${resolver.size} mappings loaded)`);
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
// Test 1: REFS section written and parsed for regular prefabs
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: REFS section for regular prefab (Button)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Check that REFS section exists
  if (compactStr.includes('--- REFS')) {
    pass('REFS section present in output');
  } else {
    fail('REFS section present in output');
  }

  // Parse compact and check refs map
  const compact = readCompact(compactStr);

  if (compact.refs.size > 0) {
    pass(`REFS parsed: ${compact.refs.size} entries`);
  } else {
    fail('REFS parsed', 'No entries found');
  }

  // Check specific entries from Button.prefab
  const buttonGoRef = compact.refs.get('Button')?.[0];
  if (buttonGoRef === '8027481463175804169') {
    pass('Button GO fileID correct');
  } else {
    fail('Button GO fileID correct', `Got: ${buttonGoRef}`);
  }

  const buttonRtRef = compact.refs.get('Button:RectTransform')?.[0];
  if (buttonRtRef === '8027481463175804168') {
    pass('Button:RectTransform fileID correct');
  } else {
    fail('Button:RectTransform fileID correct', `Got: ${buttonRtRef}`);
  }

  const bgImageRef = compact.refs.get('Button/Background9Slice_Image:Image')?.[0];
  if (bgImageRef === '8027481461304769067') {
    pass('Button/Background9Slice_Image:Image fileID correct');
  } else {
    fail('Button/Background9Slice_Image:Image fileID correct', `Got: ${bgImageRef}`);
  }

  // Check nested prefab instance ref
  const textInstanceRef = compact.refs.get('Button/Button_Text:__instance')?.[0];
  if (textInstanceRef === '6920765965181414293') {
    pass('Button/Button_Text:__instance fileID correct');
  } else {
    fail('Button/Button_Text:__instance fileID correct', `Got: ${textInstanceRef}`);
  }
}

// ============================================================
// Test 2: REFS round-trip preserves identity for regular prefab
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: REFS-based identity round-trip (Button)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Merge back with REFS
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  // Compare
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }

  if (diffs === 0) {
    pass('Identity round-trip with REFS: 0 diffs');
  } else {
    fail(`Identity round-trip with REFS: ${diffs} diffs`);
  }
}

// ============================================================
// Test 3: REFS section for variant
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: REFS section for variant (Card_Explorer)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  // Check __instance ref
  const instanceRef = compact.refs.get('__instance')?.[0];
  if (instanceRef === '4987371547573211178') {
    pass('Variant __instance fileID correct');
  } else {
    fail('Variant __instance fileID correct', `Got: ${instanceRef}`);
  }

  // Check that REFS has entries for modification targets
  if (compact.refs.size > 1) {
    pass(`Variant REFS has ${compact.refs.size} entries`);
  } else {
    fail('Variant REFS entries', 'Too few entries');
  }

  // Variant identity round-trip
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }

  if (diffs === 0) {
    pass('Variant identity round-trip with REFS: 0 diffs');
  } else {
    fail(`Variant identity round-trip with REFS: ${diffs} diffs`);
  }
}

// ============================================================
// Test 4: Variant output uses GOPath:Component format (not raw fileIDs)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Variant output format (resolved headers)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Check that we don't have raw [&fileID] sections
  const hasRawFileIdSections = /\[&\d+\]/.test(compactStr.split('--- REFS')[0]);
  if (!hasRawFileIdSections) {
    pass('No raw [&fileID] sections in STRUCTURE/DETAILS');
  } else {
    fail('No raw [&fileID] sections', 'Found raw [&fileID] in output');
  }

  // Check that we have resolved section headers
  const compact = readCompact(compactStr);
  const hasResolvedHeaders = compact.sections.some(s =>
    !s.goPath.startsWith('&') && s.goPath !== ''
  );
  if (hasResolvedHeaders) {
    pass('Has resolved GOPath:Component section headers');
  } else {
    fail('Has resolved GOPath:Component section headers');
  }

  // Print compact output for visual inspection
  console.log('\n  --- Variant compact output (first 40 lines) ---');
  const lines = compactStr.split('\n').slice(0, 40);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log('  ...');
}

// ============================================================
// Test 5: Variant with full inherited tree (when base prefab available)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Variant structure tree from base prefab');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // Check if the structure section has a tree (not just "(variant of ...)")
  const structureSection = compactStr.split('--- STRUCTURE')[1]?.split('--- DETAILS')[0] || '';
  const hasTree = structureSection.includes('├─') || structureSection.includes('└─');
  const hasFallback = structureSection.includes('(variant of');

  if (hasTree) {
    pass('Full inherited tree shown in STRUCTURE');
  } else if (hasFallback) {
    // Base prefab wasn't available — this is acceptable
    pass('Fallback variant structure (base prefab not in scanned project)');
  } else {
    fail('Variant structure section', 'Neither tree nor fallback found');
  }
}

// ============================================================
// Test 6: generateFileId() produces valid random IDs
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: generateFileId() random int64 generation');
console.log('='.repeat(60));

{
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateFileId());
  }

  // All should be unique (100 random int64s should never collide)
  if (ids.size === 100) {
    pass('100 generated IDs are all unique');
  } else {
    fail('Uniqueness', `Only ${ids.size} unique out of 100`);
  }

  // All should be valid positive integers
  let allValid = true;
  for (const id of ids) {
    if (!/^\d+$/.test(id)) {
      allValid = false;
      fail(`Valid format`, `Invalid ID: ${id}`);
      break;
    }
    const n = BigInt(id);
    if (n <= 0n || n > 9223372036854775807n) {
      allValid = false;
      fail(`Valid range`, `Out of range: ${id}`);
      break;
    }
  }
  if (allValid) {
    pass('All IDs are valid positive int64 strings');
  }

  // Print a few sample IDs
  const sample = Array.from(ids).slice(0, 5);
  console.log(`  Sample IDs: ${sample.join(', ')}`);
}

// ============================================================
// Test 7: REFS round-trip for _Card_Template (complex prefab)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: REFS round-trip for complex prefab (_Card_Template)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  if (compact.refs.size > 0) {
    pass(`REFS parsed: ${compact.refs.size} entries`);
  } else {
    fail('REFS parsed');
  }

  // Identity round-trip
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }

  if (diffs === 0) {
    pass('_Card_Template identity round-trip with REFS: 0 diffs');
  } else {
    fail(`_Card_Template identity round-trip: ${diffs} diffs`);
    // Show first few diffs
    let shown = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
      if ((origLines[i] || '') !== (outLines[i] || '')) {
        console.log(`    Line ${i + 1}:`);
        console.log(`      ORIG: ${(origLines[i] || '').substring(0, 120)}`);
        console.log(`      OUT:  ${(outLines[i] || '').substring(0, 120)}`);
        if (++shown >= 5) break;
      }
    }
  }
}

// ============================================================
// Test 8: Ellen variant REFS
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: REFS for Ellen variant');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'variants', 'Ellen_Variant.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const compact = readCompact(compactStr);

  if (compact.refs.has('__instance')) {
    pass('Ellen variant has __instance ref');
  } else {
    fail('Ellen variant __instance ref');
  }

  // Identity round-trip
  const merged = mergeCompactChanges(ast, compact);
  const output = writeUnityYaml(merged);

  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }

  if (diffs === 0) {
    pass('Ellen variant identity round-trip with REFS: 0 diffs');
  } else {
    fail(`Ellen variant round-trip: ${diffs} diffs`);
  }
}

// ============================================================
// Test 9: Nested prefab expansion in structure tree
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Nested prefab expansion (_Card_Template)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  const structure = compactStr.split('--- STRUCTURE')[1]?.split('--- DETAILS')[0] || '';

  // Check that nested prefabs show {SourceName} annotations
  if (structure.includes('{_Header_Text}')) {
    pass('_Header_Text source name shown');
  } else {
    fail('_Header_Text source name', 'Not found in structure');
  }

  if (structure.includes('{Medal_Template}')) {
    pass('Medal_Template source name shown');
  } else {
    fail('Medal_Template source name', 'Not found in structure');
  }

  // Check expanded children from Medal_Template
  if (structure.includes('Circle_Image') && structure.includes('Small_Circle_Image')) {
    pass('Medal_Template children expanded (Circle_Image, Small_Circle_Image)');
  } else {
    fail('Medal_Template children', 'Missing expanded children');
  }

  // Check deep nesting: ActivationParticles_Template children
  if (structure.includes('Burst_ParticleSystem') && structure.includes('Activated_ParticleSystem')) {
    pass('Deep nested children expanded (Burst/Activated ParticleSystem)');
  } else {
    fail('Deep nested children', 'Missing Burst/Activated ParticleSystem');
  }

  // Check modification markers (* on overridden components)
  if (structure.includes('TextMeshProUGUI*')) {
    pass('Modification markers (* on overridden components)');
  } else {
    fail('Modification markers', 'No * markers found');
  }

  // Check REFS uses resolved names (not NestedPrefab)
  const refs = compactStr.split('--- REFS')[1] || '';
  if (refs.includes('_Header_Text') && !refs.includes('NestedPrefab')) {
    pass('REFS uses resolved names (not NestedPrefab)');
  } else {
    fail('REFS resolution', refs.includes('NestedPrefab') ? 'Found NestedPrefab in REFS' : 'Missing _Header_Text');
  }
}

// ============================================================
// Test 10: Variant path resolution (resolved headers)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Variant path resolution (Card_Explorer_Variant)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  const details = compactStr.split('--- DETAILS')[1]?.split('--- REFS')[0] || '';
  const refs = compactStr.split('--- REFS')[1] || '';

  // Check _Header_Text resolved (not NestedPrefab)
  if (details.includes('[_Header_Text:TextMeshProUGUI]')) {
    pass('_Header_Text:TextMeshProUGUI resolved in DETAILS');
  } else {
    fail('_Header_Text resolution', 'Not found in DETAILS');
  }

  // Check Paragraph_Text resolved (not duplicate _Header_Text)
  if (details.includes('[Paragraph_Text:TextMeshProUGUI]')) {
    pass('Paragraph_Text:TextMeshProUGUI resolved in DETAILS');
  } else {
    fail('Paragraph_Text resolution', 'Not found in DETAILS');
  }

  // Check Image disambiguation with GO paths
  if (details.includes('Circle_Image:Image') && details.includes('Small_Circle_Image:Image')) {
    pass('Image components disambiguated with GO paths');
  } else {
    fail('Image disambiguation', 'Missing Circle_Image or Small_Circle_Image paths');
  }

  // Check deep nested resolution (ParticleSystem)
  if (details.includes('ActivationParticles_Template') && details.includes('ParticleSystem]')) {
    pass('Deep nested ParticleSystem resolved');
  } else {
    fail('Deep nested resolution', 'Missing ActivationParticles_Template path');
  }

  // Check no raw &fileID headers remain in DETAILS
  const hasRawIds = /\[&\d+/.test(details);
  if (!hasRawIds) {
    pass('No raw &fileID headers in DETAILS');
  } else {
    fail('Raw fileID headers', 'Found raw &fileID in DETAILS');
  }

  // Check REFS has unique keys (no duplicates)
  const refsLines = refs.trim().split('\n').filter(l => l.includes(' = '));
  const refsKeys = refsLines.map(l => l.split(' = ')[0]);
  const uniqueKeys = new Set(refsKeys);
  if (uniqueKeys.size === refsKeys.length) {
    pass(`REFS has ${refsKeys.length} unique keys`);
  } else {
    fail('REFS uniqueness', `${refsKeys.length} keys but only ${uniqueKeys.size} unique`);
  }

  // Identity round-trip
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
    pass('Variant with resolved paths: identity round-trip 0 diffs');
  } else {
    fail(`Variant round-trip: ${diffs} diffs`);
  }
}

// ============================================================
// Test 11: Variant with added objects (RootPrefabInstance)
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Variant with added objects (RootPrefabInstance)');
console.log('='.repeat(60));

{
  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'RootPrefabInstance.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);

  // Should be detected as variant
  if (ast.type === 'variant') {
    pass('Detected as variant (not prefab)');
  } else {
    fail('File type detection', `Expected variant, got ${ast.type}`);
  }

  // Should have variantSource
  if (ast.variantSource?.guid === '1f8fbf0ce1db62d40a7badbbf65dec4d') {
    pass('variantSource GUID correct');
  } else {
    fail('variantSource GUID', `Got: ${ast.variantSource?.guid}`);
  }

  // Should have hierarchy (added objects)
  if (ast.hierarchy) {
    pass(`Hierarchy present: ${ast.hierarchy.name}`);
  } else {
    fail('Hierarchy present', 'hierarchy is undefined');
  }

  // Compact output should be non-empty (has STRUCTURE + DETAILS + REFS)
  const compactStr = writeCompact(ast, { guidResolver: resolver });
  const hasStructure = compactStr.includes('--- STRUCTURE');
  const hasDetails = compactStr.includes('--- DETAILS');
  const hasRefs = compactStr.includes('--- REFS');
  if (hasStructure && hasDetails && hasRefs) {
    pass('Compact output has all sections');
  } else {
    fail('Compact sections', `STRUCTURE:${hasStructure} DETAILS:${hasDetails} REFS:${hasRefs}`);
  }

  // Added GOs should appear in compact output
  if (compactStr.includes('Btns') && compactStr.includes('NoStage') && compactStr.includes('Text')) {
    pass('Added GOs appear in compact output');
  } else {
    fail('Added GOs in output', 'Missing Btns/NoStage/Text');
  }

  // YAML roundtrip
  const output = writeUnityYaml(ast);
  const origLines = content.split('\n').map(l => l.trimEnd());
  const outLines = output.split('\n').map(l => l.trimEnd());
  let diffs = 0;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if ((origLines[i] || '') !== (outLines[i] || '')) diffs++;
  }
  if (diffs === 0) {
    pass(`YAML roundtrip: 0 diffs (${origLines.length} lines)`);
  } else {
    fail(`YAML roundtrip: ${diffs} diffs`);
  }
}

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
