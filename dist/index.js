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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareLocalPrefabSemantics = exports.normalizeLocalPrefab = exports.compileV3 = exports.writeV3 = exports.readV3 = exports.GuidResolver = exports.writeUnityYaml = exports.mergeCompactChanges = exports.parseCompactValue = exports.readCompact = exports.writeCompact = exports.parseUnityYaml = void 0;
var unity_yaml_parser_1 = require("./unity-yaml-parser");
Object.defineProperty(exports, "parseUnityYaml", { enumerable: true, get: function () { return unity_yaml_parser_1.parseUnityYaml; } });
var compact_writer_1 = require("./compact-writer");
Object.defineProperty(exports, "writeCompact", { enumerable: true, get: function () { return compact_writer_1.writeCompact; } });
var compact_reader_1 = require("./compact-reader");
Object.defineProperty(exports, "readCompact", { enumerable: true, get: function () { return compact_reader_1.readCompact; } });
Object.defineProperty(exports, "parseCompactValue", { enumerable: true, get: function () { return compact_reader_1.parseCompactValue; } });
var compact_merger_1 = require("./compact-merger");
Object.defineProperty(exports, "mergeCompactChanges", { enumerable: true, get: function () { return compact_merger_1.mergeCompactChanges; } });
var unity_yaml_writer_1 = require("./unity-yaml-writer");
Object.defineProperty(exports, "writeUnityYaml", { enumerable: true, get: function () { return unity_yaml_writer_1.writeUnityYaml; } });
var guid_resolver_1 = require("./guid-resolver");
Object.defineProperty(exports, "GuidResolver", { enumerable: true, get: function () { return guid_resolver_1.GuidResolver; } });
var reader_1 = require("./v3/reader");
Object.defineProperty(exports, "readV3", { enumerable: true, get: function () { return reader_1.readV3; } });
var writer_1 = require("./v3/writer");
Object.defineProperty(exports, "writeV3", { enumerable: true, get: function () { return writer_1.writeV3; } });
var compiler_1 = require("./v3/compiler");
Object.defineProperty(exports, "compileV3", { enumerable: true, get: function () { return compiler_1.compileV3; } });
var semantic_normalizer_1 = require("./v3/semantic-normalizer");
Object.defineProperty(exports, "normalizeLocalPrefab", { enumerable: true, get: function () { return semantic_normalizer_1.normalizeLocalPrefab; } });
Object.defineProperty(exports, "compareLocalPrefabSemantics", { enumerable: true, get: function () { return semantic_normalizer_1.compareLocalPrefabSemantics; } });
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map