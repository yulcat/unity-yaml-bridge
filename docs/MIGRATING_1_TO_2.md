# Migrating from uBridge 1.x to 2.0

uBridge 2.0 makes standalone v3 the default CLI parse format while preserving
the existing v1/v2 patch workflow explicitly.

## Runtime requirement

Use Node.js 20 or newer. The supported CI matrix is Node.js 20, 22, and 24.

## CLI default change

In 1.x, this command emitted a legacy compact document:

```bash
ubridge parse Input.prefab -o Input.ubridge
```

In 2.0 it emits v3. A v3 document can compile without the original YAML:

```bash
ubridge parse Input.prefab -o Input.ubridge
ubridge compile Input.ubridge -o Rebuilt.prefab
```

Pass a Unity project root when source GUID or script resolution is needed:

```bash
ubridge parse Input.prefab --project ./MyUnityProject -o Input.ubridge
ubridge compile Input.ubridge --project ./MyUnityProject -o Rebuilt.prefab
```

## Keep the 1.x write workflow

Select v2 (recommended legacy format) or v1 explicitly, then continue to provide
the original YAML to `write`:

```bash
ubridge parse Input.prefab --format v2 -o Input.ubridge
# edit Input.ubridge
ubridge write Input.ubridge --yaml Input.prefab -o Input.modified.prefab
```

Use `--format v1` only when a consumer specifically requires v1. The v1/v2
write semantics are unchanged in 2.0.

## Error and output behavior

Expected CLI failures now print one concise `Error: ...` line and exit with
status 1. File output is written to a temporary sibling and atomically renamed,
so parse, compile, or write failures do not partially replace an existing
output file.

## API compatibility

The package remains CommonJS and preserves the public root exports, including
`parseUnityYaml`, `writeCompact`, `readCompact`, `mergeCompactChanges`,
`writeUnityYaml`, `readV3`, `writeV3`, and `compileV3`.

## v3 scope in 2.0

v3 supports the documented prefab and prefab-variant workflows. The following
remain outside the 2.0 boundary and fail closed where applicable:

- inherited reparenting or sibling reordering;
- edits crossing a `PrefabInstance` boundary;
- arrays and managed references;
- scenes and non-prefab assets.

See [FORMAT_V3.md](FORMAT_V3.md) for the exact grammar and supported ownership
operations. This release does not claim Unity Editor validation or npm
publication.
