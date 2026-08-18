"use strict";
/**
 * Round-trip test: Unity YAML → v3 text → cold standalone compile → YAML.
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
const unity_yaml_writer_1 = require("./unity-yaml-writer");
const writer_1 = require("./v3/writer");
const reader_1 = require("./v3/reader");
const compiler_1 = require("./v3/compiler");
const semantic_normalizer_1 = require("./v3/semantic-normalizer");
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
let failures = 0;
function testFile(filePath, label) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${label}`);
    console.log(`File: ${filePath}`);
    console.log('='.repeat(60));
    const content = fs.readFileSync(filePath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');
    // Step 1: Parse Unity YAML → AST
    console.log('\n[1] Parsing Unity YAML...');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
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
    const compact = (0, writer_1.writeV3)(ast);
    const compactSize = Buffer.byteLength(compact, 'utf-8');
    console.log(`    v3 size: ${compactSize} bytes`);
    console.log(`    Reduction: ${((1 - compactSize / originalSize) * 100).toFixed(1)}%`);
    // Step 3: serialized v3 only → fresh parse → compile → Unity YAML
    console.log('\n[3] Cold-compiling v3 without original YAML...');
    const roundTripped = (0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(String(compact))));
    const roundTrippedSize = Buffer.byteLength(roundTripped, 'utf-8');
    console.log(`    Round-tripped size: ${roundTrippedSize} bytes`);
    // Step 4: semantic comparison and deterministic output
    console.log('\n[4] Comparing semantic graphs...');
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)(roundTripped);
    const difference = (0, semantic_normalizer_1.compareLocalPrefabSemantics)(ast, rebuilt);
    const deterministic = (0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(compact))) === roundTripped;
    if (!difference && deterministic) {
        console.log('    PASS: semantic equality and deterministic canonical YAML');
    }
    else {
        failures++;
        console.log(`    FAIL: ${difference ? `${difference.path}: ${JSON.stringify(difference.expected)} != ${JSON.stringify(difference.actual)}` : 'non-deterministic output'}`);
    }
}
function countDescendants(node) {
    return node.children.length + node.children.reduce((sum, child) => sum + countDescendants(child), 0);
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
if (failures > 0)
    process.exit(1);
//# sourceMappingURL=test-roundtrip.js.map