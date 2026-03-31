/**
 * Parse a .ubridge compact file back into a structure that can be used
 * to reconstruct Unity YAML.
 *
 * This module handles the reverse direction: compact → CompactFile.
 */

/** Parsed compact file representation */
export interface CompactFile {
  version: number;
  type: 'prefab' | 'variant' | 'scene';
  baseGuid?: string;
  structure: CompactStructureNode | null;
  sections: CompactSection[];
  /** REFS map: "GOName:ComponentType" → fileID strings (supports duplicate keys) */
  refs: Map<string, string[]>;
}

export interface CompactStructureNode {
  name: string;
  nestedPrefab?: string;
  components: string[];
  children: CompactStructureNode[];
  marker?: '*' | '+' | '-';
}

export interface CompactSection {
  /** GO path (e.g. "Button") or variant target (e.g. "&8368714169436892108") */
  goPath: string;
  /** Component type (e.g. "RectTransform", "Image") — empty for variant sections */
  componentType: string;
  /** Parsed properties */
  properties: CompactProperty[];
  /** Whether this section is for a newly added component (+ prefix in DETAILS header) */
  isAdded?: boolean;
}

export interface CompactProperty {
  key: string;
  value: string | CompactProperty[];
  indent: number;
}

/** Parse a .ubridge string into a CompactFile */
export function readCompact(content: string): CompactFile {
  const lines = content.split('\n');

  // Parse header
  const headerLine = lines[0];
  const headerMatch = headerLine.match(/^# ubridge v(\d+) \| (\w+)(?:\s*\|\s*(.+))?/);
  if (!headerMatch) {
    throw new Error(`Invalid .ubridge header: ${headerLine}`);
  }

  const version = parseInt(headerMatch[1], 10);
  const type = headerMatch[2] as 'prefab' | 'variant' | 'scene';
  const extra = headerMatch[3] || '';

  let baseGuid: string | undefined;
  const guidMatch = extra.match(/base-guid:(\S+)/);
  if (guidMatch) baseGuid = guidMatch[1];

  // Find section boundaries
  let structureStart = -1;
  let detailsStart = -1;
  let refsStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '--- STRUCTURE') structureStart = i + 1;
    if (lines[i] === '--- DETAILS') detailsStart = i + 1;
    if (lines[i] === '--- REFS') refsStart = i + 1;
  }

  // Parse structure
  let structure: CompactStructureNode | null = null;
  if (structureStart >= 0) {
    const structureEnd = detailsStart >= 0 ? detailsStart - 1 : (refsStart >= 0 ? refsStart - 1 : lines.length);
    const structureLines = lines.slice(structureStart, structureEnd).filter(l => l.trim() !== '');
    if (structureLines.length > 0) {
      structure = parseStructureTree(structureLines);
    }
  }

  // Parse details sections
  const sections: CompactSection[] = [];
  if (detailsStart >= 0) {
    const detailsEnd = refsStart >= 0 ? refsStart - 1 : lines.length;
    const detailLines = lines.slice(detailsStart, detailsEnd);
    parseDetailsSections(detailLines, sections);
  }

  // Parse REFS section
  const refs = new Map<string, string[]>();
  if (refsStart >= 0) {
    const refsLines = lines.slice(refsStart);
    parseRefsSection(refsLines, refs);
  }

  return { version, type, baseGuid, structure, sections, refs };
}

/** Parse the structure tree from lines */
function parseStructureTree(lines: string[]): CompactStructureNode | null {
  if (lines.length === 0) return null;

  // Skip variant structure line like "(variant of ...)"
  if (lines[0].trim().startsWith('(variant of')) {
    return null;
  }

  // First line is the root
  const root = parseStructureLine(lines[0]);

  // Parse children using indentation/tree characters
  parseChildren(lines, 1, root);

  return root;
}

/** Parse a single structure line into a node */
function parseStructureLine(line: string): CompactStructureNode {
  // Remove tree characters
  let cleaned = line.replace(/[├└│─]/g, '').trim();

  // Check for variant markers
  let marker: '*' | '+' | '-' | undefined;
  if (cleaned.startsWith('+ ')) {
    marker = '+';
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('- ')) {
    marker = '-';
    cleaned = cleaned.substring(2);
  }

  // Extract components [Comp1, Comp2]
  let components: string[] = [];
  const compMatch = cleaned.match(/\[([^\]]*)\]$/);
  if (compMatch) {
    components = compMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    cleaned = cleaned.substring(0, compMatch.index!).trim();
  }

  // Extract nested prefab {PrefabName}
  let nestedPrefab: string | undefined;
  const prefabMatch = cleaned.match(/\{([^}]+)\}$/);
  if (prefabMatch) {
    nestedPrefab = prefabMatch[1];
    cleaned = cleaned.substring(0, prefabMatch.index!).trim();
  }

  return {
    name: cleaned,
    nestedPrefab,
    components,
    children: [],
    marker,
  };
}

