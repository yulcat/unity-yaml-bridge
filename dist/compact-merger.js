"use strict";
/**
 * Merge CompactFile edits back into a UnityFile AST.
 *
 * This enables the full editing pipeline:
 *   Unity YAML → AST → compact (.ubridge) → [AI edits] → parse compact → merge → YAML
 *
 * The merge approach preserves all original data (fileIDs, boilerplate fields,
 * document structure) and only updates properties that appear in the compact file.
 *
 * When REFS are available, uses them for precise fileID-based document lookup.
 * For new elements not in REFS, auto-generates random int64 fileIDs.
 */
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
exports.generateFileId = generateFileId;
exports.mergeCompactChanges = mergeCompactChanges;
const crypto = __importStar(require("crypto"));
const types_1 = require("./types");
const compact_reader_1 = require("./compact-reader");
const path_utils_1 = require("./path-utils");
const guid_resolver_1 = require("./guid-resolver");
const merge_validation_1 = require("./merge-validation");
/** Deep clone a UnityFile for safe mutation, preserving non-enumerable markers (__flow, __multiLine) */
function cloneUnityFile(file) {
    return deepClone(file);
}
function deepClone(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(deepClone);
    const result = {};
    for (const key of Object.keys(value)) {
        result[key] = deepClone(value[key]);
    }
    // Preserve non-enumerable markers
    if (value.__flow === true) {
        Object.defineProperty(result, '__flow', { value: true, enumerable: false, writable: false });
    }
    if (value.__multiLine === true) {
        Object.defineProperty(result, '__multiLine', { value: true, enumerable: false, writable: false });
    }
    return result;
}
/**
 * Generate a random int64 fileID like Unity does.
 * Uses crypto.randomBytes for proper randomness.
 * Returns a positive BigInt string (always positive to match Unity convention).
 */
