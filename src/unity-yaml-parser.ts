/**
 * Parse Unity YAML files into internal AST.
 *
 * Unity YAML quirks handled:
 * - %YAML 1.1 / %TAG directives
 * - Multiple documents in one file (--- separators)
 * - Custom tags like !u!114 &1234567
 * - Stripped objects
 * - Flow mappings {fileID: 123, guid: abc, type: 3}
 * - Both old-style (Prefab/m_PrefabInternal) and new-style (PrefabInstance/m_CorrespondingSourceObject) formats
 */

import {
  UnityDocument,
  UnityFile,
  GameObjectNode,
  ComponentInfo,
  TransformInfo,
  PrefabInstanceInfo,
  PropertyModification,
  FileReference,
  UNITY_TYPE_MAP,
} from './types';

/** Parse a Unity YAML string into a UnityFile */
export function parseUnityYaml(content: string): UnityFile {
  const documents = splitDocuments(content);
  const parsed = documents.map(parseDocument);

  const prefabInstances = extractPrefabInstances(parsed);
  const fileType = detectFileType(parsed, prefabInstances);

  let hierarchy: GameObjectNode | undefined;
  let variantSource: FileReference | undefined;

  if (fileType === 'variant') {
    // Pure variant: only PrefabInstance document(s)
    const mainInstance = prefabInstances.find(pi =>
      String(pi.transformParent.fileID) === '0'
    );
    if (mainInstance) {
      variantSource = mainInstance.sourcePrefab;
    }
  } else {
    // Regular prefab or scene: build hierarchy
    hierarchy = buildHierarchy(parsed);
  }

  return {
    type: fileType,
    documents: parsed,
    hierarchy,
    prefabInstances,
    variantSource,
  };
}

/** Raw document block before parsing */
interface RawDocument {
  header: string;  // The --- line
  body: string;    // Everything until next ---
}

/** Split a Unity YAML file into individual document blocks */
function splitDocuments(content: string): RawDocument[] {
  const docs: RawDocument[] = [];
  const lines = content.split('\n');

  let currentHeader = '';
  let currentBody: string[] = [];
  let inDocument = false;

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      if (inDocument) {
        docs.push({ header: currentHeader, body: currentBody.join('\n') });
      }
      currentHeader = line;
      currentBody = [];
      inDocument = true;
    } else if (line.startsWith('%') || line.trim() === '') {
      if (inDocument) {
        currentBody.push(line);
      }
      // Skip directives and blank lines before first document
    } else if (inDocument) {
      currentBody.push(line);
    }
  }

  if (inDocument) {
    docs.push({ header: currentHeader, body: currentBody.join('\n') });
  }

  return docs;
}

/** Parse a document header: --- !u!114 &1234567 stripped */
function parseHeader(header: string): { typeId: number; fileId: string; stripped: boolean } {
  const match = header.match(/^--- !u!(\d+) &(-?\d+)\s*(stripped)?/);
  if (!match) {
    throw new Error(`Invalid document header: ${header}`);
  }
  return {
    typeId: parseInt(match[1], 10),
    fileId: match[2],
    stripped: match[3] === 'stripped',
  };
}

/** Parse a single document into a UnityDocument */
function parseDocument(raw: RawDocument): UnityDocument {
  const { typeId, fileId, stripped } = parseHeader(raw.header);

  // Parse the YAML body and extract the actual type name from the first line
  const { properties, bodyTypeName } = parseYamlBody(raw.body);

  // Use the actual body type name if available, fall back to the type map
  const typeName = bodyTypeName || UNITY_TYPE_MAP[typeId] || `Unknown_${typeId}`;

  return { typeId, typeName, fileId, stripped, properties };
}

/**
 * Simple YAML parser that handles Unity's subset of YAML.
 * Does NOT use a full YAML parser because Unity uses custom tags and flow syntax.
 */
