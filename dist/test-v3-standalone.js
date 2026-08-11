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
let failed = 0;
function assert(condition, name, details = '') {
    if (condition)
        console.log(`  PASS: ${name}`);
    else {
        console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
        failed++;
    }
}
function semanticSnapshot(file) {
    const documents = [...file.documents]
        .sort((left, right) => left.fileId.localeCompare(right.fileId))
        .map(document => ({
        typeId: document.typeId,
        typeName: document.typeName,
        fileId: document.fileId,
        stripped: document.stripped,
        properties: sortObject(document.properties),
    }));
    return JSON.stringify({ type: file.type, documents });
}
function sortObject(value) {
    if (Array.isArray(value))
        return value.map(sortObject);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
}
console.log('\n=== v3 standalone compiler ===');
const samplePath = path.join(__dirname, '..', 'samples', 'v3', 'MinimalHierarchy.source.prefab');
const originalText = fs.readFileSync(samplePath, 'utf-8');
const original = (0, unity_yaml_parser_1.parseUnityYaml)(originalText);
const v3Text = (0, writer_1.writeV3)(original, { profile: 'unity-generic-v1' });
assert(v3Text.includes('Root @g1 [BoxCollider @c1]') && v3Text.includes('Child @g2'), 'writer emits authoritative hierarchy and stable machine identities');
assert(v3Text.includes('--- IDENTITY') && v3Text.includes('t2 = transform'), 'writer emits a separate identity graph');
// Cold boundary: only serialized v3 text crosses into the compiler. The
// original UnityFile and original YAML are not compiler inputs.
const parsedV3 = (0, reader_1.readV3)(v3Text);
const rebuilt = (0, compiler_1.compileV3)(parsedV3);
const rebuiltText = (0, unity_yaml_writer_1.writeUnityYaml)(rebuilt);
const reparsed = (0, unity_yaml_parser_1.parseUnityYaml)(rebuiltText);
assert(semanticSnapshot(reparsed) === semanticSnapshot(original), 'YAML -> v3 -> discard original -> prefab preserves the semantic document graph');
assert((0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(v3Text))) === rebuiltText, 'same standalone v3 input produces byte-identical canonical YAML');
assert(reparsed.hierarchy?.children[0]?.name === 'Child' &&
    reparsed.hierarchy.transform.fileId === '200' &&
    reparsed.hierarchy.children[0].transform.fileId === '500', 'compiled hierarchy and existing fileIDs survive reparsing');
const scriptedV3 = `# ubridge v3 | prefab | profile:unity-generic-v1
--- STRUCTURE
ScriptedRoot @g1 [ExampleBehaviour @c1]
--- DETAILS
[g1 | ScriptedRoot]
m_IsActive = 1
[t1 | ScriptedRoot:Transform]
m_LocalPosition = {"x":0,"y":0,"z":0}
[c1 | ScriptedRoot:ExampleBehaviour]
answer = 42
--- IDENTITY
g1 = gameObject | fileID:10 | type:1 | typeName:GameObject
t1 = transform | fileID:20 | type:4 | typeName:Transform | owner:g1
c1 = component | fileID:30 | type:114 | typeName:MonoBehaviour | owner:g1 | displayName:ExampleBehaviour | script:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;
const scripted = (0, compiler_1.compileV3)((0, reader_1.readV3)(scriptedV3));
const behaviour = scripted.documents.find(document => document.fileId === '30');
assert(behaviour?.typeName === 'MonoBehaviour' &&
    behaviour.properties.m_Script?.guid === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' &&
    behaviour.properties.answer === 42, 'readable script name remains separate from serialized MonoBehaviour identity');
try {
    (0, reader_1.readV3)(v3Text.replace('Root @g1', 'Root @missing'));
    assert(false, 'unbound structure identity fails closed');
}
catch (error) {
    assert(String(error).includes('not bound to a GameObject'), 'unbound structure identity fails closed', String(error));
}
console.log(`\nv3 standalone tests: ${failed === 0 ? 'all passed' : `${failed} failed`}`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=test-v3-standalone.js.map