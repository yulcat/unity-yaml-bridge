import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

let failed = 0;
function assert(condition: unknown, name: string, details = ''): void {
  if (condition) console.log(`  PASS: ${name}`);
  else {
    console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
    failed++;
  }
}

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

console.log('\n=== CLI release behavior ===');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-cli-test-'));
try {
  const prefab = path.join(__dirname, '..', 'samples', 'v3', 'MinimalHierarchy.source.prefab');
  const defaultParse = runCli(['parse', prefab], tempDir);
  assert(defaultParse.status === 0 && defaultParse.stdout.startsWith('# ubridge v3 | prefab'),
    'parse defaults to standalone v3',
    `status=${defaultParse.status}\nstdout=${defaultParse.stdout.slice(0, 120)}\nstderr=${defaultParse.stderr}`);

  for (const legacyVersion of ['v1', 'v2']) {
    const legacyParse = runCli(['parse', prefab, '--format', legacyVersion], tempDir);
    assert(legacyParse.status === 0 && legacyParse.stdout.startsWith(`# ubridge ${legacyVersion} | prefab`),
      `parse preserves explicit ${legacyVersion} output`,
      `status=${legacyParse.status}\nstdout=${legacyParse.stdout.slice(0, 120)}\nstderr=${legacyParse.stderr}`);
  }

  const help = runCli(['--help'], tempDir);
  assert(help.status === 0 && /ubridge compile <file\.ubridge> \[options\][\s\S]*?Options:\n      --project <path>/.test(help.stdout),
    'help documents compile --project', help.stdout);

  const malformedV3 = path.join(tempDir, 'malformed.ubridge');
  const protectedOutput = path.join(tempDir, 'protected.prefab');
  fs.writeFileSync(malformedV3, '# ubridge v3 | prefab\n--- STRUCTURE\nBroken @missing\n');
  fs.writeFileSync(protectedOutput, 'keep this output intact\n');
  const malformedCompile = runCli(['compile', malformedV3, '-o', protectedOutput], tempDir);
  assert(malformedCompile.status === 1,
    'malformed compile exits with status 1', `status=${malformedCompile.status}`);
  assert(/^Error: [^\n]+\n?$/.test(malformedCompile.stderr) && !malformedCompile.stderr.includes('    at '),
    'expected CLI errors are concise and omit Node stacks', malformedCompile.stderr);
  assert(fs.readFileSync(protectedOutput, 'utf8') === 'keep this output intact\n',
    'failed compile preserves an existing output file');

  const readOnlyDir = path.join(tempDir, 'read-only-output-dir');
  const atomicOutput = path.join(readOnlyDir, 'existing.ubridge');
  fs.mkdirSync(readOnlyDir);
  fs.writeFileSync(atomicOutput, 'old output\n');
  fs.chmodSync(atomicOutput, 0o666);
  fs.chmodSync(readOnlyDir, 0o555);
  const unwritableAtomicParse = runCli(['parse', prefab, '-o', atomicOutput], tempDir);
  fs.chmodSync(readOnlyDir, 0o755);
  assert(unwritableAtomicParse.status === 1,
    'output requires a writable sibling for atomic replacement',
    `status=${unwritableAtomicParse.status}\nstderr=${unwritableAtomicParse.stderr}`);
  assert(fs.readFileSync(atomicOutput, 'utf8') === 'old output\n',
    'failed atomic replacement preserves the old target');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`\nCLI release tests: ${failed === 0 ? 'all passed' : `${failed} failed`}`);
if (failed > 0) process.exit(1);