/** Parse children recursively based on tree structure */
function parseChildren(lines: string[], startIdx: number, parent: CompactStructureNode): number {
  let i = startIdx;
  const parentDepth = getTreeDepth(lines[startIdx - 1] || '');

  while (i < lines.length) {
    const line = lines[i];
    const depth = getTreeDepth(line);

    if (depth <= parentDepth && i > startIdx) break;

    if (depth === parentDepth + 1) {
      const child = parseStructureLine(line);
      parent.children.push(child);
      i = parseChildren(lines, i + 1, child);
    } else {
      i++;
    }
  }

  return i;
}

/** Get the tree depth from indentation and tree characters */
function getTreeDepth(line: string): number {
  // Count based on tree character positions
  // Root = 0, first child = 1, etc.
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '├' || line[i] === '└') {
      depth = Math.floor(i / 3) + 1;
      break;
    }
  }
  return depth;
}

/** Parse detail sections from lines using stack-based indent tracking */
function parseDetailsSections(lines: string[], sections: CompactSection[]): void {
  let currentSection: CompactSection | null = null;
  // Stack of (property, indent) for nesting — only properties with value=[] are pushed
  let stack: { prop: CompactProperty; indent: number }[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Section header: [GOPath:ComponentType] or [&fileID]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      let header = sectionMatch[1];
      let isAdded = false;
      if (header.startsWith('+ ')) {
        isAdded = true;
        header = header.substring(2);
      }
      if (header.startsWith('&')) {
        // Variant section: [&fileID]
        currentSection = { goPath: header, componentType: '', properties: [], isAdded };
      } else {
        const colonIdx = header.indexOf(':');
        if (colonIdx >= 0) {
          const goPath = header.substring(0, colonIdx);
          const componentType = header.substring(colonIdx + 1);
          currentSection = { goPath, componentType, properties: [], isAdded };
        } else {
          currentSection = { goPath: header, componentType: '', properties: [], isAdded };
        }
      }
      sections.push(currentSection);
      stack = [];
      continue;
    }

    // Property line
    if (currentSection) {
      const indent = line.length - line.trimStart().length;

      // Pop stack until we find a parent with indent strictly less than current
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      // Determine the target container: parent's value array, or section's top-level properties
      const target = stack.length > 0
        ? stack[stack.length - 1].prop.value as CompactProperty[]
        : currentSection.properties;

      if (trimmed.startsWith('- ')) {
        // Array item — find the nearest ancestor block (value=[]) to attach to
        const itemContent = trimmed.substring(2);
        const itemMatch = itemContent.match(/^(.+?)\s*=\s*(.*)$/);

        // Find the block property to attach to: walk up the stack or check last item in target
        let blockProp: CompactProperty | null = null;

        // First check if the stack top is a block
        if (stack.length > 0 && Array.isArray(stack[stack.length - 1].prop.value)) {
          blockProp = stack[stack.length - 1].prop;
        }
        // Otherwise check the last property in the target
        if (!blockProp) {
          for (let i = target.length - 1; i >= 0; i--) {
            if (Array.isArray(target[i].value)) {
              blockProp = target[i];
              break;
            }
          }
        }

        if (blockProp && Array.isArray(blockProp.value)) {
          if (itemMatch) {
            let itemValue = itemMatch[2];
            // Collect multiline quoted strings
            itemValue = collectMultilineValue(itemValue, lines, li, (newIdx) => { li = newIdx; });
            // key=value array item: wrap in __item__ group so continuations
            // (subsequent non-dash lines at deeper indent) get grouped together
            const itemGroup: CompactProperty = {
              key: '__item__',
              value: [{
                key: itemMatch[1],
                value: itemValue,
                indent: indent + 2,
              }],
              indent,
            };
            (blockProp.value as CompactProperty[]).push(itemGroup);
            // Push onto stack so continuation lines become children of this group
            stack.push({ prop: itemGroup, indent });
          } else if (itemContent.endsWith(':')) {
            // Nested block within array item: - Key:
            const nestedKey = itemContent.slice(0, -1);
            const nestedBlock: CompactProperty = {
              key: nestedKey,
              value: [],
              indent: indent + 2,
            };
            const itemGroup: CompactProperty = {
              key: '__item__',
              value: [nestedBlock],
              indent,
            };
            (blockProp.value as CompactProperty[]).push(itemGroup);
            stack.push({ prop: itemGroup, indent });
            stack.push({ prop: nestedBlock, indent: indent + 2 });
          } else {
            (blockProp.value as CompactProperty[]).push({
              key: '__item__',
              value: itemContent,
              indent: indent + 2,
            });
          }
        }
      } else {
        const propMatch = trimmed.match(/^(.+?)\s*=\s*(.*)$/);

        if (propMatch) {
          let propValue = propMatch[2];
          // Collect multiline quoted strings
          propValue = collectMultilineValue(propValue, lines, li, (newIdx) => { li = newIdx; });
          const prop: CompactProperty = {
            key: propMatch[1],
            value: propValue,
            indent,
          };
          target.push(prop);
        } else if (trimmed.endsWith(':')) {
          // Start of nested block
          const prop: CompactProperty = {
            key: trimmed.slice(0, -1),
            value: [],
            indent,
          };
          target.push(prop);
          stack.push({ prop, indent });
        }
      }
    }
  }
}

