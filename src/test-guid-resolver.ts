/**
 * Test GuidResolver: verify that .cs script GUIDs are resolved to class names.
 *
 * Tests:
 * 1. Built-in Unity GUIDs resolve correctly
 * 2. Project .cs.meta scanning resolves script GUIDs to class names
 * 3. Asset .meta scanning resolves prefab/scene GUIDs
 * 4. Packages/ directory is scanned when present
 * 5. Compact output uses resolved class names for MonoBehaviours
 */

import * as fs from 'fs';
import * as path from 'path';
import { GuidResolver } from './guid-resolver';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact } from './compact-writer';

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const PROJECT_PATH = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');

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
// Test 1: Built-in GUIDs resolve correctly
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Built-in GUIDs resolve correctly');
console.log('='.repeat(60));

{
  const resolver = new GuidResolver();

  const cases: [string, string][] = [
    ['f70555f144d8491a825f0804e09c671c', 'Image'],
    ['fe87c0e1cc204ed48ad3b37840f39efc', 'Text'],
    ['4e29b1a8efbd4b44bd927f3ae6b005da', 'Button'],
    ['f4688fdb7df04437aeb418b961361dc5', 'TextMeshProUGUI'],
    ['4f231c4fb786f3946a523354b45a0805', 'EventSystem'],
  ];

  for (const [guid, expected] of cases) {
    const resolved = resolver.resolve(guid);
    if (resolved === expected) {
      pass(`Built-in ${expected} (${guid.substring(0, 8)}...)`);
    } else {
      fail(`Built-in ${expected}`, `Got: ${resolved}`);
    }
  }
}

// ============================================================
// Test 2: Project .cs.meta scanning resolves script GUIDs
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Project .cs.meta scanning resolves script GUIDs');
console.log('='.repeat(60));

{
  const resolver = new GuidResolver();
  resolver.scanProject(PROJECT_PATH);

  console.log(`  (Loaded ${resolver.size} mappings from project scan)`);

  // Known GUIDs from sample project .cs.meta files
  const cases: [string, string][] = [
    ['9208535555d3a8240ace8b8bd8270dfb', 'CardBehaviour'],
    ['972d2ab202f4c7742aa210c364a56a05', 'ActivatePanelUI'],
  ];

  for (const [guid, expected] of cases) {
    const resolved = resolver.resolve(guid);
    if (resolved === expected) {
      pass(`Script ${expected} resolved from .cs.meta`);
    } else {
      fail(`Script ${expected}`, `Got: ${resolved}`);
    }
  }

  // Verify that scanning found more than just built-ins
  if (resolver.size > 50) {
    pass(`Resolver has ${resolver.size} mappings (> 50 built-in)`);
  } else {
    fail(`Expected > 50 mappings`, `Got: ${resolver.size}`);
  }
}

// ============================================================
// Test 3: Asset .meta scanning resolves prefab GUIDs
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Asset .meta scanning resolves prefab/scene GUIDs');
console.log('='.repeat(60));

{
  const resolver = new GuidResolver();
  resolver.scanProject(PROJECT_PATH);

  // Find any .prefab.meta file in the project and verify it resolves
  const ellenMetaPath = path.join(PROJECT_PATH, 'Assets', '3DGamekit', 'Ellen', 'Models', 'Ellen_Variant.prefab.meta');
  if (fs.existsSync(ellenMetaPath)) {
    const meta = fs.readFileSync(ellenMetaPath, 'utf-8');
    const match = meta.match(/guid:\s*([a-f0-9]{32})/);
    if (match) {
      const filePath = resolver.resolveFilePath(match[1]);
      if (filePath && filePath.endsWith('Ellen_Variant.prefab')) {
        pass(`Ellen_Variant.prefab asset path resolved`);
      } else {
        fail('Ellen_Variant.prefab asset path', `Got: ${filePath}`);
      }
      const name = resolver.resolve(match[1]);
      if (name === 'Ellen_Variant') {
        pass(`Ellen_Variant name resolved from .prefab.meta`);
      } else {
        fail('Ellen_Variant name', `Got: ${name}`);
      }
    } else {
      fail('Ellen_Variant.prefab.meta has no GUID');
    }
  } else {
    fail('Ellen_Variant.prefab.meta not found');
  }
}

// ============================================================
// Test 4: Compact output uses resolved class names
// ============================================================

console.log('\n' + '='.repeat(60));
console.log('TEST: Compact output uses resolved class names');
console.log('='.repeat(60));

{
  const resolver = new GuidResolver();
  resolver.scanProject(PROJECT_PATH);

  const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
  const ast = parseUnityYaml(content);
  const compactStr = writeCompact(ast, { guidResolver: resolver });

  // ActivatePanelUI should appear as resolved class name instead of raw GUID
  if (compactStr.includes('ActivatePanelUI')) {
    pass('ActivatePanelUI class name appears in compact output');
  } else {
    fail('ActivatePanelUI not found in compact output');
  }

  // CardBehaviour might not be in Button.prefab, but check that 114:MonoBehaviour
  // sections use resolved names where possible
  // At minimum, TextMeshProUGUI (built-in) should appear
  if (compactStr.includes('TextMeshProUGUI')) {
    pass('TextMeshProUGUI (built-in) appears in compact output');
  } else {
    fail('TextMeshProUGUI not found in compact output');
  }
}

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
