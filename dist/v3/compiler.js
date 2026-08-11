"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileV3 = compileV3;
const crypto_1 = require("crypto");
const value_1 = require("./value");
const COMMON_LOCAL_ENVELOPE = {
    m_ObjectHideFlags: 0,
    m_CorrespondingSourceObject: { fileID: 0 },
    m_PrefabInstance: { fileID: 0 },
    m_PrefabAsset: { fileID: 0 },
};
function compileV3(document) {
    if (document.version !== 3 || document.kind !== 'prefab') {
        throw new Error('compileV3 accepts v3 local regular prefab documents only.');
    }
    const allocated = allocateFileIds(document);
    const documents = [];
    const buildNode = (node, parentTransformId, siblingIndex) => {
        const goIdentity = requireIdentity(document, node.machineId, 'gameObject');
        const transformIdentity = findOwnedTransform(document, node.machineId);
        const goId = allocated.get(goIdentity.machineId);
        const transformId = allocated.get(transformIdentity.machineId);
        const componentIds = node.components.map(component => {
            const identity = requireIdentity(document, component.machineId, 'component');
            return allocated.get(identity.machineId);
        });
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
        transformProperties.m_Children = node.children.map(child => ({ fileID: allocated.get(findOwnedTransform(document, child.machineId).machineId) }));
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
        node.children.forEach((child, index) => buildNode(child, transformId, index));
    };
    buildNode(document.structure, '0', 0);
    assertUniqueFileIds(documents);
    return { type: 'prefab', documents, prefabInstances: [] };
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
        stripped: false,
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