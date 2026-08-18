#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ubridge-packed-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  if (options.expectStatus === undefined && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

try {
  const packDir = path.join(tempRoot, 'pack');
  const consumerDir = path.join(tempRoot, 'consumer');
  fs.mkdirSync(packDir);
  fs.mkdirSync(consumerDir);
  fs.writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify({ private: true }));

  const packed = run('npm', ['pack', '--json', '--pack-destination', packDir]);
  const packInfo = JSON.parse(packed.stdout);
  assert.strictEqual(packInfo.length, 1, 'npm pack should create exactly one tarball');
  const tarball = path.join(packDir, packInfo[0].filename);
  assert.ok(fs.existsSync(tarball), 'reported tarball should exist');

  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumerDir });

  const installedRoot = path.join(consumerDir, 'node_modules', 'unity-yaml-bridge');
  const manifest = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  assert.strictEqual(manifest.version, '2.0.0');
  assert.strictEqual(manifest.type, 'commonjs');
  assert.strictEqual(manifest.sideEffects, false);
  assert.ok(manifest.exports && manifest.exports['.'], 'root package export should be declared');
  assert.ok(fs.existsSync(path.join(installedRoot, 'dist', 'index.d.ts')), 'root declarations should be packed');
  for (const releaseFile of ['LICENSE', 'CHANGELOG.md', 'docs/MIGRATING_1_TO_2.md']) {
    assert.ok(fs.existsSync(path.join(installedRoot, releaseFile)), `${releaseFile} should be packed`);
  }

  const apiProbe = run(process.execPath, ['-e', `
    const api = require('unity-yaml-bridge');
    for (const name of ['parseUnityYaml', 'writeCompact', 'readCompact', 'mergeCompactChanges',
      'writeUnityYaml', 'readV3', 'writeV3', 'compileV3']) {
      if (typeof api[name] !== 'function') throw new Error('missing CJS export: ' + name);
    }
    if (api.V3_STABLE_PROFILE !== 'unity-generic-v1') {
      throw new Error('missing canonical V3_STABLE_PROFILE export');
    }
  `], { cwd: consumerDir });
  assert.strictEqual(apiProbe.stderr, '');

  fs.writeFileSync(path.join(consumerDir, 'types-probe.ts'), `
    import { parseUnityYaml, writeV3, readV3, compileV3, V3Document,
      V3_STABLE_PROFILE, V3StableProfile } from 'unity-yaml-bridge';
    const parsed = parseUnityYaml('%YAML 1.1\\n');
    const text: string = writeV3(parsed);
    const document: V3Document = readV3(text);
    const profile: V3StableProfile = V3_STABLE_PROFILE;
    if (document.profile !== profile) throw new Error('unexpected v3 profile');
    compileV3(document);
  `);
  run(process.execPath, [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2020',
    '--module', 'Node16', '--moduleResolution', 'Node16', 'types-probe.ts'], { cwd: consumerDir });

  const cli = path.join(consumerDir, 'node_modules', '.bin', 'ubridge');
  const version = run(cli, ['--version'], { cwd: consumerDir });
  assert.strictEqual(version.stdout.trim(), '2.0.0');

  const fixture = path.join(consumerDir, 'MinimalHierarchy.prefab');
  fs.copyFileSync(path.join(repoRoot, 'samples', 'v3', 'MinimalHierarchy.source.prefab'), fixture);
  const parsedV3 = run(cli, ['parse', fixture], { cwd: consumerDir });
  assert.ok(parsedV3.stdout.startsWith('# ubridge v3 | prefab'), 'packed CLI parse should default to v3');

  const parsedV2 = run(cli, ['parse', fixture, '--format', 'v2'], { cwd: consumerDir });
  assert.ok(parsedV2.stdout.startsWith('# ubridge v2 | prefab'), 'packed CLI should retain explicit v2');

  const v3File = path.join(consumerDir, 'MinimalHierarchy.ubridge');
  fs.writeFileSync(v3File, parsedV3.stdout);
  const compiledA = run(cli, ['compile', v3File], { cwd: consumerDir });
  const compiledB = run(cli, ['compile', v3File], { cwd: consumerDir });
  assert.strictEqual(compiledA.stdout, compiledB.stdout, 'packed compile output should be deterministic');
  assert.ok(compiledA.stdout.startsWith('%YAML 1.1'), 'packed compile should emit Unity YAML');

  const malformed = path.join(consumerDir, 'malformed.ubridge');
  const protectedOutput = path.join(consumerDir, 'protected.prefab');
  fs.writeFileSync(malformed, '# ubridge v3 | prefab\n--- STRUCTURE\nBroken @missing\n');
  fs.writeFileSync(protectedOutput, 'preserve me\n');
  const failed = run(cli, ['compile', malformed, '-o', protectedOutput], {
    cwd: consumerDir,
    expectStatus: 1,
  });
  assert.strictEqual(failed.status, 1);
  assert.match(failed.stderr, /^Error: [^\n]+\n?$/);
  assert.ok(!failed.stderr.includes('    at '), 'malformed packed CLI error should omit stack traces');
  assert.strictEqual(fs.readFileSync(protectedOutput, 'utf8'), 'preserve me\n');

  console.log(`Packed boundary passed: ${path.basename(tarball)}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