function parseYamlBody(body: string): { properties: Record<string, any>; bodyTypeName: string } {
  const lines = body.split('\n');
  const result: Record<string, any> = {};
  let bodyTypeName = '';

  if (lines.length === 0) return { properties: result, bodyTypeName };

  // First non-empty line should be the type name (e.g., "GameObject:")
  // Extract it and skip it
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('%')) {
      // This is the type name line (e.g., "GameObject:" or "MonoBehaviour:")
      if (trimmed.endsWith(':')) {
        bodyTypeName = trimmed.slice(0, -1);
      }
      startIdx = i + 1;
      break;
    }
  }

  parseIndentedBlock(lines, startIdx, 2, result);
  return { properties: result, bodyTypeName };
}

/** Parse an indented YAML block into a key-value map */
function parseIndentedBlock(
  lines: string[],
  startIdx: number,
  expectedIndent: number,
  target: Record<string, any>
): number {
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const indent = getIndent(line);
    if (indent < expectedIndent) break;
    if (indent > expectedIndent) { i++; continue; } // Skip deeper indented continuation lines that were already processed

    const trimmed = line.trim();

    // Array item: starts with "- "
    if (trimmed.startsWith('- ')) {
      // This shouldn't happen at the top level of a block
      // (arrays are values of keys), but handle gracefully
      i++;
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = trimmed.substring(0, colonIdx);
    const valueStr = trimmed.substring(colonIdx + 1).trim();

    if (valueStr === '' || valueStr === undefined) {
      // Value is on next lines (could be a nested object or empty)
      // Check next line to determine type
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const nextTrimmed = nextLine.trim();
      const nextIndent = getIndent(nextLine);

      if (nextIndent >= expectedIndent && nextTrimmed.startsWith('- ')) {
        // Array value — Unity YAML puts array items at same or greater indent
        const arr: any[] = [];
        i = parseArray(lines, i + 1, nextIndent, arr);
        target[key] = arr;
      } else if (nextIndent > expectedIndent) {
        // Nested object
        const nested: Record<string, any> = {};
        i = parseIndentedBlock(lines, i + 1, nextIndent, nested);
        target[key] = nested;
      } else {
        // Empty value
        target[key] = '';
        i++;
      }
    } else {
      // Inline value — but check for multi-line constructs
      let fullValue = valueStr;
      let wasMultiLine = false;
      if (fullValue.startsWith('{') && !fullValue.includes('}')) {
        // Multi-line flow mapping: collect continuation lines
        wasMultiLine = true;
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          fullValue += ' ' + nextLine;
          i++;
          if (nextLine.includes('}')) break;
        }
      } else if (fullValue.startsWith("'") && !fullValue.endsWith("'")) {
        // Multi-line single-quoted string: collect until closing quote
        // Include blank lines (they represent newlines in YAML single-quoted strings)
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          fullValue += '\n' + nextLine;
          i++;
          if (nextLine.trimEnd().endsWith("'")) break;
        }
      } else if (fullValue.startsWith('"') && !fullValue.endsWith('"')) {
        // Multi-line double-quoted string: collect until closing quote
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          fullValue += '\n' + nextLine;
          i++;
          if (nextLine.trimEnd().endsWith('"') && !nextLine.trimEnd().endsWith('\\"')) break;
        }
      } else if (!fullValue.startsWith('{') && !fullValue.startsWith('[')) {
        // Plain scalar value — check for continuation lines (indented deeper than key)
        // Preserve original line breaks for round-trip fidelity
        let hasContinuation = false;
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextIndent = getIndent(nextLine);
          const nextTrimmed = nextLine.trim();
          if (nextTrimmed !== '' && nextIndent > expectedIndent && !nextTrimmed.startsWith('- ')) {
            fullValue += '\n' + nextLine;
            hasContinuation = true;
            i++;
          } else {
            break;
          }
        }
      }
      const parsed = parseInlineValue(fullValue);
      if (wasMultiLine && typeof parsed === 'object' && parsed !== null) {
        markMultiLine(parsed);
      }
      target[key] = parsed;
      i++;
    }
  }

  return i;
}

