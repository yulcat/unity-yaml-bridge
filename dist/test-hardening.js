"use strict";
/** Regression tests for v1 parsing and transactional merge hardening. */
Object.defineProperty(exports, "__esModule", { value: true });
const compact_reader_1 = require("./compact-reader");
const compact_merger_1 = require("./compact-merger");
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
function expectThrow(fn, text, name) {
    try {
        fn();
        assert(false, name, 'Expected an error, but none was thrown.');
    }
    catch (error) {
        assert(String(error.message).includes(text), name, String(error.message));
    }
}
const yaml = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Component:
  - component: {fileID: 200}
  - component: {fileID: 300}
  m_Name: Root
--- !u!4 &200
Transform:
  m_GameObject: {fileID: 100}
  m_Children: []
  m_Father: {fileID: 0}
--- !u!225 &300
CanvasGroup:
  m_GameObject: {fileID: 100}
  m_Alpha: 1
`;
function compact(details = '[Root:CanvasGroup]\nm_Alpha = 0.5', refs = 'Root = 100\nRoot:Transform = 200\nRoot:CanvasGroup = 300') {
    return `# ubridge v1 | prefab
--- STRUCTURE
Root [CanvasGroup]
--- DETAILS
${details}
--- REFS
${refs}
`;
}
console.log('\n=== v1 parser and merge hardening ===');
{
    const parsed = (0, compact_reader_1.readCompact)(`\uFEFF${compact()}`.replace(/\n/g, '\r\n'));
    assert(parsed.structure?.name === 'Root' && parsed.sections.length === 1, 'UTF-8 BOM and CRLF input parses normally');
}
expectThrow(() => (0, compact_reader_1.readCompact)(compact().replace('v1', 'v2')), 'Unsupported', 'unsupported versions fail closed');
expectThrow(() => (0, compact_reader_1.readCompact)(compact().replace('prefab', 'asset')), 'Invalid .ubridge header', 'unknown document types fail closed');
expectThrow(() => (0, compact_reader_1.readCompact)(`${compact()}--- DETAILS\n`), 'Duplicate', 'duplicate sections fail closed');
expectThrow(() => (0, compact_reader_1.readCompact)(compact().replace('--- DETAILS', '--- DETAILZ')), 'section order', 'misspelled required section fails closed');
expectThrow(() => (0, compact_reader_1.readCompact)(compact().replace('m_Alpha = 0.5', 'not a property')), 'Invalid DETAILS', 'malformed DETAILS lines fail closed');
expectThrow(() => (0, compact_reader_1.readCompact)(compact().replace('Root = 100', 'Root => 100')), 'Invalid REFS', 'malformed REFS lines fail closed');
{
    const original = (0, unity_yaml_parser_1.parseUnityYaml)(yaml);
    expectThrow(() => (0, compact_merger_1.mergeCompactChanges)(original, (0, compact_reader_1.readCompact)(compact().replace('Root [CanvasGroup]', 'Other [CanvasGroup]'))), 'root mismatch', 'compact files for another root are rejected');
    expectThrow(() => (0, compact_merger_1.mergeCompactChanges)(original, (0, compact_reader_1.readCompact)(compact(undefined, 'Root = 100\nRoot:Transform = 200\nRoot:CanvasGroup = 200'))), 'target type mismatch', 'REFS cannot redirect component edits to a Transform');
    expectThrow(() => (0, compact_merger_1.mergeCompactChanges)(original, (0, compact_reader_1.readCompact)(compact(undefined, 'Root = 100\nRoot:Transform = 200\nRoot:CanvasGroup = 999'))), 'does not exist', 'stale REFS targets are rejected');
    expectThrow(() => (0, compact_merger_1.mergeCompactChanges)(original, (0, compact_reader_1.readCompact)(compact('[Other:CanvasGroup]\nm_Alpha = 0.5', 'Root = 100\nRoot:Transform = 200\nOther:CanvasGroup = 300'))), 'target GameObject not found', 'a valid document ID cannot be relabeled as another GameObject path');
    expectThrow(() => (0, compact_merger_1.mergeCompactChanges)(original, (0, compact_reader_1.readCompact)(compact('[Root:CanvasGroup]\nm_Alpha = 0.5\n\n[Root:CanvasGroup]\nm_Alpha = 0.25', 'Root = 100\nRoot:Transform = 200\nRoot:CanvasGroup = 300\nRoot:CanvasGroup = 300'))), 'No unused REFS target', 'duplicate sections cannot reuse the same component target');
}
{
    const addition = (0, compact_reader_1.readCompact)(compact('[+ Root:BoxCollider]\nm_Enabled = 1', 'Root = 100\nRoot:Transform = 200\nRoot:CanvasGroup = 300').replace('Root [CanvasGroup]', 'Root [CanvasGroup, +BoxCollider]'));
    const refsBefore = JSON.stringify([...addition.refs]);
    const first = (0, compact_merger_1.mergeCompactChanges)((0, unity_yaml_parser_1.parseUnityYaml)(yaml), addition);
    const second = (0, compact_merger_1.mergeCompactChanges)((0, unity_yaml_parser_1.parseUnityYaml)(yaml), addition);
    assert(first.documents.some(doc => doc.typeId === 65) && second.documents.some(doc => doc.typeId === 65), 'the same parsed compact edit can be merged more than once');
    assert(JSON.stringify([...addition.refs]) === refsBefore, 'merge does not mutate caller-owned compact REFS');
}
console.log(`\nHardening tests: ${passed} passed, ${failed} failed`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=test-hardening.js.map