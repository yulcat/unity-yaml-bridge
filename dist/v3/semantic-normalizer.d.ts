import { UnityFile } from '../types';
export interface SemanticDifference {
    path: string;
    expected: unknown;
    actual: unknown;
}
/** Canonical semantic view for the first v3 compiler slice. Structural links
 * are represented explicitly rather than compared as serializer fields. */
export declare function normalizeLocalPrefab(file: UnityFile): unknown;
export declare function compareLocalPrefabSemantics(expected: UnityFile, actual: UnityFile): SemanticDifference | null;
//# sourceMappingURL=semantic-normalizer.d.ts.map