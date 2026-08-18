# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-08-18

### Added

- Stable standalone v3 desired-state format for supported prefab and prefab-variant workflows.
- `ubridge compile`, including optional `--project` GUID/script resolution.
- CJS package `exports`, runtime metadata, declarations, and packed-consumer validation.
- Atomic CLI output replacement and concise expected-error reporting.

### Changed

- `ubridge parse` now emits v3 by default.
- Node.js 20 or newer is required; CI covers Node.js 20, 22, and 24.

### Compatibility

- v1 and v2 parsing remain available with `--format v1` and `--format v2`.
- The v1/v2 `ubridge write --yaml ...` patch workflow is unchanged.
- Root CommonJS API exports remain available.

### Known limitations

- v3 is scoped to prefab and prefab-variant workflows. Scenes and other assets are deferred.
- Inherited reparent/reorder operations, PrefabInstance boundary edits, and arrays/managed references are deferred.
- Release validation does not claim Unity Editor validation or npm publication.

## [1.1.1]

- Previous v1/v2 patch-workflow release.