/**
 * Collect multiline quoted string values.
 * If the value starts with a quote but doesn't end with it,
 * continue reading lines until the closing quote is found.
 */
function collectMultilineValue(
  value: string,
  lines: string[],
  currentIdx: number,
  setIdx: (idx: number) => void
): string {
  // Double-quoted multiline
  if (value.startsWith('"') && !value.endsWith('"')) {
    let full = value;
    let i = currentIdx + 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      full += '\n' + nextLine;
      if (nextLine.trimEnd().endsWith('"') && !nextLine.trimEnd().endsWith('\\"')) {
        setIdx(i);
        return full;
      }
      i++;
    }
    setIdx(i - 1);
    return full;
  }
  // Single-quoted multiline
  if (value.startsWith("'") && !value.endsWith("'")) {
    let full = value;
    let i = currentIdx + 1;
    while (i < lines.length) {
      const nextLine = lines[i];
      full += '\n' + nextLine;
      if (nextLine.trimEnd().endsWith("'")) {
        setIdx(i);
        return full;
      }
      i++;
    }
    setIdx(i - 1);
    return full;
  }
  return value;
}

// ============================================================
// Value Parsing — convert compact string values back to AST types
// ============================================================

/** Parse a compact value string back to its proper AST type */
export function parseCompactValue(str: string): any {
  if (str === undefined || str === null) return '';
  str = str.trim();
  if (str === '') return '';

  // null
  if (str === 'null') return null;

  // Empty array
  if (str === '[]') return [];

  // Anchor range: (x1, y1)-(x2, y2)
  const anchorMatch = str.match(/^\(([^)]+)\)-\(([^)]+)\)$/);
  if (anchorMatch) {
    return parseAnchorRange(anchorMatch[1], anchorMatch[2]);
  }

  // Vector/color: (x, y) or (x, y, z) or (x, y, z, w)
  if (str.startsWith('(') && str.endsWith(')') && !str.includes('-(')) {
    return parseVectorValue(str);
  }

  // Asset/file reference: {fileID, guid} or {fileID}
  if (str.startsWith('{') && str.endsWith('}')) {
    return parseReferenceValue(str);
  }

  // Array: [item1, item2, ...]
  if (str.startsWith('[') && str.endsWith(']')) {
    return parseArrayValue(str);
  }

  // Number (integer)
  if (/^-?\d+$/.test(str)) {
    if (str === '-0') return str; // Preserve negative zero
    if (str.length > 1 && str.startsWith('0')) return str; // Preserve leading zeros
    const n = parseInt(str, 10);
    if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return str;
    return n;
  }

  // Float — preserve original string if parseFloat would lose formatting
  if (/^-?\d*\.\d+$/.test(str)) {
    const f = parseFloat(str);
    if (String(f) !== str) return str; // Preserve formatting (e.g., "30.0000")
    return f;
  }

  // Scientific notation
  if (/^-?\d+\.\d*e[+-]?\d+$/i.test(str)) return parseFloat(str);

  // String value
  return str;
}

