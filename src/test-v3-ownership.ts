import * as fs from 'fs';
import * as path from 'path';
import { compileV3 } from './v3/compiler';
import { readV3 } from './v3/reader';
import { writeV3 } from './v3/writer';
import { parseUnityYaml } from './unity-yaml-parser';
import { writeUnityYaml } from './unity-yaml-writer';

let passed = 0;
let failed = 0;

function assert(condition: unknown, name: string, details = ''): void {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.error(`  FAIL: ${name}${details ? `\n${details}` : ''}`);
    failed++;
  }
}

function sample(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, '..', 'samples', ...parts), 'utf-8');
}

function compileText(v3Text: string) {
  return parseUnityYaml(writeUnityYaml(compileV3(readV3(v3Text))));
}

function buttonV3() {
  return readV3(writeV3(parseUnityYaml(sample('prefabs', 'Button.prefab'))));
}

console.log('\n=== v3 ownership cold-boundary edits ===');

{
  const v3Text = writeV3(parseUnityYaml(sample('variants', 'Ellen_Variant.prefab')));
  const document = readV3(v3Text);
  assert(document.kind === 'variant' && !!document.variantRootId &&
         v3Text.includes('(variant @p1 source:a5674d01884853d4e8f2386a171e14d9)'),
    'variant source and root PrefabInstance are explicit in v3 STRUCTURE');

  const details: any = document.details.get(document.variantRootId!);
  const modifications: any[] = details.m_Modification.m_Modifications;
  const name = modifications.find(modification => modification.propertyPath === 'm_Name');
  assert(name?.value === 'Ellen', 'variant name override is present in standalone DETAILS');
  name.value = 'Ellen_v3_edited';

  // Only the parsed v3 document enters compileV3.
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rebuiltName = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name');
  assert(rebuiltName?.value === 'Ellen_v3_edited',
    'variant delta edit compiles without the original variant YAML');
  assert(rebuilt.variantSource?.guid === 'a5674d01884853d4e8f2386a171e14d9',
    'variant source GUID survives standalone compilation');
}

{
  const v3Text = writeV3(parseUnityYaml(sample('prefabs', 'RootPrefabInstance.prefab')));
  const document = readV3(v3Text);
  const unowned = [...document.identity.values()].filter(identity =>
    identity.kind === 'owned' && !identity.ownerId
  );
  assert(unowned.length === 0,
    'variant added-object documents have explicit PrefabInstance ownership');
}

{
  const document = buttonV3();
  const nested = document.structure!.children.find(child => !!child.nestedSourceGuid)!;
  nested.name = 'Button_Text_Renamed';
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const nameOverride = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name');
  assert(nameOverride?.value === 'Button_Text_Renamed',
    'renaming a nested STRUCTURE node rewrites its PrefabInstance name override');
}

{
  const document = buttonV3();
  document.structure!.children.reverse();
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rootTransform = rebuilt.documents.find(item =>
    (item.typeId === 4 || item.typeId === 224) && String(item.properties.m_Father?.fileID) === '0'
  )!;
  const nestedRoot = rebuilt.documents.find(item => item.stripped &&
    item.typeId === 224 && item.properties.m_PrefabInstance?.fileID !== 0)!;
  const rootOrder = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_RootOrder');
  assert(String(rootTransform.properties.m_Children[0].fileID) === nestedRoot.fileId &&
         rootOrder?.value === '0',
    'reordering nested STRUCTURE rewrites parent children and m_RootOrder');
}

{
  const document = buttonV3();
  const root = document.structure!;
  const nestedIndex = root.children.findIndex(child => !!child.nestedSourceGuid);
  const [nested] = root.children.splice(nestedIndex, 1);
  const background = root.children[0];
  background.children.push(nested);
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const backgroundIdentity = document.identity.get(background.machineId)!;
  const backgroundTransform = [...document.identity.values()].find(identity =>
    identity.kind === 'transform' && identity.ownerId === backgroundIdentity.machineId
  )!;
  const instance = rebuilt.documents.find(item => item.typeId === 1001)!;
  assert(String(instance.properties.m_Modification.m_TransformParent.fileID) === backgroundTransform.fileId,
    'reparenting nested STRUCTURE rewrites PrefabInstance m_TransformParent');
}

{
  const document = buttonV3();
  document.structure!.children = document.structure!.children.filter(child => !child.nestedSourceGuid);
  (document.details.get('c1') as any).activateDisplayText = { fileID: 0 };
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  assert(!rebuilt.documents.some(item => item.typeId === 1001 || item.stripped),
    'deleting nested STRUCTURE removes its PrefabInstance and stripped ownership documents');
}

{
  const v3Text = writeV3(parseUnityYaml(sample('prefabs', 'Button.prefab')));
  const document = readV3(v3Text);
  const instance = [...document.identity.values()]
    .find(identity => identity.kind === 'prefabInstance');
  assert(!!instance && v3Text.includes(`Button_Text @${instance?.machineId} {source:`),
    'nested PrefabInstance is visible in regular-prefab STRUCTURE');

  const details: any = document.details.get(instance!.machineId);
  const modifications: any[] = details.m_Modification.m_Modifications;
  const name = modifications.find(modification => modification.propertyPath === 'm_Name');
  name.value = 'Button_Text_v3';
  const rebuilt = parseUnityYaml(writeUnityYaml(compileV3(document)));
  const rebuiltName = rebuilt.prefabInstances[0].modifications
    .find(modification => modification.propertyPath === 'm_Name');
  assert(rebuiltName?.value === 'Button_Text_v3',
    'nested PrefabInstance override edit compiles across the cold boundary');
  assert(rebuilt.documents.filter(item => item.stripped).length === 2,
    'nested stripped identity documents are reconstructed');
}

{
  const original = sample('prefabs', 'RootPrefabInstance.prefab');
  const first = compileText(writeV3(parseUnityYaml(original)));
  const secondText = writeUnityYaml(compileV3(readV3(writeV3(parseUnityYaml(original)))));
  assert(first.type === 'variant' && first.hierarchy?.children.length === 4 &&
         first.documents.length === 53,
    'variant with added root objects is independently reconstructed');
  assert(writeUnityYaml(first) === secondText,
    'variant ownership compilation is deterministic');
}

console.log(`\nv3 ownership tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
