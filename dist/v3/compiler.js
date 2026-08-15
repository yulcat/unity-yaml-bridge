"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileV3 = compileV3;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const value_1 = require("./value");
const references_1 = require("./references");
const COMMON_LOCAL_ENVELOPE = {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
};
function compileV3(document, options = {}) {
    if (document.version !== 3)
        throw new Error('compileV3 accepts v3 documents only.');
    validateSourceFingerprints(document, options);
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
function validateSourceFingerprints(document, options) {
    if (!options.sourceResolver)
        return;
    const checked = new Set();
    for (const identity of document.identity.values()) {
        if (!identity.sourceGuid || !identity.sourceFingerprint)
            continue;
        const key = `${identity.sourceGuid}:${identity.sourceFingerprint}`;
        if (checked.has(key))
            continue;
        const sourcePath = options.sourceResolver.resolveFilePath(identity.sourceGuid);
        if (!sourcePath) {
            throw new Error(`Source project cannot resolve GUID ${identity.sourceGuid}.`);
        }
        const actual = (0, crypto_1.createHash)('sha256').update((0, fs_1.readFileSync)(sourcePath)).digest('hex');
        if (actual !== identity.sourceFingerprint) {
            throw new Error(`Source fingerprint mismatch for GUID ${identity.sourceGuid}.`);
        }
        checked.add(key);
    }
}
function applyNestedInstancePlan(document, identity, plan, properties) {
    const modification = properties.m_Modification;
    if (!modification || typeof modification !== 'object') {
        throw new Error(`PrefabInstance ${identity.machineId} has no m_Modification DETAILS.`);
    }
    if (plan.parentTransformMachineId || !modification.m_TransformParent) {
        modification.m_TransformParent = { fileID: plan.parentTransformId };
    }
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
    const removedGameObjects = [];
    const removedComponents = [];
    const addedGameObjects = [];
    const addedComponents = [];
    const inheritedGameObjectStubs = new Map();
    const usedInheritedStubIds = new Set();
    const desiredInheritedNestedInstances = new Set();
    const desiredInheritedNestedInternals = new Set();
    const hasInheritedStructure = [...document.identity.values()].some(identity => identity.origin === 'inherited');
    const validateInheritedNestedInternal = (node, prefabOwnerId, nestedSourceGuid, parentTransformMachineId, siblingIndex, sourceRoot = false) => {
        if ((node.nestedSourceGuid && !sourceRoot) || node.tombstone) {
            throw new Error(`Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`);
        }
        const gameObject = requireIdentity(document, node.machineId, 'gameObject');
        const transform = findOwnedTransform(document, node.machineId);
        if (gameObject.origin !== 'inherited' || gameObject.prefabOwnerId !== prefabOwnerId ||
            gameObject.sourceGuid !== nestedSourceGuid || !gameObject.sourceFileId ||
            gameObject.displayName !== node.name || transform.origin !== 'inherited' ||
            transform.prefabOwnerId !== prefabOwnerId || transform.sourceGuid !== nestedSourceGuid ||
            !transform.sourceFileId || transform.baselineParentId !== parentTransformMachineId ||
            transform.baselineOrder !== siblingIndex) {
            throw new Error(`Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`);
        }
        desiredInheritedNestedInternals.add(gameObject.machineId);
        desiredInheritedNestedInternals.add(transform.machineId);
        const baselineComponents = [...document.identity.values()]
            .filter(identity => identity.kind === 'component' && identity.origin === 'inherited' &&
            identity.prefabOwnerId === prefabOwnerId && identity.ownerId === gameObject.machineId)
            .sort((left, right) => (left.baselineOrder ?? -1) - (right.baselineOrder ?? -1));
        if (baselineComponents.length !== node.components.length) {
            throw new Error(`Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`);
        }
        node.components.forEach((component, index) => {
            const identity = requireIdentity(document, component.machineId, 'component');
            if (identity !== baselineComponents[index] || identity.ownerId !== gameObject.machineId ||
                identity.prefabOwnerId !== prefabOwnerId || identity.sourceGuid !== nestedSourceGuid ||
                !identity.sourceFileId || identity.baselineOrder !== index ||
                (identity.displayName || identity.typeName) !== component.typeName) {
                throw new Error(`Structural editing of inherited nested PrefabInstance ${prefabOwnerId} internals is not implemented.`);
            }
            desiredInheritedNestedInternals.add(identity.machineId);
        });
        node.children.forEach((child, index) => validateInheritedNestedInternal(child, prefabOwnerId, nestedSourceGuid, transform.machineId, index));
    };
    const buildNode = (node, parentTransformId, siblingIndex, parentTransformMachineId) => {
        if (node.tombstone) {
            if (node.children.length > 0) {
                throw new Error(`GameObject tombstone ${node.machineId} cannot have effective children.`);
            }
            const identity = requireIdentity(document, node.machineId, 'gameObject');
            if (identity.origin !== 'inherited' || !identity.sourceGuid || !identity.sourceFileId) {
                throw new Error(`GameObject tombstone ${node.machineId} requires inherited source identity.`);
            }
            removedGameObjects.push({
                fileID: identity.sourceFileId,
                guid: identity.sourceGuid,
                type: 3,
            });
            return;
        }
        if (node.nestedSourceGuid && node.prefabInstanceId) {
            const identity = requireIdentity(document, node.prefabInstanceId, 'prefabInstance');
            if (identity.origin !== 'inherited' || !identity.sourceGuid || !identity.sourceFileId) {
                throw new Error(`Inherited nested PrefabInstance ${node.prefabInstanceId} has no direct source identity.`);
            }
            validateInheritedNestedInternal(node, identity.machineId, node.nestedSourceGuid, parentTransformMachineId, siblingIndex, true);
            desiredInheritedNestedInstances.add(identity.machineId);
            return;
        }
        if (node.nestedSourceGuid) {
            const identity = requireIdentity(document, node.machineId, 'prefabInstance');
            if (identity.origin === 'inherited') {
                if (!identity.sourceGuid || !identity.sourceFileId) {
                    throw new Error(`Inherited nested PrefabInstance ${node.machineId} has no direct source identity.`);
                }
                if (node.components.length > 0 ||
                    node.name !== identity.displayName ||
                    identity.baselineParentId !== parentTransformMachineId ||
                    identity.baselineOrder !== siblingIndex) {
                    throw new Error(`Structural editing of inherited nested PrefabInstance ${node.machineId} is not implemented.`);
                }
                node.children.forEach((child, index) => validateInheritedNestedInternal(child, node.machineId, node.nestedSourceGuid, node.machineId, index));
                desiredInheritedNestedInstances.add(node.machineId);
                return;
            }
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
        if (goIdentity.origin === 'inherited') {
            const desiredComponents = new Set(node.components.map(component => component.machineId));
            for (const identity of document.identity.values()) {
                if (identity.kind !== 'component' || identity.origin !== 'inherited' ||
                    identity.ownerId !== goIdentity.machineId || desiredComponents.has(identity.machineId))
                    continue;
                if (!identity.sourceGuid || !identity.sourceFileId) {
                    throw new Error(`Removed inherited component ${identity.machineId} has no source identity.`);
                }
                removedComponents.push({
                    fileID: identity.sourceFileId,
                    guid: identity.sourceGuid,
                    type: 3,
                });
            }
            if (transformIdentity.origin !== 'inherited') {
                throw new Error(`Inherited STRUCTURE node ${node.machineId} has mixed local ownership.`);
            }
            for (const component of node.components) {
                const identity = requireIdentity(document, component.machineId, 'component');
                if (identity.origin === 'inherited')
                    continue;
                if (identity.ownerId !== goIdentity.machineId ||
                    !identity.prefabOwnerId || identity.prefabOwnerId !== document.variantRootId) {
                    throw new Error(`Local component ${identity.machineId} on inherited GameObject ${goIdentity.machineId} ` +
                        'requires its direct PrefabInstance owner.');
                }
                if (!goIdentity.sourceGuid || !goIdentity.sourceFileId) {
                    throw new Error(`Inherited GameObject ${goIdentity.machineId} has no source identity.`);
                }
                const ownerIdentity = requireIdentity(document, identity.prefabOwnerId, 'prefabInstance');
                let strippedGameObjectId = inheritedGameObjectStubs.get(goIdentity.machineId);
                if (!strippedGameObjectId) {
                    const existingStub = findInheritedGameObjectStub(document, goIdentity, ownerIdentity);
                    if (existingStub) {
                        strippedGameObjectId = allocated.get(existingStub.machineId);
                        usedInheritedStubIds.add(existingStub.machineId);
                    }
                    else {
                        strippedGameObjectId = allocateSyntheticFileId(document, `inherited-game-object:${goIdentity.machineId}`, allocated);
                        documents.push({
                            typeId: 1,
                            typeName: 'GameObject',
                            fileId: strippedGameObjectId,
                            stripped: true,
                            properties: {
                                m_CorrespondingSourceObject: {
                                    fileID: goIdentity.sourceFileId,
                                    guid: goIdentity.sourceGuid,
                                    type: 3,
                                },
                                m_PrefabInstance: { fileID: allocated.get(ownerIdentity.machineId) },
                                m_PrefabAsset: { fileID: 0 },
                            },
                        });
                    }
                    inheritedGameObjectStubs.set(goIdentity.machineId, strippedGameObjectId);
                }
                const componentProperties = mergeDetails(COMMON_LOCAL_ENVELOPE, document.details.get(identity.machineId));
                componentProperties.m_GameObject = { fileID: strippedGameObjectId };
                if (identity.typeId === 114) {
                    if (!identity.scriptGuid) {
                        throw new Error(`MonoBehaviour ${identity.machineId} requires script GUID identity.`);
                    }
                    componentProperties.m_Enabled ?? (componentProperties.m_Enabled = 1);
                    componentProperties.m_EditorHideFlags ?? (componentProperties.m_EditorHideFlags = 0);
                    componentProperties.m_Script = {
                        fileID: identity.scriptFileId ?? 11500000,
                        guid: identity.scriptGuid,
                        type: identity.scriptType ?? 3,
                    };
                    componentProperties.m_Name ?? (componentProperties.m_Name = '');
                    componentProperties.m_EditorClassIdentifier ?? (componentProperties.m_EditorClassIdentifier = '');
                }
                documents.push(makeDocument(identity, allocated.get(identity.machineId), componentProperties));
                emitted.add(identity.machineId);
                addedComponents.push({
                    targetCorrespondingSourceObject: {
                        fileID: goIdentity.sourceFileId,
                        guid: goIdentity.sourceGuid,
                        type: 3,
                    },
                    insertIndex: -1,
                    addedObject: { $ref: identity.machineId },
                });
            }
            node.children.forEach((child, index) => {
                const childIdentity = document.identity.get(child.machineId);
                if (!childIdentity)
                    throw new Error(`Missing identity ${child.machineId}.`);
                if (child.nestedSourceGuid) {
                    const prefabIdentity = document.identity.get(child.prefabInstanceId || child.machineId);
                    const validNested = child.prefabInstanceId
                        ? childIdentity.kind === 'gameObject' && childIdentity.origin === 'inherited' &&
                            prefabIdentity?.kind === 'prefabInstance' && prefabIdentity.origin === 'inherited'
                        : childIdentity.kind === 'prefabInstance' && childIdentity.origin === 'inherited';
                    if (!validNested) {
                        throw new Error(`Adding nested PrefabInstance ${child.prefabInstanceId || child.machineId} ` +
                            'below an inherited parent is not implemented.');
                    }
                }
                else if (childIdentity.kind !== 'gameObject') {
                    throw new Error(`${child.machineId} is not a gameObject identity.`);
                }
                else if (childIdentity.origin !== 'inherited' &&
                    (!transformIdentity.sourceGuid || !transformIdentity.sourceFileId)) {
                    throw new Error(`Inherited parent ${transformIdentity.machineId} has no source identity.`);
                }
                let inheritedParentTransformId = '0';
                if (!child.nestedSourceGuid && childIdentity.origin !== 'inherited') {
                    const existingParentStub = findInheritedTransformStub(document, transformIdentity);
                    if (existingParentStub) {
                        inheritedParentTransformId = allocated.get(existingParentStub.machineId);
                    }
                }
                buildNode(child, inheritedParentTransformId, index, transformIdentity.machineId);
            });
            return;
        }
        if (!parentTransformMachineId && !goIdentity.fileId) {
            throw new Error(`New variant root ${node.machineId} requires an inherited source-parent identity.`);
        }
        if (!parentTransformMachineId && transformIdentity.baselineParentId) {
            throw new Error(`Moving ${node.machineId} to the variant root requires an inherited source-parent identity.`);
        }
        const goId = allocated.get(goIdentity.machineId);
        const transformId = allocated.get(transformIdentity.machineId);
        if (parentTransformMachineId) {
            const parentIdentity = document.identity.get(parentTransformMachineId);
            if (parentIdentity?.origin === 'inherited') {
                if (!parentIdentity.sourceGuid || !parentIdentity.sourceFileId) {
                    throw new Error(`Inherited parent ${parentTransformMachineId} has no source identity.`);
                }
                addedGameObjects.push({
                    targetCorrespondingSourceObject: {
                        fileID: parentIdentity.sourceFileId,
                        guid: parentIdentity.sourceGuid,
                        type: 3,
                    },
                    insertIndex: siblingIndex,
                    addedObject: { $ref: transformIdentity.machineId },
                });
            }
        }
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
    for (const identity of document.identity.values()) {
        if (identity.kind === 'prefabInstance' && identity.origin === 'inherited' &&
            !desiredInheritedNestedInstances.has(identity.machineId)) {
            throw new Error(`Inherited nested PrefabInstance ${identity.machineId} is missing from variant STRUCTURE.`);
        }
        if ((identity.kind === 'gameObject' || identity.kind === 'transform' || identity.kind === 'component') &&
            identity.origin === 'inherited' && identity.prefabOwnerId &&
            document.identity.get(identity.prefabOwnerId)?.kind === 'prefabInstance' &&
            document.identity.get(identity.prefabOwnerId)?.origin === 'inherited' &&
            !desiredInheritedNestedInternals.has(identity.machineId)) {
            throw new Error(`Inherited nested PrefabInstance ${identity.prefabOwnerId} internal ${identity.machineId} ` +
                'is missing from variant STRUCTURE.');
        }
    }
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
        if (identity.kind === 'stripped' && identity.typeId === 1 &&
            isDirectInheritedGameObjectStub(document, identity) &&
            !usedInheritedStubIds.has(identity.machineId))
            continue;
        if ((identity.ownerId || identity.kind === 'prefabInstance') && !isDesiredOwnership(identity.machineId))
            continue;
        const details = document.details.get(identity.machineId);
        if (!details)
            throw new Error(`Variant identity ${identity.machineId} requires DETAILS.`);
        let properties = clone(details);
        if (identity.machineId === document.variantRootId && hasInheritedStructure) {
            if (!properties.m_Modification || typeof properties.m_Modification !== 'object') {
                throw new Error(`Variant root ${identity.machineId} has no m_Modification DETAILS.`);
            }
            const modification = properties.m_Modification;
            modification.m_RemovedGameObjects = removedGameObjects;
            modification.m_RemovedComponents = removedComponents;
            modification.m_AddedGameObjects = addedGameObjects;
            modification.m_AddedComponents = addedComponents;
        }
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
function allocateSyntheticFileId(document, key, allocated) {
    const existing = allocated.get(key);
    if (existing)
        return existing;
    const occupied = new Set(allocated.values());
    let salt = 0;
    while (true) {
        const seed = `${document.assetGuid || document.profile}|${key}|stripped|${salt}`;
        const digest = (0, crypto_1.createHash)('sha256').update(seed).digest();
        const candidate = (digest.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
        if (candidate !== '0' && !occupied.has(candidate)) {
            allocated.set(key, candidate);
            return candidate;
        }
        salt++;
    }
}
function findInheritedTransformStub(document, transform) {
    const sourceMatches = [...document.identity.values()].filter(identity => {
        if (identity.kind !== 'stripped' || (identity.typeId !== 4 && identity.typeId !== 224)) {
            return false;
        }
        const details = document.details.get(identity.machineId);
        const source = details?.m_CorrespondingSourceObject;
        return String(source?.fileID ?? '0') === transform.sourceFileId &&
            String(source?.guid ?? '') === transform.sourceGuid;
    });
    const directMatches = sourceMatches.filter(identity => {
        if (identity.ownerId !== document.variantRootId)
            return false;
        const owner = document.details.get(identity.machineId)?.m_PrefabInstance;
        const root = document.variantRootId
            ? document.identity.get(document.variantRootId)
            : undefined;
        return owner?.$ref === document.variantRootId ||
            (!!root?.fileId && String(owner?.fileID ?? '0') === root.fileId);
    });
    if (sourceMatches.length > 0 && directMatches.length !== 1) {
        throw new Error(`Inherited Transform ${transform.machineId} has ambiguous stripped Transform ownership.`);
    }
    return directMatches[0];
}
function findInheritedGameObjectStub(document, gameObject, owner) {
    const sourceMatches = [...document.identity.values()].filter(identity => {
        if (identity.kind !== 'stripped' || identity.typeId !== 1)
            return false;
        const details = document.details.get(identity.machineId);
        const source = details?.m_CorrespondingSourceObject;
        return String(source?.fileID ?? '0') === gameObject.sourceFileId &&
            String(source?.guid ?? '') === gameObject.sourceGuid;
    });
    const directMatches = sourceMatches.filter(identity => {
        if (identity.ownerId !== owner.machineId)
            return false;
        const prefabInstance = document.details.get(identity.machineId)?.m_PrefabInstance;
        return prefabInstance?.$ref === owner.machineId ||
            (!!owner.fileId && String(prefabInstance?.fileID ?? '0') === owner.fileId);
    });
    if (sourceMatches.length > 0 && directMatches.length !== 1) {
        throw new Error(`Inherited GameObject ${gameObject.machineId} has ambiguous stripped GameObject ownership.`);
    }
    return directMatches[0];
}
function isDirectInheritedGameObjectStub(document, identity) {
    if (!document.variantRootId || identity.ownerId !== document.variantRootId)
        return false;
    const details = document.details.get(identity.machineId);
    const source = details?.m_CorrespondingSourceObject;
    const prefabInstance = details?.m_PrefabInstance;
    const root = document.identity.get(document.variantRootId);
    const hasDirectOwner = prefabInstance?.$ref === document.variantRootId ||
        (!!root?.fileId && String(prefabInstance?.fileID ?? '0') === root.fileId);
    if (!hasDirectOwner)
        return false;
    return [...document.identity.values()].some(candidate => candidate.kind === 'gameObject' && candidate.origin === 'inherited' &&
        candidate.sourceFileId === String(source?.fileID ?? '0') &&
        candidate.sourceGuid === String(source?.guid ?? ''));
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