function generateFileId() {
    const bytes = crypto.randomBytes(8);
    // Read as unsigned 64-bit big-endian, then ensure it's positive and non-zero
    let value = BigInt(0);
    for (let i = 0; i < 8; i++) {
        value = (value << BigInt(8)) | BigInt(bytes[i]);
    }
    // Ensure positive (clear sign bit) and non-zero
    value = value & BigInt('9223372036854775807'); // Max positive int64
    if (value === BigInt(0))
        value = BigInt(1);
    return value.toString();
}
/** Recursively collect all GO paths from a STRUCTURE tree */
function collectStructurePaths(node, parentPath, paths) {
    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    paths.add(currentPath);
    // Also add with each component
    for (const comp of node.components) {
        const componentName = comp.replace(/^[+*-]/, '').replace(/\*$/, '');
        paths.add(`${currentPath}:${componentName}`);
    }
    for (const child of node.children) {
        collectStructurePaths(child, currentPath, paths);
    }
}
/** Collect explicit -Component edit instructions from STRUCTURE. */
function collectComponentRemovals(node, parentPath, removals) {
    const goPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    for (const component of node.components) {
        if (!component.startsWith('-'))
            continue;
        const componentType = component.slice(1).replace(/\*$/, '').trim();
        if (componentType)
            removals.push({ goPath, componentType });
    }
    for (const child of node.children) {
        collectComponentRemovals(child, goPath, removals);
    }
}
const NEW_COMPONENT_STRUCTURAL_FIELDS = new Set([
    'm_CorrespondingSourceObject',
    'm_PrefabInstance',
    'm_PrefabAsset',
    'm_GameObject',
]);
/** Generate a fileID that does not collide with any existing or newly created document. */
function generateUniqueFileId(file) {
    const used = new Set(file.documents.map(doc => doc.fileId));
    let id = generateFileId();
    while (used.has(id))
        id = generateFileId();
    return id;
}
function getSingleRef(refs, key) {
    return (0, path_utils_1.findPathMapEntry)(refs, key, { allowAddedRootAliases: true })?.value[0];
}
function findScriptReference(section, componentType, resolver) {
    const scriptProperty = section.properties.find(prop => prop.key === 'm_Script' && typeof prop.value === 'string');
    if (scriptProperty && typeof scriptProperty.value === 'string') {
        const parsed = (0, compact_reader_1.parseCompactValue)(scriptProperty.value);
        if (parsed && typeof parsed === 'object' && parsed.guid)
            return parsed;
    }
    const guid = /^[a-f0-9]{32}$/i.test(componentType)
        ? componentType
        : (resolver || new guid_resolver_1.GuidResolver()).resolveGuid(componentType);
    if (!guid)
        return undefined;
    return { fileID: 11500000, guid, type: 3 };
}
function resolveNewComponentType(section, resolver) {
    const nativeEntry = Object.entries(types_1.UNITY_TYPE_MAP).find(([id, name]) => name === section.componentType && ![1, 4, 114, 224, 1001].includes(Number(id)));
    if (nativeEntry) {
        return { typeId: Number(nativeEntry[0]), typeName: nativeEntry[1] };
    }
    const script = findScriptReference(section, section.componentType, resolver);
    if (script)
        return { typeId: 114, typeName: 'MonoBehaviour', script };
    throw new Error(`Cannot determine Unity type for new component ${section.goPath}:${section.componentType}. ` +
        'Use a built-in component name, pass a project GuidResolver, or add an m_Script reference.');
}
function createComponentProperties(typeId, gameObjectFileId, script) {
    const properties = {
        m_ObjectHideFlags: 0,
        m_CorrespondingSourceObject: { fileID: 0 },
        m_PrefabInstance: { fileID: 0 },
        m_PrefabAsset: { fileID: 0 },
        m_GameObject: { fileID: gameObjectFileId },
    };
    if (typeId === 114) {
        properties.m_Enabled = 1;
        properties.m_EditorHideFlags = 0;
        properties.m_Script = script;
        properties.m_Name = '';
        properties.m_EditorClassIdentifier = '';
    }
    return properties;
}
function appendGameObjectComponent(goDoc, componentId) {
    if (!Array.isArray(goDoc.properties.m_Component))
        goDoc.properties.m_Component = [];
    goDoc.properties.m_Component.push({ component: { fileID: componentId } });
}
function addHierarchyComponent(file, goPath, document, componentType, scriptGuid) {
    if (!file.hierarchy)
        return;
    const goMap = new Map();
    flattenHierarchy(file.hierarchy, goMap);
    const node = goMap.get(goPath)?.[0];
    if (!node)
        return;
    const info = {
        typeName: document.typeName,
        typeId: document.typeId,
        fileId: document.fileId,
        scriptGuid,
        scriptName: document.typeId === 114 ? componentType : undefined,
        properties: document.properties,
        stripped: false,
    };
    node.components.push(info);
}
function componentMatches(info, componentType, allowSelectors = false) {
    const candidates = allowSelectors ? selectorCandidates(componentType) : [componentType];
    return candidates.some(candidate => info.typeName === candidate
        || info.scriptName === candidate
        || info.scriptGuid === candidate);
}
/** A final #N may be a v2 discriminator; exact literal names always win first. */
function selectorCandidates(value) {
    const match = /^(.*)#([1-9]\d*)$/.exec(value);
    return match ? [value, match[1]] : [value];
}
function sectionAddress(section) {
    return section.componentType
        ? `${section.goPath}:${section.componentType}`
        : section.goPath;
}
/** Component type encoded in legacy [&fileID:Type] section headers. */
function effectiveSectionComponentType(section) {
    if (section.componentType)
        return section.componentType;
    return /^&\d+:(.+)$/.exec(section.goPath)?.[1];
}
function validateDocumentType(section, document, resolver, allowSelectors = false) {
    const address = sectionAddress(section);
    const renderedComponentType = effectiveSectionComponentType(section);
    if (!renderedComponentType) {
        if (document.typeId !== 1) {
            throw new Error(`REFS target type mismatch for ${address}: &${document.fileId} is ${document.typeName}.`);
        }
        return;
    }
    const componentTypes = allowSelectors
        ? selectorCandidates(renderedComponentType)
        : [renderedComponentType];
    const transformType = componentTypes.find(type => type === 'Transform' || type === 'RectTransform');
    if (transformType) {
        const expectedTypeId = transformType === 'RectTransform' ? 224 : 4;
        if (document.typeId !== expectedTypeId) {
            throw new Error(`REFS target type mismatch for ${address}: &${document.fileId} is ${document.typeName}.`);
        }
        return;
    }
    if ([1, 4, 224, 1001].includes(document.typeId)) {
        throw new Error(`REFS target type mismatch for ${address}: &${document.fileId} is ${document.typeName}.`);
    }
    if (document.typeId !== 114) {
        const nativeType = types_1.UNITY_TYPE_MAP[document.typeId] || document.typeName;
        if (!componentTypes.includes(nativeType)) {
            throw new Error(`REFS target type mismatch for ${address}: &${document.fileId} is ${nativeType}.`);
        }
        return;
    }
    const scriptGuid = document.properties.m_Script?.guid;
    const explicitGuids = componentTypes.filter(type => /^[a-f0-9]{32}$/i.test(type));
    if (explicitGuids.length > 0 && scriptGuid && !explicitGuids.includes(scriptGuid)) {
        throw new Error(`REFS target script mismatch for ${address}: &${document.fileId} uses ${scriptGuid}.`);
    }
    const resolvedGuids = componentTypes
        .map(type => resolver?.resolveGuid(type))
        .filter((guid) => Boolean(guid));
    if (resolvedGuids.length > 0 && scriptGuid && !resolvedGuids.includes(scriptGuid)) {
        throw new Error(`REFS target script mismatch for ${address}: &${document.fileId} uses ${scriptGuid}.`);
    }
    const fallbackGuidPrefixes = componentTypes
        .map(type => /^MonoBehaviour_([a-f0-9]{8})$/i.exec(type)?.[1])
        .filter((prefix) => Boolean(prefix));
    if (fallbackGuidPrefixes.length > 0 && scriptGuid &&
        !fallbackGuidPrefixes.some(prefix => scriptGuid.startsWith(prefix))) {
        throw new Error(`REFS target script mismatch for ${address}: &${document.fileId} uses ${scriptGuid}.`);
    }
}
function validatePrefabOwnership(section, document, goMap, file, refs) {
    const candidates = goMap.get(section.goPath) || [];
    let node = candidates[0];
    if (candidates.length > 1) {
        const ownerId = document.typeId === 1
            ? document.fileId
            : String(document.properties.m_GameObject?.fileID ?? '0');
        const identified = candidates.filter(candidate => candidate.fileId === ownerId);
        if (identified.length !== 1) {
            throw new Error(`Ambiguous GameObject path for DETAILS section: ${section.goPath}.`);
        }
        node = identified[0];
    }
    if (!node) {
        // v2 aliases do not exist in the original hierarchy. Their REFS GameObject
        // entry proves ownership without heuristically stripping a literal #N.
        const goId = getSingleRef(refs, section.goPath);
        const documentOwner = document.typeId === 1
            ? document.fileId
            : String(document.properties.m_GameObject?.fileID ?? '0');
        if (goId && documentOwner === goId)
            return;
        // A component added to a nested PrefabInstance may use the instance-root
        // alias rather than a local hierarchy path. Accept it only when the REFS
        // owner metadata and the PrefabInstance attachment agree.
        const ownerId = getRefsValue(refs, `${sectionAddress(section)}:__instance`, { allowAddedRootAliases: true }) || getRefsValue(refs, `${section.goPath}:__instance`, { allowAddedRootAliases: true });
        const owner = ownerId
            ? file.prefabInstances.find(instance => instance.fileId === ownerId)
            : undefined;
        const attached = owner?.addedComponents.some(entry => String(entry.addedComponent?.fileID) === document.fileId);
        if (section.isAdded && attached)
            return;
        throw new Error(`DETAILS target GameObject not found: ${section.goPath}.`);
    }
    if (document.stripped)
        return;
    let owned = false;
    if (!section.componentType)
        owned = document.fileId === node.fileId;
    else if (section.componentType === 'Transform' || section.componentType === 'RectTransform') {
        owned = document.fileId === node.transform.fileId;
    }
    else {
        owned = node.components.some(component => component.fileId === document.fileId);
    }
    if (!owned) {
        throw new Error(`REFS ownership mismatch for ${sectionAddress(section)}: ` +
            `&${document.fileId} does not belong to ${section.goPath}.`);
    }
}
function removeHierarchyComponent(file, goPath, fileId) {
    if (!file.hierarchy)
        return;
    const goMap = new Map();
    flattenHierarchy(file.hierarchy, goMap);
    const node = goMap.get(goPath)?.[0];
    if (node)
        node.components = node.components.filter(component => component.fileId !== fileId);
}
function findReferencesToDocuments(file, removedIds) {
    const references = [];
    const visit = (value, path) => {
        if (value === null || typeof value !== 'object')
            return;
        if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'fileID')) {
            const fileId = String(value.fileID);
            if (removedIds.has(fileId))
                references.push(`${path} -> &${fileId}`);
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}[${index}]`));
        }
        else {
            for (const [key, child] of Object.entries(value))
                visit(child, `${path}.${key}`);
        }
    };
    for (const document of file.documents) {
        if (removedIds.has(document.fileId))
            continue;
        visit(document.properties, `&${document.fileId}`);
    }
    return references;
}
/** Apply -Component instructions to local components in regular prefabs. */
function removeLocalComponents(file, compact) {
    if (compact.type === 'variant' || !compact.structure || !file.hierarchy)
        return;
    const removals = [];
    collectComponentRemovals(compact.structure, '', removals);
    if (removals.length === 0)
        return;
    const docMap = new Map(file.documents.map(document => [document.fileId, document]));
    const goMap = new Map();
    flattenHierarchy(file.hierarchy, goMap);
    const selected = [];
    for (const request of removals) {
        if (request.componentType === 'Transform' || request.componentType === 'RectTransform') {
            throw new Error(`Cannot remove required component ${request.goPath}:${request.componentType}.`);
        }
        const goNode = goMap.get(request.goPath)?.[0];
        const goId = getSingleRef(compact.refs, request.goPath) || goNode?.fileId;
        const goDoc = goId ? docMap.get(goId) : undefined;
        if (!goDoc || goDoc.typeId !== 1 || goDoc.stripped) {
            // Existing nested-prefab removal overlays also use -Component. They have
            // no local owning GameObject/document, so keep their no-op round-trip.
            continue;
        }
        const refEntry = (0, path_utils_1.findPathMapEntry)(compact.refs, `${request.goPath}:${request.componentType}`);
        const candidateIds = new Set();
        for (const id of refEntry?.value || []) {
            const doc = docMap.get(id);
            if (doc && !doc.stripped && String(doc.properties.m_GameObject?.fileID) === goDoc.fileId) {
                candidateIds.add(id);
            }
        }
        for (const component of goNode?.components || []) {
            if (componentMatches(component, request.componentType, compact.version === 2)) {
                candidateIds.add(component.fileId);
            }
        }
        const candidates = [...candidateIds]
            .map(id => docMap.get(id))
            .filter((doc) => !!doc);
        if (candidates.length === 0) {
            throw new Error(`Local component not found for removal: ${request.goPath}:${request.componentType}.`);
        }
        if (candidates.length > 1) {
            throw new Error(`Component removal is ambiguous for ${request.goPath}:${request.componentType}; ` +
                `matching fileIDs: ${candidates.map(doc => doc.fileId).join(', ')}.`);
        }
        selected.push({ request, goDoc, componentDoc: candidates[0] });
    }
    const removedIds = new Set(selected.map(item => item.componentDoc.fileId));
    if (removedIds.size === 0)
        return;
    // Remove the owning attachment first so it is not mistaken for a dangling ref.
    for (const { request, goDoc, componentDoc } of selected) {
        const components = Array.isArray(goDoc.properties.m_Component)
            ? goDoc.properties.m_Component
            : [];
        goDoc.properties.m_Component = components.filter((entry) => !removedIds.has(String(entry?.component?.fileID)));
        removeHierarchyComponent(file, request.goPath, componentDoc.fileId);
    }
    const dangling = findReferencesToDocuments(file, removedIds);
    if (dangling.length > 0) {
        throw new Error(`Cannot remove component${removedIds.size === 1 ? '' : 's'} ${[...removedIds].map(id => `&${id}`).join(', ')}; ` +
            `remaining reference${dangling.length === 1 ? '' : 's'}: ${dangling.slice(0, 5).join(', ')}. ` +
            'Clear or replace those references in the same edit.');
    }
    file.documents = file.documents.filter(document => !removedIds.has(document.fileId));
    for (const [key, ids] of compact.refs) {
        const remaining = ids.filter(id => !removedIds.has(id));
        if (remaining.length > 0)
            compact.refs.set(key, remaining);
        else
            compact.refs.delete(key);
    }
}
function findOrCreateStrippedGameObject(file, targetFileId, sourceGuid, ownerInstanceId) {
    const existing = file.documents.find(doc => doc.typeId === 1 && doc.stripped &&
        String(doc.properties.m_CorrespondingSourceObject?.fileID) === targetFileId &&
        (doc.properties.m_CorrespondingSourceObject?.guid || '') === sourceGuid &&
        String(doc.properties.m_PrefabInstance?.fileID) === ownerInstanceId);
    if (existing)
        return existing;
    const document = {
        typeId: 1,
        typeName: 'GameObject',
        fileId: generateUniqueFileId(file),
        stripped: true,
        properties: {
            m_CorrespondingSourceObject: { fileID: targetFileId, guid: sourceGuid, type: 3 },
            m_PrefabInstance: { fileID: ownerInstanceId },
            m_PrefabAsset: { fileID: 0 },
        },
    };
    file.documents.push(document);
    return document;
}
function attachInheritedAddedComponent(file, compact, section, componentId, referencedGoId, existingStrippedGo) {
    const ownerInstanceId = getSingleRef(compact.refs, `${section.goPath}:__instance`)
        || (existingStrippedGo
            ? String(existingStrippedGo.properties.m_PrefabInstance?.fileID || '')
            : getSingleRef(compact.refs, '__instance'));
    if (!ownerInstanceId) {
        throw new Error(`Missing PrefabInstance owner for new component ${section.goPath}:${section.componentType}.`);
    }
    const sourceGuid = getSingleRef(compact.refs, `${section.goPath}:__source`)
        || existingStrippedGo?.properties.m_CorrespondingSourceObject?.guid
        || compact.baseGuid;
    if (!sourceGuid) {
        throw new Error(`Missing source GUID for inherited GameObject ${section.goPath}.`);
    }
    const ownerDoc = file.documents.find(doc => doc.typeId === 1001 && doc.fileId === ownerInstanceId);
    const ownerInfo = file.prefabInstances.find(instance => instance.fileId === ownerInstanceId);
    if (!ownerDoc || !ownerInfo) {
        throw new Error(`PrefabInstance ${ownerInstanceId} not found for new component.`);
    }
    const targetGoId = existingStrippedGo
        ? String(existingStrippedGo.properties.m_CorrespondingSourceObject?.fileID || '')
        : referencedGoId;
    if (!targetGoId) {
        throw new Error(`Missing corresponding source GameObject for ${section.goPath}.`);
    }
    const strippedGo = existingStrippedGo
        || findOrCreateStrippedGameObject(file, targetGoId, sourceGuid, ownerInstanceId);
    const modification = ownerDoc.properties.m_Modification || (ownerDoc.properties.m_Modification = {});
    if (!Array.isArray(modification.m_AddedComponents))
        modification.m_AddedComponents = [];
    modification.m_AddedComponents.push({
        targetCorrespondingSourceObject: { fileID: targetGoId, guid: sourceGuid, type: 3 },
        insertIndex: -1,
        addedObject: { fileID: componentId },
    });
    ownerInfo.addedComponents.push({
        targetGameObject: { fileID: targetGoId, guid: sourceGuid, type: 3 },
        insertIndex: -1,
        addedComponent: { fileID: componentId },
    });
    return strippedGo.fileId;
}
/** Allocate all requested components before applying properties so cross-references are order-independent. */
function createAddedComponents(file, compact, structurePaths, options) {
    const existingDocumentIds = new Set(file.documents.map(doc => doc.fileId));
    const addedSections = compact.sections.filter(section => {
        if (!section.isAdded)
            return false;
        const key = section.componentType
            ? `${section.goPath}:${section.componentType}`
            : section.goPath;
        const existingId = getSingleRef(compact.refs, key);
        return !existingId || !existingDocumentIds.has(existingId);
    });
    if (addedSections.length === 0)
        return;
    const pending = [];
    const docMap = new Map(file.documents.map(doc => [doc.fileId, doc]));
    const createdKeys = new Set();
    for (const section of addedSections) {
        if (!section.componentType) {
            throw new Error(`New component section must include a component type: ${section.goPath}`);
        }
        const componentKey = `${section.goPath}:${section.componentType}`;
        if (!(0, path_utils_1.findPathSetEntry)(structurePaths, componentKey, { allowAddedRootAliases: true })) {
            throw new Error(`New component ${componentKey} must also be listed in STRUCTURE with a + marker.`);
        }
        if (createdKeys.has(componentKey) || getSingleRef(compact.refs, componentKey)) {
            throw new Error(`Component already exists or is duplicated: ${componentKey}`);
        }
        const targetGoId = getSingleRef(compact.refs, section.goPath);
        if (!targetGoId)
            throw new Error(`GameObject not found for new component: ${section.goPath}`);
        const type = resolveNewComponentType(section, options.guidResolver);
        const componentId = generateUniqueFileId(file);
        let owningGoId = targetGoId;
        const localGoDoc = docMap.get(targetGoId);
        if (localGoDoc && localGoDoc.typeId === 1 && !localGoDoc.stripped) {
            appendGameObjectComponent(localGoDoc, componentId);
        }
        else if ((localGoDoc && localGoDoc.typeId === 1 && localGoDoc.stripped)
            || compact.type === 'variant') {
            owningGoId = attachInheritedAddedComponent(file, compact, section, componentId, targetGoId, localGoDoc?.typeId === 1 && localGoDoc.stripped ? localGoDoc : undefined);
        }
        else {
            throw new Error(`GameObject not found for new component: ${section.goPath}`);
        }
        const document = {
            typeId: type.typeId,
            typeName: type.typeName,
            fileId: componentId,
            stripped: false,
            properties: createComponentProperties(type.typeId, owningGoId, type.script),
        };
        file.documents.push(document);
        docMap.set(componentId, document);
        compact.refs.set(componentKey, [componentId]);
        createdKeys.add(componentKey);
        addHierarchyComponent(file, section.goPath, document, section.componentType, type.script?.guid);
        pending.push({ section, document });
    }
    for (const { section, document } of pending) {
        applyComponentProperties(section.properties.filter(prop => !NEW_COMPONENT_STRUCTURAL_FIELDS.has(prop.key)), document, compact.refs, structurePaths, { allowAddedRootAliases: true });
    }
}
/**
 * Merge compact file changes into the original AST.
 * Returns a new UnityFile with the changes applied.
 * The original is not modified.
 */
function mergeCompactChanges(original, compact, options = {}) {
    const workingCompact = (0, merge_validation_1.cloneCompactFile)(compact);
    (0, merge_validation_1.assertCompactSourceCompatible)(original, workingCompact);
    const baselineIntegrity = (0, merge_validation_1.collectUnityIntegrityIssues)(original);
    const result = cloneUnityFile(original);
    if (result.hierarchy) {
        registerHierarchyRefAliases(result.hierarchy, workingCompact.refs);
    }
    // Collect all GO paths from STRUCTURE tree — used to distinguish
    // valid new references (GO exists in hierarchy) from typos
    const structurePaths = new Set();
    if (workingCompact.structure) {
        collectStructurePaths(workingCompact.structure, '', structurePaths);
    }
    createAddedComponents(result, workingCompact, structurePaths, options);
    if (workingCompact.type === 'variant') {
        mergeVariantSections(result, workingCompact.sections, workingCompact.refs, structurePaths, options.guidResolver, workingCompact.version === 2);
    }
    else {
        mergePrefabSections(result, workingCompact.sections, workingCompact.refs, structurePaths, options.guidResolver, workingCompact.version === 2);
    }
    // Apply removals after additions/property edits so an atomic replacement can
    // redirect or clear references before dangling-reference validation runs.
    removeLocalComponents(result, workingCompact);
    syncPrefabInstanceState(result);
    (0, merge_validation_1.assertNoNewIntegrityIssues)(baselineIntegrity, result);
    return result;
}
/** Keep the parsed PrefabInstance view consistent with the mutated YAML documents. */
function syncPrefabInstanceState(file) {
    const instanceDocs = new Map(file.documents.filter(doc => doc.typeId === 1001).map(doc => [doc.fileId, doc]));
    for (const instance of file.prefabInstances) {
        const modification = instanceDocs.get(instance.fileId)?.properties.m_Modification;
        if (!modification)
            continue;
        instance.modifications = (modification.m_Modifications || []).map((entry) => ({
            target: entry.target,
            propertyPath: entry.propertyPath || '',
            value: entry.value ?? '',
            objectReference: entry.objectReference || { fileID: 0 },
        }));
        instance.addedComponents = (modification.m_AddedComponents || []).map((entry) => ({
            targetGameObject: entry.targetCorrespondingSourceObject,
            addedComponent: entry.addedObject,
            insertIndex: entry.insertIndex ?? -1,
        }));
    }
}
// ============================================================
// Prefab merging — match sections by REFS fileID or GO name + component type
// ============================================================
/** Merge sections for a regular prefab */
function mergePrefabSections(file, sections, refs, structurePaths, resolver, allowSelectors = false) {
    if (!file.hierarchy) {
        if (sections.length > 0)
            throw new Error('Cannot apply DETAILS: original YAML has no hierarchy.');
        return;
    }
    // Build a map: document fileId → document (for fast lookup)
    const docMap = new Map();
    for (const doc of file.documents) {
        docMap.set(doc.fileId, doc);
    }
    // Build a flat map: GO name → GameObjectNode (using the hierarchy)
    const goMap = new Map();
    flattenHierarchy(file.hierarchy, goMap);
    // Track which REFS fileIDs have been used (for duplicate key handling)
    const usedRefs = new Set();
    for (const section of sections) {
        const goPath = section.goPath;
        const compType = section.componentType;
        const refsKey = compType ? `${goPath}:${compType}` : goPath;
        // Try REFS lookup — find the best matching document for this section
        const refsEntry = (0, path_utils_1.findPathMapEntry)(refs, refsKey);
        if (refsEntry && refsEntry.value.length > 0) {
            const refsFileIds = refsEntry.value;
            const refsFileId = refsFileIds.length === 1
                ? refsFileIds[0]
                : findBestRefsMatch(refsFileIds, section, docMap, usedRefs);
            if (refsFileId) {
                usedRefs.add(refsFileId);
                const doc = docMap.get(refsFileId);
                if (doc) {
                    validateDocumentType(section, doc, resolver, allowSelectors);
                    validatePrefabOwnership(section, doc, goMap, file, refs);
                    if (compType === 'Transform' || compType === 'RectTransform') {
                        applyTransformProperties(section.properties, doc, compType === 'RectTransform');
                    }
                    else {
                        applyComponentProperties(section.properties, doc, refs, structurePaths);
                    }
                    continue;
                }
                throw new Error(`Stale REFS target for ${sectionAddress(section)}: document &${refsFileId} ` +
                    'does not exist in the original YAML.');
            }
        }
        // Fallback: name-based matching
        const candidates = goMap.get(goPath) || [];
        if (candidates.length === 0) {
            throw new Error(`DETAILS target GameObject not found: ${goPath}.`);
        }
        if (candidates.length > 1)
            throw new Error(`Ambiguous GameObject path: ${goPath}.`);
        const go = candidates[0];
        if (compType === 'Transform' || compType === 'RectTransform') {
            const transformDoc = docMap.get(go.transform.fileId);
            if (transformDoc) {
                applyTransformProperties(section.properties, transformDoc, compType === 'RectTransform');
            }
            else
                throw new Error(`Transform document not found for DETAILS target: ${goPath}.`);
        }
        else {
            const comp = go.components.find(c => {
                if (c.typeName === compType)
                    return true;
                if (c.scriptName === compType)
                    return true;
                if (c.scriptGuid === compType)
                    return true;
                return false;
            });
            if (comp) {
                const compDoc = docMap.get(comp.fileId);
                if (compDoc) {
                    validateDocumentType(section, compDoc, resolver, allowSelectors);
                    applyComponentProperties(section.properties, compDoc, refs, structurePaths);
                }
                else
                    throw new Error(`Component document not found: ${sectionAddress(section)}.`);
            }
            else
                throw new Error(`DETAILS target component not found: ${sectionAddress(section)}.`);
        }
    }
}
/**
 * Find the best matching REFS fileID for a section when there are duplicates.
 * Compares section properties against each candidate document's existing values.
 * For a zero-edit roundtrip, the correct document already has matching values.
 */
function findBestRefsMatch(fileIds, section, docMap, usedRefs) {
    const unused = fileIds.filter(id => !usedRefs.has(id));
    if (unused.length === 0) {
        throw new Error(`No unused REFS target remains for duplicate section: ${sectionAddress(section)}.`);
    }
    if (unused.length === 1)
        return unused[0];
    // Score each candidate by how many section properties match the document's values
    let bestId = unused[0];
    let bestScore = -1;
    for (const id of unused) {
        const doc = docMap.get(id);
        if (!doc)
            continue;
        let score = 0;
        for (const prop of section.properties) {
            if (typeof prop.value !== 'string')
                continue;
            const parsed = (0, compact_reader_1.parseCompactValue)(prop.value);
            const docVal = getDocValueForProp(prop.key, doc.properties, section.componentType);
            if (docVal !== undefined && valuesMatch(parsed, docVal)) {
                score++;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestId = id;
        }
    }
    return bestId;
}
/** Get the document property value for a compact property key (handles transform shorthands) */
function getDocValueForProp(key, props, compType) {
    // Transform shorthand mappings
    if (compType === 'RectTransform' || compType === 'Transform') {
        switch (key) {
            case 'pos': return compType === 'RectTransform' ? props.m_AnchoredPosition : props.m_LocalPosition;
            case 'rot': return props.m_LocalRotation;
            case 'scale': return props.m_LocalScale;
            case 'size': return props.m_SizeDelta;
            case 'pivot': return props.m_Pivot;
            case 'anchor': {
                const min = props.m_AnchorMin;
                const max = props.m_AnchorMax;
                return min && max ? { min, max } : undefined;
            }
        }
    }
    return props[key];
}
/** Check if two values match (deep comparison for vectors, shallow for scalars) */
function valuesMatch(a, b) {
    if (a === b)
        return true;
    if (a == null || b == null)
        return false;
    if (typeof a === 'object' && typeof b === 'object') {
        // For anchor: {min, max} comparison
        if ('min' in a && 'min' in b) {
            return valuesMatch(a.min, b.min) && valuesMatch(a.max, b.max);
        }
        // Vector/color comparison: compare values by position
        const aKeys = Object.keys(a).filter(k => !k.startsWith('__'));
        const bKeys = Object.keys(b).filter(k => !k.startsWith('__'));
        if (aKeys.length !== bKeys.length)
            return false;
        for (let i = 0; i < aKeys.length; i++) {
            if (String(a[aKeys[i]]) !== String(b[bKeys[i]]))
                return false;
        }
        return true;
    }
    return String(a) === String(b);
}
/** Flatten hierarchy into a map of name → nodes */
function flattenHierarchy(node, map, parentPath = '') {
    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (!map.has(currentPath)) {
        map.set(currentPath, []);
    }
    map.get(currentPath).push(node);
    for (const child of node.children) {
        flattenHierarchy(child, map, currentPath);
    }
}
/**
 * Fill aliases omitted by older v1 writers from the parsed Unity hierarchy.
 * Explicit compact REFS remain authoritative; inferred aliases are only added
 * when a key is absent.
 */
function registerHierarchyRefAliases(node, refs, parentPath = '') {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (!refs.has(path))
        refs.set(path, [node.fileId]);
    const aliases = new Map();
    const addAlias = (type, fileId) => {
        if (!type)
            return;
        const key = `${path}:${type}`;
        const ids = aliases.get(key) || [];
        if (!ids.includes(fileId))
            ids.push(fileId);
        aliases.set(key, ids);
    };
    addAlias(node.transform.isRect ? 'RectTransform' : 'Transform', node.transform.fileId);
    for (const component of node.components) {
        addAlias(component.typeName, component.fileId);
        addAlias(component.scriptName, component.fileId);
        addAlias(component.scriptGuid, component.fileId);
        if (component.typeId === 114 && component.scriptGuid) {
            addAlias(`MonoBehaviour_${component.scriptGuid.substring(0, 8)}`, component.fileId);
        }
    }
    for (const [key, ids] of aliases) {
        if (!refs.has(key))
            refs.set(key, ids);
    }
    for (const child of node.children)
        registerHierarchyRefAliases(child, refs, path);
}
/** Apply transform shorthand properties to a transform document */
function applyTransformProperties(properties, doc, isRect) {
    for (const prop of properties) {
        if (typeof prop.value !== 'string')
            continue;
        const parsed = (0, compact_reader_1.parseCompactValue)(prop.value);
        switch (prop.key) {
            case 'pos':
                if (isRect) {
                    preserveFlowMarker(doc.properties.m_AnchoredPosition, parsed);
                    doc.properties.m_AnchoredPosition = parsed;
                }
                else {
                    preserveFlowMarker(doc.properties.m_LocalPosition, parsed);
                    doc.properties.m_LocalPosition = parsed;
                }
                break;
            case 'rot':
                preserveFlowMarker(doc.properties.m_LocalRotation, parsed);
                doc.properties.m_LocalRotation = parsed;
                break;
            case 'scale':
                preserveFlowMarker(doc.properties.m_LocalScale, parsed);
                doc.properties.m_LocalScale = parsed;
                break;
            case 'anchor': {
                // anchor = (x1, y1)-(x2, y2) → parsed as {min, max}
                if (parsed && parsed.min && parsed.max) {
                    preserveFlowMarker(doc.properties.m_AnchorMin, parsed.min);
                    preserveFlowMarker(doc.properties.m_AnchorMax, parsed.max);
                    doc.properties.m_AnchorMin = parsed.min;
                    doc.properties.m_AnchorMax = parsed.max;
                }
                break;
            }
            case 'size':
                preserveFlowMarker(doc.properties.m_SizeDelta, parsed);
                doc.properties.m_SizeDelta = parsed;
                break;
            case 'pivot':
                preserveFlowMarker(doc.properties.m_Pivot, parsed);
                doc.properties.m_Pivot = parsed;
                break;
            default:
                // Direct property name (m_LocalPosition, etc.)
                preserveFlowMarker(doc.properties[prop.key], parsed);
                doc.properties[prop.key] = parsed;
                break;
        }
    }
}
/** Apply component properties to a component document */
function applyComponentProperties(properties, doc, refs, structurePaths, pathLookupOptions = {}) {
    applyPropertiesToTarget(properties, doc.properties, refs, structurePaths, pathLookupOptions);
}
/** Apply a list of CompactProperty entries into a target object, preserving nesting */
function applyPropertiesToTarget(properties, target, refs, structurePaths, pathLookupOptions = {}) {
    for (const prop of properties) {
        if (Array.isArray(prop.value)) {
            // Nested block — check if the target already has this key as an object
            const existing = target[prop.key];
            if (isPlainObject(existing) && prop.value.length > 0 && !prop.value.some(c => c.key === '__item__')) {
                // Recursively apply nested properties into existing object
                applyPropertiesToTarget(prop.value, existing, refs, structurePaths, pathLookupOptions);
            }
            else {
                // Reconstruct as new object or array, passing original for key remapping
                target[prop.key] = reconstructNestedValue(prop.value, existing, refs, structurePaths, pathLookupOptions);
            }
        }
        else {
            let parsed = (0, compact_reader_1.parseCompactValue)(prop.value);
            // Resolve path references (->GOPath:Component or @GOPath:Component)
            parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
            const original = target[prop.key];
            // Preserve null references: compact writes {fileID:0} as "null",
            // but we need to keep the original {fileID: 0} object for YAML round-trip
            if (parsed === null && isNullReference(original)) {
                continue; // Keep original {fileID: 0}
            }
            // Preserve vector/color key names: compact format loses r/g/b/a vs x/y/z/w distinction
            if (isPlainObject(parsed) && isPlainObject(original)) {
                const remapped = remapVectorKeys(parsed, original);
                if (remapped) {
                    preserveFlowMarker(original, remapped);
                    target[prop.key] = remapped;
                    continue;
                }
                preserveFlowMarker(original, parsed);
            }
            target[prop.key] = parsed;
        }
    }
}
/**
 * Resolve ->GOPath:Component or @GOPath:Component path references to {fileID: X} objects.
 * Recursively handles arrays. Returns the original value unchanged if not a path reference.
 */
function resolvePathReference(value, refs, structurePaths, pathLookupOptions = {}) {
    if (!refs)
        return value;
    if (typeof value === 'string') {
        let pathRef = null;
        if (value.startsWith('->')) {
            pathRef = value.substring(2);
        }
        else if (value.startsWith('@')) {
            pathRef = value.substring(1);
        }
        if (!pathRef)
            return value;
        const refsEntry = (0, path_utils_1.findPathMapEntry)(refs, pathRef, pathLookupOptions);
        if (refsEntry && refsEntry.value.length > 0) {
            return (0, compact_reader_1.parseCompactValue)('{' + refsEntry.value[0] + '}');
        }
        // Not found in REFS — check if this references a newly added section (+ prefix).
        // If so, auto-generate a fileID and register it in REFS for later use.
        if (structurePaths && (0, path_utils_1.findPathSetEntry)(structurePaths, pathRef, pathLookupOptions)) {
            const newFileId = generateFileId();
            refs.set(pathRef, [newFileId]);
            return (0, compact_reader_1.parseCompactValue)('{' + newFileId + '}');
        }
        // Also check if just the GO part matches an added path (reference to GO's Transform)
        if (structurePaths) {
            const colonIdx = pathRef.indexOf(':');
            const goPath = colonIdx >= 0 ? pathRef.substring(0, colonIdx) : pathRef;
            if ((0, path_utils_1.findPathSetEntry)(structurePaths, goPath, pathLookupOptions)) {
                const newFileId = generateFileId();
                refs.set(pathRef, [newFileId]);
                return (0, compact_reader_1.parseCompactValue)('{' + newFileId + '}');
            }
        }
        const sampleKeys = Array.from(refs.keys()).slice(0, 10).join(', ');
        throw new Error(`Unresolved path reference: ${value}. Valid REFS keys: [${sampleKeys}]. ` +
            `Make sure the reference exactly matches a key in the REFS section.`);
    }
    if (Array.isArray(value)) {
        return value.map(item => resolvePathReference(item, refs, structurePaths, pathLookupOptions));
    }
    return value;
}
/** Preserve the __flow marker from original onto target (non-enumerable) */
function preserveFlowMarker(original, target) {
    if (original && typeof original === 'object' && original.__flow === true
        && target && typeof target === 'object') {
        Object.defineProperty(target, '__flow', { value: true, enumerable: false, writable: false });
    }
}
/** Check if a value is a {fileID: 0} null reference */
function isNullReference(value) {
    return value && typeof value === 'object' && 'fileID' in value && String(value.fileID) === '0';
}
/** Check if a value is a plain object (not array, not null) */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Remap vector keys from parsed compact value to match original key names.
 * E.g., {x:1, y:1, z:1, w:1} → {r:1, g:1, b:1, a:1} if original had r/g/b/a keys.
 * Returns remapped object, or null if key counts don't match.
 */
function remapVectorKeys(parsed, original) {
    const parsedKeys = Object.keys(parsed).filter(k => k !== '__multiLine');
    const origKeys = Object.keys(original).filter(k => k !== '__multiLine');
    if (parsedKeys.length !== origKeys.length || parsedKeys.length === 0)
        return null;
    // Only remap if both look like vectors/colors (2-4 single-letter keys)
    const isVectorLike = (keys) => keys.length >= 2 && keys.length <= 4 &&
        keys.every(k => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].includes(k));
    if (!isVectorLike(parsedKeys) || !isVectorLike(origKeys))
        return null;
    // Check if keys differ — need remapping
    const needsRemap = parsedKeys.some((k, i) => k !== origKeys[i]);
    if (!needsRemap)
        return null;
    const remapped = {};
    for (let i = 0; i < origKeys.length; i++) {
        remapped[origKeys[i]] = parsed[parsedKeys[i]];
    }
    return remapped;
}
/** Reconstruct a nested value from CompactProperty children, using original for key remapping */
function reconstructNestedValue(children, original, refs, structurePaths, pathLookupOptions = {}) {
    // Check if this is an array (items have __item__ key) or an object
    const isArray = children.some(c => c.key === '__item__');
    if (isArray) {
        const origArray = Array.isArray(original) ? original : undefined;
        return children.map((c, idx) => {
            const origItem = origArray?.[idx];
            if (typeof c.value === 'string') {
                let parsed = (0, compact_reader_1.parseCompactValue)(c.value);
                parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
                return remapWithOriginal(parsed, origItem);
            }
            return reconstructNestedValue(c.value, origItem, refs, structurePaths, pathLookupOptions);
        });
    }
    // Object
    const origObj = isPlainObject(original) ? original : undefined;
    const result = {};
    for (const child of children) {
        const origVal = origObj?.[child.key];
        if (Array.isArray(child.value)) {
            result[child.key] = reconstructNestedValue(child.value, origVal, refs, structurePaths, pathLookupOptions);
        }
        else {
            let parsed = (0, compact_reader_1.parseCompactValue)(child.value);
            parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
            result[child.key] = remapWithOriginal(parsed, origVal);
        }
    }
    return result;
}
/** Remap a parsed value using the original for vector key preservation and flow markers */
function remapWithOriginal(parsed, original) {
    if (isPlainObject(parsed) && isPlainObject(original)) {
        const remapped = remapVectorKeys(parsed, original);
        if (remapped) {
            preserveFlowMarker(original, remapped);
            return remapped;
        }
        preserveFlowMarker(original, parsed);
    }
    return parsed;
}
/** Build mutable PrefabInstance modification owners from their Unity documents. */
function buildVariantModificationOwners(file) {
    const instanceDocs = new Map();
    for (const doc of file.documents) {
        if (doc.typeId === 1001) {
            instanceDocs.set(doc.fileId, doc);
        }
    }
    const owners = [];
    for (const instance of file.prefabInstances) {
        const doc = instanceDocs.get(instance.fileId);
        const modifications = doc?.properties.m_Modification?.m_Modifications;
        if (!Array.isArray(modifications))
            continue;
        owners.push({
            instanceFileId: instance.fileId,
            modifications,
        });
    }
    return owners;
}
/** Get the first scalar REFS value for a key, with normal path alias handling. */
function getRefsValue(refs, key, pathLookupOptions) {
    const entry = (0, path_utils_1.findPathMapEntry)(refs, key, pathLookupOptions);
    return entry?.value[0];
}
function modificationTargetsFileId(mod, targetFileId) {
    return String(mod.target?.fileID) === targetFileId;
}
function ownerHasSectionProperty(owner, targetFileId, section) {
    const editableKeys = section.properties
        .filter(prop => typeof prop.value === 'string')
        .map(prop => prop.key);
    if (editableKeys.length === 0) {
        return owner.modifications.some(mod => modificationTargetsFileId(mod, targetFileId));
    }
    return owner.modifications.some(mod => modificationTargetsFileId(mod, targetFileId) && editableKeys.includes(mod.propertyPath));
}
/** Pick the PrefabInstance document that owns a variant section's modifications. */
function selectVariantModificationOwner(owners, targetFileId, section, ownerInstanceId, refsOccurrenceIndex = 0) {
    if (ownerInstanceId) {
        return owners.find(owner => owner.instanceFileId === ownerInstanceId);
    }
    let candidates = owners.filter(owner => ownerHasSectionProperty(owner, targetFileId, section));
    if (candidates.length === 0) {
        candidates = owners.filter(owner => owner.modifications.some(mod => modificationTargetsFileId(mod, targetFileId)));
    }
    return candidates[refsOccurrenceIndex] || candidates[0];
}
/** Preserve reference context when a path ref only carries a fileID. */
function contextualizeObjectReference(parsed, existing) {
    if (!parsed || typeof parsed !== 'object' || !('fileID' in parsed))
        return parsed;
    if (!existing || typeof existing !== 'object')
        return parsed;
    const next = { ...parsed };
    if (next.guid === undefined && existing.guid !== undefined) {
        next.guid = existing.guid;
    }
    if (next.type === undefined && existing.type !== undefined) {
        next.type = existing.type;
    }
    return next;
}
/** Merge sections for a variant file */
function mergeVariantSections(file, sections, refs, structurePaths, resolver, allowSelectors = false) {
    // Find the main PrefabInstance (the one with transformParent = {fileID: 0})
    const mainInstance = file.prefabInstances.find(pi => String(pi.transformParent.fileID) === '0');
    if (!mainInstance) {
        if (sections.length > 0) {
            throw new Error('Cannot apply DETAILS: variant YAML has no root PrefabInstance.');
        }
        return;
    }
    const modificationOwners = buildVariantModificationOwners(file);
    if (modificationOwners.length === 0) {
        if (sections.length > 0) {
            throw new Error('Cannot apply DETAILS: variant YAML has no modification owner.');
        }
        return;
    }
    const docMap = new Map();
    for (const doc of file.documents) {
        docMap.set(doc.fileId, doc);
    }
    // Track per-key index for cycling through duplicate REFS entries
    const refsIndexMap = new Map();
    const pathLookupOptions = { allowAddedRootAliases: true };
    for (const section of sections) {
        // Resolve target fileID from REFS or section header
        let targetFileId;
        let ownerInstanceId;
        let targetSourceGuid;
        let refsOccurrenceIndex = 0;
        if (/^&\d+$/.test(section.goPath) && !section.componentType) {
            // Legacy format: [&fileID]
            targetFileId = section.goPath.substring(1);
        }
        else {
            // New format: [GOPath:ComponentType] — look up in REFS
            const refsKey = section.componentType
                ? `${section.goPath}:${section.componentType}`
                : section.goPath;
            const refsEntry = (0, path_utils_1.findPathMapEntry)(refs, refsKey, pathLookupOptions);
            if (refsEntry && refsEntry.value.length > 0) {
                const idx = refsIndexMap.get(refsEntry.key) || 0;
                refsOccurrenceIndex = idx;
                targetFileId = refsEntry.value[idx];
                refsIndexMap.set(refsEntry.key, idx + 1);
                ownerInstanceId = getRefsValue(refs, `${refsEntry.key}:__instance`, pathLookupOptions);
                targetSourceGuid = getRefsValue(refs, `${refsEntry.key}:__source`, pathLookupOptions);
            }
        }
        if (!targetFileId) {
            throw new Error(`REFS target not found for DETAILS section: ${sectionAddress(section)}.`);
        }
        const targetDoc = docMap.get(targetFileId);
        if (targetDoc && !targetDoc.stripped && targetDoc.typeId !== 1001) {
            validateDocumentType(section, targetDoc, resolver, allowSelectors);
            if (section.componentType === 'Transform' || section.componentType === 'RectTransform') {
                applyTransformProperties(section.properties, targetDoc, section.componentType === 'RectTransform');
            }
            else {
                applyComponentProperties(section.properties, targetDoc, refs, structurePaths, pathLookupOptions);
            }
            continue;
        }
        const owner = selectVariantModificationOwner(modificationOwners, targetFileId, section, ownerInstanceId, refsOccurrenceIndex);
        if (!owner) {
            throw new Error(`Variant modification owner not found for ${sectionAddress(section)} ` +
                `(target &${targetFileId}).`);
        }
        for (const prop of section.properties) {
            if (typeof prop.value !== 'string')
                continue;
            // Find existing modification with this target + propertyPath
            const existing = owner.modifications.find((m) => String(m.target?.fileID) === targetFileId && m.propertyPath === prop.key);
            if (existing) {
                // Update existing modification
                let parsed = (0, compact_reader_1.parseCompactValue)(prop.value);
                parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
                if (typeof parsed === 'object' && parsed !== null && 'fileID' in parsed) {
                    parsed = contextualizeObjectReference(parsed, existing.objectReference);
                    // Object reference — preserve original type if fileID and guid match
                    const origRef = existing.objectReference;
                    if (origRef &&
                        String(origRef.fileID) === String(parsed.fileID) &&
                        (origRef.guid || '') === (parsed.guid || '')) {
                        // Same reference — keep original (preserves type field)
                    }
                    else {
                        existing.objectReference = parsed;
                        existing.value = '';
                    }
                }
                else {
                    const newValue = String(parsed ?? '');
                    if (existing.value !== newValue) {
                        existing.value = newValue;
                        existing.objectReference = { fileID: 0 };
                    }
                }
            }
            else {
                let parsed = (0, compact_reader_1.parseCompactValue)(prop.value);
                parsed = resolvePathReference(parsed, refs, structurePaths, pathLookupOptions);
                const ownerInfo = file.prefabInstances.find(instance => instance.fileId === owner.instanceFileId);
                const sourceGuid = targetSourceGuid
                    || owner.modifications.find(mod => modificationTargetsFileId(mod, targetFileId))?.target?.guid
                    || ownerInfo?.sourcePrefab.guid
                    || mainInstance.sourcePrefab.guid
                    || compactBaseGuid(file);
                const target = { fileID: targetFileId };
                if (sourceGuid) {
                    target.guid = sourceGuid;
                    target.type = 3;
                }
                const modification = {
                    target,
                    propertyPath: prop.key,
                    value: '',
                    objectReference: { fileID: 0 },
                };
                if (parsed && typeof parsed === 'object' && 'fileID' in parsed) {
                    modification.objectReference = parsed;
                }
                else {
                    modification.value = String(parsed ?? '');
                }
                owner.modifications.push(modification);
            }
        }
    }
}
/** Best-effort source GUID fallback for legacy compact files without :__source metadata. */
function compactBaseGuid(file) {
    return file.variantSource?.guid;
}
//# sourceMappingURL=compact-merger.js.map