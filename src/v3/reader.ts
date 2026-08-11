import { V3Document, V3IdentityRecord, V3StructureComponent, V3StructureNode } from './model';
import { parseV3Value } from './value';

const MACHINE_ID = '[A-Za-z][A-Za-z0-9_-]*';

export function readV3(content: string): V3Document {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const header = lines[0]?.trim();
  const headerMatch = header?.match(/^# ubridge v3 \| (prefab|variant) \| profile:([^ |]+)(?: \| asset-guid:([a-f0-9]{32}))?$/i);
  if (!headerMatch) {
    throw new Error('Invalid v3 header. Expected "# ubridge v3 | prefab | profile:<id>".');
  }
  if (headerMatch[1] !== 'prefab') {
    throw new Error('v3 compiler currently supports local regular prefabs only.');
  }

  const structureIndex = findUniqueSection(lines, '--- STRUCTURE');
  const detailsIndex = findUniqueSection(lines, '--- DETAILS');
  const identityIndex = findUniqueSection(lines, '--- IDENTITY');
  if (!(structureIndex < detailsIndex && detailsIndex < identityIndex)) {
    throw new Error('Invalid v3 section order. Expected STRUCTURE, DETAILS, then IDENTITY.');
  }

  const structureLines = lines.slice(structureIndex + 1, detailsIndex)
    .filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
  const structure = parseStructure(structureLines);
  const details = parseDetails(lines.slice(detailsIndex + 1, identityIndex));
  const identity = parseIdentity(lines.slice(identityIndex + 1));

  validateBindings(structure, details, identity);
  return {
    version: 3,
    kind: 'prefab',
    profile: headerMatch[2],
    assetGuid: headerMatch[3],
    structure,
    details,
    identity,
  };
}

function findUniqueSection(lines: string[], section: string): number {
  const indexes = lines.flatMap((line, index) => line.trim() === section ? [index] : []);
  if (indexes.length !== 1) throw new Error(`Expected exactly one ${section} section.`);
  return indexes[0];
}

function parseStructure(lines: string[]): V3StructureNode {
  if (lines.length === 0) throw new Error('v3 STRUCTURE must contain exactly one root.');
  const root = parseStructureLine(lines[0]);
  const stack: Array<{ depth: number; node: V3StructureNode }> = [{ depth: 0, node: root }];

  for (let index = 1; index < lines.length; index++) {
    const depth = getTreeDepth(lines[index]);
    if (depth === 0) throw new Error(`Invalid v3 STRUCTURE indentation: ${lines[index]}`);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
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

function parseStructureLine(line: string): V3StructureNode {
  let text = line.replace(/[├└│─]/g, '').trim();
  let components: V3StructureComponent[] = [];
  const componentMatch = text.match(/\s+\[([^\]]*)\]$/);
  if (componentMatch) {
    components = componentMatch[1].split(',').map(item => item.trim()).filter(Boolean).map(item => {
      const match = item.match(new RegExp(`^(.+?) @(${MACHINE_ID})$`));
      if (!match) throw new Error(`Invalid v3 component binding: ${item}`);
      return { typeName: match[1].trim(), machineId: match[2] };
    });
    text = text.slice(0, componentMatch.index).trim();
  }

  const match = text.match(new RegExp(`^(.+?) @(${MACHINE_ID})$`));
  if (!match) throw new Error(`Every existing v3 GameObject needs an @machineId: ${line}`);
  return { name: match[1].trim(), machineId: match[2], components, children: [] };
}

function getTreeDepth(line: string): number {
  const branch = line.search(/[├└]/);
  return branch < 0 ? 0 : Math.floor(branch / 3) + 1;
}

function parseDetails(lines: string[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  let currentId: string | undefined;

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (!text || text.startsWith('#')) continue;
    const section = text.match(new RegExp(`^\\[(${MACHINE_ID})(?: \\| [^\\]]+)?\\]$`));
    if (section) {
      currentId = section[1];
      if (result.has(currentId)) throw new Error(`Duplicate v3 DETAILS section for ${currentId}.`);
      result.set(currentId, {});
      continue;
    }
    if (!currentId) throw new Error(`v3 DETAILS property appears before a section: ${text}`);
    const assignment = text.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (!assignment) throw new Error(`Invalid v3 DETAILS property: ${text}`);
    const key = assignment[1].trim();
    const properties = result.get(currentId)!;
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      throw new Error(`Duplicate v3 property ${currentId}.${key}.`);
    }
    properties[key] = parseV3Value(assignment[2], `line ${index + 1}`);
  }
  return result;
}

function parseIdentity(lines: string[]): Map<string, V3IdentityRecord> {
  const result = new Map<string, V3IdentityRecord>();
  for (const rawLine of lines) {
    const text = rawLine.trim();
    if (!text || text.startsWith('#')) continue;
    const assignment = text.match(new RegExp(`^(${MACHINE_ID})\\s*=\\s*(.+)$`));
    if (!assignment) throw new Error(`Invalid v3 IDENTITY record: ${text}`);
    const machineId = assignment[1];
    if (result.has(machineId)) throw new Error(`Duplicate v3 identity ${machineId}.`);
    const parts = assignment[2].split('|').map(part => part.trim());
    const kind = parts.shift();
    if (kind !== 'gameObject' && kind !== 'transform' && kind !== 'component') {
      throw new Error(`Invalid v3 identity kind for ${machineId}: ${kind}`);
    }
    const fields = new Map<string, string>();
    for (const part of parts) {
      const colon = part.indexOf(':');
      if (colon <= 0) throw new Error(`Invalid v3 identity field for ${machineId}: ${part}`);
      fields.set(part.slice(0, colon), part.slice(colon + 1));
    }
    const typeId = Number(fields.get('type'));
    const typeName = fields.get('typeName');
    if (!Number.isInteger(typeId) || !typeName) {
      throw new Error(`v3 identity ${machineId} requires type and typeName.`);
    }
    result.set(machineId, {
      machineId,
      kind,
      fileId: fields.get('fileID'),
      typeId,
      typeName,
      displayName: fields.get('displayName') || typeName,
      ownerId: fields.get('owner'),
      scriptGuid: fields.get('script'),
      scriptFileId: fields.get('scriptFileID'),
      scriptType: fields.has('scriptType') ? Number(fields.get('scriptType')) : undefined,
    });
  }
  return result;
}

function validateBindings(
  root: V3StructureNode,
  details: Map<string, Record<string, unknown>>,
  identity: Map<string, V3IdentityRecord>
): void {
  const used = new Set<string>();
  const visit = (node: V3StructureNode): void => {
    if (used.has(node.machineId)) throw new Error(`Duplicate STRUCTURE machine identity ${node.machineId}.`);
    used.add(node.machineId);
    const go = identity.get(node.machineId);
    if (!go || go.kind !== 'gameObject' || go.typeId !== 1) {
      throw new Error(`STRUCTURE ${node.machineId} is not bound to a GameObject identity.`);
    }
    const transforms = [...identity.values()].filter(record =>
      record.kind === 'transform' && record.ownerId === node.machineId
    );
    if (transforms.length !== 1 || ![4, 224].includes(transforms[0].typeId)) {
      throw new Error(`GameObject ${node.machineId} requires exactly one Transform identity.`);
    }
    for (const component of node.components) {
      if (used.has(component.machineId)) throw new Error(`Duplicate STRUCTURE machine identity ${component.machineId}.`);
      used.add(component.machineId);
      const record = identity.get(component.machineId);
      if (!record || record.kind !== 'component' || record.ownerId !== node.machineId ||
          (record.displayName || record.typeName) !== component.typeName) {
        throw new Error(`Invalid component binding ${component.typeName} @${component.machineId}.`);
      }
    }
    node.children.forEach(visit);
  };
  visit(root);

  for (const machineId of details.keys()) {
    if (!identity.has(machineId)) throw new Error(`DETAILS target ${machineId} has no IDENTITY record.`);
  }
  for (const record of identity.values()) {
    if (record.kind === 'gameObject' || record.kind === 'component') {
      if (!used.has(record.machineId)) {
        throw new Error(`IDENTITY ${record.machineId} is absent from desired STRUCTURE.`);
      }
    }
  }
}
