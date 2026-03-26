/**
 * Write a UnityFile AST back to Unity YAML format.
 *
 * This reconstructs valid Unity YAML from the internal representation,
 * preserving all document structure, IDs, and property values.
 *
 * Unity YAML formatting conventions:
 * - Array items at SAME indent level as the parent key (block compact style)
 * - Long flow mappings (references with guid) break across lines
 * - m_Component items written as: - component: {fileID: X}
 */
import { UnityFile } from './types';
/** Write a UnityFile back to Unity YAML string */
export declare function writeUnityYaml(file: UnityFile): string;
//# sourceMappingURL=unity-yaml-writer.d.ts.map