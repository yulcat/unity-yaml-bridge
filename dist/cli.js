#!/usr/bin/env node
"use strict";
/**
 * CLI tool for unity-yaml-bridge.
 *
 * Usage:
 *   ubridge parse <file.prefab> [--project <path>] [--verbose]
 *   ubridge write <file.ubridge> --yaml <original.prefab> [-o <output.prefab>]
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
const compact_reader_1 = require("./compact-reader");
const compact_merger_1 = require("./compact-merger");
const unity_yaml_writer_1 = require("./unity-yaml-writer");
const guid_resolver_1 = require("./guid-resolver");
function usage() {
    console.log(`unity-yaml-bridge CLI

Usage:
  ubridge parse <file.prefab|.unity|.asset> [options]
    Convert a Unity YAML file to compact .ubridge format.

    Options:
      --project <path>   Unity project root for GUID/script resolution
      --verbose          Include all fields (disable boilerplate filtering)
      -o <file>          Output file (default: stdout)

  ubridge write <file.ubridge> --yaml <original.prefab> [options]
    Merge a .ubridge file back into the original Unity YAML.

    Options:
      --yaml <file>      Original Unity YAML file (required)
      -o <file>          Output file (default: stdout)

Examples:
  ubridge parse Button.prefab --project ./MyUnityProject
  ubridge parse Card_Variant.prefab --project ./MyUnityProject -o Card_Variant.ubridge
  ubridge write Card_Variant.ubridge --yaml Card_Variant.prefab -o Card_Variant_modified.prefab
`);
}
function die(msg) {
    console.error(`Error: ${msg}`);
    process.exit(1);
}
function parseArgs(argv) {
    const command = argv[0] || '';
    const args = [];
    const flags = new Map();
    let i = 1;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === '--project' || arg === '--yaml' || arg === '-o') {
            if (i + 1 >= argv.length)
                die(`${arg} requires a value`);
            flags.set(arg, argv[i + 1]);
            i += 2;
        }
        else if (arg === '--verbose') {
            flags.set('--verbose', 'true');
            i++;
        }
        else if (arg.startsWith('-')) {
            die(`Unknown flag: ${arg}`);
        }
        else {
            args.push(arg);
            i++;
        }
    }
    return { command, args, flags };
}
function cmdParse(args, flags) {
    if (args.length === 0)
        die('parse requires a file argument');
    const inputPath = path.resolve(args[0]);
    if (!fs.existsSync(inputPath))
        die(`File not found: ${inputPath}`);
    const options = {};
    // Set up GUID resolver if project path provided
    const projectPath = flags.get('--project');
    if (projectPath) {
        const resolved = path.resolve(projectPath);
        if (!fs.existsSync(resolved))
            die(`Project path not found: ${resolved}`);
        const resolver = new guid_resolver_1.GuidResolver();
        resolver.scanProject(resolved);
        options.guidResolver = resolver;
    }
    if (flags.has('--verbose')) {
        options.verbose = true;
    }
    // Parse and convert
    const content = fs.readFileSync(inputPath, 'utf-8');
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
    const compact = (0, compact_writer_1.writeCompact)(ast, options);
    // Output
    const outputPath = flags.get('-o');
    if (outputPath) {
        fs.writeFileSync(path.resolve(outputPath), compact, 'utf-8');
        console.error(`Written to ${outputPath}`);
    }
    else {
        process.stdout.write(compact);
    }
}
function cmdWrite(args, flags) {
    if (args.length === 0)
        die('write requires a .ubridge file argument');
    const ubridgePath = path.resolve(args[0]);
    if (!fs.existsSync(ubridgePath))
        die(`File not found: ${ubridgePath}`);
    const yamlPath = flags.get('--yaml');
    if (!yamlPath)
        die('write requires --yaml <original.prefab>');
    const resolvedYamlPath = path.resolve(yamlPath);
    if (!fs.existsSync(resolvedYamlPath))
        die(`YAML file not found: ${resolvedYamlPath}`);
    // Parse both files
    const ubridgeContent = fs.readFileSync(ubridgePath, 'utf-8');
    const yamlContent = fs.readFileSync(resolvedYamlPath, 'utf-8');
    const compactFile = (0, compact_reader_1.readCompact)(ubridgeContent);
    const ast = (0, unity_yaml_parser_1.parseUnityYaml)(yamlContent);
    // Merge and write
    const merged = (0, compact_merger_1.mergeCompactChanges)(ast, compactFile);
    const output = (0, unity_yaml_writer_1.writeUnityYaml)(merged);
    // Output
    const outputPath = flags.get('-o');
    if (outputPath) {
        fs.writeFileSync(path.resolve(outputPath), output, 'utf-8');
        console.error(`Written to ${outputPath}`);
    }
    else {
        process.stdout.write(output);
    }
}
// Main
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    process.exit(0);
}
const { command, args, flags } = parseArgs(argv);
switch (command) {
    case 'parse':
        cmdParse(args, flags);
        break;
    case 'write':
        cmdWrite(args, flags);
        break;
    default:
        die(`Unknown command: ${command}. Use 'parse' or 'write'.`);
}
//# sourceMappingURL=cli.js.map