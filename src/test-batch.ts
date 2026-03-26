/**
 * Batch round-trip test: find all .prefab files, parse -> writeUnityYaml -> compare line-by-line.
 * Reports a summary table with file name, document count, type, differing lines, total lines.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively find all files matching a given extension under a directory */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

interface TestResult {
  file: string;           // short display name
  fullPath: string;       // absolute path
  docCount: number;
  fileType: string;
  diffLines: number;
  totalLines: number;
  error?: string;
  sampleDiffs?: string[]; // first few diff examples
}

function testFile(filePath: string, baseDir: string): TestResult {
  const shortName = path.relative(baseDir, filePath);
  const result: TestResult = {
    file: shortName,
    fullPath: filePath,
    docCount: 0,
    fileType: '?',
    diffLines: 0,
    totalLines: 0,
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = parseUnityYaml(content);

    result.docCount = ast.documents.length;
    result.fileType = ast.type;

    const roundTripped = writeUnityYaml(ast);

    // Compare line-by-line (trim trailing whitespace for fair comparison)
    const origLines = content.split('\n').map(l => l.trimEnd());
    const rtLines = roundTripped.split('\n').map(l => l.trimEnd());

    const maxLines = Math.max(origLines.length, rtLines.length);
    result.totalLines = maxLines;

    const sampleDiffs: string[] = [];
    for (let i = 0; i < maxLines; i++) {
      const orig = origLines[i] || '';
      const rt = rtLines[i] || '';
      if (orig !== rt) {
        result.diffLines++;
        if (sampleDiffs.length < 5) {
          sampleDiffs.push(
            `  L${i + 1}:\n    ORIG: ${orig.substring(0, 120)}\n    RT:   ${rt.substring(0, 120)}`
          );
        }
      }
    }
    result.sampleDiffs = sampleDiffs;
  } catch (err: any) {
    result.error = err.message || String(err);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

// Directory 1: PrefabWorkflows_UIDemo (all files)
const uiDemoBase = path.join(
  SAMPLES_DIR,
  'unity-projects',
  'PrefabWorkflows_UIDemo',
  'PrefabWorkflows_UIDemo_Project',
  'Assets'
);

// Directory 2: open-project-1 (sample of files)
const openProjBase = path.join(
  SAMPLES_DIR,
  'unity-projects',
  'open-project-1',
  'UOP1_Project',
  'Assets'
);

console.log('================================================================');
console.log('  Unity YAML Bridge — Batch Round-Trip Test');
console.log('================================================================\n');

// ── Gather files ─────────────────────────────────────────────────────────────

const uiDemoFiles = findFiles(uiDemoBase, '.prefab').sort();
console.log(`Found ${uiDemoFiles.length} .prefab files in PrefabWorkflows_UIDemo\n`);

const openProjFiles = findFiles(openProjBase, '.prefab').sort();
console.log(`Found ${openProjFiles.length} .prefab files in open-project-1`);

// Pick a representative sample from open-project-1: first 20 + every 20th after that
let openProjSample: string[] = [];
if (openProjFiles.length > 0) {
  // Take first 20
  openProjSample = openProjFiles.slice(0, 20);
  // Then every 20th file for broader coverage
  for (let i = 20; i < openProjFiles.length; i += 20) {
    openProjSample.push(openProjFiles[i]);
  }
  // Deduplicate (in case overlap)
  openProjSample = [...new Set(openProjSample)];
  console.log(`  Selected ${openProjSample.length} sample files for testing\n`);
}

// ── Run tests ────────────────────────────────────────────────────────────────

const allResults: TestResult[] = [];

console.log('--- Testing PrefabWorkflows_UIDemo ---\n');
for (const f of uiDemoFiles) {
  const r = testFile(f, uiDemoBase);
  allResults.push(r);
  const status = r.error ? 'ERROR' : (r.diffLines === 0 ? 'PASS' : `DIFF:${r.diffLines}`);
  process.stdout.write(`  [${status.padEnd(10)}] ${r.file}\n`);
}

if (openProjSample.length > 0) {
  console.log('\n--- Testing open-project-1 (sample) ---\n');
  for (const f of openProjSample) {
    const r = testFile(f, openProjBase);
    allResults.push(r);
    const status = r.error ? 'ERROR' : (r.diffLines === 0 ? 'PASS' : `DIFF:${r.diffLines}`);
    process.stdout.write(`  [${status.padEnd(10)}] ${r.file}\n`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n\n================================================================');
console.log('  SUMMARY');
console.log('================================================================\n');

const passed = allResults.filter(r => !r.error && r.diffLines === 0);
const withDiffs = allResults.filter(r => !r.error && r.diffLines > 0);
const errors = allResults.filter(r => !!r.error);

console.log(`Total files tested: ${allResults.length}`);
console.log(`  PASS (0 diffs):   ${passed.length}`);
console.log(`  WITH DIFFS:       ${withDiffs.length}`);
console.log(`  ERRORS:           ${errors.length}`);

// Print table header
console.log('\n' + '-'.repeat(110));
console.log(
  'File'.padEnd(55) +
  'Docs'.padStart(6) +
  'Type'.padStart(10) +
  'Diff'.padStart(8) +
  'Total'.padStart(8) +
  '  Status'
);
console.log('-'.repeat(110));

for (const r of allResults) {
  const shortFile = r.file.length > 52 ? '...' + r.file.slice(-49) : r.file;
  const status = r.error ? 'ERROR' : (r.diffLines === 0 ? 'PASS' : 'DIFF');

  console.log(
    shortFile.padEnd(55) +
    String(r.docCount).padStart(6) +
    r.fileType.padStart(10) +
    String(r.diffLines).padStart(8) +
    String(r.totalLines).padStart(8) +
    '  ' + status
  );
}

console.log('-'.repeat(110));

// ── Detail on files with diffs ───────────────────────────────────────────────

if (withDiffs.length > 0) {
  console.log('\n\n================================================================');
  console.log('  FILES WITH DIFFS — Details');
  console.log('================================================================\n');

  for (const r of withDiffs) {
    console.log(`--- ${r.file} ---`);
    console.log(`  Documents: ${r.docCount}, Type: ${r.fileType}`);
    console.log(`  Differing lines: ${r.diffLines} / ${r.totalLines}`);
    if (r.sampleDiffs && r.sampleDiffs.length > 0) {
      console.log('  Sample diffs:');
      for (const d of r.sampleDiffs) {
        console.log(d);
      }
    }
    console.log('');
  }
}

// ── Detail on errors ─────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.log('\n\n================================================================');
  console.log('  ERRORS — Details');
  console.log('================================================================\n');

  for (const r of errors) {
    console.log(`--- ${r.file} ---`);
    console.log(`  Error: ${r.error}`);
    console.log('');
  }
}

// ── Final stats ──────────────────────────────────────────────────────────────

const totalDiffLines = allResults.reduce((s, r) => s + r.diffLines, 0);
const totalLines = allResults.reduce((s, r) => s + r.totalLines, 0);
const diffRate = totalLines > 0 ? ((totalDiffLines / totalLines) * 100).toFixed(3) : '0.000';

console.log('\n================================================================');
console.log(`  Overall diff rate: ${totalDiffLines} / ${totalLines} lines (${diffRate}%)`);
console.log('================================================================\n');
