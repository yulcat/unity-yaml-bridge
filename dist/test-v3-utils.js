"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coldRoundTripV3 = coldRoundTripV3;
exports.describeSemanticDifference = describeSemanticDifference;
const compiler_1 = require("./v3/compiler");
const reader_1 = require("./v3/reader");
const semantic_normalizer_1 = require("./v3/semantic-normalizer");
const writer_1 = require("./v3/writer");
const unity_yaml_parser_1 = require("./unity-yaml-parser");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
/** The only input crossing the cold boundary is serialized v3 text. */
function coldRoundTripV3(yaml) {
    const original = (0, unity_yaml_parser_1.parseUnityYaml)(yaml);
    const v3Text = (0, writer_1.writeV3)(original);
    // Do not pass yaml or original to either readV3 or compileV3.
    const rebuiltText = (0, unity_yaml_writer_1.writeUnityYaml)((0, compiler_1.compileV3)((0, reader_1.readV3)(String(v3Text))));
    const rebuilt = (0, unity_yaml_parser_1.parseUnityYaml)(rebuiltText);
    return { original, v3Text, rebuiltText, rebuilt };
}
function describeSemanticDifference(expected, actual) {
    const difference = (0, semantic_normalizer_1.compareLocalPrefabSemantics)(expected, actual);
    if (!difference)
        return null;
    return `${difference.path}: expected ${JSON.stringify(difference.expected)}, ` +
        `actual ${JSON.stringify(difference.actual)}`;
}
//# sourceMappingURL=test-v3-utils.js.map