#!/usr/bin/env node
/**
 * CLI tool for unity-yaml-bridge.
 *
 * Usage:
 *   ubridge parse <file.prefab> [--project <path>] [--verbose]
 *   ubridge write <file.ubridge> --yaml <original.prefab> [-o <output.prefab>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact, CompactWriterOptions } from './compact-writer';
import { readCompact } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import { writeUnityYaml } from './unity-yaml-writer';
import { GuidResolver } from './guid-resolver';

function usage(): void {
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

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Map<string, string> } {
  const command = argv[0] || '';
  const args: string[] = [];
  const flags = new Map<string, string>();

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--project' || arg === '--yaml' || arg === '-o') {
      if (i + 1 >= argv.length) die(`${arg} requires a value`);
      flags.set(arg, argv[i + 1]);
      i += 2;
    } else if (arg === '--verbose') {
      flags.set('--verbose', 'true');
      i++;
    } else if (arg.startsWith('-')) {
      die(`Unknown flag: ${arg}`);
    } else {
      args.push(arg);
      i++;
    }
  }

  return { command, args, flags };
}

function cmdParse(args: string[], flags: Map<string, string>): void {
  if (args.length === 0) die('parse requires a file argument');

  const inputPath = path.resolve(args[0]);
  if (!fs.existsSync(inputPath)) die(`File not found: ${inputPath}`);

  const options: CompactWriterOptions = {};

  // Set up GUID resolver if project path provided
  const projectPath = flags.get('--project');
  if (projectPath) {
    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) die(`Project path not found: ${resolved}`);
    const resolver = new GuidResolver();
    resolver.scanProject(resolved);
    options.guidResolver = resolver;
  }

  if (flags.has('--verbose')) {
    options.verbose = true;
  }

  // Parse and convert
  const content = fs.readFileSync(inputPath, 'utf-8');
  const ast = parseUnityYaml(content);
  const compact = writeCompact(ast, options);

  // Output
  const outputPath = flags.get('-o');
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), compact, 'utf-8');
    console.error(`Written to ${outputPath}`);
  } else {
    process.stdout.write(compact);
  }
}

function cmdWrite(args: string[], flags: Map<string, string>): void {
  if (args.length === 0) die('write requires a .ubridge file argument');

  const ubridgePath = path.resolve(args[0]);
  if (!fs.existsSync(ubridgePath)) die(`File not found: ${ubridgePath}`);

  const yamlPath = flags.get('--yaml');
  if (!yamlPath) die('write requires --yaml <original.prefab>');

  const resolvedYamlPath = path.resolve(yamlPath);
  if (!fs.existsSync(resolvedYamlPath)) die(`YAML file not found: ${resolvedYamlPath}`);

  // Parse both files
  const ubridgeContent = fs.readFileSync(ubridgePath, 'utf-8');
  const yamlContent = fs.readFileSync(resolvedYamlPath, 'utf-8');

  const compactFile = readCompact(ubridgeContent);
  const ast = parseUnityYaml(yamlContent);

  // Merge and write
  const merged = mergeCompactChanges(ast, compactFile);
  const output = writeUnityYaml(merged);

  // Output
  const outputPath = flags.get('-o');
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), output, 'utf-8');
    console.error(`Written to ${outputPath}`);
  } else {
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
