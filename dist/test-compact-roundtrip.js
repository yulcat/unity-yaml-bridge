"use strict";
/**
 * Test the v3 standalone round-trip pipeline:
 *   Unity YAML → v3 text → fresh v3 parse → standalone compile → Unity YAML
 *
 * This verifies:
 * The original YAML/AST never enters the compile stage.
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
const test_v3_utils_1 = require("./test-v3-utils");
const writer_1 = require("./v3/writer");
const reader_1 = require("./v3/reader");
const compiler_1 = require("./v3/compiler");
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
let totalTests = 0;
let passedTests = 0;
function testIdentityRoundtrip(filePath, label) {
    totalTests++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: Identity Round-trip — ${label}`);
    console.log('='.repeat(60));
    const content = fs.readFileSync(filePath, 'utf-8');
    const cold = (0, test_v3_utils_1.coldRoundTripV3)(content);
    const difference = (0, test_v3_utils_1.describeSemanticDifference)(cold.original, cold.rebuilt);
    const deterministic = (0, test_v3_utils_1.coldRoundTripV3)(content).rebuiltText === cold.rebuiltText;
    console.log(`  v3 bytes: ${cold.v3Text.length}, type=${cold.original.type}`);
    if (!difference && deterministic) {
        console.log('  PASS — semantic equality, deterministic standalone output');
        passedTests++;
    }
    else {
        console.log(`  FAIL — ${difference || 'non-deterministic output'}`);
    }
}
function testVariantEdit(filePath, label) {
    totalTests++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: Variant Edit — ${label}`);
    console.log('='.repeat(60));
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    if (ast.type !== 'variant') {
        console.log('  SKIP — not a variant file');
        return;
    }
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(ast));
    let editedModification;
    for (const identity of document.identity.values()) {
        if (identity.kind !== 'prefabInstance')
            continue;
        const details = document.details.get(identity.machineId);
        const modifications = details?.m_Modification?.m_Modifications || [];
        editedModification = modifications.find(item => item.propertyPath === 'm_Name');
        if (editedModification)
            break;
    }
    if (!editedModification) {
        console.log('  SKIP — no m_Name property found in variant');
        return;
    }
    const originalName = String(editedModification.value);
    const newName = `${originalName}_edited`;
    editedModification.value = newName;
    console.log(`  Editing m_Name: "${originalName}" → "${newName}"`);
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rebuiltName = rebuilt.prefabInstances.flatMap(instance => instance.modifications)
        .find(modification => modification.propertyPath === 'm_Name' && modification.value === newName);
    if (rebuiltName) {
        console.log('  PASS — standalone variant delta edit applied');
        passedTests++;
    }
    else {
        console.log('  FAIL — edit not found in compiled variant');
    }
}
function testPrefabEdit(filePath, label) {
    totalTests++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: Prefab Edit — ${label}`);
    console.log('='.repeat(60));
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    if (ast.type !== 'prefab') {
        console.log('  SKIP — not a prefab file');
        return;
    }
    const document = (0, reader_1.readV3)((0, writer_1.writeV3)(ast));
    let targetIdentity;
    let targetKey;
    for (const identity of document.identity.values()) {
        if (identity.kind !== 'transform')
            continue;
        const details = document.details.get(identity.machineId);
        if (details?.m_AnchoredPosition)
            targetKey = 'm_AnchoredPosition';
        else if (details?.m_LocalPosition)
            targetKey = 'm_LocalPosition';
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
    const targetFileId = document.identity.get(targetIdentity).fileId;
    const rebuilt = (0, compiler_1.compileV3)(document);
    const position = rebuilt.documents.find(item => item.fileId === targetFileId)
        ?.properties[targetKey];
    if (position?.x === 100 && position?.y === 200) {
        console.log('  PASS — standalone position edit applied correctly');
        passedTests++;
    }
    else {
        console.log(`  FAIL — expected x:100, y:200; got ${JSON.stringify(position)}`);
    }
}
// ============================================================
// Run tests
// ============================================================
console.log('Unity YAML Bridge — v3 Standalone Round-trip Test Suite');
console.log('=================================================');
// Identity round-trip tests (should produce 0 diff lines)
testIdentityRoundtrip(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'Simple UI Prefab (Button)');
testIdentityRoundtrip(path.join(SAMPLES_DIR, 'prefabs', '_Card_Template.prefab'), 'Complex Prefab (_Card_Template)');
testIdentityRoundtrip(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'Variant (Card_Explorer)');
testIdentityRoundtrip(path.join(SAMPLES_DIR, 'variants', 'Ellen_Variant.prefab'), 'Variant (Ellen)');
testIdentityRoundtrip(path.join(SAMPLES_DIR, 'prefabs', 'RootPrefabInstance.prefab'), 'Variant with added objects (RootPrefabInstance)');
// Edit tests
testVariantEdit(path.join(SAMPLES_DIR, 'variants', 'Ellen_Variant.prefab'), 'Ellen Variant name edit');
testVariantEdit(path.join(SAMPLES_DIR, 'variants', 'Card_Explorer_Variant.prefab'), 'Card Explorer Variant name edit');
testPrefabEdit(path.join(SAMPLES_DIR, 'prefabs', 'Button.prefab'), 'Button position edit');
// Summary
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${passedTests}/${totalTests} tests passed`);
console.log('='.repeat(60));
process.exit(passedTests === totalTests ? 0 : 1);
//# sourceMappingURL=test-compact-roundtrip.js.map