/** Parse an array starting at the given position */
function parseArray(
  lines: string[],
  startIdx: number,
  expectedIndent: number,
  target: any[]
): number {
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const indent = getIndent(line);
    if (indent < expectedIndent) break;

    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) {
      if (indent === expectedIndent) {
        // Not an array item at the same indent — we've left the array
        break;
      }
      // Continuation of previous array item (nested content at deeper indent)
      i++;
      continue;
    }

    const itemContent = trimmed.substring(2); // Remove "- "

    if (itemContent.startsWith('{')) {
      // Flow mapping: - {fileID: 123, guid: abc}
      // Handle multi-line flow mappings (e.g., {fileID: X, guid: Y,\n    type: 3})
      let fullMapping = itemContent;
      let itemWasMultiLine = false;
      if (!fullMapping.includes('}')) {
        itemWasMultiLine = true;
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          fullMapping += ' ' + nextLine;
          i++;
          if (nextLine.includes('}')) break;
        }
      }
      const parsed = parseFlowMapping(fullMapping);
      if (itemWasMultiLine) markMultiLine(parsed);
      target.push(parsed);
      i++;
    } else if (itemContent.includes(':')) {
      // Inline key-value in array item: - key: value
      // Could be start of a multi-line object in the array
      const obj: Record<string, any> = {};
      const colonIdx = itemContent.indexOf(':');
      const key = itemContent.substring(0, colonIdx);
      const val = itemContent.substring(colonIdx + 1).trim();

      if (val === '' || val === undefined) {
        // Empty value for first key — check what follows
        const peekLine2 = i + 1 < lines.length ? lines[i + 1] : '';
        const peekTrimmed2 = peekLine2.trim();
        const peekIndent2 = getIndent(peekLine2);
        const contLevel = expectedIndent + 2;

        if (peekTrimmed2 !== '' && peekIndent2 > contLevel && !peekTrimmed2.startsWith('- ')) {
          // Truly nested object (deeper than continuation level)
          const nested: Record<string, any> = {};
          i = parseIndentedBlock(lines, i + 1, peekIndent2, nested);
          obj[key] = nested;
        } else if (peekTrimmed2 !== '' && peekIndent2 >= expectedIndent && peekTrimmed2.startsWith('- ')) {
          // Array value of current key at same or deeper indent
          const arr: any[] = [];
          i = parseArray(lines, i + 1, peekIndent2, arr);
          obj[key] = arr;
        } else {
          // Empty value — continuation properties will be picked up by the cont loop
          obj[key] = '';
          i++;
        }
      } else {
        // Handle multi-line flow mappings in array item values
        let fullVal = val;
        let valWasMultiLine = false;
        if (fullVal.startsWith('{') && !fullVal.includes('}')) {
          valWasMultiLine = true;
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            fullVal += ' ' + nextLine;
            i++;
            if (nextLine.includes('}')) break;
          }
        }
        const parsedVal = parseInlineValue(fullVal);
        if (valWasMultiLine && typeof parsedVal === 'object' && parsedVal !== null) {
          markMultiLine(parsedVal);
        }
        obj[key] = parsedVal;
        i++;
      }

      // Check for more key-value pairs at the same level (continuation of this array item)
      const contIndent = expectedIndent + 2;
      while (i < lines.length) {
        const contLine = lines[i];
        if (contLine.trim() === '') { i++; continue; }
        const contActualIndent = getIndent(contLine);
        if (contActualIndent < contIndent) break;
        if (contActualIndent !== contIndent) { i++; continue; }
        const contTrimmed = contLine.trim();
        if (contTrimmed.startsWith('- ')) break;

        const contColonIdx = contTrimmed.indexOf(':');
        if (contColonIdx === -1) { i++; continue; }

        const contKey = contTrimmed.substring(0, contColonIdx);
        const contVal = contTrimmed.substring(contColonIdx + 1).trim();

        if (contVal === '' || contVal === undefined) {
          // Check if next line is an array, nested object, or empty value
          const peekLine = i + 1 < lines.length ? lines[i + 1] : '';
          const peekTrimmed = peekLine.trim();
          const peekIndent = getIndent(peekLine);
          if (peekTrimmed !== '' && peekIndent >= contIndent && peekTrimmed.startsWith('- ')) {
            // Array value within continuation property
            const arr: any[] = [];
            i = parseArray(lines, i + 1, peekIndent, arr);
            obj[contKey] = arr;
          } else if (peekIndent > contIndent && peekTrimmed !== '') {
            const nested: Record<string, any> = {};
            i = parseIndentedBlock(lines, i + 1, peekIndent, nested);
            obj[contKey] = nested;
          } else {
            obj[contKey] = '';
            i++;
          }
        } else {
          // Handle multi-line constructs in continuation values
          let fullContVal = contVal;
          let contWasMultiLine = false;
          if (fullContVal.startsWith('{') && !fullContVal.includes('}')) {
            contWasMultiLine = true;
            while (i + 1 < lines.length) {
              const nextLine = lines[i + 1].trim();
              fullContVal += ' ' + nextLine;
              i++;
              if (nextLine.includes('}')) break;
            }
          } else if (fullContVal.startsWith("'") && !fullContVal.endsWith("'")) {
            // Multi-line single-quoted string
            while (i + 1 < lines.length) {
              const nextLine = lines[i + 1];
              fullContVal += '\n' + nextLine;
              i++;
              if (nextLine.trimEnd().endsWith("'")) break;
            }
          } else if (fullContVal.startsWith('"') && !fullContVal.endsWith('"')) {
            // Multi-line double-quoted string
            while (i + 1 < lines.length) {
              const nextLine = lines[i + 1];
              fullContVal += '\n' + nextLine;
              i++;
              if (nextLine.trimEnd().endsWith('"') && !nextLine.trimEnd().endsWith('\\"')) break;
            }
          } else if (!fullContVal.startsWith('{') && !fullContVal.startsWith('[') &&
                     !fullContVal.startsWith("'") && !fullContVal.startsWith('"')) {
            // Plain scalar continuation
            while (i + 1 < lines.length) {
              const nextLine = lines[i + 1];
              const nextIndent = getIndent(nextLine);
              const nextTrimmed = nextLine.trim();
              if (nextTrimmed !== '' && nextIndent > contIndent && !nextTrimmed.startsWith('- ')) {
                fullContVal += '\n' + nextLine;
                i++;
              } else {
                break;
              }
            }
          }
          const parsedContVal = parseInlineValue(fullContVal);
          if (contWasMultiLine && typeof parsedContVal === 'object' && parsedContVal !== null) {
            markMultiLine(parsedContVal);
          }
          obj[contKey] = parsedContVal;
          i++;
        }
      }

      target.push(obj);
    } else {
      // Simple value
      target.push(parseInlineValue(itemContent));
      i++;
    }
  }

  return i;
}

