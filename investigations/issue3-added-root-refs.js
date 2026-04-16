#!/usr/bin/env node

const path = require('path');

const moduleRoot = process.env.UBRIDGE_BUILD_DIR
  ? path.resolve(process.env.UBRIDGE_BUILD_DIR)
  : path.resolve(__dirname, '../dist');

const { readCompact } = require(path.join(moduleRoot, 'compact-reader'));
const { mergeCompactChanges } = require(path.join(moduleRoot, 'compact-merger'));
const { parseUnityYaml } = require(path.join(moduleRoot, 'unity-yaml-parser'));
const { writeUnityYaml } = require(path.join(moduleRoot, 'unity-yaml-writer'));

const BASE_GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SCRIPT_GUID = 'f70555f144d8491a825f0804e09c671c';

let total = 0;
let passed = 0;
const results = [];

function record(name, status, detail) {
  total++;
  if (status === 'PASS' || status === 'EXPECTED_FAIL') passed++;
  results.push({ name, status, detail });
  const suffix = detail ? `\n    ${detail}` : '';
  console.log(`  ${status}: ${name}${suffix}`);
}

function assertPass(name, condition, detail) {
  record(name, condition ? 'PASS' : 'FAIL', condition ? undefined : detail);
}

function variantWithAddedReferenceDocsYaml() {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &900
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications: []
    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${BASE_GUID}, type: 3}
--- !u!1 &1000
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1100}
  - component: {fileID: 1200}
  m_Layer: 0
  m_Name: Source
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &1100
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &1200
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SCRIPT_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  targetRef: {fileID: 1600}
  targetRefs:
  - {fileID: 1600}
--- !u!1 &1500
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1550}
  - component: {fileID: 1600}
  m_Layer: 0
  m_Name: Target
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &1550
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1500}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &1600
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1500}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${SCRIPT_GUID}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
`;
}

function compactWith(detailsBody, refsBody) {
  return `# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
__added_root__
├─ + Source [${SCRIPT_GUID}]
└─ + Target [${SCRIPT_GUID}]
--- DETAILS

[Source:${SCRIPT_GUID}]
${detailsBody}
--- REFS
__instance = 900
${refsBody}
`;
}

function runWrite(compactText) {
  const ast = parseUnityYaml(variantWithAddedReferenceDocsYaml());
  const compact = readCompact(compactText);
  const merged = mergeCompactChanges(ast, compact);
  const sourceDoc = merged.documents.find(doc => doc.fileId === '1200');
  return { yaml: writeUnityYaml(merged), sourceDoc };
}

function tryWrite(compactText) {
  try {
    return { ok: true, result: runWrite(compactText) };
  } catch (error) {
    return { ok: false, error };
  }
}

function fileIdOf(value) {
  return value && typeof value === 'object' && 'fileID' in value ? String(value.fileID) : String(value);
}

console.log('\n=== Issue #3 added-root reference investigation ===\n');

{
  console.log('Guardrails that should pass today');
  const refs = `Source:${SCRIPT_GUID} = 1200
Target:${SCRIPT_GUID} = 1600`;
  const scalar = runWrite(compactWith(`targetRef = ->Target:${SCRIPT_GUID}`, refs));
  assertPass(
    'non-prefixed scalar -> reference resolves through non-prefixed REFS',
    fileIdOf(scalar.sourceDoc.properties.targetRef) === '1600',
    `got ${fileIdOf(scalar.sourceDoc.properties.targetRef)}`
  );

  const array = runWrite(compactWith(`targetRefs = [->Target:${SCRIPT_GUID}, ->Target:${SCRIPT_GUID}]`, refs));
  const arrayRefs = array.sourceDoc.properties.targetRefs || [];
  assertPass(
    'non-prefixed array -> references resolve through non-prefixed REFS',
    Array.isArray(arrayRefs) && arrayRefs.length === 2 && arrayRefs.every(ref => fileIdOf(ref) === '1600'),
    `got ${JSON.stringify(arrayRefs)}`
  );

  const alias = runWrite(compactWith(`targetRef = @Target:${SCRIPT_GUID}`, refs));
  assertPass(
    '@ alias resolves when DETAILS and REFS use the same non-prefixed key',
    fileIdOf(alias.sourceDoc.properties.targetRef) === '1600',
    `got ${fileIdOf(alias.sourceDoc.properties.targetRef)}`
  );

  const prefixedRefs = `Source:${SCRIPT_GUID} = 1200
