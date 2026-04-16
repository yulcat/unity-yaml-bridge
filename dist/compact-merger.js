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
const compact_reader_1 = require("./compact-reader");
const path_utils_1 = require("./path-utils");
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
        paths.add(`${currentPath}:${comp}`);
    }
    for (const child of node.children) {
        collectStructurePaths(child, currentPath, paths);
    }
}
/**
 * Merge compact file changes into the original AST.
 * Returns a new UnityFile with the changes applied.
 * The original is not modified.
 */
function mergeCompactChanges(original, compact) {
    const result = cloneUnityFile(original);
    // Collect all GO paths from STRUCTURE tree — used to distinguish
    // valid new references (GO exists in hierarchy) from typos
    const structurePaths = new Set();
    if (compact.structure) {
        collectStructurePaths(compact.structure, '', structurePaths);
    }
    if (compact.type === 'variant') {
        mergeVariantSections(result, compact.sections, compact.refs, structurePaths);
    }
    else {
        mergePrefabSections(result, compact.sections, compact.refs, structurePaths);
    }
    return result;
}
// ============================================================
// Prefab merging — match sections by REFS fileID or GO name + component type
// ============================================================
/** Merge sections for a regular prefab */
function mergePrefabSections(file, sections, refs, structurePaths) {
    if (!file.hierarchy)
        return;
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
                    if (compType === 'Transform' || compType === 'RectTransform') {
                        applyTransformProperties(section.properties, doc, compType === 'RectTransform');
                    }
                    else {
                        applyComponentProperties(section.properties, doc, refs, structurePaths);
                    }
                    continue;
                }
            }
        }
        // Fallback: name-based matching
        const candidates = goMap.get(goPath) || [];
        if (candidates.length === 0) {
            continue;
        }
        const go = candidates[0];
        if (compType === 'Transform' || compType === 'RectTransform') {
            const transformDoc = docMap.get(go.transform.fileId);
            if (transformDoc) {
                applyTransformProperties(section.properties, transformDoc, compType === 'RectTransform');
            }
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
                    applyComponentProperties(section.properties, compDoc, refs, structurePaths);
                }
            }
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
    if (unused.length === 0)
        return fileIds[0]; // All used, fallback to first
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
function mergeVariantSections(file, sections, refs, structurePaths) {
    // Find the main PrefabInstance (the one with transformParent = {fileID: 0})
    const mainInstance = file.prefabInstances.find(pi => String(pi.transformParent.fileID) === '0');
    if (!mainInstance)
        return;
    const modificationOwners = buildVariantModificationOwners(file);
    if (modificationOwners.length === 0)
        return;
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
        let refsOccurrenceIndex = 0;
        if (section.goPath.startsWith('&')) {
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
            }
        }
        if (!targetFileId)
            continue;
        const targetDoc = docMap.get(targetFileId);
        if (targetDoc && !targetDoc.stripped && targetDoc.typeId !== 1001) {
            if (section.componentType === 'Transform' || section.componentType === 'RectTransform') {
                applyTransformProperties(section.properties, targetDoc, section.componentType === 'RectTransform');
            }
            else {
                applyComponentProperties(section.properties, targetDoc, refs, structurePaths, pathLookupOptions);
            }
            continue;
        }
        const owner = selectVariantModificationOwner(modificationOwners, targetFileId, section, ownerInstanceId, refsOccurrenceIndex);
        if (!owner)
            continue;
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
            // Note: adding NEW modifications would require generating proper target refs.
            // For Phase 1, we only support editing existing modifications.
        }
    }
}
//# sourceMappingURL=compact-merger.js.map