/** Parse an inline value (the part after ": ") */
function parseInlineValue(str: string): any {
  if (!str || str === '') return '';

  // Flow mapping: {fileID: 123, guid: abc, type: 3}
  if (str.startsWith('{')) {
    return parseFlowMapping(str);
  }

  // Flow sequence: [item1, item2]
  if (str.startsWith('[') && str.endsWith(']')) {
    return parseFlowSequence(str);
  }

  // Quoted string — preserve quotes to maintain round-trip fidelity
  if ((str.startsWith("'") && str.endsWith("'"))) {
    // Single-quoted YAML strings: preserve the quotes as-is for round-trip
    return str; // Keep quotes: they'll be written back as-is
  }
  if ((str.startsWith('"') && str.endsWith('"'))) {
    // Double-quoted YAML strings: preserve the quotes as-is for round-trip
    return str;
  }

  // Integer — but keep as string if too large for JS number precision
  // Also keep -0 as string to preserve the sign
  // Also keep strings with leading zeros as strings (e.g., hex vertex data "00000000")
  if (/^-?\d+$/.test(str)) {
    if (str === '-0') return str; // Preserve negative zero as string
    if (str.length > 1 && str.startsWith('0')) return str; // Preserve leading zeros
    const n = parseInt(str, 10);
    if (Math.abs(n) > Number.MAX_SAFE_INTEGER) {
      return str; // Keep large fileIDs as strings to preserve precision
    }
    return n;
  }

  // Float — preserve original string if parseFloat would lose trailing zeros
  if (/^-?\d*\.\d+$/.test(str)) {
    const f = parseFloat(str);
    if (String(f) !== str) return str; // Preserve formatting (e.g., "30.0000")
    return f;
  }
  if (/^-?\d+\.\d*e[+-]?\d+$/i.test(str)) return parseFloat(str);
  // Also handle forms like "0.33333334" and "-0"
  if (/^-?0$/.test(str)) return parseInt(str, 10);

  return str;
}

