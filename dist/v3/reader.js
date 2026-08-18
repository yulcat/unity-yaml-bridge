"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readV3 = readV3;
const value_1 = require("./value");
const MACHINE_ID = '[A-Za-z][A-Za-z0-9_-]*';
function readV3(content) {
    const lines = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
    const header = lines[0]?.trim();
    const headerMatch = header?.match(/^# ubridge v3 \| (prefab|variant) \| profile:([^ |]+)(?: \| asset-guid:([a-f0-9]{32}))?$/i);
    if (!headerMatch) {
        throw new Error('Invalid v3 header. Expected "# ubridge v3 | prefab | profile:<id>".');
    }
    const kind = headerMatch[1];
    const structureIndex = findUniqueSection(lines, '--- STRUCTURE');
    const detailsIndex = findUniqueSection(lines, '--- DETAILS');
    const identityIndex = findUniqueSection(lines, '--- IDENTITY');
    if (!(structureIndex < detailsIndex && detailsIndex < identityIndex)) {
        throw new Error('Invalid v3 section order. Expected STRUCTURE, DETAILS, then IDENTITY.');
    }
    const structureLines = lines.slice(structureIndex + 1, detailsIndex)
        .filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
    let structure;
    let variantRootId;
    let baseGuid;
    let variantRoots;
    if (kind === 'variant') {
        const variantLine = structureLines[0]?.match(new RegExp(`^\\(variant @(${MACHINE_ID}) source:([a-f0-9]{32})\\)$`, 'i'));
        if (!variantLine)
            throw new Error('v3 variant STRUCTURE requires a variant root descriptor.');
        structure = null;
        variantRootId = variantLine[1];
        baseGuid = variantLine[2];
        variantRoots = parseStructureForest(structureLines.slice(1));
    }
    else {
        structure = parseStructure(structureLines);
    }
    const details = parseDetails(lines.slice(detailsIndex + 1, identityIndex));
    const identity = parseIdentity(lines.slice(identityIndex + 1));
    if (structure)
        validateBindings(structure, details, identity);
    const variantBindings = new Set();
    for (const root of variantRoots ?? []) {
        validateBindings(root, details, identity, variantBindings, variantRootId);
    }
    if (kind === 'variant') {
        const root = identity.get(variantRootId);
        if (!root || root.kind !== 'prefabInstance' || root.typeId !== 1001) {
            throw new Error(`Variant root ${variantRootId} is not a PrefabInstance identity.`);
        }
    }
    return {
        version: 3,
        kind,
        profile: headerMatch[2],
        assetGuid: headerMatch[3],
        structure,
        variantRoots,
        details,
        identity,
        variantRootId,
        baseGuid,
    };
}
function parseStructureForest(lines) {
    const roots = [];
    const stack = [];
    for (const line of lines) {
        const depth = getTreeDepth(line);
        if (depth < 1)
            throw new Error(`Invalid v3 variant STRUCTURE indentation: ${line}`);
        while (stack.length && stack[stack.length - 1].depth >= depth)
            stack.pop();
        const node = parseStructureLine(line);
        if (depth === 1)
            roots.push(node);
        else {
            const parent = stack[stack.length - 1];
            if (!parent || depth !== parent.depth + 1) {
                throw new Error(`Invalid v3 variant STRUCTURE depth jump: ${line}`);
            }
            parent.node.children.push(node);
        }
        stack.push({ depth, node });
    }
    return roots;
}
function findUniqueSection(lines, section) {
    const indexes = lines.flatMap((line, index) => line.trim() === section ? [index] : []);
    if (indexes.length !== 1)
        throw new Error(`Expected exactly one ${section} section.`);
    return indexes[0];
}
function parseStructure(lines) {
    if (lines.length === 0)
        throw new Error('v3 STRUCTURE must contain exactly one root.');
    const root = parseStructureLine(lines[0]);
    const stack = [{ depth: 0, node: root }];
    for (let index = 1; index < lines.length; index++) {
        const depth = getTreeDepth(lines[index]);
        if (depth === 0)
            throw new Error(`Invalid v3 STRUCTURE indentation: ${lines[index]}`);
        while (stack.length && stack[stack.length - 1].depth >= depth)
            stack.pop();
        const parent = stack[stack.length - 1];
        if (!parent || depth !== parent.depth + 1) {
            throw new Error(`Invalid v3 STRUCTURE depth jump: ${lines[index]}`);
        }
        const node = parseStructureLine(lines[index]);
        parent.node.children.push(node);
        stack.push({ depth, node });
    }
    return root;
}
function parseStructureLine(line) {
    let text = line.replace(/[├└│─]/g, '').trim();
    const tombstone = text.startsWith('- ');
    if (tombstone)
        text = text.slice(2).trim();
    let components = [];
    const componentMatch = text.match(/\s+\[([^\]]*)\]$/);
    if (componentMatch) {
        components = componentMatch[1].split(',').map(item => item.trim()).filter(Boolean).map(item => {
            const match = item.match(new RegExp(`^(.+?) @(${MACHINE_ID})$`));
            if (!match)
                throw new Error(`Invalid v3 component binding: ${item}`);
            return { typeName: match[1].trim(), machineId: match[2] };
        });
        text = text.slice(0, componentMatch.index).trim();
    }
    let nestedSourceGuid;
    let prefabInstanceId;
    const nestedMatch = text.match(new RegExp(`\\s+\\{(?:prefab:@(${MACHINE_ID}) )?source:([a-f0-9]{32})\\}$`, 'i'));
    if (nestedMatch) {
        prefabInstanceId = nestedMatch[1];
        nestedSourceGuid = nestedMatch[2];
        text = text.slice(0, nestedMatch.index).trim();
    }
    const match = text.match(new RegExp(`^(.+?) @(${MACHINE_ID})$`));
    if (!match)
        throw new Error(`Every existing v3 GameObject needs an @machineId: ${line}`);
    return {
        name: match[1].trim(),
        machineId: match[2],
        components,
        children: [],
        nestedSourceGuid,
        prefabInstanceId,
        tombstone,
    };
}
function getTreeDepth(line) {
    const branch = line.search(/[├└]/);
    return branch < 0 ? 0 : Math.floor(branch / 3) + 1;
}
function parseDetails(lines) {
    const result = new Map();
    let currentId;
    for (let index = 0; index < lines.length; index++) {
        const text = lines[index].trim();
        if (!text || text.startsWith('#'))
            continue;
        const section = text.match(new RegExp(`^\\[(${MACHINE_ID})(?: \\| [^\\]]+)?\\]$`));
        if (section) {
            currentId = section[1];
            if (result.has(currentId))
                throw new Error(`Duplicate v3 DETAILS section for ${currentId}.`);
            result.set(currentId, {});
            continue;
        }
        if (!currentId)
            throw new Error(`v3 DETAILS property appears before a section: ${text}`);
        const assignment = text.match(/^([^=]+?)\s*=\s*(.+)$/);
        if (!assignment)
            throw new Error(`Invalid v3 DETAILS property: ${text}`);
        const key = assignment[1].trim();
        const properties = result.get(currentId);
        if (Object.prototype.hasOwnProperty.call(properties, key)) {
            throw new Error(`Duplicate v3 property ${currentId}.${key}.`);
        }
        properties[key] = (0, value_1.parseV3Value)(assignment[2], `line ${index + 1}`);
    }
    return result;
}
function parseIdentity(lines) {
    const result = new Map();
    for (const rawLine of lines) {
        const text = rawLine.trim();
        if (!text || text.startsWith('#'))
            continue;
        const assignment = text.match(new RegExp(`^(${MACHINE_ID})\\s*=\\s*(.+)$`));
        if (!assignment)
            throw new Error(`Invalid v3 IDENTITY record: ${text}`);
        const machineId = assignment[1];
        if (result.has(machineId))
            throw new Error(`Duplicate v3 identity ${machineId}.`);
        const parts = assignment[2].split('|').map(part => part.trim());
        const kind = parts.shift();
        if (kind !== 'gameObject' && kind !== 'transform' && kind !== 'component' &&
            kind !== 'prefabInstance' && kind !== 'stripped' && kind !== 'owned') {
            throw new Error(`Invalid v3 identity kind for ${machineId}: ${kind}`);
        }
        const fields = new Map();
        for (const part of parts) {
            const colon = part.indexOf(':');
            if (colon <= 0)
                throw new Error(`Invalid v3 identity field for ${machineId}: ${part}`);
            fields.set(part.slice(0, colon), part.slice(colon + 1));
        }
        const typeId = Number(fields.get('type'));
        const typeName = fields.get('typeName');
        if (!Number.isInteger(typeId) || !typeName) {
            throw new Error(`v3 identity ${machineId} requires type and typeName.`);
        }
        const origin = fields.get('origin');
        if (origin !== undefined && origin !== 'inherited') {
            throw new Error(`Invalid v3 identity origin for ${machineId}: ${origin}`);
        }
        result.set(machineId, {
            machineId,
            kind,
            origin,
            fileId: fields.get('fileID'),
            typeId,
            typeName,
            displayName: fields.get('displayName') || typeName,
            ownerId: fields.get('owner'),
            prefabOwnerId: fields.get('prefabOwner'),
            scriptGuid: fields.get('script'),
            scriptFileId: fields.get('scriptFileID'),
            scriptType: fields.has('scriptType') ? Number(fields.get('scriptType')) : undefined,
            stripped: fields.get('stripped') === '1',
            nestedRoot: fields.get('nestedRoot') === '1',
            baselineParentId: fields.get('baselineParent'),
            baselineOrder: fields.has('baselineOrder') ? Number(fields.get('baselineOrder')) : undefined,
            sourceGuid: fields.get('sourceGuid'),
            sourceFileId: fields.get('sourceFileID'),
            sourceFingerprint: fields.get('sourceFingerprint'),
        });
    }
    return result;
}
function validateBindings(root, details, identity, used = new Set(), leafPrefabOwnerId) {
    const visit = (node, activePrefabOwnerId, activeSourceGuid) => {
        if (used.has(node.machineId))
            throw new Error(`Duplicate STRUCTURE machine identity ${node.machineId}.`);
        used.add(node.machineId);
        const go = identity.get(node.machineId);
        if (node.nestedSourceGuid && !node.prefabInstanceId) {
            if (!go || go.kind !== 'prefabInstance' || go.typeId !== 1001) {
                throw new Error(`Nested STRUCTURE ${node.machineId} is not bound to a PrefabInstance identity.`);
            }
            if (activePrefabOwnerId &&
                (go.prefabOwnerId !== activePrefabOwnerId || go.sourceGuid !== activeSourceGuid)) {
                throw new Error(`Nested PrefabInstance ${node.machineId} is not directly owned by ${activePrefabOwnerId}.`);
            }
            if (go.origin !== 'inherited') {
                const rootTransforms = [...identity.values()].filter(record => record.kind === 'stripped' && record.ownerId === node.machineId && record.nestedRoot &&
                    (record.typeId === 4 || record.typeId === 224));
                if (rootTransforms.length !== 1) {
                    throw new Error(`Nested PrefabInstance ${node.machineId} requires exactly one stripped root Transform.`);
                }
            }
            if (node.components.length > 0) {
                throw new Error(`Inherited nested root components are not implemented for ${node.machineId}.`);
            }
            if (go.origin !== 'inherited' && node.children.length > 0) {
                throw new Error(`Expanded nested STRUCTURE is not implemented for ${node.machineId}.`);
            }
            node.children.forEach(child => visit(child, go.machineId, node.nestedSourceGuid));
            return;
        }
        let directPrefabOwnerId = activePrefabOwnerId;
        let directSourceGuid = activeSourceGuid;
        if (node.prefabInstanceId) {
            if (!node.nestedSourceGuid) {
                throw new Error(`Nested source-root ${node.machineId} has PrefabInstance metadata without a source GUID.`);
            }
            const prefabInstance = identity.get(node.prefabInstanceId);
            if (!prefabInstance || prefabInstance.kind !== 'prefabInstance' || prefabInstance.typeId !== 1001) {
                throw new Error(`Nested source-root ${node.machineId} has invalid PrefabInstance metadata ${node.prefabInstanceId}.`);
            }
            if (activePrefabOwnerId &&
                (prefabInstance.prefabOwnerId !== activePrefabOwnerId ||
                    prefabInstance.sourceGuid !== activeSourceGuid)) {
                throw new Error(`Nested PrefabInstance ${node.prefabInstanceId} is not directly owned by ${activePrefabOwnerId}.`);
            }
            if (!go || go.kind !== 'gameObject' || go.prefabOwnerId !== prefabInstance.machineId) {
                throw new Error(`Nested source-root ${node.machineId} is not directly owned by ${node.prefabInstanceId}.`);
            }
            directPrefabOwnerId = prefabInstance.machineId;
            directSourceGuid = node.nestedSourceGuid;
        }
        if (!go || go.kind !== 'gameObject' || go.typeId !== 1) {
            throw new Error(`STRUCTURE ${node.machineId} is not bound to a GameObject identity.`);
        }
        if (directPrefabOwnerId) {
            const validInheritedOwner = go?.origin === 'inherited' &&
                go.prefabOwnerId === directPrefabOwnerId && go.sourceGuid === directSourceGuid;
            const validLeafLocalOwner = go?.origin !== 'inherited' && !!leafPrefabOwnerId &&
                go?.prefabOwnerId === leafPrefabOwnerId && !go?.sourceGuid && !go?.sourceFileId;
            if (!validInheritedOwner && !validLeafLocalOwner) {
                throw new Error(`GameObject ${node.machineId} is not owned by nested PrefabInstance ` +
                    `${directPrefabOwnerId} or emitted leaf ${leafPrefabOwnerId}.`);
            }
        }
        const transforms = [...identity.values()].filter(record => record.kind === 'transform' && record.ownerId === node.machineId);
        if (transforms.length !== 1 || ![4, 224].includes(transforms[0].typeId)) {
            throw new Error(`GameObject ${node.machineId} requires exactly one Transform identity.`);
        }
        if (directPrefabOwnerId) {
            const transform = transforms[0];
            const validInheritedOwner = transform.origin === 'inherited' &&
                transform.prefabOwnerId === directPrefabOwnerId && transform.sourceGuid === directSourceGuid;
            const validLeafLocalOwner = go.origin !== 'inherited' && !!leafPrefabOwnerId &&
                transform.origin !== 'inherited' && transform.prefabOwnerId === leafPrefabOwnerId &&
                !transform.sourceGuid && !transform.sourceFileId;
            if (!validInheritedOwner && !validLeafLocalOwner) {
                throw new Error(`Transform ${transform.machineId} has ambiguous nested addition ownership.`);
            }
        }
        for (const component of node.components) {
            if (used.has(component.machineId))
                throw new Error(`Duplicate STRUCTURE machine identity ${component.machineId}.`);
            used.add(component.machineId);
            const record = identity.get(component.machineId);
            const validBase = !!record && record.kind === 'component' && record.ownerId === node.machineId &&
                (record.displayName || record.typeName) === component.typeName;
            const validNestedOwner = !directPrefabOwnerId ||
                record?.origin === 'inherited' && record.prefabOwnerId === directPrefabOwnerId &&
                    record.sourceGuid === directSourceGuid ||
                record?.origin !== 'inherited' && !!leafPrefabOwnerId &&
                    record?.prefabOwnerId === leafPrefabOwnerId && !record?.sourceGuid && !record?.sourceFileId;
            if (!validBase || !validNestedOwner) {
                throw new Error(`Invalid component binding ${component.typeName} @${component.machineId}.`);
            }
        }
        node.children.forEach(child => visit(child, directPrefabOwnerId, directSourceGuid));
    };
    visit(root);
    for (const machineId of details.keys()) {
        if (!identity.has(machineId))
            throw new Error(`DETAILS target ${machineId} has no IDENTITY record.`);
    }
    for (const record of identity.values()) {
        if ((record.kind === 'transform' || record.kind === 'component') && record.ownerId) {
            const owner = identity.get(record.ownerId);
            if (!owner || owner.kind !== 'gameObject') {
                throw new Error(`IDENTITY ${record.machineId} has invalid owner ${record.ownerId}.`);
            }
        }
        if (record.kind === 'stripped' && record.ownerId) {
            const owner = identity.get(record.ownerId);
            if (!owner || owner.kind !== 'prefabInstance') {
                throw new Error(`Stripped IDENTITY ${record.machineId} has invalid owner ${record.ownerId}.`);
            }
        }
    }
}
//# sourceMappingURL=reader.js.map