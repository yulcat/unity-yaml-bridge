"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeV3 = writeV3;
const value_1 = require("./value");
const STRUCTURAL_FIELDS = new Set([
    'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
    'm_GameObject', 'm_Father', 'm_Children', 'm_RootOrder', 'm_Component',
    'm_Name', 'm_Script',
]);
function writeV3(file, options = {}) {
    if (file.type !== 'prefab' || !file.hierarchy) {
        throw new Error('writeV3 currently supports local regular prefabs only.');
    }
    if (file.prefabInstances.length > 0 || file.documents.some(document => document.stripped)) {
        throw new Error('writeV3 nested prefab ownership is not implemented yet.');
    }
    const byId = new Map(file.documents.map(document => [document.fileId, document]));
    const identities = new Map();
    const documentIds = new Map();
    let gameObjectIndex = 0;
    let transformIndex = 0;
    let componentIndex = 0;
    const build = (node) => {
        const goId = `g${++gameObjectIndex}`;
        const transformId = `t${++transformIndex}`;
        documentIds.set(node.fileId, goId);
        documentIds.set(node.transform.fileId, transformId);
        identities.set(goId, identityFor(byId, node.fileId, goId, 'gameObject'));
        identities.set(transformId, {
            ...identityFor(byId, node.transform.fileId, transformId, 'transform'),
            ownerId: goId,
        });
        const components = node.components.map(component => {
            const machineId = `c${++componentIndex}`;
            documentIds.set(component.fileId, machineId);
            identities.set(machineId, {
                ...identityFor(byId, component.fileId, machineId, 'component'),
                displayName: component.typeName,
                ownerId: goId,
                scriptGuid: component.scriptGuid,
            });
            return { typeName: component.typeName, machineId };
        });
        return {
            name: node.name,
            machineId: goId,
            components,
            children: node.children.map(build),
        };
    };
    const structure = build(file.hierarchy);
    const lines = [
        `# ubridge v3 | prefab | profile:${options.profile || 'unity-generic-v1'}${options.assetGuid ? ` | asset-guid:${options.assetGuid}` : ''}`,
        '--- STRUCTURE',
        ...writeStructure(structure),
        '--- DETAILS',
    ];
    for (const document of file.documents) {
        const machineId = documentIds.get(document.fileId);
        if (!machineId)
            throw new Error(`Local document ${document.fileId} is not represented by v3 STRUCTURE.`);
        const label = describeIdentity(identities.get(machineId), structure);
        lines.push('', `[${machineId} | ${label}]`);
        for (const [key, value] of Object.entries(document.properties)) {
            if (STRUCTURAL_FIELDS.has(key))
                continue;
            lines.push(`${key} = ${(0, value_1.formatV3Value)(value)}`);
        }
    }
    lines.push('', '--- IDENTITY');
    for (const identity of identities.values())
        lines.push(writeIdentity(identity));
    return lines.join('\n') + '\n';
}
function identityFor(byId, fileId, machineId, kind) {
    const document = byId.get(fileId);
    if (!document)
        throw new Error(`Missing Unity document ${fileId}.`);
    return {
        machineId,
        kind,
        fileId,
        typeId: document.typeId,
        typeName: document.typeName,
    };
}
function writeStructure(root) {
    const lines = [];
    const visit = (node, prefix, isLast, isRoot) => {
        const branch = isRoot ? '' : `${prefix}${isLast ? '└─ ' : '├─ '}`;
        const components = node.components.length
            ? ` [${node.components.map(component => `${component.typeName} @${component.machineId}`).join(', ')}]`
            : '';
        lines.push(`${branch}${node.name} @${node.machineId}${components}`);
        const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`;
        node.children.forEach((child, index) => visit(child, childPrefix, index === node.children.length - 1, false));
    };
    visit(root, '', true, true);
    return lines;
}
function writeIdentity(identity) {
    const fields = [
        identity.kind,
        `fileID:${identity.fileId}`,
        `type:${identity.typeId}`,
        `typeName:${identity.typeName}`,
    ];
    if (identity.ownerId)
        fields.push(`owner:${identity.ownerId}`);
    if (identity.displayName && identity.displayName !== identity.typeName) {
        fields.push(`displayName:${identity.displayName}`);
    }
    if (identity.scriptGuid)
        fields.push(`script:${identity.scriptGuid}`);
    return `${identity.machineId} = ${fields.join(' | ')}`;
}
function describeIdentity(identity, root) {
    if (identity.kind === 'gameObject')
        return findNode(root, identity.machineId)?.name || identity.typeName;
    const owner = identity.ownerId ? findNode(root, identity.ownerId)?.name : undefined;
    return owner ? `${owner}:${identity.typeName}` : identity.typeName;
}
function findNode(root, machineId) {
    if (root.machineId === machineId)
        return root;
    for (const child of root.children) {
        const match = findNode(child, machineId);
        if (match)
            return match;
    }
    return undefined;
}
//# sourceMappingURL=writer.js.map