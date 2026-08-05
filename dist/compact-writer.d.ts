/**
 * Convert a parsed UnityFile AST into the compact .ubridge format.
 */
import { UnityFile } from './types';
import { GuidResolver } from './guid-resolver';
/** Options for compact writer */
export interface CompactWriterOptions {
    /** GUID resolver for script name resolution */
    guidResolver?: GuidResolver;
    /** Include all fields (disable boilerplate filtering) */
    verbose?: boolean;
    /** Compact format version. v1 remains the default for compatibility. */
    version?: 1 | 2;
}
/** Convert a UnityFile to compact .ubridge string */
export declare function writeCompact(file: UnityFile, options?: CompactWriterOptions): string;
//# sourceMappingURL=compact-writer.d.ts.map