/** Mark a flow mapping object as originally multi-line */
function markMultiLine(obj: Record<string, any>): Record<string, any> {
  Object.defineProperty(obj, '__multiLine', { value: true, enumerable: false, writable: false });
  return obj;
}

/** Parse a YAML flow mapping: {key: value, key2: value2} */
function parseFlowMapping(str: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Handle potential multi-line flow mappings by finding the closing brace
  const inner = str.slice(1, str.lastIndexOf('}'));
  if (!inner.trim()) return result;

  // Split by comma, but respect nested braces
  const pairs = smartSplit(inner, ',');

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;

    const key = pair.substring(0, colonIdx).trim();
    const value = pair.substring(colonIdx + 1).trim();
    result[key] = parseInlineValue(value);
  }

  return result;
}

/** Parse a flow sequence: [a, b, c] */
function parseFlowSequence(str: string): any[] {
  const inner = str.slice(1, -1).trim();
  if (!inner) return [];

  const items = smartSplit(inner, ',');
  return items.map(item => parseInlineValue(item.trim()));
}

/** Split a string by delimiter, respecting nested braces and quotes */
function smartSplit(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inQuote) {
      current += ch;
      if (ch === quoteChar) inQuote = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
      continue;
    }

    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;

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

/** Get the indentation level of a line (number of leading spaces) */
function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

/** Extract PrefabInstance info from parsed documents */
function extractPrefabInstances(docs: UnityDocument[]): PrefabInstanceInfo[] {
  return docs
    .filter(d => d.typeId === 1001 && (d.typeName === 'PrefabInstance' || d.typeName === 'Prefab'))
    .filter(d => {
      const props = d.properties;
      // Only PrefabInstance documents that have modifications (not old-style Prefab root)
      return props.m_Modification || props.m_SourcePrefab;
    })
    .map(d => {
      const props = d.properties;
      const mod = props.m_Modification || {};

      // Handle old format (m_ParentPrefab) vs new format (m_SourcePrefab)
      const sourcePrefab = props.m_SourcePrefab || props.m_ParentPrefab || { fileID: '0' };

      const modifications: PropertyModification[] = (mod.m_Modifications || []).map((m: any) => ({
        target: m.target || { fileID: '0' },
        propertyPath: m.propertyPath || '',
        value: String(m.value ?? ''),
        objectReference: m.objectReference || { fileID: '0' },
      }));

      return {
        fileId: d.fileId,
        sourcePrefab: sourcePrefab as FileReference,
        transformParent: (mod.m_TransformParent || { fileID: '0' }) as FileReference,
        modifications,
        removedComponents: (mod.m_RemovedComponents || []) as FileReference[],
      };
    });
}

/** Detect file type based on document structure */
function detectFileType(docs: UnityDocument[], prefabInstances: PrefabInstanceInfo[]): 'prefab' | 'variant' | 'scene' {
  // Scene has OcclusionCullingSettings, RenderSettings, etc.
  const hasSceneObjects = docs.some(d => [29, 104, 157, 196].includes(d.typeId));
  if (hasSceneObjects) return 'scene';

  // Pure variant: only PrefabInstance documents and stripped objects
  const nonStrippedNonPrefab = docs.filter(d => !d.stripped && d.typeId !== 1001);
  if (nonStrippedNonPrefab.length === 0 && prefabInstances.length > 0) {
    return 'variant';
  }

  return 'prefab';
}

