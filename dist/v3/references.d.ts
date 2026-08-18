export interface V3MachineReference {
    $ref: string;
}
export type V3OverrideReferenceResolver = (machineId: string) => Record<string, unknown> | undefined;
export declare function validateV3ExternalObjectReference(value: unknown, context: string): Record<string, unknown>;
/** Normalize the deliberately narrow object-reference forms accepted by an
 * inherited nested DETAILS override. Arbitrary object values fail closed. */
export declare function resolveV3OverrideReference(value: unknown, resolveMachineReference: V3OverrideReferenceResolver, context: string): Record<string, unknown> | undefined;
/** Convert local `{fileID}` references to stable v3 machine identities. */
export declare function encodeV3References(value: unknown, documentIds: ReadonlyMap<string, string>): unknown;
/** Resolve stable v3 machine references only against entities emitted by the
 * desired STRUCTURE. A reference to a tombstoned identity is a hard error. */
export declare function resolveV3References(value: unknown, fileIds: ReadonlyMap<string, string>, emittedMachineIds: ReadonlySet<string>, context: string): unknown;
//# sourceMappingURL=references.d.ts.map