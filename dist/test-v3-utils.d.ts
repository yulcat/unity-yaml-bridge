import { UnityFile } from './types';
export interface ColdRoundTripResult {
    original: UnityFile;
    v3Text: string;
    rebuiltText: string;
    rebuilt: UnityFile;
}
/** The only input crossing the cold boundary is serialized v3 text. */
export declare function coldRoundTripV3(yaml: string): ColdRoundTripResult;
export declare function describeSemanticDifference(expected: UnityFile, actual: UnityFile): string | null;
//# sourceMappingURL=test-v3-utils.d.ts.map