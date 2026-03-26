/**
 * Write a UnityFile AST back to Unity YAML format.
 *
 * This reconstructs valid Unity YAML from the internal representation,
 * preserving all document structure, IDs, and property values.
 *
 * Unity YAML formatting conventions:
 * - Array items at SAME indent level as the parent key (block compact style)
 * - Long flow mappings (references with guid) break across lines
 * - m_Component items written as: - component: {fileID: X}
 */

import { UnityDocument, UnityFile, UNITY_TYPE_MAP } from './types';

/** Write a UnityFile back to Unity YAML string */
export function writeUnityYaml(file: UnityFile): string {
  const lines: string[] = [];

  // File header
  lines.push('%YAML 1.1');
  lines.push('%TAG !u! tag:unity3d.com,2011:');

  // Write each document
  for (const doc of file.documents) {
    // Document separator with tag
    let header = `--- !u!${doc.typeId} &${doc.fileId}`;
    if (doc.stripped) header += ' stripped';
    lines.push(header);

    // Write the type name as the first line
    lines.push(`${doc.typeName}:`);

    // Write properties
    writeYamlProperties(doc.properties, lines, 2);
  }

  return lines.join('\n') + '\n';
}

/** Write properties as YAML with given indentation */
function writeYamlProperties(props: Record<string, any>, lines: string[], indent: number): void {
  for (const [key, value] of Object.entries(props)) {
    writeYamlValue(key, value, lines, indent);
  }
}

/** Write a single key-value pair in YAML */
function writeYamlValue(key: string, value: any, lines: string[], indent: number): void {
  const indentStr = ' '.repeat(indent);

  if (value === null || value === undefined) {
    lines.push(`${indentStr}${key}: `);
    return;
  }

  if (typeof value === 'string') {
    if (value === '') {
      lines.push(`${indentStr}${key}: `);
    } else if (value.includes('\n')) {
      // Multi-line string — preserve original lines exactly
      const valueLines = value.split('\n');
      lines.push(`${indentStr}${key}: ${valueLines[0]}`);
      for (let vi = 1; vi < valueLines.length; vi++) {
        lines.push(valueLines[vi]);
      }
    } else {
      lines.push(`${indentStr}${key}: ${value}`);
    }
    return;
  }

  if (typeof value === 'number') {
    lines.push(`${indentStr}${key}: ${value}`);
    return;
  }

  if (typeof value === 'boolean') {
    lines.push(`${indentStr}${key}: ${value ? 1 : 0}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${indentStr}${key}: []`);
      return;
    }

    lines.push(`${indentStr}${key}:`);
    // Unity convention: array items at SAME indent as the key
    for (const item of value) {
      writeYamlArrayItem(item, lines, indent);
    }
    return;
  }

  if (typeof value === 'object') {
    // Check if this is a flow mapping (reference-like)
    if (isFlowMapping(value)) {
      const flow = formatFlowMapping(value);
      const lineStr = `${indentStr}${key}: ${flow}`;
      const wasMultiLine = value.__multiLine === true;
      if (wasMultiLine) {
        // Break multi-line flow mapping (preserve original format)
        writeMultiLineFlowMapping(key, value, lines, indent);
      } else {
        lines.push(lineStr);
      }
      return;
    }

    // Regular nested object
    lines.push(`${indentStr}${key}:`);
    writeYamlProperties(value, lines, indent + 2);
    return;
  }

  lines.push(`${indentStr}${key}: ${value}`);
}

/** Write an array item */
function writeYamlArrayItem(item: any, lines: string[], indent: number): void {
  const indentStr = ' '.repeat(indent);

  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    if (isFlowMapping(item)) {
      const flow = formatFlowMapping(item);
      const lineStr = `${indentStr}- ${flow}`;
      const wasMultiLine = item.__multiLine === true;
      if (wasMultiLine) {
        writeMultiLineFlowMappingArrayItem(item, lines, indent);
      } else {
        lines.push(lineStr);
      }
      return;
    }

    // Complex object array item
    const entries = Object.entries(item);
    if (entries.length === 0) {
      lines.push(`${indentStr}- {}`);
      return;
    }

    // First property on the "- " line
    const [firstKey, firstVal] = entries[0];
    if (typeof firstVal === 'object' && firstVal !== null && !isFlowMapping(firstVal)) {
      if (Array.isArray(firstVal) && firstVal.length === 0) {
        // Empty array: write inline []
        lines.push(`${indentStr}- ${firstKey}: []`);
      } else {
        lines.push(`${indentStr}- ${firstKey}:`);
        if (Array.isArray(firstVal)) {
          // Unity convention: array items at same indent as key (indent+2 = key position)
          for (const subItem of firstVal) {
            writeYamlArrayItem(subItem, lines, indent + 2);
          }
        } else {
          writeYamlProperties(firstVal, lines, indent + 4);
        }
      }
    } else if (typeof firstVal === 'object' && firstVal !== null && isFlowMapping(firstVal)) {
      // Value is a flow mapping (e.g., component: {fileID: X} or target: {fileID: X, guid: Y, type: 3})
      const flow = formatFlowMapping(firstVal);
      const lineStr = `${indentStr}- ${firstKey}: ${flow}`;
      const firstValWasMultiLine = (firstVal as any).__multiLine === true;
      if (firstValWasMultiLine) {
        // Break multi-line flow mapping (preserve original format)
        const flowParts = splitFlowMapping(firstVal);
        lines.push(`${indentStr}- ${firstKey}: ${flowParts.first}`);
        lines.push(`${' '.repeat(indent + 4)}${flowParts.rest}`);
      } else {
        lines.push(lineStr);
      }
    } else {
      const formatted = formatInlineValue(firstVal);
      lines.push(`${indentStr}- ${firstKey}: ${formatted}`);
    }

    // Remaining properties at indent + 2
    for (let i = 1; i < entries.length; i++) {
      const [k, v] = entries[i];
      writeYamlValue(k, v, lines, indent + 2);
    }
    return;
  }

  // Simple value
  lines.push(`${indentStr}- ${formatInlineValue(item)}`);
}

