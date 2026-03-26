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
exports.GuidResolver = exports.writeUnityYaml = exports.mergeCompactChanges = exports.parseCompactValue = exports.readCompact = exports.writeCompact = exports.parseUnityYaml = void 0;
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
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map