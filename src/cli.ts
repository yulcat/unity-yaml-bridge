#!/usr/bin/env node
/**
 * CLI tool for unity-yaml-bridge.
 *
 * Usage:
 *   ubridge parse <file.prefab> [--project <path>] [--verbose]
 *   ubridge compile <file.ubridge> [-o <output.prefab>]
 *   ubridge write <file.ubridge> --yaml <original.prefab> [--project <path>] [-o <output.prefab>]
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeCompact, CompactWriterOptions } from './compact-writer';
import { readCompact } from './compact-reader';
import { mergeCompactChanges } from './compact-merger';
import { writeUnityYaml } from './unity-yaml-writer';
import { GuidResolver } from './guid-resolver';
import { writeV3 } from './v3/writer';
import { readV3 } from './v3/reader';
import { compileV3 } from './v3/compiler';

function usage(): void {
  console.log(`unity-yaml-bridge CLI

Usage:
  ubridge --version
    Print the package version.

  ubridge parse <file.prefab|.unity|.asset> [options]
    Convert a Unity YAML file to compact .ubridge format.

    Options:
      --project <path>   Unity project root for GUID/script resolution
      --format <v1|v2|v3>  Compact format version (default: v3)
      --verbose          Include all fields (disable boilerplate filtering)
      -o <file>          Output file (default: stdout)

  ubridge compile <file.ubridge> [options]
    Compile a standalone v3 .ubridge document without an original YAML file.

    Options:
      --project <path>   Unity project root for GUID/script resolution
      -o <file>          Output file (default: stdout)

  ubridge write <file.ubridge> --yaml <original.prefab> [options]
    Merge a .ubridge file back into the original Unity YAML.

    Options:
      --yaml <file>      Original Unity YAML file (required)
      --project <path>   Unity project root for new script component resolution
      -o <file>          Output file (default: stdout)

Examples:
  ubridge parse Button.prefab --project ./MyUnityProject
  ubridge parse Button.prefab --format v3 -o Button.v3.ubridge
  ubridge compile Button.v3.ubridge -o Button.rebuilt.prefab
  ubridge parse Card_Variant.prefab --project ./MyUnityProject -o Card_Variant.ubridge
  ubridge write Card_Variant.ubridge --yaml Card_Variant.prefab -o Card_Variant_modified.prefab
`);
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function writeFileAtomic(outputPath: string, content: string): void {
  const resolved = path.resolve(outputPath);
  let existingMode: number | undefined;
  try {
    const destination = fs.lstatSync(resolved);
    if (destination.isFile()) existingMode = destination.mode & 0o777;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const tempPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      ...(existingMode === undefined ? {} : { mode: existingMode }),
    });
    if (existingMode !== undefined) fs.chmodSync(tempPath, existingMode);
    fs.renameSync(tempPath, resolved);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Map<string, string> } {
  const command = argv[0] || '';
  const args: string[] = [];
  const flags = new Map<string, string>();

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--project' || arg === '--yaml' || arg === '--format' || arg === '-o') {
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

function validateCommandArgs(command: string, args: string[], flags: Map<string, string>): void {
  const allowedFlags: Record<string, ReadonlySet<string>> = {
    parse: new Set(['--project', '--format', '--verbose', '-o']),
    compile: new Set(['--project', '-o']),
    write: new Set(['--yaml', '--project', '-o']),
  };
  const allowed = allowedFlags[command];
  if (!allowed) return;
  if (args.length > 1) die(`${command} accepts exactly one file argument`);
  for (const flag of flags.keys()) {
    if (!allowed.has(flag)) die(`${command} does not accept ${flag}`);
  }
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
  const format = flags.get('--format') || 'v3';
  if (format !== 'v1' && format !== 'v2' && format !== 'v3') {
    die('--format must be v1, v2, or v3');
  }

  // Parse and convert
  const content = fs.readFileSync(inputPath, 'utf-8');
  const ast = parseUnityYaml(content);
  let compact: string;
  if (format === 'v3') {
    compact = writeV3(ast, { sourceResolver: options.guidResolver });
  } else {
    options.version = format === 'v1' ? 1 : 2;
    compact = writeCompact(ast, options);
  }

  // Output
  const outputPath = flags.get('-o');
  if (outputPath) {
    writeFileAtomic(outputPath, compact);
    console.error(`Written to ${outputPath}`);
  } else {
    process.stdout.write(compact);
  }
}

function cmdCompile(args: string[], flags: Map<string, string>): void {
  if (args.length === 0) die('compile requires a v3 .ubridge file argument');
  if (flags.has('--yaml')) die('compile does not accept --yaml; v3 is standalone');

  const ubridgePath = path.resolve(args[0]);
  if (!fs.existsSync(ubridgePath)) die(`File not found: ${ubridgePath}`);
  const document = readV3(fs.readFileSync(ubridgePath, 'utf-8'));
  let resolver: GuidResolver | undefined;
  const projectPath = flags.get('--project');
  if (projectPath) {
    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) die(`Project path not found: ${resolved}`);
    resolver = new GuidResolver();
    resolver.scanProject(resolved);
  }
  const output = writeUnityYaml(compileV3(document, { sourceResolver: resolver }));
  const outputPath = flags.get('-o');
  if (outputPath) {
    writeFileAtomic(outputPath, output);
    console.error(`Written to ${outputPath}`);
  } else {
    process.stdout.write(output);
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
  let resolver: GuidResolver | undefined;
  const projectPath = flags.get('--project');
  if (projectPath) {
    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) die(`Project path not found: ${resolved}`);
    resolver = new GuidResolver();
    resolver.scanProject(resolved);
  }

  const merged = mergeCompactChanges(ast, compactFile, { guidResolver: resolver });
  const output = writeUnityYaml(merged);

  // Output
  const outputPath = flags.get('-o');
  if (outputPath) {
    writeFileAtomic(outputPath, output);
    console.error(`Written to ${outputPath}`);
  } else {
    process.stdout.write(output);
  }
}

// Main
function main(): void {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    if (argv.length > 1) die(`${argv[0]} does not accept operands`);
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
    );
    console.log(packageJson.version);
    return;
  }

  const { command, args, flags } = parseArgs(argv);
  validateCommandArgs(command, args, flags);

  switch (command) {
    case 'parse':
      cmdParse(args, flags);
      break;
    case 'write':
      cmdWrite(args, flags);
      break;
    case 'compile':
      cmdCompile(args, flags);
      break;
    default:
      die(`Unknown command: ${command}. Use 'parse', 'compile', or 'write'.`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
