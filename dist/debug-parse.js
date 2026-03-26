"use strict";
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
const file = path.join(__dirname, '..', 'samples', 'prefabs', 'Button.prefab');
const content = fs.readFileSync(file, 'utf-8');
const ast = (0, unity_yaml_parser_1.parseUnityYaml)(content);
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
    function printNode(node, indent) {
        console.log(`${indent}${node.name} (${node.fileId}) children=${node.children.length}`);
        for (const child of node.children) {
            printNode(child, indent + '  ');
        }
    }
    printNode(ast.hierarchy, '');
}
//# sourceMappingURL=debug-parse.js.map