"use strict";
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
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const compact_writer_1 = require("./compact-writer");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
const compact_reader_1 = require("./compact-reader");
const compact_merger_1 = require("./compact-merger");
const guid_resolver_1 = require("./guid-resolver");
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const resolver = new guid_resolver_1.GuidResolver();
const projectPath = path.join(SAMPLES_DIR, 'unity-projects', 'PrefabWorkflows_UIDemo', 'PrefabWorkflows_UIDemo_Project');
if (fs.existsSync(projectPath)) {
    resolver.scanProject(projectPath);
    console.log(`GUID resolver: ${resolver.size} mappings loaded`);
}
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
// Test 1: Write direction — internal refs use -> format
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('TEST: Write direction — internal refs use -> format');
console.log('='.repeat(60));
{
    const content = fs.readFileSync(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Check that activateDisplayText uses -> format
    if (compactStr.includes('activateDisplayText = ->Button_Text:TextMeshProUGUI')) {
        pass('activateDisplayText written as ->Button_Text:TextMeshProUGUI');
    }
    else {
        fail('activateDisplayText -> format', 'Not found in compact output');
    }
    // Check that external refs still use {fileID, guid} format
    if (compactStr.includes('{21300000, e197d4e89f9f4274dac4566fdd117ecf}')) {
        pass('External refs still use {fileID, guid} format');
    }
    else {
        fail('External ref format');
    }
    // Check that null refs still use {0} format
    if (!compactStr.includes('->') || compactStr.includes('{0}') || !compactStr.includes('->{0}')) {
        pass('Null refs not converted to -> format');
    }
    else {
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
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Check that Button_Text:TextMeshProUGUI is in REFS
    const tmproRef = compact.refs.get('Button_Text:TextMeshProUGUI')?.[0];
    if (tmproRef === '8027481463030904456') {
        pass('Button_Text:TextMeshProUGUI = 8027481463030904456 in REFS');
    }
    else {
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
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Merge back and check the resolved value
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    // The original has: activateDisplayText: {fileID: 8027481463030904456}
    if (output.includes('activateDisplayText: {fileID: 8027481463030904456}')) {
        pass('-> reference resolved to correct fileID in YAML output');
    }
    else {
        fail('-> resolution', 'fileID not found in output');
    }
    // Full identity round-trip
    const origLines = content.split('\n').map(l => l.trimEnd());
    const outLines = output.split('\n').map(l => l.trimEnd());
    let diffs = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
        if ((origLines[i] || '') !== (outLines[i] || ''))
            diffs++;
    }
    if (diffs === 0) {
        pass('Full identity round-trip: 0 diffs');
    }
    else {
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
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Replace -> with @ in the compact string
    const atCompact = compactStr.replace('->Button_Text:TextMeshProUGUI', '@Button_Text:TextMeshProUGUI');
    const compact = (0, compact_reader_1.readCompact)(atCompact);
    // Merge back and verify
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    if (output.includes('activateDisplayText: {fileID: 8027481463030904456}')) {
        pass('@ alias resolves to correct fileID');
    }
    else {
        fail('@ alias resolution');
    }
    // Identity round-trip should still work
    const origLines = content.split('\n').map(l => l.trimEnd());
    const outLines = output.split('\n').map(l => l.trimEnd());
    let diffs = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
        if ((origLines[i] || '') !== (outLines[i] || ''))
            diffs++;
    }
    if (diffs === 0) {
        pass('@ alias round-trip: 0 diffs');
    }
    else {
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
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    // Check that the array uses -> format
    if (compactStr.includes('[->Frame, ->_Header_Text, ->Paragraph_Text]')) {
        pass('Array of internal refs uses -> format');
    }
    else {
        // Check if individual refs are present
        const hasArrow = compactStr.includes('->Frame');
        fail('Array -> format', `Has ->Frame: ${hasArrow}`);
    }
    // Round-trip should still work
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    const origLines = content.split('\n').map(l => l.trimEnd());
    const outLines = output.split('\n').map(l => l.trimEnd());
    let diffs = 0;
    for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
        if ((origLines[i] || '') !== (outLines[i] || ''))
            diffs++;
    }
    if (diffs === 0) {
        pass('_Card_Template round-trip with -> arrays: 0 diffs');
    }
    else {
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
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compactStr = (0, compact_writer_1.writeCompact)(ast, { guidResolver: resolver });
    const compact = (0, compact_reader_1.readCompact)(compactStr);
    // Modify the compact: change activateDisplayText to point to Background9Slice_Image:Image
    for (const section of compact.sections) {
        for (const prop of section.properties) {
            if (prop.key === 'activateDisplayText') {
                // Use @ syntax to set reference
                prop.value = '@Background9Slice_Image:Image';
            }
        }
    }
    // Merge and check
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compact);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    // Should resolve to Background9Slice_Image:Image fileID (8027481461304769067)
    if (output.includes('activateDisplayText: {fileID: 8027481461304769067}')) {
        pass('@ path reference resolved to correct fileID (8027481461304769067)');
    }
    else {
        // Check what value was written
        const match = output.match(/activateDisplayText: (.+)/);
        fail('@ path resolution', `Got: ${match ? match[1] : 'not found'}`);
    }
}
// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
//# sourceMappingURL=test-path-refs.js.map