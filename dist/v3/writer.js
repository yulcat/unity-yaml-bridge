"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeV3 = writeV3;
const value_1 = require("./value");
const references_1 = require("./references");
const STRUCTURAL_FIELDS = new Set([
    'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
    'm_GameObject', 'm_Father', 'm_Children', 'm_RootOrder', 'm_Component',
    'm_Name', 'm_Script',
]);
function writeV3(file, options = {}) {
    if (file.type === 'variant')
        return writeVariantV3(file, options);
    if (file.type !== 'prefab' || !file.hierarchy)
        throw new Error('writeV3 requires a prefab hierarchy.');
    const byId = new Map(file.documents.map(document => [document.fileId, document]));
    const identities = new Map();
    const documentIds = new Map();
    let gameObjectIndex = 0;
    let transformIndex = 0;
    let componentIndex = 0;
    let prefabInstanceIndex = 0;
    let strippedIndex = 0;
    for (const prefabInstance of file.prefabInstances) {
        const machineId = `p${++prefabInstanceIndex}`;
        documentIds.set(prefabInstance.fileId, machineId);
        identities.set(machineId, identityFor(byId, prefabInstance.fileId, machineId, 'prefabInstance'));
    }
    const build = (node, parentTransformMachineId, siblingIndex = 0) => {
        if (node.nestedPrefab) {
            const machineId = documentIds.get(node.nestedPrefab.instanceId);
            if (!machineId)
                throw new Error(`Missing PrefabInstance ${node.nestedPrefab.instanceId}.`);
            const nestedIdentity = identities.get(machineId);
            nestedIdentity.displayName = node.name;
            nestedIdentity.baselineParentId = parentTransformMachineId;
            nestedIdentity.baselineOrder = siblingIndex;
            const transformDocument = byId.get(node.transform.fileId);
            if (!transformDocument?.stripped) {
                throw new Error(`Nested PrefabInstance ${machineId} has no stripped root Transform.`);
            }
            if (!documentIds.has(transformDocument.fileId)) {
                const strippedId = `s${++strippedIndex}`;
                documentIds.set(transformDocument.fileId, strippedId);
                identities.set(strippedId, {
                    ...identityFor(byId, transformDocument.fileId, strippedId, 'stripped'),
                    ownerId: machineId,
                    nestedRoot: true,
                });
            }
            if (node.fileId !== '0' && byId.has(node.fileId) && !documentIds.has(node.fileId)) {
                const strippedId = `s${++strippedIndex}`;
                documentIds.set(node.fileId, strippedId);
                identities.set(strippedId, {
                    ...identityFor(byId, node.fileId, strippedId, 'stripped'),
                    ownerId: machineId,
                });
            }
            return {
                name: node.name,
                machineId,
                components: [],
                children: [],
                nestedSourceGuid: node.nestedPrefab.sourceGuid,
            };
        }
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
                scriptFileId: component.scriptGuid
                    ? String(byId.get(component.fileId)?.properties.m_Script?.fileID ?? 11500000)
                    : undefined,
                scriptType: component.scriptGuid
                    ? Number(byId.get(component.fileId)?.properties.m_Script?.type ?? 3)
                    : undefined,
            });
            return { typeName: component.typeName, machineId };
        });
        const rawName = byId.get(node.fileId)?.properties.m_Name;
        return {
            name: String(rawName ?? node.name),
            machineId: goId,
            components,
            children: node.children.map((child, index) => build(child, transformId, index)),
        };
    };
    const structure = build(file.hierarchy);
    const inferredOwners = inferNestedOwnership(file, byId, identities, documentIds);
    for (const document of file.documents) {
        if (documentIds.has(document.fileId))
            continue;
        if (!document.stripped) {
            const machineId = `o${++strippedIndex}`;
            documentIds.set(document.fileId, machineId);
            identities.set(machineId, {
                ...identityFor(byId, document.fileId, machineId, 'owned'),
                ownerId: inferredOwners.get(document.fileId),
            });
            continue;
        }
        const ownerFileId = String(document.properties.m_PrefabInstance?.fileID ?? '0');
        const ownerId = documentIds.get(ownerFileId);
        if (!ownerId)
            throw new Error(`Stripped document ${document.fileId} has no PrefabInstance owner.`);
        const machineId = `s${++strippedIndex}`;
        documentIds.set(document.fileId, machineId);
        identities.set(machineId, {
            ...identityFor(byId, document.fileId, machineId, 'stripped'),
            ownerId,
        });
    }
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
        const identity = identities.get(machineId);
        for (const [key, value] of Object.entries(document.properties)) {
            if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned' &&
                STRUCTURAL_FIELDS.has(key))
                continue;
            lines.push(`${key} = ${(0, value_1.formatV3Value)((0, references_1.encodeV3References)(value, documentIds))}`);
        }
    }
    lines.push('', '--- IDENTITY');
    for (const identity of identities.values())
        lines.push(writeIdentity(identity));
    return lines.join('\n') + '\n';
}
function inferNestedOwnership(file, byId, identities, documentIds) {
    const owners = new Map();
    const seedAddedObject = (outerId, value) => {
        const addedFileId = String(value?.fileID ?? '0');
        const added = byId.get(addedFileId);
        if (!added)
            return;
        if (added.stripped) {
            const childInstanceFileId = String(added.properties.m_PrefabInstance?.fileID ?? '0');
            const childId = documentIds.get(childInstanceFileId);
            if (childId && childId !== outerId)
                identities.get(childId).ownerId = outerId;
            return;
        }
        owners.set(addedFileId, outerId);
    };
    for (const prefabInstance of file.documents.filter(item => item.typeId === 1001)) {
        const outerId = documentIds.get(prefabInstance.fileId);
        if (!outerId)
            continue;
        const modification = prefabInstance.properties.m_Modification;
        for (const entry of modification?.m_AddedGameObjects ?? []) {
            seedAddedObject(outerId, entry?.addedObject);
        }
        for (const entry of modification?.m_AddedComponents ?? []) {
            seedAddedObject(outerId, entry?.addedObject);
        }
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const [fileId, ownerId] of [...owners]) {
            const document = byId.get(fileId);
            if (!document)
                continue;
            const related = structuralLocalReferences(document);
            for (const relatedFileId of related) {
                const relatedDocument = byId.get(relatedFileId);
                if (!relatedDocument || relatedDocument.stripped || documentIds.has(relatedFileId) || owners.has(relatedFileId)) {
                    continue;
                }
                owners.set(relatedFileId, ownerId);
                changed = true;
            }
        }
    }
    return owners;
}
function structuralLocalReferences(document) {
    const properties = document.properties;
    const references = [];
    const add = (value) => {
        const fileId = String(value?.fileID ?? '0');
        if (fileId !== '0')
            references.push(fileId);
    };
    add(properties.m_GameObject);
    for (const entry of properties.m_Component ?? [])
        add(entry?.component);
    for (const entry of properties.m_Children ?? [])
        add(entry);
    return references;
}
function writeVariantV3(file, options) {
    const byId = new Map(file.documents.map(document => [document.fileId, document]));
    const identities = new Map();
    const documentIds = new Map();
    let prefabIndex = 0;
    let strippedIndex = 0;
    let ownedIndex = 0;
    for (const document of file.documents.filter(item => item.typeId === 1001)) {
        const machineId = `p${++prefabIndex}`;
        documentIds.set(document.fileId, machineId);
        identities.set(machineId, identityFor(byId, document.fileId, machineId, 'prefabInstance'));
    }
    const rootInstance = file.prefabInstances.find(instance => String(instance.transformParent.fileID) === '0');
    if (!rootInstance)
        throw new Error('v3 variant requires a root PrefabInstance.');
    const rootId = documentIds.get(rootInstance.fileId);
    if (!rootId || !rootInstance.sourcePrefab.guid)
        throw new Error('v3 variant root source identity is incomplete.');
    let gameObjectIndex = 0;
    let transformIndex = 0;
    let componentIndex = 0;
    const buildVariantNode = (node, parentTransformMachineId, siblingIndex = 0) => {
        if (node.nestedPrefab) {
            const machineId = documentIds.get(node.nestedPrefab.instanceId);
            if (!machineId)
                throw new Error(`Missing variant nested PrefabInstance ${node.nestedPrefab.instanceId}.`);
            const nestedIdentity = identities.get(machineId);
            nestedIdentity.displayName = node.name;
            nestedIdentity.baselineParentId = parentTransformMachineId;
            nestedIdentity.baselineOrder = siblingIndex;
            const transformDocument = byId.get(node.transform.fileId);
            if (!transformDocument?.stripped) {
                throw new Error(`Variant nested PrefabInstance ${machineId} has no stripped root Transform.`);
            }
            if (!documentIds.has(transformDocument.fileId)) {
                const strippedId = `s${++strippedIndex}`;
                documentIds.set(transformDocument.fileId, strippedId);
                identities.set(strippedId, {
                    ...identityFor(byId, transformDocument.fileId, strippedId, 'stripped'),
                    ownerId: machineId,
                    nestedRoot: true,
                });
            }
            if (node.fileId !== '0' && byId.has(node.fileId) && !documentIds.has(node.fileId)) {
                const strippedId = `s${++strippedIndex}`;
                documentIds.set(node.fileId, strippedId);
                identities.set(strippedId, {
                    ...identityFor(byId, node.fileId, strippedId, 'stripped'),
                    ownerId: machineId,
                });
            }
            return {
                name: node.name,
                machineId,
                components: [],
                children: [],
                nestedSourceGuid: node.nestedPrefab.sourceGuid,
            };
        }
        const goId = `g${++gameObjectIndex}`;
        const transformId = `t${++transformIndex}`;
        documentIds.set(node.fileId, goId);
        documentIds.set(node.transform.fileId, transformId);
        identities.set(goId, {
            ...identityFor(byId, node.fileId, goId, 'gameObject'),
            prefabOwnerId: rootId,
        });
        identities.set(transformId, {
            ...identityFor(byId, node.transform.fileId, transformId, 'transform'),
            ownerId: goId,
            baselineParentId: parentTransformMachineId,
            baselineOrder: siblingIndex,
        });
        const components = node.components.map(component => {
            const machineId = `c${++componentIndex}`;
            documentIds.set(component.fileId, machineId);
            identities.set(machineId, {
                ...identityFor(byId, component.fileId, machineId, 'component'),
                displayName: component.typeName,
                ownerId: goId,
                scriptGuid: component.scriptGuid,
                scriptFileId: component.scriptGuid
                    ? String(byId.get(component.fileId)?.properties.m_Script?.fileID ?? 11500000)
                    : undefined,
                scriptType: component.scriptGuid
                    ? Number(byId.get(component.fileId)?.properties.m_Script?.type ?? 3)
                    : undefined,
            });
            return { typeName: component.typeName, machineId };
        });
        return {
            name: node.name,
            machineId: goId,
            components,
            children: node.children.map((child, index) => buildVariantNode(child, transformId, index)),
        };
    };
    const variantHierarchyRoots = file.hierarchy
        ? file.hierarchy.name === '__added_root__' || !byId.has(file.hierarchy.fileId)
            ? file.hierarchy.children
            : [file.hierarchy]
        : [];
    const variantRoots = variantHierarchyRoots.map((node, index) => buildVariantNode(node, undefined, index));
    const inferredOwners = inferNestedOwnership(file, byId, identities, documentIds);
    for (const document of file.documents) {
        if (documentIds.has(document.fileId))
            continue;
        const machineId = document.stripped ? `s${++strippedIndex}` : `o${++ownedIndex}`;
        const kind = document.stripped ? 'stripped' : 'owned';
        const ownerFileId = String(document.properties.m_PrefabInstance?.fileID ?? '0');
        documentIds.set(document.fileId, machineId);
        identities.set(machineId, {
            ...identityFor(byId, document.fileId, machineId, kind),
            ownerId: documentIds.get(ownerFileId) || inferredOwners.get(document.fileId),
        });
    }
    const lines = [
        `# ubridge v3 | variant | profile:${options.profile || 'unity-generic-v1'}${options.assetGuid ? ` | asset-guid:${options.assetGuid}` : ''}`,
        '--- STRUCTURE',
        `(variant @${rootId} source:${rootInstance.sourcePrefab.guid})`,
        ...writeVariantRoots(variantRoots),
        '--- DETAILS',
    ];
    for (const document of file.documents) {
        const machineId = documentIds.get(document.fileId);
        lines.push('', `[${machineId} | ${document.typeName}]`);
        const identity = identities.get(machineId);
        for (const [key, value] of Object.entries(document.properties)) {
            if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned' &&
                STRUCTURAL_FIELDS.has(key) && key !== 'm_Father' && key !== 'm_RootOrder')
                continue;
            lines.push(`${key} = ${(0, value_1.formatV3Value)((0, references_1.encodeV3References)(value, documentIds))}`);
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
        stripped: document.stripped,
    };
}
function writeStructure(root) {
    const lines = [];
    const visit = (node, prefix, isLast, isRoot) => {
        const branch = isRoot ? '' : `${prefix}${isLast ? '└─ ' : '├─ '}`;
        const components = node.components.length
            ? ` [${node.components.map(component => `${component.typeName} @${component.machineId}`).join(', ')}]`
            : '';
        const nested = node.nestedSourceGuid ? ` {source:${node.nestedSourceGuid}}` : '';
        lines.push(`${branch}${node.name} @${node.machineId}${nested}${components}`);
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
    if (identity.prefabOwnerId)
        fields.push(`prefabOwner:${identity.prefabOwnerId}`);
    if (identity.displayName && identity.displayName !== identity.typeName) {
        fields.push(`displayName:${identity.displayName}`);
    }
    if (identity.scriptGuid)
        fields.push(`script:${identity.scriptGuid}`);
    if (identity.scriptGuid)
        fields.push(`scriptFileID:${identity.scriptFileId ?? 11500000}`);
    if (identity.scriptGuid)
        fields.push(`scriptType:${identity.scriptType ?? 3}`);
    if (identity.stripped)
        fields.push('stripped:1');
    if (identity.nestedRoot)
        fields.push('nestedRoot:1');
    if (identity.baselineParentId)
        fields.push(`baselineParent:${identity.baselineParentId}`);
    if (identity.baselineOrder !== undefined)
        fields.push(`baselineOrder:${identity.baselineOrder}`);
    return `${identity.machineId} = ${fields.join(' | ')}`;
}
function writeVariantRoots(roots) {
    const lines = [];
    const visit = (node, prefix, isLast) => {
        const components = node.components.length
            ? ` [${node.components.map(component => `${component.typeName} @${component.machineId}`).join(', ')}]`
            : '';
        const nested = node.nestedSourceGuid ? ` {source:${node.nestedSourceGuid}}` : '';
        lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${node.name} @${node.machineId}${nested}${components}`);
        const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
        node.children.forEach((child, index) => visit(child, childPrefix, index === node.children.length - 1));
    };
    roots.forEach((root, index) => visit(root, '', index === roots.length - 1));
    return lines;
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