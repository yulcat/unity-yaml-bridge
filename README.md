# 🌉 Unity YAML Bridge

> Turn Unity's 10,000-line YAML prefabs into something AI can actually read — and write back perfectly.

Unity serializes prefabs, scenes, and assets as YAML files filled with cryptic fileIDs, boilerplate metadata, and flat hierarchies that are hostile to both humans and AI. **Unity YAML Bridge** converts them to a compact, AI-friendly `.ubridge` format — and back again, losslessly.

## The Problem

A simple UI button in Unity YAML:

```yaml
--- !u!1 &8027481463175804169
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 8027481463175804168}
  - component: {fileID: 8027481463175804175}
  m_Layer: 5
  m_Name: Button
  # ... 250 more lines of this
```

**9,488 bytes.** For a button. Good luck asking Claude to "change the sprite."

## The Solution

The same button in `.ubridge`:

```ini
# ubridge v1 | prefab
--- STRUCTURE
Button [ActivatePanelUI]
├─ Background9Slice_Image [Image]
└─ Button_Text {Button_Text}
--- DETAILS

[Button:RectTransform]
pos = (-694, 416)
size = (187.87, 51.63)

[Button:ActivatePanelUI]
activatedText = Activated
activateText = Activate
disabledText = Disabled

[Background9Slice_Image:Image]
m_Sprite = {21300000, e197d4e89f9f4274dac4566fdd117ecf}
m_Type = 1
--- REFS
Button = 8027481463175804169
Button:RectTransform = 8027481463175804168
Button:ActivatePanelUI = 8027481463175804175
Background9Slice_Image = 8027481461304769077
Background9Slice_Image:Image = 8027481461304769067
```

**698 bytes. 92.6% smaller.** AI reads the tree, edits the details, ignores the refs. Tool handles the rest.

## ✨ Features

- **🌳 Structure + Details separation** — Understand hierarchy at a glance, dive into components only when needed
- **🔄 Lossless round-trip** — 0 diff lines across 1M+ lines of real Unity YAML
- **📦 Self-contained files** — REFS section stores all fileIDs; no in-memory state between CLI calls
- **🆕 Auto fileID generation** — Add new GameObjects or components; the tool generates valid fileIDs automatically
- **🎭 Prefab Variant support** — Base + delta pattern with `*` (modified), `+` (added), `-` (removed) markers
- **🗜️ 77-96% token reduction** — Less context = cheaper, faster, more accurate AI edits

## Token Efficiency

Tested on 142 real prefabs from Unity's official sample projects:

| File | Unity YAML | .ubridge | Reduction |
|------|-----------|----------|-----------|
| Button.prefab | 9,488 B | 698 B | **92.6%** |
| _Card_Template.prefab | 25,643 B | 873 B | **96.6%** |
| Card_Explorer_Variant.prefab | 14,081 B | 3,233 B | **77.0%** |
| Ellen_Variant.prefab | 2,349 B | 434 B | **81.5%** |

## .ubridge Format

Three sections, one file:

```
# ubridge v1 | prefab
--- STRUCTURE          ← AI reads this: "what does this prefab look like?"
Button [ActivatePanelUI]
├─ Background [Image]
└─ Label [TextMeshProUGUI]
--- DETAILS            ← AI edits this: "change the text to 'Buy Now'"
[Label:TextMeshProUGUI]
m_text = Click Me
--- REFS               ← Tool uses this: fileID restoration on write-back
Button = 8027481463175804169
Label:TextMeshProUGUI = 8027481463030904456
```

### Prefab Variants

Variants show the inherited tree with override markers:

```
# ubridge v1 | variant | base-guid:2982fa53447c5c643865bbd0d194eab1
--- STRUCTURE
_Card_Template [CameraFacingBillboard, CardBehaviour*]
├─ Frame [Image]
├─ _Header_Text [TextMeshProUGUI*]
└─ + NewBadge [Image]
--- DETAILS
[_Header_Text:TextMeshProUGUI]
m_text = Explorer

[+ NewBadge:Image]
m_Sprite = {21300000, abc123...}
--- REFS
__instance = 4987371547573211178
_Header_Text:TextMeshProUGUI = 7213628277689136018
```

`*` = overridden, `+` = added in this variant, `-` = removed.

### Value Syntax

| Type | Syntax | Example |
|------|--------|---------|
| Vector | `(x, y[, z[, w]])` | `(0.5, 0.5, 0)` |
| Color | `(r, g, b, a)` | `(1, 0.9, 0.3, 1)` |
| Asset ref | `{fileID, guid}` | `{21300000, e197d4e8...}` |
| Internal ref | `{fileID}` | `{8027481463030904456}` |
| Null | `null` | |

Full spec: [docs/FORMAT.md](docs/FORMAT.md)

## Usage

## Installation

```bash
git clone https://github.com/yulcat/unity-yaml-bridge.git
cd unity-yaml-bridge
npm install
npm link    # makes `ubridge` available globally
```

## Usage

```typescript
import { parseUnityYaml, writeCompact, parseCompact, writeUnityYaml } from 'unity-yaml-bridge';
import fs from 'fs';

// Unity YAML → .ubridge
const yaml = fs.readFileSync('Button.prefab', 'utf-8');
const ast = parseUnityYaml(yaml);
const compact = writeCompact(ast);
fs.writeFileSync('Button.ubridge', compact);

// .ubridge → Unity YAML (after AI edits)
const edited = fs.readFileSync('Button.ubridge', 'utf-8');
const editedAst = parseCompact(edited);
const yamlOut = writeUnityYaml(editedAst);
fs.writeFileSync('Button.prefab', yamlOut);
```

## How It Works

```
Unity YAML ──parse──→ AST ──write──→ .ubridge
                                        │
                                    AI edits
                                        │
Unity YAML ←─write── AST ←─parse──  .ubridge
```

The AST preserves everything Unity needs — document ordering, fileIDs, custom tags, stripped objects — while the `.ubridge` format shows only what matters for understanding and editing.

## Project Structure

```
src/
├── unity-yaml-parser.ts   # Unity YAML → AST (handles all YAML quirks)
├── compact-writer.ts      # AST → .ubridge (tree + details + refs)
├── compact-reader.ts      # .ubridge → AST (self-contained, no external state)
├── compact-merger.ts      # Apply .ubridge edits back to AST + auto fileID gen
├── unity-yaml-writer.ts   # AST → Unity YAML (byte-identical round-trip)
├── guid-resolver.ts       # GUID → asset name resolution
└── types.ts               # Shared type definitions
```

## Testing

```bash
# Single file round-trip
npx tsx src/test-roundtrip.ts samples/prefabs/Button.prefab

# Batch test (all 142 prefabs)
npx tsx src/test-batch.ts

# Compact format round-trip + edit scenarios
npx tsx src/test-compact-roundtrip.ts
```

## Status

- ✅ Prefab parsing & round-trip (0% diff on 1M+ lines)
- ✅ Prefab variant support
- ✅ REFS section (self-contained files)
- ✅ Auto fileID generation for new elements
- ✅ Compact edit → YAML write-back
- 🔧 Variant path resolution (base prefab cross-reference)
- 🔧 CLI tool (`ubridge parse` / `ubridge write`)
- 📋 Scene file support
- 📋 npm package publish

## Acknowledgments

Inspired by a colleague's Unity YAML→JSON converter that pioneered the `@` reference syntax and `refs` table pattern for lossless round-trips. This project explores a different angle: tree-based structure visualization + INI-style details for maximum AI token efficiency.

## License

MIT
