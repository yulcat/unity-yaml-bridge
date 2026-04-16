"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADDED_ROOT_NAME = void 0;
exports.hasAddedRootPrefix = hasAddedRootPrefix;
exports.stripAddedRootPrefix = stripAddedRootPrefix;
exports.addedRootPathAliases = addedRootPathAliases;
exports.pathLookupCandidates = pathLookupCandidates;
exports.findPathMapEntry = findPathMapEntry;
exports.findPathSetEntry = findPathSetEntry;
exports.ADDED_ROOT_NAME = '__added_root__';
function hasAddedRootPrefix(path) {
    return path.startsWith(`${exports.ADDED_ROOT_NAME}/`);
}
function stripAddedRootPrefix(path) {
    return hasAddedRootPrefix(path)
        ? path.substring(exports.ADDED_ROOT_NAME.length + 1)
        : path;
}
function addedRootPathAliases(path) {
    if (!path || path === exports.ADDED_ROOT_NAME)
        return [];
    if (hasAddedRootPrefix(path)) {
        return [stripAddedRootPrefix(path)];
    }
    return [`${exports.ADDED_ROOT_NAME}/${path}`];
}
function pathLookupCandidates(path, options = {}) {
    const candidates = [path];
    if (options.allowAddedRootAliases) {
        for (const alias of addedRootPathAliases(path)) {
            if (!candidates.includes(alias))
                candidates.push(alias);
        }
    }
    return candidates;
}
function findPathMapEntry(map, key, options = {}) {
    for (const candidate of pathLookupCandidates(key, options)) {
        const value = map.get(candidate);
        if (value !== undefined) {
            return { key: candidate, value };
        }
    }
    return undefined;
}
function findPathSetEntry(set, key, options = {}) {
    for (const candidate of pathLookupCandidates(key, options)) {
        if (set.has(candidate))
            return candidate;
    }
    return undefined;
}
//# sourceMappingURL=path-utils.js.map