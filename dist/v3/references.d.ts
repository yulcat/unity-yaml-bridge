export interface V3MachineReference {
    $ref: string;
}
/** Convert local `{fileID}` references to stable v3 machine identities. */
export declare function encodeV3References(value: unknown, documentIds: ReadonlyMap<string, string>): unknown;
/** Resolve stable v3 machine references only against entities emitted by the
 * desired STRUCTURE. A reference to a tombstoned identity is a hard error. */
export declare function resolveV3References(value: unknown, fileIds: ReadonlyMap<string, string>, emittedMachineIds: ReadonlySet<string>, context: string): unknown;
//# sourceMappingURL=references.d.ts.map