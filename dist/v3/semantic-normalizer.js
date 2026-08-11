"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLocalPrefab = normalizeLocalPrefab;
exports.compareLocalPrefabSemantics = compareLocalPrefabSemantics;
const LOCAL_LINK_FIELDS = [
    'm_CorrespondingSourceObject',
    'm_PrefabInstance',
    'm_PrefabAsset',
];
/** Canonical semantic view for the first v3 compiler slice. Structural links
 * are represented explicitly rather than compared as serializer fields. */
function normalizeLocalPrefab(file) {
    if (file.type !== 'prefab' || file.prefabInstances.length > 0 ||
        file.documents.some(document => document.stripped)) {
        throw new Error('normalizeLocalPrefab accepts local regular prefabs only.');
    }
    const byId = new Map(file.documents.map(document => [document.fileId, document]));
    const transformByGameObject = new Map();
    for (const document of file.documents) {
        if (document.typeId !== 4 && document.typeId !== 224)
            continue;
        const owner = referenceId(document.properties.m_GameObject);
        if (owner !== '0')
            transformByGameObject.set(owner, document);
    }
    const documents = file.documents.map(document => {
        const properties = canonicalProperties(document);
        const structural = {};
        if (document.typeId === 1) {
            structural.name = String(document.properties.m_Name ?? '');
            structural.components = (document.properties.m_Component || [])
                .map((entry) => referenceId(entry?.component || entry));
            const transform = transformByGameObject.get(document.fileId);
            structural.transform = transform?.fileId || null;
            delete properties.m_Name;
            delete properties.m_Component;
        }
        else if (document.typeId === 4 || document.typeId === 224) {
            structural.owner = referenceId(document.properties.m_GameObject);
            structural.parent = referenceId(document.properties.m_Father);
            structural.children = (document.properties.m_Children || []).map(referenceId);
            delete properties.m_GameObject;
            delete properties.m_Father;
            delete properties.m_Children;
            delete properties.m_RootOrder;
        }
        else {
            structural.owner = referenceId(document.properties.m_GameObject);
            delete properties.m_GameObject;
        }
        return {
            fileId: document.fileId,
            typeId: document.typeId,
            typeName: document.typeName,
            structural: stable(structural),
            properties: stable(properties),
        };
    }).sort((left, right) => compareFileIds(left.fileId, right.fileId));
    return { kind: 'local-prefab', documents };
}
function compareLocalPrefabSemantics(expected, actual) {
    return firstDifference(normalizeLocalPrefab(expected), normalizeLocalPrefab(actual), '$');
}
function canonicalProperties(document) {
    const properties = clone(document.properties);
    for (const field of LOCAL_LINK_FIELDS) {
        const value = properties[field];
        if (value === undefined || referenceId(value) === '0')
            delete properties[field];
    }
    properties.m_ObjectHideFlags ?? (properties.m_ObjectHideFlags = 0);
    if (document.typeId === 1) {
        properties.serializedVersion ?? (properties.serializedVersion = 6);
        properties.m_Layer ?? (properties.m_Layer = 0);
        properties.m_TagString ?? (properties.m_TagString = 'Untagged');
        properties.m_Icon ?? (properties.m_Icon = { fileID: 0 });
        properties.m_NavMeshLayer ?? (properties.m_NavMeshLayer = 0);
        properties.m_StaticEditorFlags ?? (properties.m_StaticEditorFlags = 0);
        properties.m_IsActive ?? (properties.m_IsActive = 1);
    }
    else if (document.typeId === 4 || document.typeId === 224) {
        properties.serializedVersion ?? (properties.serializedVersion = 2);
        properties.m_LocalRotation ?? (properties.m_LocalRotation = { x: 0, y: 0, z: 0, w: 1 });
        properties.m_LocalPosition ?? (properties.m_LocalPosition = { x: 0, y: 0, z: 0 });
        properties.m_LocalScale ?? (properties.m_LocalScale = { x: 1, y: 1, z: 1 });
        properties.m_LocalEulerAnglesHint ?? (properties.m_LocalEulerAnglesHint = { x: 0, y: 0, z: 0 });
        if (document.typeId === 224) {
            properties.m_AnchorMin ?? (properties.m_AnchorMin = { x: 0.5, y: 0.5 });
            properties.m_AnchorMax ?? (properties.m_AnchorMax = { x: 0.5, y: 0.5 });
            properties.m_AnchoredPosition ?? (properties.m_AnchoredPosition = { x: 0, y: 0 });
            properties.m_SizeDelta ?? (properties.m_SizeDelta = { x: 100, y: 100 });
            properties.m_Pivot ?? (properties.m_Pivot = { x: 0.5, y: 0.5 });
        }
    }
    else if (document.typeId === 114) {
        properties.m_Enabled ?? (properties.m_Enabled = 1);
        properties.m_EditorHideFlags ?? (properties.m_EditorHideFlags = 0);
        properties.m_Name ?? (properties.m_Name = '');
        properties.m_EditorClassIdentifier ?? (properties.m_EditorClassIdentifier = '');
    }
    return properties;
}
function referenceId(value) {
    if (!value || value.fileID === undefined || value.fileID === null)
        return '0';
    return String(value.fileID);
}
function compareFileIds(left, right) {
    try {
        const a = BigInt(left);
        const b = BigInt(right);
        return a < b ? -1 : a > b ? 1 : 0;
    }
    catch {
        return left.localeCompare(right);
    }
}
function stable(value) {
    if (Array.isArray(value))
        return value.map(stable);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function firstDifference(expected, actual, path) {
    if (Object.is(expected, actual))
        return null;
    if (typeof expected !== typeof actual || expected === null || actual === null) {
        return { path, expected, actual };
    }
    if (Array.isArray(expected) || Array.isArray(actual)) {
        if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
            return { path, expected, actual };
        }
        for (let index = 0; index < expected.length; index++) {
            const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
            if (difference)
                return difference;
        }
        return null;
    }
    if (typeof expected === 'object') {
        const expectedKeys = Object.keys(expected);
        const actualKeys = Object.keys(actual);
        if (expectedKeys.length !== actualKeys.length ||
            expectedKeys.some((key, index) => key !== actualKeys[index])) {
            return { path, expected: expectedKeys, actual: actualKeys };
        }
        for (const key of expectedKeys) {
            const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
            if (difference)
                return difference;
        }
        return null;
    }
    return { path, expected, actual };
}
//# sourceMappingURL=semantic-normalizer.js.map