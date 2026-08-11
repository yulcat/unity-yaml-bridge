import { UnityFile } from '../types';
export interface SemanticDifference {
    path: string;
    expected: unknown;
    actual: unknown;
}
/** Canonical semantic view for regular prefabs. Local structural links are
 * represented explicitly; ownership documents are compared as serialized
 * semantic records. */
export declare function normalizeLocalPrefab(file: UnityFile): unknown;
export declare function compareLocalPrefabSemantics(expected: UnityFile, actual: UnityFile): SemanticDifference | null;
//# sourceMappingURL=semantic-normalizer.d.ts.map