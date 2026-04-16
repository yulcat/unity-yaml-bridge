export const ADDED_ROOT_NAME = '__added_root__';

export interface PathLookupOptions {
  allowAddedRootAliases?: boolean;
}

export interface PathLookupResult<T> {
  key: string;
  value: T;
}

export function hasAddedRootPrefix(path: string): boolean {
  return path.startsWith(`${ADDED_ROOT_NAME}/`);
}

export function stripAddedRootPrefix(path: string): string {
  return hasAddedRootPrefix(path)
    ? path.substring(ADDED_ROOT_NAME.length + 1)
    : path;
}

export function addedRootPathAliases(path: string): string[] {
  if (!path || path === ADDED_ROOT_NAME) return [];
  if (hasAddedRootPrefix(path)) {
    return [stripAddedRootPrefix(path)];
  }
  return [`${ADDED_ROOT_NAME}/${path}`];
}

export function pathLookupCandidates(path: string, options: PathLookupOptions = {}): string[] {
  const candidates = [path];
  if (options.allowAddedRootAliases) {
    for (const alias of addedRootPathAliases(path)) {
      if (!candidates.includes(alias)) candidates.push(alias);
    }
  }
  return candidates;
}

export function findPathMapEntry<T>(
  map: Map<string, T>,
  key: string,
  options: PathLookupOptions = {}
): PathLookupResult<T> | undefined {
  for (const candidate of pathLookupCandidates(key, options)) {
    const value = map.get(candidate);
    if (value !== undefined) {
      return { key: candidate, value };
    }
  }
  return undefined;
}

export function findPathSetEntry(
  set: Set<string>,
  key: string,
  options: PathLookupOptions = {}
): string | undefined {
  for (const candidate of pathLookupCandidates(key, options)) {
    if (set.has(candidate)) return candidate;
  }
  return undefined;
}