/** Check if an object should be written as a YAML flow mapping */
function isFlowMapping(obj: any): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

  const keys = Object.keys(obj);

  // File references — always flow
  if (keys.includes('fileID')) return true;

  // Vectors/colors — only flow if originally parsed from a flow mapping
  if (keys.length <= 4 && keys.every(k => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].includes(k))) {
    return obj.__flow === true;
  }

  return false;
}

/** Check if a flow mapping is a vector/color (should never be line-broken) */
function isVectorOrColor(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.keys(obj);
  return keys.length <= 4 && keys.every(k => ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a'].includes(k));
}

/** Check if a flow mapping has a guid field (indicating it might need line breaking) */
function hasGuid(obj: any): boolean {
  return obj && typeof obj === 'object' && 'guid' in obj;
}

/** Split a flow mapping into two parts for multi-line output */
function splitFlowMapping(obj: any): { first: string; rest: string } {
  const entries = Object.entries(obj);
  const parts: string[] = entries.map(([k, v]) => `${k}: ${formatInlineValue(v)}`);

  // Prefer to break after 'guid' for file references
  let breakIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][0] === 'guid') {
      breakIdx = i;
      break;
    }
  }

  // If no guid, break before the last field
  if (breakIdx === -1 && parts.length > 1) {
    breakIdx = parts.length - 2;
  }
  if (breakIdx === -1) breakIdx = 0;

  const firstParts = parts.slice(0, breakIdx + 1);
  const restParts = parts.slice(breakIdx + 1);

  return {
    first: `{${firstParts.join(', ')},`,
    rest: `${restParts.join(', ')}}`,
  };
}

/** Write a multi-line flow mapping for a regular key-value pair */
function writeMultiLineFlowMapping(
  key: string, obj: any, lines: string[], indent: number
): void {
  const indentStr = ' '.repeat(indent);
  const { first, rest } = splitFlowMapping(obj);
  lines.push(`${indentStr}${key}: ${first}`);
  lines.push(`${' '.repeat(indent + 2)}${rest}`);
}

/** Write a multi-line flow mapping for an array item */
function writeMultiLineFlowMappingArrayItem(
  obj: any, lines: string[], indent: number
): void {
  const indentStr = ' '.repeat(indent);
  const { first, rest } = splitFlowMapping(obj);
  lines.push(`${indentStr}- ${first}`);
  lines.push(`${' '.repeat(indent + 4)}${rest}`);
}

/** Format an object as a YAML flow mapping */
function formatFlowMapping(obj: any): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    parts.push(`${key}: ${formatInlineValue(value)}`);
  }
  return `{${parts.join(', ')}}`;
}

/** Format a value for inline YAML output */
function formatInlineValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value || '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object' && isFlowMapping(value)) return formatFlowMapping(value);
  if (Array.isArray(value)) return `[${value.map(formatInlineValue).join(', ')}]`;
  return String(value);
}

/** Break a long scalar value across multiple lines.
 *  Returns array of line segments, or null if can't break.
 *  Tries comma-break first (for flow-style values), then word-break (for quoted strings). */
function breakLongScalar(
  value: string, maxFirstLen: number, maxContLen: number
): string[] | null {
  // First try comma-based break (for plain scalars like "Assembly-CSharp, Version=...")
  const commaIdx = findBreakPoint(value, maxFirstLen, ',');
  if (commaIdx !== -1) {
    return [
      value.substring(0, commaIdx + 1),
      value.substring(commaIdx + 1).trim(),
    ];
  }

  // For double-quoted strings, break at word boundaries across multiple lines
  if (value.startsWith('"') && value.endsWith('"')) {
    const segments: string[] = [];
    let remaining = value;
    let maxLen = maxFirstLen;
    while (remaining.length > maxLen) {
      const breakIdx = findBreakPoint(remaining, maxLen, ' ');
      if (breakIdx === -1) break;
      segments.push(remaining.substring(0, breakIdx + 1));
      remaining = remaining.substring(breakIdx + 1);
      maxLen = maxContLen;
    }
    if (remaining) segments.push(remaining);
    if (segments.length > 1) return segments;
  }

  return null;
}

/** Find a break point character searching backwards from maxLen */
function findBreakPoint(str: string, maxLen: number, breakChar: string): number {
  for (let i = Math.min(maxLen, str.length - 1); i >= 0; i--) {
    if (str[i] === breakChar) return i;
  }
  return -1;
}

/** Escape a YAML string for double-quote context */
function escapeYamlString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
