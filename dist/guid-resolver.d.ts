/**
 * Resolve Unity script GUIDs to human-readable names.
 *
 * Two sources:
 * 1. Built-in Unity component GUIDs (globally consistent)
 * 2. Project-specific .cs.meta files (scanned at runtime)
 */
/** GuidResolver maps script GUIDs to human-readable class names */
export declare class GuidResolver {
    /** GUID → display name for both scripts and named assets. */
    private map;
    /** Script name → every known script GUID; assets never enter this index. */
    private scriptGuidsByName;
    /** Project/manual mappings take precedence over built-in defaults. */
    private projectScriptGuidsByName;
    private preferredBuiltinGuidByName;
    /** GUID → absolute file path for asset files (.prefab, .unity, etc.) */
    private assetPaths;
    constructor();
    private registerScript;
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
    /** Resolve a script/component name to one safe GUID for component creation. */
    resolveGuid(name: string): string | undefined;
    /** Resolve every known script GUID for validation of an existing document. */
    resolveScriptGuids(name: string): string[];
    private onlyGuid;
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