"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const guid_resolver_1 = require("./guid-resolver");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const compact_writer_1 = require("./compact-writer");
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const PROJECT_PATH = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
let totalTests = 0;
let passedTests = 0;
function pass(label) {
    totalTests++;
    passedTests++;
    console.log(`  PASS — ${label}`);
}
function fail(label, detail) {
    totalTests++;
    console.log(`  FAIL — ${label}`);
    if (detail)
        console.log(`    ${detail}`);
}
// ============================================================
// Test 1: Built-in GUIDs resolve correctly
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Built-in GUIDs resolve correctly');
console.log('='.repeat(60));
{
    const resolver = new guid_resolver_1.GuidResolver();
    const cases = [
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
        }
        else {
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
    const resolver = new guid_resolver_1.GuidResolver();
    resolver.scanProject(PROJECT_PATH);
    console.log(`  (Loaded ${resolver.size} mappings from project scan)`);
    // Known GUIDs from sample project .cs.meta files
    const cases = [
        ['9208535555d3a8240ace8b8bd8270dfb', 'CardBehaviour'],
        ['972d2ab202f4c7742aa210c364a56a05', 'ActivatePanelUI'],
    ];
    for (const [guid, expected] of cases) {
        const resolved = resolver.resolve(guid);
        if (resolved === expected) {
            pass(`Script ${expected} resolved from .cs.meta`);
        }
        else {
            fail(`Script ${expected}`, `Got: ${resolved}`);
        }
    }
    // Verify that scanning found more than just built-ins
    if (resolver.size > 50) {
        pass(`Resolver has ${resolver.size} mappings (> 50 built-in)`);
    }
    else {
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
    const resolver = new guid_resolver_1.GuidResolver();
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
            }
            else {
                fail('Ellen_Variant.prefab asset path', `Got: ${filePath}`);
            }
            const name = resolver.resolve(match[1]);
            if (name === 'Ellen_Variant') {
                pass(`Ellen_Variant name resolved from .prefab.meta`);
            }
            else {
                fail('Ellen_Variant name', `Got: ${name}`);
            }
        }
        else {
            fail('Ellen_Variant.prefab.meta has no GUID');
        }
    }
    else {
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
    const resolver = new guid_resolver_1.GuidResolver();
    resolver.scanProject(PROJECT_PATH);
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // ActivatePanelUI should appear as resolved class name instead of raw GUID
    if (compactStr.includes('ActivatePanelUI')) {
        pass('ActivatePanelUI class name appears in compact output');
    }
    else {
        fail('ActivatePanelUI not found in compact output');
    }
    // CardBehaviour might not be in Button.prefab, but check that 114:MonoBehaviour
    // sections use resolved names where possible
    // At minimum, TextMeshProUGUI (built-in) should appear
    if (compactStr.includes('TextMeshProUGUI')) {
        pass('TextMeshProUGUI (built-in) appears in compact output');
    }
    else {
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
//# sourceMappingURL=test-guid-resolver.js.map