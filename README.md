# 🌉 Unity YAML Bridge

> Turn verbose Unity YAML prefabs into compact documents that humans and AI can
> read and edit.

uBridge 2.0 provides two deliberate workflows:

- **v3 (default):** a standalone desired-state format that compiles supported
  prefabs and prefab variants without the original YAML file.
- **v1/v2 (explicit):** the established patch workflow, where `write` merges an
  edited compact document into the original Unity YAML.

## Features

- Read Unity YAML into a typed document graph.
- Emit compact hierarchy and component details.
- Compile deterministic standalone v3 documents.
- Preserve the v1/v2 merge workflow for existing integrations.
- Resolve source GUIDs and scripts from a Unity project with `--project`.
- Fail closed on unsupported or ambiguous v3 ownership edits.
- Replace file outputs atomically and report concise CLI errors.
- CommonJS API with TypeScript declarations.

## Requirements and installation

Node.js 20 or newer is required. The project is tested on Node.js 20, 22, and
24.

The repository is release-ready but this documentation does **not** claim that
2.0.0 has been published to npm. To install from a checkout:

```bash
git clone https://github.com/yulcat/unity-yaml-bridge.git
cd unity-yaml-bridge
npm ci
npm run build
npm link
```

## CLI

```text
ubridge parse <file.prefab|.unity|.asset> [--format v1|v2|v3]
              [--project <path>] [--verbose] [-o <file>]
ubridge compile <file.ubridge> [--project <path>] [-o <file>]
ubridge write <file.ubridge> --yaml <original.prefab>
              [--project <path>] [-o <file>]
ubridge --version
```

### Default v3 workflow

`parse` defaults to v3 in uBridge 2.0:

```bash
ubridge parse Input.prefab -o Input.ubridge
# edit Input.ubridge
ubridge compile Input.ubridge -o Rebuilt.prefab
```

For prefab variants, nested prefab sources, or new script components, provide a
Unity project root when GUID/script resolution is required:

```bash
ubridge parse Variant.prefab --project ./MyUnityProject -o Variant.ubridge
ubridge compile Variant.ubridge --project ./MyUnityProject -o Variant.rebuilt.prefab
```

A small tested example is available in [`samples/v3/`](samples/v3/):

```text
# ubridge v3 | prefab | profile:unity-generic-v1
--- STRUCTURE
Root @g1 [BoxCollider @c1]
└─ Child @g2
--- DETAILS
...
--- IDENTITY
...
```

See the complete grammar and support boundary in
[`docs/FORMAT_V3.md`](docs/FORMAT_V3.md).

### Explicit v1/v2 patch workflow

Use v2 when retaining the 1.x workflow (or v1 for a consumer that specifically
requires it):

```bash
ubridge parse Input.prefab --format v2 -o Input.ubridge
# edit Input.ubridge
ubridge write Input.ubridge --yaml Input.prefab -o Input.modified.prefab
```

The `write` workflow is unchanged: it requires the original YAML as its merge
baseline. See [`docs/FORMAT.md`](docs/FORMAT.md) for v1/v2 syntax.

## JavaScript / TypeScript API

The package is CommonJS and preserves its public root exports.

### Standalone v3

```typescript
import {
  parseUnityYaml,
  writeV3,
  readV3,
  compileV3,
  writeUnityYaml,
} from 'unity-yaml-bridge';

const ast = parseUnityYaml(prefabText);
const documentText = writeV3(ast);
const rebuiltAst = compileV3(readV3(documentText));
const rebuiltPrefab = writeUnityYaml(rebuiltAst);
```

### Legacy v2 patching

```typescript
import {
  parseUnityYaml,
  writeCompact,
  readCompact,
  mergeCompactChanges,
  writeUnityYaml,
} from 'unity-yaml-bridge';

const originalAst = parseUnityYaml(originalPrefab);
const compact = writeCompact(originalAst, { version: 2 });
// ...edit compact text...
const merged = mergeCompactChanges(originalAst, readCompact(editedCompact));
const output = writeUnityYaml(merged);
```

## Supported v3 boundary

uBridge 2.0 supports the prefab and prefab-variant operations documented in the
v3 format specification, including source-backed variant/nested-prefab
workflows within that ownership model.

The following are deferred:

- inherited reparenting and sibling reordering;
- edits that cross a `PrefabInstance` boundary;
- arrays and managed references;
- scenes and non-prefab assets.

Unsupported or ambiguous operations are intended to fail closed. The automated
suite exercises parser/compiler round trips and packed npm-consumer behavior;
it does not claim Unity Editor validation.

## Errors and output safety

Expected CLI failures emit a concise `Error: ...` line and exit with status 1.
When `-o` is used, uBridge writes a temporary sibling and renames it over the
target only after parsing/compilation/serialization succeeds. A failed command
therefore does not partially overwrite an existing output.

## Migration

See [`docs/MIGRATING_1_TO_2.md`](docs/MIGRATING_1_TO_2.md) for the Node.js
requirement, CLI default change, compatibility guidance, and v3 limitations.

## Development and testing

```bash
npm ci
npm test
npm run test:packed
npx tsc --noEmit
```

`test:packed` creates the exact npm tarball, installs it into an empty temporary
consumer without fetching runtime dependencies, and verifies the CJS API,
declarations, executable version, v3 default, explicit v2 behavior,
deterministic compile output, and malformed-input safety.

## License

[MIT](LICENSE)
