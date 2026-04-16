/**
 * Resolve Unity script GUIDs to human-readable names.
 *
 * Two sources:
 * 1. Built-in Unity component GUIDs (globally consistent)
 * 2. Project-specific .cs.meta files (scanned at runtime)
 */
/** GuidResolver maps script GUIDs to human-readable class names */
export declare class GuidResolver {
    private map;
    /** GUID → absolute file path for asset files (.prefab, .unity, etc.) */
    private assetPaths;
    constructor();
    /** Scan a Unity project folder for .cs.meta and asset .meta files */
    scanProject(projectPath: string): void;
    /** Recursively scan a directory for .meta files */
    private scanDirectory;
    /** Read a .cs.meta file and extract the GUID → class name mapping */
    private readScriptMetaFile;
    /** Read an asset .meta file and store GUID → file path mapping */
    private readAssetMetaFile;
    /** Resolve a GUID to a human-readable name */
    resolve(guid: string): string | undefined;
    /** Resolve a GUID to the asset file path */
    resolveFilePath(guid: string): string | undefined;
    /** Add a manual mapping */
    add(guid: string, name: string): void;
    /** Add a manual asset mapping */
    addAsset(guid: string, assetPath: string, name?: string): void;
    /** Get the number of mappings */
    get size(): number;
}
//# sourceMappingURL=guid-resolver.d.ts.map