/** Build the GameObject hierarchy from parsed documents */
function buildHierarchy(docs: UnityDocument[]): GameObjectNode | undefined {
  // Index documents by fileId
  const byId = new Map<string, UnityDocument>();
  for (const doc of docs) {
    byId.set(doc.fileId, doc);
  }

  // Find all GameObjects
  const gameObjects = docs.filter(d => d.typeId === 1 && !d.stripped);
  if (gameObjects.length === 0) return undefined;

  // Find all Transforms/RectTransforms (including stripped — needed for hierarchy)
  const transforms = docs.filter(d => (d.typeId === 4 || d.typeId === 224));

  // Build a map: GO fileId -> Transform doc
  const goToTransform = new Map<string, UnityDocument>();
  for (const t of transforms) {
    const goRef = t.properties.m_GameObject;
    if (goRef && goRef.fileID) {
      goToTransform.set(String(goRef.fileID), t);
    }
  }

  // Build a map: Transform fileId -> children transform fileIds
  const transformChildren = new Map<string, string[]>();
  const transformParent = new Map<string, string>();

  for (const t of transforms) {
    const children = t.properties.m_Children;
    if (Array.isArray(children)) {
      const childIds = children.map((c: any) => String(c.fileID)).filter((id: string) => id !== '0');
      transformChildren.set(t.fileId, childIds);
      for (const childId of childIds) {
        transformParent.set(childId, t.fileId);
      }
    }

    const father = t.properties.m_Father;
    if (father && String(father.fileID) !== '0') {
      transformParent.set(t.fileId, String(father.fileID));
    }
  }

  // Build component map: GO fileId -> Component docs
  const goToComponents = new Map<string, UnityDocument[]>();
  for (const doc of docs) {
    if (doc.typeId === 1 || doc.typeId === 4 || doc.typeId === 224 || doc.typeId === 1001) continue;
    if (doc.stripped) continue;

    const goRef = doc.properties.m_GameObject;
    if (goRef && goRef.fileID) {
      const goId = String(goRef.fileID);
      if (!goToComponents.has(goId)) goToComponents.set(goId, []);
      goToComponents.get(goId)!.push(doc);
    }
  }

  // Build nodes recursively
  function buildNode(goDoc: UnityDocument): GameObjectNode {
    const props = goDoc.properties;
    const transformDoc = goToTransform.get(goDoc.fileId);

    const components: ComponentInfo[] = [];
    const compDocs = goToComponents.get(goDoc.fileId) || [];

    for (const comp of compDocs) {
      let typeName = comp.typeName;
      let scriptGuid: string | undefined;

      if (comp.typeId === 114) {
        // MonoBehaviour — use script GUID to identify
        const script = comp.properties.m_Script;
        if (script && script.guid) {
          scriptGuid = script.guid;
          typeName = script.guid; // Will be resolved later or kept as GUID
        }
      }

      // Filter out boilerplate fields
      const filteredProps: Record<string, any> = {};
      for (const [key, value] of Object.entries(comp.properties)) {
        if (!isOmittedField(key)) {
          filteredProps[key] = value;
        }
      }

      components.push({
        typeName,
        typeId: comp.typeId,
        fileId: comp.fileId,
        scriptGuid,
        properties: filteredProps,
        stripped: comp.stripped,
      });
    }

    // Build transform info
    const transformInfo: TransformInfo = {
      fileId: transformDoc?.fileId || '',
      isRect: transformDoc?.typeId === 224,
      properties: {},
    };

    if (transformDoc) {
      for (const [key, value] of Object.entries(transformDoc.properties)) {
        if (!isOmittedField(key)) {
          transformInfo.properties[key] = value;
        }
      }
    }

    // Build children
    const children: GameObjectNode[] = [];
    if (transformDoc) {
      const childTransformIds = transformChildren.get(transformDoc.fileId) || [];
      for (const childTId of childTransformIds) {
        const childTransform = byId.get(childTId);
        if (!childTransform) continue;

        if (!childTransform.stripped) {
          // Normal child
          const childGoRef = childTransform.properties.m_GameObject;
          if (childGoRef && childGoRef.fileID) {
            const childGo = byId.get(String(childGoRef.fileID));
            if (childGo && !childGo.stripped) {
              children.push(buildNode(childGo));
            }
          }
        } else {
          // Stripped child — comes from a nested prefab instance
          // Find the PrefabInstance that owns this stripped transform
          const prefabInstanceRef = childTransform.properties.m_PrefabInstance;
          if (prefabInstanceRef && prefabInstanceRef.fileID) {
            const prefabInstanceDoc = byId.get(String(prefabInstanceRef.fileID));
            if (prefabInstanceDoc) {
              // Get the source prefab name from modifications (m_Name property)
              const mods = prefabInstanceDoc.properties?.m_Modification?.m_Modifications || [];
              let goName = 'NestedPrefab';
              let sourceGuid = '';

              const sourcePrefab = prefabInstanceDoc.properties?.m_SourcePrefab;
              if (sourcePrefab?.guid) sourceGuid = sourcePrefab.guid;

              // Look for m_Name in modifications
              for (const mod of mods) {
                if (mod.propertyPath === 'm_Name' && mod.value) {
                  goName = String(mod.value);
                  break;
                }
              }

              // Also check for a stripped GameObject associated with this instance
              const strippedGOs = docs.filter(d =>
                d.typeId === 1 && d.stripped &&
                String(d.properties?.m_PrefabInstance?.fileID) === String(prefabInstanceRef.fileID)
              );
              if (strippedGOs.length > 0) {
                // Use the stripped GO's info
                const strippedGo = strippedGOs[0];
                children.push({
                  name: goName,
                  fileId: strippedGo.fileId,
                  components: [],
                  transform: { fileId: childTId, isRect: childTransform.typeId === 224, properties: {} },
                  children: [],
                  nestedPrefab: { instanceId: String(prefabInstanceRef.fileID), sourceGuid },
                  layer: 0,
                  isActive: true,
                });
              } else {
                children.push({
                  name: goName,
                  fileId: '0',
                  components: [],
                  transform: { fileId: childTId, isRect: childTransform.typeId === 224, properties: {} },
                  children: [],
                  nestedPrefab: { instanceId: String(prefabInstanceRef.fileID), sourceGuid },
                  layer: 0,
                  isActive: true,
                });
              }
            }
          }
        }
      }
    }

    return {
      name: props.m_Name || 'Unnamed',
      fileId: goDoc.fileId,
      components,
      transform: transformInfo,
      children,
      layer: props.m_Layer || 0,
      isActive: props.m_IsActive !== 0,
    };
  }

  // Check for old-format root (Prefab document with m_RootGameObject)
  const prefabDoc = docs.find(d => d.typeId === 1001 && d.properties.m_RootGameObject);
  let explicitRootId: string | undefined;
  if (prefabDoc?.properties.m_RootGameObject?.fileID) {
    explicitRootId = String(prefabDoc.properties.m_RootGameObject.fileID);
  }

  // Find root GameObjects
  const roots: GameObjectNode[] = [];
  if (explicitRootId) {
    // Old format: explicit root
    const rootGo = byId.get(explicitRootId);
    if (rootGo) {
      roots.push(buildNode(rootGo));
    }
  } else {
    // New format: root is the GO whose Transform has m_Father: {fileID: 0}
    for (const go of gameObjects) {
      const transformDoc = goToTransform.get(go.fileId);
      if (transformDoc) {
        const father = transformDoc.properties.m_Father;
        if (!father || String(father.fileID) === '0') {
          roots.push(buildNode(go));
        }
      }
    }
  }

  // For prefabs, there should be exactly one root
  if (roots.length === 1) return roots[0];

  // For scenes or multiple roots, create a virtual root
  if (roots.length > 1) {
    return {
      name: '__scene_root__',
      fileId: '0',
      components: [],
      transform: { fileId: '0', isRect: false, properties: {} },
      children: roots,
      layer: 0,
      isActive: true,
    };
  }

  return undefined;
}

function isOmittedField(key: string): boolean {
  const OMIT = new Set([
    'm_ObjectHideFlags',
    'm_CorrespondingSourceObject',
    'm_PrefabInstance',
    'm_PrefabAsset',
    'm_PrefabInternal',
    'm_PrefabParentObject',
    'serializedVersion',
    'm_EditorHideFlags',
    'm_EditorClassIdentifier',
    'm_Script',
    'm_Name',
    'm_GameObject',
    'm_Father',
    'm_Children',
    'm_RootOrder',
    'm_Component',
    'm_TagString',
    'm_Icon',
    'm_NavMeshLayer',
    'm_StaticEditorFlags',
    'm_LocalEulerAnglesHint',
  ]);
  return OMIT.has(key);
}
