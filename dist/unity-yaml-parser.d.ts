/**
 * Parse Unity YAML files into internal AST.
 *
 * Unity YAML quirks handled:
 * - %YAML 1.1 / %TAG directives
 * - Multiple documents in one file (--- separators)
 * - Custom tags like !u!114 &1234567
 * - Stripped objects
 * - Flow mappings {fileID: 123, guid: abc, type: 3}
 * - Both old-style (Prefab/m_PrefabInternal) and new-style (PrefabInstance/m_CorrespondingSourceObject) formats
 */
import { UnityFile } from './types';
/** Parse a Unity YAML string into a UnityFile */
export declare function parseUnityYaml(content: string): UnityFile;
//# sourceMappingURL=unity-yaml-parser.d.ts.map