"use strict";
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
const compiler_1 = require("./v3/compiler");
const reader_1 = require("./v3/reader");
const writer_1 = require("./v3/writer");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
let passed = 0;
let failed = 0;
function assert(condition, name, details = '') {
    if (condition) {
        console.log(`  PASS: ${name}`);
        passed++;
    }
    else {
        console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
        failed++;
    }
}
function sample(...parts) {
    return fs.readFileSync(path.join(__dirname, '..', 'samples', ...parts), 'utf-8');
}
function compileText(v3Text) {
    return (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(v3Text))));
}
console.log('\n=== v3 ownership cold-boundary edits ===');
{
    const v3Text = (0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('variants', 'Ellen_Variant.prefab')));
    const document = (0, reader_1.readV3)(v3Text);
    assert(document.kind === 'variant' && !!document.variantRootId &&
        v3Text.includes('(variant @p1 source:a5674d01884853d4e8f2386a171e14d9)'), 'variant source and root PrefabInstance are explicit in v3 STRUCTURE');
    const details = document.details.get(document.variantRootId);
    const modifications = details.m_Modification.m_Modifications;
    const name = modifications.find(modification => modification.propertyPath === 'm_Name');
    assert(name?.value === 'Ellen', 'variant name override is present in standalone DETAILS');
    name.value = 'Ellen_v3_edited';
    // Only the parsed v3 document enters compileV3.
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rebuiltName = rebuilt.prefabInstances[0].modifications
        .find(modification => modification.propertyPath === 'm_Name');
    assert(rebuiltName?.value === 'Ellen_v3_edited', 'variant delta edit compiles without the original variant YAML');
    assert(rebuilt.variantSource?.guid === 'a5674d01884853d4e8f2386a171e14d9', 'variant source GUID survives standalone compilation');
}
{
    const v3Text = (0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(sample('prefabs', 'Button.prefab')));
    const document = (0, reader_1.readV3)(v3Text);
    const instance = [...document.identity.values()]
        .find(identity => identity.kind === 'prefabInstance');
    assert(!!instance && v3Text.includes(`Button_Text @${instance?.machineId} {source:`), 'nested PrefabInstance is visible in regular-prefab STRUCTURE');
    const details = document.details.get(instance.machineId);
    const modifications = details.m_Modification.m_Modifications;
    const name = modifications.find(modification => modification.propertyPath === 'm_Name');
    name.value = 'Button_Text_v3';
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)(document)));
    const rebuiltName = rebuilt.prefabInstances[0].modifications
        .find(modification => modification.propertyPath === 'm_Name');
    assert(rebuiltName?.value === 'Button_Text_v3', 'nested PrefabInstance override edit compiles across the cold boundary');
    assert(rebuilt.documents.filter(item => item.stripped).length === 2, 'nested stripped identity documents are reconstructed');
}
{
    const original = sample('prefabs', 'RootPrefabInstance.prefab');
    const first = compileText((0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(original)));
    const secondText = (0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)((0, writer_1.writeV3)((0, unity_yaml_parser_1.parseUnityYaml)(original)))));
    assert(first.type === 'variant' && first.hierarchy?.children.length === 4 &&
        first.documents.length === 53, 'variant with added root objects is independently reconstructed');
    assert((0, unity_yaml_writer_1.writeUnityYaml)(first) === secondText, 'variant ownership compilation is deterministic');
}
console.log(`\nv3 ownership tests: ${passed} passed, ${failed} failed`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=test-v3-ownership.js.map