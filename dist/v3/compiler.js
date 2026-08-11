"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileV3 = compileV3;
const crypto_1 = require("crypto");
const value_1 = require("./value");
const references_1 = require("./references");
const COMMON_LOCAL_ENVELOPE = {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
};
function compileV3(document) {
    if (document.version !== 3)
        throw new Error('compileV3 accepts v3 documents only.');
    if (document.kind === 'variant')
        return compileVariant(document);
    if (!document.structure)
        throw new Error('v3 prefab requires STRUCTURE.');
    const allocated = allocateFileIds(document);
    const documents = [];
    const emittedMachineIds = new Set();
    const nestedPlans = new Map();
    const buildNode = (node, parentTransformId, siblingIndex, parentTransformMachineId) => {
        if (node.nestedSourceGuid) {
            if (nestedPlans.has(node.machineId)) {
                throw new Error(`Nested PrefabInstance ${node.machineId} appears more than once in STRUCTURE.`);
            }
            nestedPlans.set(node.machineId, {
                machineId: node.machineId,
                name: node.name,
                parentTransformId,
                parentTransformMachineId,
                siblingIndex,
            });
            return;
        }
        const goIdentity = requireIdentity(document, node.machineId, 'gameObject');
        const transformIdentity = findOwnedTransform(document, node.machineId);
        const goId = allocated.get(goIdentity.machineId);
        const transformId = allocated.get(transformIdentity.machineId);
        const componentIds = node.components.map(component => {
            const identity = requireIdentity(document, component.machineId, 'component');
            return allocated.get(identity.machineId);
        });
        emittedMachineIds.add(goIdentity.machineId);
        emittedMachineIds.add(transformIdentity.machineId);
        node.components.forEach(component => emittedMachineIds.add(component.machineId));
        const gameObjectProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(node.machineId));
        gameObjectProperties.serializedVersion ?? (gameObjectProperties.serializedVersion = 6);
        gameObjectProperties.m_Component = [transformId, ...componentIds]
            .map(fileID => ({ component: { fileID } }));
        gameObjectProperties.m_Layer ?? (gameObjectProperties.m_Layer = 0);
        gameObjectProperties.m_Name = node.name;
        gameObjectProperties.m_TagString ?? (gameObjectProperties.m_TagString = 'Untagged');
        gameObjectProperties.m_Icon ?? (gameObjectProperties.m_Icon = { fileID: 0 });
        gameObjectProperties.m_NavMeshLayer ?? (gameObjectProperties.m_NavMeshLayer = 0);
        gameObjectProperties.m_StaticEditorFlags ?? (gameObjectProperties.m_StaticEditorFlags = 0);
        gameObjectProperties.m_IsActive ?? (gameObjectProperties.m_IsActive = 1);
        documents.push(makeDocument(goIdentity, goId, gameObjectProperties));
        const transformProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(transformIdentity.machineId));
        transformProperties.m_GameObject = { fileID: goId };
        transformProperties.serializedVersion ?? (transformProperties.serializedVersion = 2);
        transformProperties.m_LocalRotation ?? (transformProperties.m_LocalRotation = flow({ x: 0, y: 0, z: 0, w: 1 }));
        transformProperties.m_LocalPosition ?? (transformProperties.m_LocalPosition = flow({ x: 0, y: 0, z: 0 }));
        transformProperties.m_LocalScale ?? (transformProperties.m_LocalScale = flow({ x: 1, y: 1, z: 1 }));
        transformProperties.m_Children = node.children.map(child => ({
            fileID: allocated.get(findDesiredRootTransform(document, child).machineId),
        }));
        transformProperties.m_Father = { fileID: parentTransformId };
        transformProperties.m_RootOrder = siblingIndex;
        transformProperties.m_LocalEulerAnglesHint ?? (transformProperties.m_LocalEulerAnglesHint = flow({ x: 0, y: 0, z: 0 }));
        if (transformIdentity.typeId === 224) {
            transformProperties.m_AnchorMin ?? (transformProperties.m_AnchorMin = flow({ x: 0.5, y: 0.5 }));
            transformProperties.m_AnchorMax ?? (transformProperties.m_AnchorMax = flow({ x: 0.5, y: 0.5 }));
            transformProperties.m_AnchoredPosition ?? (transformProperties.m_AnchoredPosition = flow({ x: 0, y: 0 }));
            transformProperties.m_SizeDelta ?? (transformProperties.m_SizeDelta = flow({ x: 100, y: 100 }));
            transformProperties.m_Pivot ?? (transformProperties.m_Pivot = flow({ x: 0.5, y: 0.5 }));
        }
        documents.push(makeDocument(transformIdentity, transformId, transformProperties));
        node.components.forEach(component => {
            const identity = requireIdentity(document, component.machineId, 'component');
            const properties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(identity.machineId));
            properties.m_GameObject = { fileID: goId };
            if (identity.typeId === 114) {
                if (!identity.scriptGuid)
                    throw new Error(`MonoBehaviour ${identity.machineId} requires script GUID identity.`);
                properties.m_Enabled ?? (properties.m_Enabled = 1);
                properties.m_EditorHideFlags ?? (properties.m_EditorHideFlags = 0);
                properties.m_Script = {
                    fileID: identity.scriptFileId ?? 11500000,
                    guid: identity.scriptGuid,
                    type: identity.scriptType ?? 3,
                };
                properties.m_Name ?? (properties.m_Name = '');
                properties.m_EditorClassIdentifier ?? (properties.m_EditorClassIdentifier = '');
            }
            documents.push(makeDocument(identity, allocated.get(identity.machineId), properties));
        });
        node.children.forEach((child, index) => buildNode(child, transformId, index, transformIdentity.machineId));
    };
    buildNode(document.structure, '0', 0);
    const desiredOwnership = new Map();
    const isDesiredOwnership = (machineId) => {
        if (desiredOwnership.has(machineId))
            return desiredOwnership.get(machineId);
        const identity = document.identity.get(machineId);
        if (!identity)
            return false;
        desiredOwnership.set(machineId, false);
        const desired = identity.kind === 'prefabInstance' && nestedPlans.has(machineId) ||
            !!identity.ownerId && isDesiredOwnership(identity.ownerId);
        desiredOwnership.set(machineId, desired);
        return desired;
    };
    for (const identity of document.identity.values()) {
        if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned')
            continue;
        if (identity.ownerId || identity.kind === 'prefabInstance') {
            if (!isDesiredOwnership(identity.machineId))
                continue;
        }
        const properties = document.details.get(identity.machineId);
        if (!properties)
            throw new Error(`Raw ownership identity ${identity.machineId} requires DETAILS.`);
        let compiledProperties = clone(properties);
        if (identity.kind === 'prefabInstance' && nestedPlans.has(identity.machineId)) {
            compiledProperties = applyNestedInstancePlan(document, identity, nestedPlans.get(identity.machineId), compiledProperties);
        }
        documents.push(makeDocument(identity, allocated.get(identity.machineId), compiledProperties));
        emittedMachineIds.add(identity.machineId);
    }
    for (const unityDocument of documents) {
        unityDocument.properties = (0, value_1.markCanonicalFlowMappings)((0, references_1.resolveV3References)(unityDocument.properties, allocated, emittedMachineIds, `${unityDocument.typeName}&${unityDocument.fileId}`));
    }
    assertUniqueFileIds(documents);
    return { type: 'prefab', documents, prefabInstances: [] };
}
function applyNestedInstancePlan(document, identity, plan, properties) {
    const modification = properties.m_Modification;
    if (!modification || typeof modification !== 'object') {
        throw new Error(`PrefabInstance ${identity.machineId} has no m_Modification DETAILS.`);
    }
    modification.m_TransformParent = { fileID: plan.parentTransformId };
    if (!Array.isArray(modification.m_Modifications))
        modification.m_Modifications = [];
    const rootTransform = [...document.identity.values()].find(record => record.kind === 'stripped' && record.ownerId === identity.machineId && record.nestedRoot);
    const rootTransformDetails = rootTransform
        ? document.details.get(rootTransform.machineId)
        : undefined;
    const rootTransformSource = rootTransformDetails?.m_CorrespondingSourceObject;
    if (!rootTransformSource || typeof rootTransformSource !== 'object') {
        throw new Error(`PrefabInstance ${identity.machineId} has no source root Transform identity.`);
    }
    const placementChanged = identity.baselineParentId !== plan.parentTransformMachineId ||
        identity.baselineOrder !== plan.siblingIndex;
    if (placementChanged) {
        upsertModification(modification.m_Modifications, rootTransformSource, 'm_RootOrder', String(plan.siblingIndex));
    }
    if (identity.displayName !== undefined && plan.name !== identity.displayName) {
        const existingName = modification.m_Modifications.find((entry) => entry?.propertyPath === 'm_Name');
        if (existingName) {
            existingName.value = plan.name;
            existingName.objectReference = { fileID: 0 };
        }
        else {
            const strippedGameObject = [...document.identity.values()].find(record => record.kind === 'stripped' && record.ownerId === identity.machineId && record.typeId === 1);
            const source = strippedGameObject
                ? document.details.get(strippedGameObject.machineId)?.m_CorrespondingSourceObject
                : undefined;
            if (!source || typeof source !== 'object') {
                throw new Error(`Cannot rename nested PrefabInstance ${identity.machineId}: source GameObject identity is unavailable.`);
            }
            upsertModification(modification.m_Modifications, source, 'm_Name', plan.name);
        }
    }
    return properties;
}
function upsertModification(modifications, target, propertyPath, value) {
    const targetFileId = String(target.fileID ?? '0');
    const targetGuid = String(target.guid ?? '');
    const existing = modifications.find(entry => entry?.propertyPath === propertyPath &&
        String(entry?.target?.fileID ?? '0') === targetFileId &&
        String(entry?.target?.guid ?? '') === targetGuid);
    if (existing) {
        existing.value = value;
        existing.objectReference = { fileID: 0 };
        return;
    }
    modifications.push({
        target: clone(target),
        propertyPath,
        value,
        objectReference: { fileID: 0 },
    });
}
function compileVariant(document) {
    const allocated = allocateFileIds(document);
    const emitted = new Set();
    const documents = [];
    const nestedPlans = new Map();
    const buildNode = (node, parentTransformId, siblingIndex, parentTransformMachineId) => {
        if (node.nestedSourceGuid) {
            if (nestedPlans.has(node.machineId)) {
                throw new Error(`Nested PrefabInstance ${node.machineId} appears more than once in variant STRUCTURE.`);
            }
            nestedPlans.set(node.machineId, {
                machineId: node.machineId,
                name: node.name,
                parentTransformId,
                parentTransformMachineId,
                siblingIndex,
            });
            return;
        }
        const goIdentity = requireIdentity(document, node.machineId, 'gameObject');
        const transformIdentity = findOwnedTransform(document, node.machineId);
        const goId = allocated.get(goIdentity.machineId);
        const transformId = allocated.get(transformIdentity.machineId);
        const componentIds = node.components.map(component => allocated.get(requireIdentity(document, component.machineId, 'component').machineId));
        emitted.add(goIdentity.machineId);
        emitted.add(transformIdentity.machineId);
        node.components.forEach(component => emitted.add(component.machineId));
        const gameObjectProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(node.machineId));
        gameObjectProperties.serializedVersion ?? (gameObjectProperties.serializedVersion = 6);
        gameObjectProperties.m_Component = [transformId, ...componentIds]
            .map(fileID => ({ component: { fileID } }));
        gameObjectProperties.m_Layer ?? (gameObjectProperties.m_Layer = 0);
        gameObjectProperties.m_Name = node.name;
        gameObjectProperties.m_TagString ?? (gameObjectProperties.m_TagString = 'Untagged');
        gameObjectProperties.m_Icon ?? (gameObjectProperties.m_Icon = { fileID: 0 });
        gameObjectProperties.m_NavMeshLayer ?? (gameObjectProperties.m_NavMeshLayer = 0);
        gameObjectProperties.m_StaticEditorFlags ?? (gameObjectProperties.m_StaticEditorFlags = 0);
        gameObjectProperties.m_IsActive ?? (gameObjectProperties.m_IsActive = 1);
        documents.push(makeDocument(goIdentity, goId, gameObjectProperties));
        const transformProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(transformIdentity.machineId));
        transformProperties.m_GameObject = { fileID: goId };
        transformProperties.m_LocalRotation ?? (transformProperties.m_LocalRotation = flow({ x: 0, y: 0, z: 0, w: 1 }));
        transformProperties.m_LocalPosition ?? (transformProperties.m_LocalPosition = flow({ x: 0, y: 0, z: 0 }));
        transformProperties.m_LocalScale ?? (transformProperties.m_LocalScale = flow({ x: 1, y: 1, z: 1 }));
        transformProperties.m_Children = node.children.map(child => ({
            fileID: allocated.get(findDesiredRootTransform(document, child).machineId),
        }));
        if (parentTransformMachineId)
            transformProperties.m_Father = { fileID: parentTransformId };
        else
            transformProperties.m_Father ?? (transformProperties.m_Father = { fileID: parentTransformId });
        const placementChanged = transformIdentity.baselineParentId !== parentTransformMachineId ||
            transformIdentity.baselineOrder !== siblingIndex;
        if (Object.prototype.hasOwnProperty.call(transformProperties, 'm_RootOrder') || placementChanged) {
            transformProperties.m_RootOrder = siblingIndex;
        }
        transformProperties.m_LocalEulerAnglesHint ?? (transformProperties.m_LocalEulerAnglesHint = flow({ x: 0, y: 0, z: 0 }));
        documents.push(makeDocument(transformIdentity, transformId, transformProperties));
        node.components.forEach(component => {
            const identity = requireIdentity(document, component.machineId, 'component');
            const properties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(identity.machineId));
            properties.m_GameObject = { fileID: goId };
            if (identity.typeId === 114) {
                if (!identity.scriptGuid)
                    throw new Error(`MonoBehaviour ${identity.machineId} requires script GUID identity.`);
                properties.m_Enabled ?? (properties.m_Enabled = 1);
                properties.m_EditorHideFlags ?? (properties.m_EditorHideFlags = 0);
                properties.m_Script = {
                    fileID: identity.scriptFileId ?? 11500000,
                    guid: identity.scriptGuid,
                    type: identity.scriptType ?? 3,
                };
                properties.m_Name ?? (properties.m_Name = '');
                properties.m_EditorClassIdentifier ?? (properties.m_EditorClassIdentifier = '');
            }
            documents.push(makeDocument(identity, allocated.get(identity.machineId), properties));
        });
        node.children.forEach((child, index) => buildNode(child, transformId, index, transformIdentity.machineId));
    };
    (document.variantRoots ?? []).forEach((root, index) => buildNode(root, '0', index));
    const desiredOwnership = new Map();
    const isDesiredOwnership = (machineId) => {
        if (desiredOwnership.has(machineId))
            return desiredOwnership.get(machineId);
        const identity = document.identity.get(machineId);
        if (!identity)
            return false;
        desiredOwnership.set(machineId, false);
        const desired = machineId === document.variantRootId || nestedPlans.has(machineId) ||
            !!identity.ownerId && isDesiredOwnership(identity.ownerId);
        desiredOwnership.set(machineId, desired);
        return desired;
    };
    for (const identity of document.identity.values()) {
        if (identity.kind === 'gameObject' || identity.kind === 'transform' || identity.kind === 'component')
            continue;
        if (identity.kind !== 'prefabInstance' && identity.kind !== 'stripped' && identity.kind !== 'owned')
            continue;
        if ((identity.ownerId || identity.kind === 'prefabInstance') && !isDesiredOwnership(identity.machineId))
            continue;
        const details = document.details.get(identity.machineId);
        if (!details)
            throw new Error(`Variant identity ${identity.machineId} requires DETAILS.`);
        let properties = clone(details);
        if (identity.kind === 'prefabInstance' && nestedPlans.has(identity.machineId)) {
            properties = applyNestedInstancePlan(document, identity, nestedPlans.get(identity.machineId), properties);
        }
        documents.push(makeDocument(identity, allocated.get(identity.machineId), properties));
        emitted.add(identity.machineId);
    }
    for (const unityDocument of documents) {
        if (unityDocument.typeId === 1001)
            pruneAbsentAddedObjects(unityDocument.properties, emitted);
        unityDocument.properties = (0, value_1.markCanonicalFlowMappings)((0, references_1.resolveV3References)(unityDocument.properties, allocated, emitted, `${unityDocument.typeName}&${unityDocument.fileId}`));
    }
    assertUniqueFileIds(documents);
    return {
        type: 'variant',
        documents,
        prefabInstances: [],
        variantSource: document.baseGuid
            ? { fileID: '100100000', guid: document.baseGuid, type: 3 }
            : undefined,
    };
}
function pruneAbsentAddedObjects(properties, emitted) {
    const modification = properties.m_Modification;
    if (!modification || typeof modification !== 'object')
        return;
    const keep = (entry) => {
        const reference = entry?.addedObject;
        return !reference?.$ref || emitted.has(String(reference.$ref));
    };
    if (Array.isArray(modification.m_AddedGameObjects)) {
        modification.m_AddedGameObjects = modification.m_AddedGameObjects.filter(keep);
    }
    if (Array.isArray(modification.m_AddedComponents)) {
        modification.m_AddedComponents = modification.m_AddedComponents.filter(keep);
    }
}
function allocateFileIds(document) {
    const result = new Map();
    const occupied = new Set();
    for (const identity of document.identity.values()) {
        if (!identity.fileId)
            continue;
        if (identity.fileId === '0' || occupied.has(identity.fileId)) {
            throw new Error(`Invalid or duplicate fileID ${identity.fileId} on ${identity.machineId}.`);
        }
        occupied.add(identity.fileId);
        result.set(identity.machineId, identity.fileId);
    }
    for (const identity of document.identity.values()) {
        if (result.has(identity.machineId))
            continue;
        let salt = 0;
        while (true) {
            const seed = `${document.assetGuid || document.profile}|${identity.machineId}|${identity.kind}|${salt}`;
            const digest = (0, crypto_1.createHash)('sha256').update(seed).digest();
            const candidate = (digest.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
            if (candidate !== '0' && !occupied.has(candidate)) {
                occupied.add(candidate);
                result.set(identity.machineId, candidate);
                break;
            }
            salt++;
        }
    }
    return result;
}
function requireIdentity(document, machineId, kind) {
    const identity = document.identity.get(machineId);
    if (!identity || identity.kind !== kind)
        throw new Error(`${machineId} is not a ${kind} identity.`);
    return identity;
}
function findOwnedTransform(document, ownerId) {
    const matches = [...document.identity.values()].filter(identity => identity.kind === 'transform' && identity.ownerId === ownerId);
    if (matches.length !== 1)
        throw new Error(`${ownerId} must own exactly one Transform identity.`);
    return matches[0];
}
function findDesiredRootTransform(document, node) {
    if (!node.nestedSourceGuid)
        return findOwnedTransform(document, node.machineId);
    const matches = [...document.identity.values()].filter(identity => identity.kind === 'stripped' && identity.ownerId === node.machineId && identity.nestedRoot &&
        (identity.typeId === 4 || identity.typeId === 224));
    if (matches.length !== 1) {
        throw new Error(`${node.machineId} must own exactly one stripped root Transform identity.`);
    }
    return matches[0];
}
function mergeDetails(base, details) {
    return (0, value_1.markCanonicalFlowMappings)({ ...clone(base), ...clone(details || {}) });
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function flow(value) {
    Object.defineProperty(value, '__flow', { value: true, enumerable: false });
    return value;
}
function makeDocument(identity, fileId, properties) {
    return {
        typeId: identity.typeId,
        typeName: identity.typeName,
        fileId,
        stripped: identity.stripped === true,
        properties,
    };
}
function assertUniqueFileIds(documents) {
    const ids = new Set();
    for (const document of documents) {
        if (ids.has(document.fileId))
            throw new Error(`Compiler produced duplicate fileID ${document.fileId}.`);
        ids.add(document.fileId);
    }
}
//# sourceMappingURL=compiler.js.map