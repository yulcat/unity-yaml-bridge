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
const test_v3_utils_1 = require("./test-v3-utils");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
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
function findPrefabs(directory) {
    return fs.readdirSync(directory)
        .filter(file => file.endsWith('.prefab'))
        .map(file => path.join(directory, file));
}
console.log('\n=== v3 prefab/variant cold-roundtrip corpus ===');
const candidates = [
    ...findPrefabs(path.join(__dirname, '..', 'samples', 'prefabs')),
    ...findPrefabs(path.join(__dirname, '..', 'samples', 'variants')),
    ...findPrefabs(path.join(__dirname, '..', 'samples', 'fixtures', 'PrefabWorkflows_UIDemo')),
];
let tested = 0;
let readableReferenceCount = 0;
for (const prefabPath of candidates) {
    const source = fs.readFileSync(prefabPath, 'utf-8');
    const parsed = (0, unity_yaml_parser_1.parseUnityYaml)(source);
    if (parsed.type !== 'prefab' && parsed.type !== 'variant')
        continue;
    tested++;
    try {
        const result = (0, test_v3_utils_1.coldRoundTripV3)(source);
        readableReferenceCount += (result.v3Text.match(/\{"\$ref":"[^"]+"\}/g) || []).length;
        const difference = (0, test_v3_utils_1.describeSemanticDifference)(result.original, result.rebuilt);
        assert(!difference, `${path.basename(prefabPath)} semantic equality`, difference || '');
        const second = (0, test_v3_utils_1.coldRoundTripV3)(source);
        assert(second.rebuiltText === result.rebuiltText, `${path.basename(prefabPath)} deterministic canonical YAML`);
    }
    catch (error) {
        assert(false, `${path.basename(prefabPath)} cold-roundtrip`, String(error));
    }
}
assert(tested >= 19, 'v3 corpus includes local, nested, and variant prefabs', `tested=${tested}`);
assert(readableReferenceCount > 0, 'local internal references are exported as stable v3 machine references', `count=${readableReferenceCount}`);
console.log(`\nv3 prefab/variant cold-roundtrip corpus: ${passed} passed, ${failed} failed`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=test-v3-cold-roundtrip.js.map