__added_root__/Target:${SCRIPT_GUID} = 1600`;
  const prefixed = runWrite(compactWith(`targetRef = ->__added_root__/Target:${SCRIPT_GUID}`, prefixedRefs));
  assertPass(
    'prefixed scalar -> reference resolves when REFS contains the matching prefixed key',
    fileIdOf(prefixed.sourceDoc.properties.targetRef) === '1600',
    `got ${fileIdOf(prefixed.sourceDoc.properties.targetRef)}`
  );
}

{
  console.log('\nPreviously failing mixed-prefix cases');
  const refs = `Source:${SCRIPT_GUID} = 1200
Target:${SCRIPT_GUID} = 1600`;

  const scalar = tryWrite(compactWith(`targetRef = ->__added_root__/Target:${SCRIPT_GUID}`, refs));
  assertPass(
    'no-edit scalar ->__added_root__/ reference with non-prefixed REFS preserves fileID 1600',
    scalar.ok && fileIdOf(scalar.result.sourceDoc.properties.targetRef) === '1600',
    scalar.ok
      ? `resolved to ${fileIdOf(scalar.result.sourceDoc.properties.targetRef)}`
      : `threw ${scalar.error.message}`
  );

  const array = tryWrite(compactWith(`targetRefs = [->__added_root__/Target:${SCRIPT_GUID}, ->__added_root__/Target:${SCRIPT_GUID}]`, refs));
  const arrayRefs = array.ok ? array.result.sourceDoc.properties.targetRefs || [] : [];
  assertPass(
    'array ->__added_root__/ references with non-prefixed REFS preserve fileID 1600',
    array.ok && Array.isArray(arrayRefs) && arrayRefs.every(ref => fileIdOf(ref) === '1600'),
    array.ok ? `resolved to ${JSON.stringify(arrayRefs)}` : `threw ${array.error.message}`
  );

  const alias = tryWrite(compactWith(`targetRef = @__added_root__/Target:${SCRIPT_GUID}`, refs));
  assertPass(
    '@__added_root__/ alias with non-prefixed REFS preserves fileID 1600',
    alias.ok && fileIdOf(alias.result.sourceDoc.properties.targetRef) === '1600',
    alias.ok ? `resolved to ${fileIdOf(alias.result.sourceDoc.properties.targetRef)}` : `threw ${alias.error.message}`
  );

  const prefixedSection = readCompact(`# ubridge v1 | variant | base-guid:${BASE_GUID}
--- STRUCTURE
__added_root__
├─ + Source [${SCRIPT_GUID}]
└─ + Target [${SCRIPT_GUID}]
--- DETAILS

[__added_root__/Source:${SCRIPT_GUID}]
targetRef = ->__added_root__/Target:${SCRIPT_GUID}
targetRefs = [->__added_root__/Target:${SCRIPT_GUID}, ->__added_root__/Target:${SCRIPT_GUID}]
--- REFS
__instance = 900
Source:${SCRIPT_GUID} = 1200
Target:${SCRIPT_GUID} = 1600
`);
  const ast = parseUnityYaml(variantWithAddedReferenceDocsYaml());
  const merged = mergeCompactChanges(ast, prefixedSection);
  const sourceDoc = merged.documents.find(doc => doc.fileId === '1200');
  const prefixedSectionRefs = sourceDoc.properties.targetRefs || [];
  assertPass(
    'prefixed DETAILS section header matches non-prefixed REFS during variant write-back',
    Array.isArray(prefixedSectionRefs) &&
      prefixedSectionRefs.length === 2 &&
      prefixedSectionRefs.every(ref => fileIdOf(ref) === '1600'),
    `resolved to ${JSON.stringify(prefixedSectionRefs)}`
  );
}

console.log('\nSummary');
for (const status of ['PASS', 'FAIL']) {
  const count = results.filter(result => result.status === status).length;
  if (count > 0) console.log(`  ${status}: ${count}`);
}
console.log(`  accepted: ${passed}/${total}`);

const hardFailures = results.filter(result => result.status === 'FAIL');
process.exit(hardFailures.length === 0 ? 0 : 1);
