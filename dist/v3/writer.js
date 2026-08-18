"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeV3 = writeV3;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const unity_yaml_parser_1 = require("../unity-yaml-parser");
const value_1 = require("./value");
const references_1 = require("./references");
const override_validation_1 = require("./override-validation");
const STRUCTURAL_FIELDS = new Set([
    'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
    'm_GameObject', 'm_Father', 'm_Children', 'm_RootOrder', 'm_Component',
    'm_Name', 'm_Script',
]);
function validateUnityModificationObjectReference(value, context) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid v3 object reference at ${context}.`);
    }
    const objectReference = value;
    const keys = Object.keys(objectReference);
    if (keys.length === 1 && keys[0] === 'fileID') {
        const fileId = typeof objectReference.fileID === 'number'
            ? (Number.isSafeInteger(objectReference.fileID) ? String(objectReference.fileID) : '')
            : typeof objectReference.fileID === 'string' && /^(0|-?[1-9]\d*)$/.test(objectReference.fileID)
                ? objectReference.fileID
                : '';
        if (!fileId)
            throw new Error(`Invalid v3 object reference at ${context}.`);
        return { fileId, projected: { fileID: fileId } };
    }
    const projected = (0, references_1.validateV3ExternalObjectReference)(objectReference, context);
    return { fileId: String(projected.fileID), projected };
}
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
    applySourceFingerprints(identities, options);
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
    const rootInstances = file.prefabInstances.filter(instance => String(instance.transformParent.fileID) === '0');
    if (rootInstances.length !== 1)
        throw new Error('v3 variant requires exactly one root PrefabInstance.');
    const rootInstance = rootInstances[0];
    const rootId = documentIds.get(rootInstance.fileId);
    if (!rootId || !rootInstance.sourcePrefab.guid)
        throw new Error('v3 variant root source identity is incomplete.');
    let gameObjectIndex = 0;
    let transformIndex = 0;
    let componentIndex = 0;
    const projectedDetails = new Map();
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
    const addedComponentsBySourceGameObject = collectVariantAddedComponents(rootInstance, byId);
    const inheritedRoots = buildInheritedVariantRoots(rootInstance, rootInstance.sourcePrefab.guid, options, identities, documentIds, rootId, addedComponentsBySourceGameObject, projectedDetails);
    const effectiveRoots = inheritedRoots.length > 0 && variantRoots.length > 0
        ? attachVariantAddedRoots(variantRoots, inheritedRoots, rootInstance, byId, identities, rootId)
        : inheritedRoots.length > 0 ? inheritedRoots : variantRoots;
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
    applySourceFingerprints(identities, options);
    const effectiveReferenceIds = collectEffectiveV3StructureIds(effectiveRoots, identities);
    effectiveReferenceIds.add(rootId);
    normalizeProjectedOverrideReferences(projectedDetails, identities, documentIds, effectiveReferenceIds);
    const lines = [
        `# ubridge v3 | variant | profile:${options.profile || 'unity-generic-v1'}${options.assetGuid ? ` | asset-guid:${options.assetGuid}` : ''}`,
        '--- STRUCTURE',
        `(variant @${rootId} source:${rootInstance.sourcePrefab.guid})`,
        ...writeVariantRoots(effectiveRoots),
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
    for (const [machineId, properties] of projectedDetails) {
        lines.push('', `[${machineId} | inherited override]`);
        for (const [key, value] of Object.entries(properties)) {
            lines.push(`${key} = ${(0, value_1.formatV3Value)(value)}`);
        }
    }
    lines.push('', '--- IDENTITY');
    for (const identity of identities.values())
        lines.push(writeIdentity(identity));
    return lines.join('\n') + '\n';
}
function collectEffectiveV3StructureIds(roots, identities) {
    const result = new Set();
    const visit = (node) => {
        if (node.tombstone)
            return;
        result.add(node.machineId);
        if (node.prefabInstanceId)
            result.add(node.prefabInstanceId);
        node.components.forEach(component => result.add(component.machineId));
        for (const identity of identities.values()) {
            if (identity.kind === 'transform' && identity.ownerId === node.machineId) {
                result.add(identity.machineId);
            }
        }
        node.children.forEach(visit);
    };
    roots.forEach(visit);
    return result;
}
function normalizeProjectedOverrideReferences(projectedDetails, identities, documentIds, effectiveReferenceIds) {
    for (const properties of projectedDetails.values()) {
        for (const [propertyPath, value] of Object.entries(properties)) {
            if (!value || typeof value !== 'object' || Array.isArray(value) ||
                !Object.prototype.hasOwnProperty.call(value, 'fileID'))
                continue;
            const reference = value;
            const fileId = String(reference.fileID);
            const guid = String(reference.guid ?? '');
            if (!guid) {
                const machineId = documentIds.get(fileId);
                if (!machineId || !identities.has(machineId) || !effectiveReferenceIds.has(machineId)) {
                    throw new Error(`Variant nested override ${propertyPath} has no effective stable local identity for fileID ${fileId}.`);
                }
                properties[propertyPath] = { $ref: machineId };
                continue;
            }
            const matches = [...identities.values()].filter(identity => identity.origin === 'inherited' && identity.sourceGuid === guid &&
                identity.sourceFileId === fileId);
            if (matches.length === 1) {
                if (!effectiveReferenceIds.has(matches[0].machineId)) {
                    throw new Error(`Variant nested override ${propertyPath} references ${guid}:${fileId}, ` +
                        'which is not an effective identity.');
                }
                properties[propertyPath] = { $ref: matches[0].machineId };
            }
        }
    }
}
function identityFor(byId, fileId, machineId, kind) {
    const document = byId.get(fileId);
    if (!document)
        throw new Error(`Missing Unity document ${fileId}.`);
    const source = document.properties.m_CorrespondingSourceObject;
    const sourcePrefab = document.properties.m_SourcePrefab || document.properties.m_ParentPrefab;
    const sourceReference = source?.guid ? source : sourcePrefab;
    return {
        machineId,
        kind,
        fileId,
        typeId: document.typeId,
        typeName: document.typeName,
        stripped: document.stripped,
        sourceGuid: sourceReference?.guid ? String(sourceReference.guid) : undefined,
        sourceFileId: sourceReference?.fileID !== undefined
            ? String(sourceReference.fileID)
            : undefined,
    };
}
function attachVariantAddedRoots(localRoots, inheritedRoots, rootInstance, byId, identities, rootId) {
    var _a;
    const rootDocument = byId.get(rootInstance.fileId);
    const additions = rootDocument?.properties.m_Modification?.m_AddedGameObjects ?? [];
    const additionsByObject = new Map();
    for (const addition of additions) {
        const target = addition?.targetCorrespondingSourceObject;
        const targetGuid = String(target?.guid ?? '');
        const addedFileId = String(addition?.addedObject?.fileID ?? '0');
        if (!targetGuid || String(target?.fileID ?? '0') === '0' || addedFileId === '0' ||
            additionsByObject.has(addedFileId)) {
            throw new Error(`Variant m_AddedGameObjects has ambiguous leaf ownership for ${addedFileId}.`);
        }
        additionsByObject.set(addedFileId, addition);
    }
    const inheritedNodesByTransform = new Map();
    const collectInherited = (node) => {
        const transforms = [...identities.values()].filter(identity => identity.kind === 'transform' && identity.origin === 'inherited' &&
            identity.ownerId === node.machineId && identity.sourceGuid && identity.sourceFileId);
        if (transforms.length === 1) {
            const key = `${transforms[0].sourceGuid}:${transforms[0].sourceFileId}`;
            if (inheritedNodesByTransform.has(key)) {
                throw new Error(`Variant effective source has ambiguous Transform ${key}.`);
            }
            inheritedNodesByTransform.set(key, node);
        }
        node.children.forEach(collectInherited);
    };
    inheritedRoots.forEach(collectInherited);
    const rootTransformIdentity = (node) => {
        const matches = [...identities.values()].filter(identity => node.nestedSourceGuid
            ? identity.kind === 'stripped' && identity.ownerId === node.machineId && identity.nestedRoot
            : identity.kind === 'transform' && identity.ownerId === node.machineId);
        if (matches.length !== 1 || !matches[0].fileId) {
            throw new Error(`Variant-added root ${node.machineId} has ambiguous local Transform ownership.`);
        }
        return matches[0];
    };
    for (const localRoot of localRoots) {
        const transformIdentity = rootTransformIdentity(localRoot);
        const addition = additionsByObject.get(transformIdentity.fileId);
        if (!addition) {
            throw new Error(`Variant-added root ${localRoot.machineId} is missing direct m_AddedGameObjects ownership.`);
        }
        additionsByObject.delete(transformIdentity.fileId);
        const target = addition.targetCorrespondingSourceObject;
        const sourceTransformFileId = String(target.fileID);
        const sourceTransformGuid = String(target.guid);
        const parentNode = inheritedNodesByTransform.get(`${sourceTransformGuid}:${sourceTransformFileId}`);
        if (!parentNode) {
            throw new Error(`Variant-added root ${localRoot.machineId} targets Transform ` +
                `${sourceTransformGuid}:${sourceTransformFileId} outside the direct source effective tree ` +
                'or recursively expanded nested sources.');
        }
        const parentTransforms = [...identities.values()].filter(identity => identity.kind === 'transform' && identity.origin === 'inherited' &&
            identity.ownerId === parentNode.machineId && identity.sourceFileId === sourceTransformFileId &&
            identity.sourceGuid === sourceTransformGuid);
        if (parentTransforms.length !== 1) {
            throw new Error(`Variant-added root ${localRoot.machineId} has ambiguous inherited parent Transform ownership.`);
        }
        const transformDocument = byId.get(transformIdentity.fileId);
        const parentStub = byId.get(String(transformDocument?.properties.m_Father?.fileID ?? '0'));
        const stubSource = parentStub?.properties.m_CorrespondingSourceObject;
        if (!parentStub?.stripped || parentStub.typeId !== parentTransforms[0].typeId ||
            String(stubSource?.fileID ?? '0') !== sourceTransformFileId ||
            String(stubSource?.guid ?? '') !== sourceTransformGuid ||
            String(parentStub.properties.m_PrefabInstance?.fileID ?? '0') !== rootInstance.fileId) {
            throw new Error(`Variant-added root ${localRoot.machineId} has ambiguous leaf-owned stripped parent identity.`);
        }
        transformIdentity.baselineParentId = parentTransforms[0].machineId;
        const requestedIndex = Number(addition.insertIndex ?? -1);
        const insertionIndex = requestedIndex < 0
            ? parentNode.children.length
            : Math.min(requestedIndex, parentNode.children.length);
        parentNode.children.splice(insertionIndex, 0, localRoot);
        (_a = identities.get(localRoot.machineId)).prefabOwnerId ?? (_a.prefabOwnerId = rootId);
        transformIdentity.prefabOwnerId ?? (transformIdentity.prefabOwnerId = rootId);
    }
    if (additionsByObject.size > 0) {
        throw new Error(`Variant m_AddedGameObjects addedObject ${additionsByObject.keys().next().value} ` +
            'is not an exposed local root.');
    }
    return inheritedRoots;
}
function buildInheritedVariantRoots(rootInstance, sourceGuid, options, identities, documentIds, rootId, addedComponentsBySourceGameObject, projectedDetails) {
    const sourcePath = options.sourceResolver?.resolveFilePath(sourceGuid);
    if (!sourcePath)
        return [];
    const source = resolveEffectiveVariantSource(sourceGuid, options, new Set());
    const sourceById = source.documents;
    let gameObjectIndex = 0;
    let transformIndex = 0;
    let componentIndex = 0;
    let addedComponentIndex = 0;
    let inheritedPrefabInstanceIndex = 0;
    const collectDirectRemovals = (references, label) => {
        const result = new Set();
        for (const reference of references) {
            const fileId = String(reference.fileID ?? '0');
            const guid = String(reference.guid ?? '');
            const key = `${guid}:${fileId}`;
            if (!guid || fileId === '0' || result.has(key)) {
                throw new Error(`Variant root ${rootInstance.fileId} has ambiguous ${label} ownership for ${fileId}.`);
            }
            result.add(key);
        }
        return result;
    };
    const removedGameObjectIds = collectDirectRemovals(rootInstance.removedGameObjects, 'removed-GameObject');
    const matchedRemovedGameObjectIds = new Set();
    const removedComponentIds = collectDirectRemovals(rootInstance.removedComponents, 'removed-component');
    const matchedRemovedComponentIds = new Set();
    const matchRemoval = (removals, matched, guid, fileId, label) => {
        const key = `${guid}:${fileId}`;
        if (!removals.has(key))
            return false;
        if (matched.has(key)) {
            throw new Error(`Variant root ${rootInstance.fileId} has ambiguous ${label} ownership for ${key}.`);
        }
        matched.add(key);
        return true;
    };
    const directSourceModificationKeys = new Set();
    for (const modification of rootInstance.modifications) {
        if (String(modification.target.guid ?? '') !== sourceGuid)
            continue;
        const fileId = String(modification.target.fileID ?? '0');
        if (fileId === '0' || !sourceById.has(fileId)) {
            throw new Error(`Variant root ${rootInstance.fileId} direct-source modification target ${sourceGuid}:${fileId} ` +
                'is not exactly one resolved source identity.');
        }
        const key = `${sourceGuid}:${fileId}:${modification.propertyPath}`;
        if (directSourceModificationKeys.has(key)) {
            if (modification.propertyPath === 'm_Name') {
                throw new Error(`Variant root ${rootInstance.fileId} has ambiguous name ownership for ${fileId}.`);
            }
            throw new Error(`Variant root ${rootInstance.fileId} has duplicate direct-source modification ${key}.`);
        }
        directSourceModificationKeys.add(key);
    }
    const nameOverrides = new Map();
    for (const modification of rootInstance.modifications) {
        if (modification.propertyPath !== 'm_Name' || modification.target.guid !== sourceGuid)
            continue;
        const fileId = String(modification.target.fileID ?? '0');
        if (nameOverrides.has(fileId)) {
            throw new Error(`Variant root ${rootInstance.fileId} has ambiguous name ownership for ${fileId}.`);
        }
        nameOverrides.set(fileId, modification.value);
    }
    const nestedOverrides = new Map();
    const matchedNestedOverrides = new Set();
    for (const modification of rootInstance.modifications) {
        const guid = String(modification.target.guid ?? '');
        const fileId = String(modification.target.fileID ?? '0');
        if (guid === sourceGuid)
            continue;
        const key = `${guid}:${fileId}:${modification.propertyPath}`;
        if (!guid || fileId === '0' || nestedOverrides.has(key)) {
            throw new Error(`Variant root ${rootInstance.fileId} has ambiguous nested override ownership for ${fileId}.`);
        }
        nestedOverrides.set(key, modification);
    }
    const projectNestedOverrides = (machineId, guid, fileId, sourceName, baselineProperties) => {
        const assignProjectedValue = (propertyPath, value) => {
            const details = projectedDetails.get(machineId) ?? Object.create(null);
            const segments = (0, override_validation_1.validateV3OverridePropertyPath)(propertyPath, `${machineId}.${propertyPath}`);
            let baseline = baselineProperties;
            let groupable = value !== null && segments.length > 1;
            for (const segment of segments.slice(0, -1)) {
                if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) ||
                    Object.prototype.hasOwnProperty.call(baseline, 'fileID') ||
                    !Object.prototype.hasOwnProperty.call(baseline, segment)) {
                    groupable = false;
                    break;
                }
                baseline = baseline[segment];
            }
            if (groupable && (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) ||
                Object.prototype.hasOwnProperty.call(baseline, 'fileID'))) {
                groupable = false;
            }
            if (!groupable) {
                if (Object.keys(details).some(existing => existing.startsWith(`${propertyPath}.`) || propertyPath.startsWith(`${existing}.`))) {
                    throw new Error(`Variant nested override ${guid}:${fileId}.${propertyPath} overlaps another projected property path.`);
                }
                details[propertyPath] = value;
                projectedDetails.set(machineId, details);
                return;
            }
            const root = segments[0];
            if (Object.prototype.hasOwnProperty.call(details, root) &&
                (!details[root] || typeof details[root] !== 'object' || Array.isArray(details[root]) ||
                    Object.prototype.hasOwnProperty.call(details[root], 'fileID'))) {
                throw new Error(`Variant nested override ${guid}:${fileId}.${propertyPath} overlaps another projected property path.`);
            }
            const partial = (details[root] ?? (details[root] = Object.create(null)));
            let cursor = partial;
            for (const segment of segments.slice(1, -1)) {
                const existing = cursor[segment];
                if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing))) {
                    throw new Error(`Variant nested override ${guid}:${fileId}.${propertyPath} overlaps another projected property path.`);
                }
                cursor = (cursor[segment] ?? (cursor[segment] = Object.create(null)));
            }
            const leaf = segments[segments.length - 1];
            cursor[leaf] = value;
            projectedDetails.set(machineId, details);
        };
        let name = sourceName;
        for (const [key, modification] of [...nestedOverrides].sort(([left], [right]) => left.localeCompare(right))) {
            if (!key.startsWith(`${guid}:${fileId}:`))
                continue;
            const segments = (0, override_validation_1.validateV3OverridePropertyPath)(modification.propertyPath, `${machineId}.${modification.propertyPath}`);
            matchedNestedOverrides.add(key);
            const normalizedObjectReference = validateUnityModificationObjectReference(modification.objectReference, `${machineId}.${modification.propertyPath}`);
            if (modification.propertyPath === 'm_Name') {
                name = modification.value;
                continue;
            }
            if ((0, override_validation_1.isV3OverrideStructuralPath)(modification.propertyPath)) {
                throw new Error(`Variant nested override ${guid}:${fileId}.${modification.propertyPath} is structural and not supported.`);
            }
            if (normalizedObjectReference.fileId !== '0') {
                assignProjectedValue(modification.propertyPath, normalizedObjectReference.projected);
                continue;
            }
            let baseline = baselineProperties;
            for (const segment of segments) {
                if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) ||
                    !Object.prototype.hasOwnProperty.call(baseline, segment)) {
                    baseline = undefined;
                    break;
                }
                baseline = baseline[segment];
            }
            const baselineIsReference = !!baseline && typeof baseline === 'object' &&
                !Array.isArray(baseline) && Object.prototype.hasOwnProperty.call(baseline, 'fileID');
            const numeric = Number(modification.value);
            const value = modification.value === '' && baselineIsReference
                ? null
                : modification.value.trim() !== '' && Number.isFinite(numeric)
                    ? numeric
                    : modification.value;
            assignProjectedValue(modification.propertyPath, value);
        }
        return name;
    };
    const projectAddedComponents = (goId, sourceGuid, sourceFileId, components) => {
        const key = `${sourceGuid}:${sourceFileId}`;
        const localAddedComponents = addedComponentsBySourceGameObject.get(key) ?? [];
        if (localAddedComponents.length > 0)
            addedComponentsBySourceGameObject.delete(key);
        for (const addedDocument of localAddedComponents) {
            const componentId = `ac${++addedComponentIndex}`;
            documentIds.set(addedDocument.fileId, componentId);
            identities.set(componentId, {
                machineId: componentId,
                kind: 'component',
                fileId: addedDocument.fileId,
                typeId: addedDocument.typeId,
                typeName: addedDocument.typeName,
                displayName: addedDocument.typeName,
                ownerId: goId,
                prefabOwnerId: rootId,
                scriptGuid: addedDocument.typeId === 114
                    ? String(addedDocument.properties.m_Script?.guid ?? '') || undefined
                    : undefined,
                scriptFileId: addedDocument.typeId === 114
                    ? String(addedDocument.properties.m_Script?.fileID ?? 11500000)
                    : undefined,
                scriptType: addedDocument.typeId === 114
                    ? Number(addedDocument.properties.m_Script?.type ?? 3)
                    : undefined,
            });
            components.push({ typeName: addedDocument.typeName, machineId: componentId });
        }
    };
    const buildNestedInternal = (node, nestedSourceGuid, prefabOwnerId, nestedDocuments, parentTransformMachineId, siblingIndex, resolvingSources) => {
        if (node.nestedPrefab) {
            if (node.components.length > 0 || node.children.length > 0) {
                throw new Error(`Inherited nested PrefabInstance ${node.name} has unsupported mixed effective content.`);
            }
            const sourceDocument = nestedDocuments.get(node.nestedPrefab.instanceId);
            if (!sourceDocument || sourceDocument.typeId !== 1001) {
                throw new Error(`Inherited nested PrefabInstance ${node.name} is missing source document ${node.nestedPrefab.instanceId}.`);
            }
            const nestedPrefabInstanceId = `ip${++inheritedPrefabInstanceIndex}`;
            identities.set(nestedPrefabInstanceId, {
                machineId: nestedPrefabInstanceId,
                kind: 'prefabInstance',
                origin: 'inherited',
                typeId: sourceDocument.typeId,
                typeName: sourceDocument.typeName,
                displayName: node.name,
                prefabOwnerId,
                baselineParentId: parentTransformMachineId,
                baselineOrder: siblingIndex,
                sourceGuid: nestedSourceGuid,
                sourceFileId: node.nestedPrefab.instanceId,
            });
            const childSourceGuid = node.nestedPrefab.sourceGuid;
            const childPath = options.sourceResolver?.resolveFilePath(childSourceGuid);
            if (!childPath) {
                return {
                    name: node.name,
                    machineId: nestedPrefabInstanceId,
                    components: [],
                    children: [],
                    nestedSourceGuid: childSourceGuid,
                };
            }
            const childSource = resolveEffectiveVariantSource(childSourceGuid, options, new Set(resolvingSources));
            const root = buildNestedInternal(childSource.hierarchy, childSourceGuid, nestedPrefabInstanceId, childSource.documents, parentTransformMachineId, siblingIndex, new Set([...resolvingSources, childSourceGuid]));
            root.name = projectNestedOverrides(root.machineId, childSourceGuid, childSource.hierarchy.fileId, node.name, childSource.documents.get(childSource.hierarchy.fileId)?.properties);
            identities.get(root.machineId).displayName = node.name;
            root.nestedSourceGuid = childSourceGuid;
            root.prefabInstanceId = nestedPrefabInstanceId;
            return root;
        }
        const gameObjectDocument = nestedDocuments.get(node.fileId);
        const transformDocument = nestedDocuments.get(node.transform.fileId);
        if (!gameObjectDocument || !transformDocument) {
            throw new Error(`Inherited nested PrefabInstance ${prefabOwnerId} has incomplete internal identity for ${node.name}.`);
        }
        const goId = `ig${++gameObjectIndex}`;
        const transformId = `it${++transformIndex}`;
        const tombstone = matchRemoval(removedGameObjectIds, matchedRemovedGameObjectIds, nestedSourceGuid, node.fileId, 'removed-GameObject');
        identities.set(goId, {
            machineId: goId,
            kind: 'gameObject',
            origin: 'inherited',
            typeId: gameObjectDocument.typeId,
            typeName: gameObjectDocument.typeName,
            displayName: node.name,
            prefabOwnerId,
            sourceGuid: nestedSourceGuid,
            sourceFileId: node.fileId,
        });
        const effectiveName = projectNestedOverrides(goId, nestedSourceGuid, node.fileId, node.name, gameObjectDocument.properties);
        identities.set(transformId, {
            machineId: transformId,
            kind: 'transform',
            origin: 'inherited',
            typeId: transformDocument.typeId,
            typeName: transformDocument.typeName,
            ownerId: goId,
            prefabOwnerId,
            baselineParentId: parentTransformMachineId,
            baselineOrder: siblingIndex,
            sourceGuid: nestedSourceGuid,
            sourceFileId: node.transform.fileId,
        });
        const components = node.components.flatMap((component, index) => {
            const sourceDocument = nestedDocuments.get(component.fileId);
            if (!sourceDocument) {
                throw new Error(`Inherited nested component ${component.fileId} is missing from source ${nestedSourceGuid}.`);
            }
            const componentId = `ic${++componentIndex}`;
            identities.set(componentId, {
                machineId: componentId,
                kind: 'component',
                origin: 'inherited',
                typeId: sourceDocument.typeId,
                typeName: sourceDocument.typeName,
                displayName: component.typeName,
                ownerId: goId,
                prefabOwnerId,
                baselineOrder: index,
                scriptGuid: component.scriptGuid,
                sourceGuid: nestedSourceGuid,
                sourceFileId: component.fileId,
            });
            projectNestedOverrides(componentId, nestedSourceGuid, component.fileId, undefined, sourceDocument.properties);
            if (matchRemoval(removedComponentIds, matchedRemovedComponentIds, nestedSourceGuid, component.fileId, 'removed-component'))
                return [];
            return { typeName: component.typeName, machineId: componentId };
        });
        projectAddedComponents(goId, nestedSourceGuid, node.fileId, components);
        const children = node.children.map((child, index) => buildNestedInternal(child, nestedSourceGuid, prefabOwnerId, nestedDocuments, transformId, index, resolvingSources));
        return {
            name: effectiveName,
            machineId: goId,
            components,
            children: tombstone ? [] : children,
            tombstone,
        };
    };
    const build = (node, parentTransformMachineId, siblingIndex = 0) => {
        if (node.nestedPrefab) {
            if (node.components.length > 0 || node.children.length > 0) {
                throw new Error(`Inherited nested PrefabInstance ${node.name} has unsupported mixed effective content.`);
            }
            const sourceDocument = sourceById.get(node.nestedPrefab.instanceId);
            if (!sourceDocument || sourceDocument.typeId !== 1001) {
                throw new Error(`Inherited nested PrefabInstance ${node.name} is missing source document ${node.nestedPrefab.instanceId}.`);
            }
            const prefabInstanceId = `ip${++inheritedPrefabInstanceIndex}`;
            identities.set(prefabInstanceId, {
                machineId: prefabInstanceId,
                kind: 'prefabInstance',
                origin: 'inherited',
                typeId: sourceDocument.typeId,
                typeName: sourceDocument.typeName,
                displayName: node.name,
                prefabOwnerId: rootId,
                baselineParentId: parentTransformMachineId,
                baselineOrder: siblingIndex,
                sourceGuid,
                sourceFileId: node.nestedPrefab.instanceId,
            });
            const nestedSourceGuid = node.nestedPrefab.sourceGuid;
            const nestedPath = options.sourceResolver?.resolveFilePath(nestedSourceGuid);
            const sourceRoot = nestedPath
                ? (() => {
                    const nestedSource = resolveEffectiveVariantSource(nestedSourceGuid, options, new Set([sourceGuid]));
                    const root = buildNestedInternal(nestedSource.hierarchy, nestedSourceGuid, prefabInstanceId, nestedSource.documents, parentTransformMachineId, siblingIndex, new Set([sourceGuid, nestedSourceGuid]));
                    root.name = projectNestedOverrides(root.machineId, nestedSourceGuid, nestedSource.hierarchy.fileId, node.name, nestedSource.documents.get(nestedSource.hierarchy.fileId)?.properties);
                    identities.get(root.machineId).displayName = node.name;
                    return root;
                })()
                : undefined;
            if (sourceRoot) {
                sourceRoot.nestedSourceGuid = nestedSourceGuid;
                sourceRoot.prefabInstanceId = prefabInstanceId;
                return sourceRoot;
            }
            return {
                name: node.name,
                machineId: prefabInstanceId,
                components: [],
                children: [],
                nestedSourceGuid,
            };
        }
        const gameObjectDocument = sourceById.get(node.fileId);
        const transformDocument = sourceById.get(node.transform.fileId);
        if (!gameObjectDocument || !transformDocument) {
            throw new Error(`Inherited source node ${node.name} has incomplete source identity.`);
        }
        const goId = `ig${++gameObjectIndex}`;
        const transformId = `it${++transformIndex}`;
        const tombstone = matchRemoval(removedGameObjectIds, matchedRemovedGameObjectIds, sourceGuid, node.fileId, 'removed-GameObject');
        identities.set(goId, {
            machineId: goId,
            kind: 'gameObject',
            origin: 'inherited',
            typeId: gameObjectDocument.typeId,
            typeName: gameObjectDocument.typeName,
            displayName: nameOverrides.get(node.fileId) ?? node.name,
            sourceGuid,
            sourceFileId: node.fileId,
        });
        identities.set(transformId, {
            machineId: transformId,
            kind: 'transform',
            origin: 'inherited',
            typeId: transformDocument.typeId,
            typeName: transformDocument.typeName,
            ownerId: goId,
            baselineParentId: parentTransformMachineId,
            baselineOrder: siblingIndex,
            sourceGuid,
            sourceFileId: node.transform.fileId,
        });
        const components = node.components.flatMap((component, index) => {
            const sourceDocument = sourceById.get(component.fileId);
            if (!sourceDocument)
                throw new Error(`Inherited component ${component.fileId} is missing from its source.`);
            const componentId = `ic${++componentIndex}`;
            identities.set(componentId, {
                machineId: componentId,
                kind: 'component',
                origin: 'inherited',
                typeId: sourceDocument.typeId,
                typeName: sourceDocument.typeName,
                displayName: component.typeName,
                ownerId: goId,
                baselineOrder: index,
                scriptGuid: component.scriptGuid,
                sourceGuid,
                sourceFileId: component.fileId,
            });
            if (matchRemoval(removedComponentIds, matchedRemovedComponentIds, sourceGuid, component.fileId, 'removed-component')) {
                return [];
            }
            return { typeName: component.typeName, machineId: componentId };
        });
        projectAddedComponents(goId, sourceGuid, node.fileId, components);
        const children = node.children.map((child, index) => build(child, transformId, index));
        return {
            name: nameOverrides.get(node.fileId) ?? node.name,
            machineId: goId,
            components,
            children: tombstone ? [] : children,
            tombstone,
        };
    };
    const roots = [build(source.hierarchy)];
    if (addedComponentsBySourceGameObject.size > 0) {
        throw new Error(`Added component target ${addedComponentsBySourceGameObject.keys().next().value} ` +
            `is missing from the direct source ${sourceGuid}.`);
    }
    for (const key of removedGameObjectIds) {
        if (!matchedRemovedGameObjectIds.has(key)) {
            throw new Error(`Removed inherited GameObject ${key} is missing from the expanded source graph.`);
        }
    }
    for (const key of removedComponentIds) {
        if (!matchedRemovedComponentIds.has(key)) {
            throw new Error(`Removed inherited component ${key} is missing from the expanded source graph.`);
        }
    }
    for (const key of nestedOverrides.keys()) {
        if (!matchedNestedOverrides.has(key)) {
            throw new Error(`Variant nested override target ${key} is not uniquely owned by an expanded nested source.`);
        }
    }
    return roots;
}
function collectVariantAddedComponents(rootInstance, byId) {
    const result = new Map();
    const seenAddedObjects = new Set();
    for (const entry of rootInstance.addedComponents) {
        const targetFileId = String(entry.targetGameObject.fileID ?? '0');
        const targetGuid = String(entry.targetGameObject.guid ?? '');
        if (targetFileId === '0' || !targetGuid) {
            throw new Error('Variant m_AddedComponents target has incomplete leaf ownership.');
        }
        const addedFileId = String(entry.addedComponent.fileID ?? '0');
        if (addedFileId === '0' || seenAddedObjects.has(addedFileId)) {
            throw new Error(`Variant m_AddedComponents has an ambiguous addedObject ${addedFileId}.`);
        }
        seenAddedObjects.add(addedFileId);
        const addedDocument = byId.get(addedFileId);
        if (!addedDocument || addedDocument.stripped ||
            addedDocument.typeId === 1 || addedDocument.typeId === 4 || addedDocument.typeId === 224) {
            throw new Error(`Variant m_AddedComponents addedObject ${addedFileId} is not a local component.`);
        }
        const strippedGameObjectId = String(addedDocument.properties.m_GameObject?.fileID ?? '0');
        const strippedGameObject = byId.get(strippedGameObjectId);
        const source = strippedGameObject?.properties.m_CorrespondingSourceObject;
        const ownerFileId = String(strippedGameObject?.properties.m_PrefabInstance?.fileID ?? '0');
        if (!strippedGameObject?.stripped || strippedGameObject.typeId !== 1 ||
            String(source?.fileID ?? '0') !== targetFileId ||
            String(source?.guid ?? '') !== targetGuid || ownerFileId !== rootInstance.fileId) {
            throw new Error(`Variant added component ${addedFileId} has no unambiguous direct-owner stripped GameObject.`);
        }
        const key = `${targetGuid}:${targetFileId}`;
        const additions = result.get(key) ?? [];
        additions.push(addedDocument);
        result.set(key, additions);
    }
    return result;
}
function resolveEffectiveVariantSource(sourceGuid, options, resolving) {
    if (resolving.has(sourceGuid)) {
        throw new Error(`Variant source chain contains a cycle at ${sourceGuid}.`);
    }
    const sourcePath = options.sourceResolver?.resolveFilePath(sourceGuid);
    if (!sourcePath)
        throw new Error(`Variant source chain cannot resolve GUID ${sourceGuid}.`);
    resolving.add(sourceGuid);
    try {
        const source = (0, unity_yaml_parser_1.parseUnityYaml)((0, fs_1.readFileSync)(sourcePath, 'utf-8'));
        if (source.type === 'prefab' && source.hierarchy) {
            return {
                hierarchy: cloneHierarchy(source.hierarchy),
                documents: new Map(source.documents.map(document => [document.fileId, document])),
            };
        }
        if (source.type !== 'variant') {
            throw new Error(`Variant source ${sourceGuid} does not resolve to a prefab or variant hierarchy.`);
        }
        const roots = source.prefabInstances.filter(instance => String(instance.transformParent.fileID) === '0');
        if (roots.length !== 1 || !roots[0].sourcePrefab.guid) {
            throw new Error(`Variant source chain ${sourceGuid} must have exactly one root PrefabInstance owner.`);
        }
        const root = roots[0];
        const parentGuid = root.sourcePrefab.guid;
        const effective = resolveEffectiveVariantSource(parentGuid, options, resolving);
        applyVariantChainAddedRoots(effective, root, source, sourceGuid, parentGuid);
        applyVariantChainAddedComponents(effective, root, source, sourceGuid);
        applyVariantChainRemovedGameObjects(effective.hierarchy, root, sourceGuid, parentGuid);
        applyVariantChainRemovedComponents(effective.hierarchy, root, sourceGuid, parentGuid);
        applyVariantChainNames(effective.hierarchy, root, sourceGuid, parentGuid);
        return effective;
    }
    finally {
        resolving.delete(sourceGuid);
    }
}
function applyVariantChainAddedRoots(effective, instance, variant, variantGuid, parentGuid) {
    if (!variant.hierarchy)
        return;
    const localDocuments = new Map(variant.documents.map(document => [document.fileId, document]));
    const localRoots = variant.hierarchy.name === '__added_root__' ||
        !localDocuments.has(variant.hierarchy.fileId)
        ? variant.hierarchy.children
        : [variant.hierarchy];
    const rootDocument = localDocuments.get(instance.fileId);
    const additions = rootDocument?.properties.m_Modification?.m_AddedGameObjects ?? [];
    const additionsByObject = new Map();
    for (const addition of additions) {
        const target = addition?.targetCorrespondingSourceObject;
        const addedFileId = String(addition?.addedObject?.fileID ?? '0');
        if (String(target?.guid ?? '') !== parentGuid || String(target?.fileID ?? '0') === '0' ||
            addedFileId === '0' || additionsByObject.has(addedFileId)) {
            throw new Error(`Variant source chain ${variantGuid} has ambiguous added-root ownership for ${addedFileId}.`);
        }
        additionsByObject.set(addedFileId, addition);
    }
    const inheritedParents = new Map();
    const collectInherited = (node) => {
        const matches = inheritedParents.get(node.transform.fileId) ?? [];
        matches.push(node);
        inheritedParents.set(node.transform.fileId, matches);
        node.children.forEach(collectInherited);
    };
    collectInherited(effective.hierarchy);
    const addDocuments = (node) => {
        if (node.nestedPrefab) {
            throw new Error(`Variant source chain ${variantGuid} has unsupported nested content in added root ${node.name}.`);
        }
        for (const fileId of [node.fileId, node.transform.fileId, ...node.components.map(item => item.fileId)]) {
            const document = localDocuments.get(fileId);
            if (!document || effective.documents.has(fileId)) {
                throw new Error(`Variant source chain ${variantGuid} has ambiguous added-root document ${fileId}.`);
            }
            effective.documents.set(fileId, document);
        }
        node.children.forEach(addDocuments);
    };
    for (const localRoot of localRoots) {
        const addition = additionsByObject.get(localRoot.transform.fileId);
        if (!addition) {
            throw new Error(`Variant source chain ${variantGuid} added root ${localRoot.fileId} has no direct owner.`);
        }
        additionsByObject.delete(localRoot.transform.fileId);
        const targetFileId = String(addition.targetCorrespondingSourceObject.fileID);
        const parentMatches = inheritedParents.get(targetFileId) ?? [];
        if (parentMatches.length !== 1) {
            throw new Error(`Variant source chain ${variantGuid} added-root parent ${targetFileId} ` +
                'is not uniquely owned by its direct source.');
        }
        const transformDocument = localDocuments.get(localRoot.transform.fileId);
        const parentStubId = String(transformDocument?.properties.m_Father?.fileID ?? '0');
        const parentStub = localDocuments.get(parentStubId);
        const stubSource = parentStub?.properties.m_CorrespondingSourceObject;
        if (!transformDocument || transformDocument.stripped ||
            !parentStub?.stripped || (parentStub.typeId !== 4 && parentStub.typeId !== 224) ||
            String(stubSource?.fileID ?? '0') !== targetFileId ||
            String(stubSource?.guid ?? '') !== parentGuid ||
            String(parentStub.properties.m_PrefabInstance?.fileID ?? '0') !== instance.fileId) {
            throw new Error(`Variant source chain ${variantGuid} added root ${localRoot.fileId} ` +
                'has ambiguous direct-owner parent identity.');
        }
        const projected = cloneHierarchy(localRoot);
        addDocuments(projected);
        const parent = parentMatches[0];
        const requestedIndex = Number(addition.insertIndex ?? -1);
        const insertionIndex = requestedIndex < 0
            ? parent.children.length
            : Math.min(requestedIndex, parent.children.length);
        parent.children.splice(insertionIndex, 0, projected);
    }
    if (additionsByObject.size > 0) {
        throw new Error(`Variant source chain ${variantGuid} addedObject ${additionsByObject.keys().next().value} ` +
            'is not an exposed added root.');
    }
}
function applyVariantChainAddedComponents(effective, instance, variant, variantGuid) {
    const localDocuments = new Map(variant.documents.map(document => [document.fileId, document]));
    const additionsByGameObject = collectVariantAddedComponents(instance, localDocuments);
    const owners = new Map();
    const collect = (node) => {
        const matches = owners.get(node.fileId) ?? [];
        matches.push(node);
        owners.set(node.fileId, matches);
        node.children.forEach(collect);
    };
    collect(effective.hierarchy);
    for (const [targetKey, additions] of additionsByGameObject) {
        const separator = targetKey.indexOf(':');
        const targetGuid = targetKey.slice(0, separator);
        const targetFileId = targetKey.slice(separator + 1);
        const matches = targetGuid === instance.sourcePrefab.guid
            ? owners.get(targetFileId) ?? []
            : [];
        if (matches.length !== 1) {
            throw new Error(`Variant source chain ${variantGuid} added-component target ${targetKey} ` +
                'is not uniquely owned by its direct source.');
        }
        const owner = matches[0];
        for (const document of additions) {
            if (effective.documents.has(document.fileId) ||
                owner.components.some(component => component.fileId === document.fileId)) {
                throw new Error(`Variant source chain ${variantGuid} has ambiguous added component ${document.fileId}.`);
            }
            const script = document.typeId === 114 ? document.properties.m_Script : undefined;
            const requestedIndex = instance.addedComponents.find(entry => String(entry.addedComponent.fileID) === document.fileId)?.insertIndex ?? -1;
            const component = {
                typeName: script?.guid ? String(script.guid) : document.typeName,
                typeId: document.typeId,
                fileId: document.fileId,
                scriptGuid: script?.guid ? String(script.guid) : undefined,
                properties: { ...document.properties },
                stripped: false,
            };
            const insertionIndex = requestedIndex < 0
                ? owner.components.length
                : Math.min(requestedIndex, owner.components.length);
            owner.components.splice(insertionIndex, 0, component);
            effective.documents.set(document.fileId, document);
        }
    }
}
function applyVariantChainRemovedGameObjects(hierarchy, instance, variantGuid, parentGuid) {
    const owners = new Map();
    const collect = (node) => {
        for (const child of node.children) {
            const matches = owners.get(child.fileId) ?? [];
            matches.push(node);
            owners.set(child.fileId, matches);
            collect(child);
        }
    };
    collect(hierarchy);
    const removed = new Set();
    for (const reference of instance.removedGameObjects) {
        const fileId = String(reference.fileID ?? '0');
        if (String(reference.guid ?? '') !== parentGuid || fileId === '0' || removed.has(fileId)) {
            throw new Error(`Variant source chain ${variantGuid} has ambiguous removed-GameObject ownership for ${fileId}.`);
        }
        const matches = owners.get(fileId) ?? [];
        if (matches.length !== 1) {
            throw new Error(`Variant source chain ${variantGuid} removed GameObject ${fileId} is not uniquely owned by its direct source.`);
        }
        matches[0].children = matches[0].children.filter(child => child.fileId !== fileId);
        removed.add(fileId);
    }
}
function applyVariantChainRemovedComponents(hierarchy, instance, variantGuid, parentGuid) {
    const owners = new Map();
    const collect = (node) => {
        for (const component of node.components) {
            const matches = owners.get(component.fileId) ?? [];
            matches.push(node);
            owners.set(component.fileId, matches);
        }
        node.children.forEach(collect);
    };
    collect(hierarchy);
    const removed = new Set();
    for (const reference of instance.removedComponents) {
        const fileId = String(reference.fileID ?? '0');
        if (String(reference.guid ?? '') !== parentGuid || fileId === '0' || removed.has(fileId)) {
            throw new Error(`Variant source chain ${variantGuid} has ambiguous removed-component ownership for ${fileId}.`);
        }
        const matches = owners.get(fileId) ?? [];
        if (matches.length !== 1) {
            throw new Error(`Variant source chain ${variantGuid} removed component ${fileId} is not uniquely owned by its direct source.`);
        }
        matches[0].components = matches[0].components.filter(component => component.fileId !== fileId);
        removed.add(fileId);
    }
}
function applyVariantChainNames(hierarchy, instance, variantGuid, parentGuid) {
    const byFileId = new Map();
    const collect = (node) => {
        if (byFileId.has(node.fileId)) {
            throw new Error(`Variant source chain ${variantGuid} has ambiguous GameObject fileID ${node.fileId}.`);
        }
        byFileId.set(node.fileId, node);
        node.children.forEach(collect);
    };
    collect(hierarchy);
    const renamed = new Set();
    for (const modification of instance.modifications) {
        if (modification.propertyPath !== 'm_Name')
            continue;
        const targetFileId = String(modification.target.fileID);
        if (String(modification.target.guid ?? '') !== parentGuid || targetFileId === '0') {
            throw new Error(`Variant source chain ${variantGuid} has ambiguous name ownership for ${targetFileId}.`);
        }
        const target = byFileId.get(targetFileId);
        if (!target) {
            throw new Error(`Variant source chain ${variantGuid} name target ${targetFileId} is not in its effective tree.`);
        }
        if (renamed.has(targetFileId)) {
            throw new Error(`Variant source chain ${variantGuid} has ambiguous name ownership for ${targetFileId}.`);
        }
        target.name = modification.value;
        renamed.add(targetFileId);
    }
}
function cloneHierarchy(node) {
    return {
        ...node,
        transform: { ...node.transform, properties: { ...node.transform.properties } },
        components: node.components.map(component => ({ ...component, properties: { ...component.properties } })),
        children: node.children.map(cloneHierarchy),
        nestedPrefab: node.nestedPrefab ? { ...node.nestedPrefab } : undefined,
    };
}
function applySourceFingerprints(identities, options) {
    if (!options.sourceResolver)
        return;
    const fingerprints = new Map();
    for (const identity of identities.values()) {
        if (!identity.sourceGuid)
            continue;
        let fingerprint = fingerprints.get(identity.sourceGuid);
        if (!fingerprint) {
            const sourcePath = options.sourceResolver.resolveFilePath(identity.sourceGuid);
            if (!sourcePath)
                continue;
            fingerprint = (0, crypto_1.createHash)('sha256').update((0, fs_1.readFileSync)(sourcePath)).digest('hex');
            fingerprints.set(identity.sourceGuid, fingerprint);
        }
        identity.sourceFingerprint = fingerprint;
    }
}
function writeStructure(root) {
    const lines = [];
    const visit = (node, prefix, isLast, isRoot) => {
        const branch = isRoot ? '' : `${prefix}${isLast ? '└─ ' : '├─ '}`;
        const components = node.components.length
            ? ` [${node.components.map(component => `${component.typeName} @${component.machineId}`).join(', ')}]`
            : '';
        const nested = node.nestedSourceGuid
            ? ` {${node.prefabInstanceId ? `prefab:@${node.prefabInstanceId} ` : ''}source:${node.nestedSourceGuid}}`
            : '';
        lines.push(`${branch}${node.name} @${node.machineId}${nested}${components}`);
        const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`;
        node.children.forEach((child, index) => visit(child, childPrefix, index === node.children.length - 1, false));
    };
    visit(root, '', true, true);
    return lines;
}
function writeIdentity(identity) {
    const fields = [identity.kind];
    if (identity.origin)
        fields.push(`origin:${identity.origin}`);
    if (identity.fileId)
        fields.push(`fileID:${identity.fileId}`);
    fields.push(`type:${identity.typeId}`, `typeName:${identity.typeName}`);
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
    if (identity.sourceGuid)
        fields.push(`sourceGuid:${identity.sourceGuid}`);
    if (identity.sourceFileId)
        fields.push(`sourceFileID:${identity.sourceFileId}`);
    if (identity.sourceFingerprint)
        fields.push(`sourceFingerprint:${identity.sourceFingerprint}`);
    return `${identity.machineId} = ${fields.join(' | ')}`;
}
function writeVariantRoots(roots) {
    const lines = [];
    const visit = (node, prefix, isLast) => {
        const components = node.components.length
            ? ` [${node.components.map(component => `${component.typeName} @${component.machineId}`).join(', ')}]`
            : '';
        const nested = node.nestedSourceGuid
            ? ` {${node.prefabInstanceId ? `prefab:@${node.prefabInstanceId} ` : ''}source:${node.nestedSourceGuid}}`
            : '';
        const tombstone = node.tombstone ? '- ' : '';
        lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${tombstone}${node.name} @${node.machineId}${nested}${components}`);
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