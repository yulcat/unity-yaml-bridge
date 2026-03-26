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
}
export interface CompactProperty {
    key: string;
    value: string | CompactProperty[];
    indent: number;
}
/** Parse a .ubridge string into a CompactFile */
export declare function readCompact(content: string): CompactFile;
/** Parse a compact value string back to its proper AST type */
export declare function parseCompactValue(str: string): any;
//# sourceMappingURL=compact-reader.d.ts.map