export { parseUnityYaml } from './unity-yaml-parser';
export { writeCompact } from './compact-writer';
export type { CompactWriterOptions } from './compact-writer';
export { readCompact, parseCompactValue } from './compact-reader';
export type { CompactFile, CompactSection, CompactStructureNode, CompactProperty } from './compact-reader';
export { mergeCompactChanges } from './compact-merger';
export type { CompactMergeOptions } from './compact-merger';
export { writeUnityYaml } from './unity-yaml-writer';
export { GuidResolver } from './guid-resolver';
export { readV3 } from './v3/reader';
export { writeV3 } from './v3/writer';
export { compileV3 } from './v3/compiler';
export { normalizeLocalPrefab, compareLocalPrefabSemantics } from './v3/semantic-normalizer';
export type { SemanticDifference } from './v3/semantic-normalizer';
export type {
  V3Document,
  V3IdentityRecord,
  V3StructureNode,
  V3StructureComponent,
  V3WriterOptions,
} from './v3/model';
export * from './types';
