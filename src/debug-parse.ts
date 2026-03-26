import * as fs from 'fs';
import * as path from 'path';
import { parseUnityYaml } from './unity-yaml-parser';

const file = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
const content = fs.readFileSync(file, 'utf-8');
const ast = parseUnityYaml(content);

// Debug: show all documents
for (const doc of ast.documents) {
  console.log(`--- ${doc.typeName} &${doc.fileId} ${doc.stripped ? 'stripped' : ''}`);
  if (doc.typeId === 224 || doc.typeId === 4) {
    console.log(`  m_GameObject: ${JSON.stringify(doc.properties.m_GameObject)}`);
    console.log(`  m_Children: ${JSON.stringify(doc.properties.m_Children)}`);
    console.log(`  m_Father: ${JSON.stringify(doc.properties.m_Father)}`);
  }
  if (doc.typeId === 1) {
    console.log(`  m_Name: ${doc.properties.m_Name}`);
    console.log(`  m_Component: ${JSON.stringify(doc.properties.m_Component)}`);
  }
}

console.log('\n--- Hierarchy ---');
if (ast.hierarchy) {
  function printNode(node: any, indent: string) {
    console.log(`${indent}${node.name} (${node.fileId}) children=${node.children.length}`);
    for (const child of node.children) {
      printNode(child, indent + '  ');
    }
  }
  printNode(ast.hierarchy, '');
}