/** Parse a vector value like (x, y, z) into {x, y, z} */
function parseVectorValue(str: string): Record<string, any> {
  const inner = str.slice(1, -1);
  const parts = inner.split(',').map(s => s.trim());

  if (parts.length === 2) {
    return { x: parseNumericValue(parts[0]), y: parseNumericValue(parts[1]) };
  }
  if (parts.length === 3) {
    return { x: parseNumericValue(parts[0]), y: parseNumericValue(parts[1]), z: parseNumericValue(parts[2]) };
  }
  if (parts.length === 4) {
    // Could be xyzw (quaternion/vector4) or rgba (color)
    return { x: parseNumericValue(parts[0]), y: parseNumericValue(parts[1]), z: parseNumericValue(parts[2]), w: parseNumericValue(parts[3]) };
  }
  // Fallback — return as object with indexed keys
  const result: Record<string, any> = {};
  parts.forEach((p, i) => { result[`v${i}`] = parseNumericValue(p); });
  return result;
}

/** Parse an anchor range (x1,y1)-(x2,y2) into {min, max} */
function parseAnchorRange(minStr: string, maxStr: string): { min: Record<string, any>; max: Record<string, any> } {
  const minParts = minStr.split(',').map(s => s.trim());
  const maxParts = maxStr.split(',').map(s => s.trim());
  return {
    min: { x: parseNumericValue(minParts[0]), y: parseNumericValue(minParts[1]) },
    max: { x: parseNumericValue(maxParts[0]), y: parseNumericValue(maxParts[1]) },
  };
}

/** Parse a reference value like {fileID} or {fileID, guid} */
function parseReferenceValue(str: string): Record<string, any> {
  const inner = str.slice(1, -1).trim();

  // Null reference
  if (inner === '0') return { fileID: 0 };

  const parts = inner.split(',').map(s => s.trim());
  if (parts.length === 1) {
    // Internal reference: {fileID}
    return { fileID: parseFileId(parts[0]) };
  }
  if (parts.length >= 2) {
    // Asset reference: {fileID, guid} or {fileID, guid, type}
    const ref: Record<string, any> = {
      fileID: parseFileId(parts[0]),
      guid: parts[1],
      type: parts.length >= 3 ? parseInt(parts[2], 10) : 3,
    };
    return ref;
  }
  return { fileID: parseFileId(inner) };
}

/** Parse a fileID value, keeping large values as strings */
function parseFileId(str: string): string | number {
  str = str.trim();
  if (/^-?\d+$/.test(str)) {
    const n = parseInt(str, 10);
    if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return str;
    return n;
  }
  return str;
}

/** Parse an array value like [item1, item2, ...] */
function parseArrayValue(str: string): any[] {
  const inner = str.slice(1, -1).trim();
  if (!inner) return [];

  // Smart split by comma, respecting braces
  const items = smartSplit(inner, ',');
  return items.map(item => parseCompactValue(item.trim()));
}

/** Split a string by delimiter, respecting nested braces */
function smartSplit(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') depth--;

    if (ch === delimiter && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parse the REFS section: "key = fileID" lines into a Map (supports duplicate keys) */
function parseRefsSection(lines: string[], refs: Map<string, string[]>): void {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf(' = ');
    if (eqIdx < 0) continue;

    const key = trimmed.substring(0, eqIdx);
    const value = trimmed.substring(eqIdx + 3);
    if (!refs.has(key)) refs.set(key, []);
    refs.get(key)!.push(value);
  }
}

/** Parse a numeric value, preserving formatting for strings that would lose precision */
function parseNumericValue(str: string): any {
  str = str.trim();

  if (str === '-0') return str;
  if (str.length > 1 && str.startsWith('0') && !str.startsWith('0.')) return str;

  // Integer
  if (/^-?\d+$/.test(str)) {
    const n = parseInt(str, 10);
    if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return str;
    return n;
  }

  // Float — preserve original if parseFloat loses formatting
  if (/^-?\d*\.\d+$/.test(str)) {
    const f = parseFloat(str);
    if (String(f) !== str) return str;
    return f;
  }

  if (/^-?\d+\.\d*e[+-]?\d+$/i.test(str)) return parseFloat(str);

  return str;
}
