/** JSON is the canonical v3 value syntax. It keeps strings and large numeric
 * scalars unambiguous while still being familiar to humans and agents. */
export declare function parseV3Value(text: string, context: string): unknown;
export declare function formatV3Value(value: unknown): string;
/** Unity's YAML writer uses a non-enumerable marker to render vectors and
 * colors as flow mappings. The marker is formatting-only and is intentionally
 * absent from the standalone document. */
export declare function markCanonicalFlowMappings(value: unknown): unknown;
//# sourceMappingURL=value.d.ts.map