/** Validation helpers shared by the compact merge pipeline. */
import { CompactFile } from './compact-reader';
import { UnityFile } from './types';
/** Keep merge transactional: callers can safely reuse the parsed compact input. */
export declare function cloneCompactFile(compact: CompactFile): CompactFile;
/** Reject a compact file that clearly belongs to another Unity YAML input. */
export declare function assertCompactSourceCompatible(original: UnityFile, compact: CompactFile): void;
/** Collect structural issues without rejecting pre-existing tolerated Unity YAML quirks. */
export declare function collectUnityIntegrityIssues(file: UnityFile): Set<string>;
/** Fail only for integrity damage introduced by this merge. */
export declare function assertNoNewIntegrityIssues(baseline: Set<string>, merged: UnityFile): void;
//# sourceMappingURL=merge-validation.d.ts.map