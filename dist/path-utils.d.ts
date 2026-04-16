export declare const ADDED_ROOT_NAME = "__added_root__";
export interface PathLookupOptions {
    allowAddedRootAliases?: boolean;
}
export interface PathLookupResult<T> {
    key: string;
    value: T;
}
export declare function hasAddedRootPrefix(path: string): boolean;
export declare function stripAddedRootPrefix(path: string): string;
export declare function addedRootPathAliases(path: string): string[];
export declare function pathLookupCandidates(path: string, options?: PathLookupOptions): string[];
export declare function findPathMapEntry<T>(map: Map<string, T>, key: string, options?: PathLookupOptions): PathLookupResult<T> | undefined;
export declare function findPathSetEntry(set: Set<string>, key: string, options?: PathLookupOptions): string | undefined;
//# sourceMappingURL=path-utils.d.ts.map