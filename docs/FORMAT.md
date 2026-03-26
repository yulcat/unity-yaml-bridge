# Unity Bridge (.ubridge) Format Specification

## Overview

A `.ubridge` file has three sections separated by `---`:

1. **Structure** — GameObject hierarchy tree
2. **Details** — Component property values
3. **REFS** — FileID mapping for round-trip fidelity

The file is self-contained: AI agents read/edit STRUCTURE + DETAILS; the REFS section enables the tool to restore Unity fileIDs on write-back without in-memory state between CLI calls.

## Structure Section

Uses tree-drawing characters to show the hierarchy. Components listed in brackets after the GO name.

```
Button [ButtonActivation]
├─ Background9Slice_Image [Image]
└─ Button_Text {SkillName_Text} [TextMeshProUGUI]
```

### Syntax

- Root GO on first line, no prefix
- Children use `├─` (mid) and `└─` (last) with `│` for continuation
- `[Component1, Component2]` after the name — only user-relevant components
  - Omit: Transform, RectTransform, CanvasRenderer (boilerplate)
  - Include: Image, TextMeshProUGUI, Animator, AudioSource, custom MonoBehaviours
- `{PrefabName}` — nested prefab instance (the GO came from instantiating PrefabName)
- Nested prefab expansion: when a `--project` path is provided, nested prefab hierarchies are recursively inlined, showing the full tree from the source prefab
- Variant markers (prefab variant files only):
  - `*` after component name = modified (e.g. `Image*`)
  - `+` before GO name = added
  - `-` before GO name = removed

### Nested Prefab Expansion

When a Unity project path is provided (via `--project` or `guidResolver`), nested PrefabInstance nodes are recursively expanded to show the full hierarchy from their source prefab. This makes the tree readable without needing to open the source prefab separately.

```
_Card_Template [CameraFacingBillboard, CardBehaviour]
├─ Frame [Image]
├─ _Header_Text {_Header_Text}
│  └─ Text [TextMeshProUGUI*]
├─ Paragraph_Text {Paragraph_Text}
│  └─ Text [TextMeshProUGUI*]
└─ small circle {Medal_Template} [MedalDisplayUI*, Animator]
   ├─ Circle_Image [Image*]
   ├─ Small_Circle_Image [Image*]
   ├─ ActivationParticles_Template {ActivationParticles_Template}
   │  ├─ ParticleReferences
   │  │  ├─ Burst_ParticleSystem [ParticleSystem*, ParticleSystemRenderer*]
   │  │  └─ Activated_ParticleSystem [ParticleSystem*, ParticleSystemRenderer*]
   │  ├─ Activated_UIParticles [UIParticles*]
   │  └─ Burst_UIParticles [UIParticles*]
   └─ ProfileIcon_Image {ProfileIcon_Image}
      └─ Image [Image*]
```

Key behaviors:
- `{SourceName}` annotation shows which prefab the node was instantiated from
- Children of the nested prefab are inlined at the correct tree depth
- `*` markers indicate components overridden by the base PI's modifications
- Expansion is recursive (nested-within-nested prefabs are also expanded)
- Cycle detection prevents infinite recursion when prefabs reference each other
- If the source prefab file cannot be found, the node shows just `{GUID}` without expansion

### Name Collision Resolution

When sibling GameObjects share the same `m_Name`, append `#N` (1-indexed):
```
Parent
├─ Item#1
├─ Item#2
└─ Item#3
```

## Details Section

Uses INI-style sections with `[GOPath:Component]` headers.

```
[Button:ButtonActivation]
activatedText = Activated
activateText = Activate
disabledText = Disabled
activateDisplayText = ->Button_Text:TextMeshProUGUI

[Background9Slice_Image:Image]
m_Sprite = {21300000, e197d4e89f9f4274dac4566fdd117ecf}
m_Type = 1
m_FillCenter = 1
m_RaycastTarget = 1
```

### Section Headers

Format: `[GOPath:ComponentType]`
- `GOPath` = slash-separated path from root (e.g. `Canvas/Panel/Button`)
- For root GO, just the name: `[Button:ButtonActivation]`
- Only sections with non-default or interesting values need to appear

### Value Formats

| Unity Type | Compact Format | Example |
|---|---|---|
| int, float | literal | `5`, `0.42` |
| bool | `0` / `1` | `1` |
| string | literal (quote if has `=`) | `Hello World` |
| Vector2 | `(x, y)` | `(0.5, 0.5)` |
| Vector3 | `(x, y, z)` | `(0, 1, 0)` |
| Vector4/Quaternion | `(x, y, z, w)` | `(0, 0, 0, 1)` |
| Color | `(r, g, b, a)` | `(1, 1, 1, 1)` |
| Asset reference | `{fileID, guid}` | `{21300000, e197d4e8...}` |
| Internal ref | `->GOPath:Component` | `->Button_Text:TextMeshProUGUI` |
| Null ref | `null` | `null` |
| Enum (int) | literal int | `1` |
| Array (simple) | `[item1, item2]` | `[{fileID1, guid1}, {fileID2, guid2}]` |
| Array (complex) | multi-line with `-` | see below |
| LayerMask | `bits:N` | `bits:512` |

### Complex Arrays

```
[Chomper:DamageDealer]
damage = 1
attackPoints:
  - radius = 0.42
    offset = (0, 0, 0)
    attackRoot = ->MouthEnd:Transform
```

### AnimationCurve

Compact form — only keyframes matter:
```
rolloffCustomCurve = curve[(0, 1, 0, 0), (1, 0, 0, 0)]
```
Format: `curve[(time, value, inSlope, outSlope), ...]`

### Omitted Fields

The following are omitted from compact output (they're metadata/boilerplate):
- `m_ObjectHideFlags`
- `m_CorrespondingSourceObject`
- `m_PrefabInstance`
- `m_PrefabAsset`
- `m_PrefabInternal`
- `m_PrefabParentObject`
- `serializedVersion`
- `m_EditorHideFlags`
- `m_EditorClassIdentifier`
- `m_Script` (redundant — component type is in the header)
- `m_Name` (redundant — GO name is in the tree)
- `m_GameObject` (redundant — linkage is structural)
- `m_Father`, `m_Children`, `m_RootOrder` (redundant — tree captures hierarchy)
- `m_Component` list on GameObjects (redundant — components listed in tree)

### Transform/RectTransform Shorthand

Transforms are so common they get a special compact form. Only non-default values shown:

```
[Button:RectTransform]
pos = (-694, 416, 0)
anchor = (0.5, 0.5)-(0.5, 0.5)
size = (187.87, 51.63)
```

Where:
- `pos` = `m_LocalPosition` or `m_AnchoredPosition`
- `rot` = euler angles (omitted if zero)
- `scale` = `m_LocalScale` (omitted if (1,1,1))
- `anchor` = `m_AnchorMin`-`m_AnchorMax` (RectTransform only)
- `size` = `m_SizeDelta` (RectTransform only)
- `pivot` = `m_Pivot` (omitted if (0.5, 0.5))

## REFS Section

Maps every GO and component to its original Unity fileID. This makes the `.ubridge` file self-contained — the CLI tool can map paths back to fileIDs on write-back without in-memory state.

```
--- REFS
Button = 8027481463175804169
Button:RectTransform = 8027481463175804168
Button:ButtonActivation = 8027481463175804175
Background9Slice_Image = 8027481461304769077
Background9Slice_Image:RectTransform = 8027481461304769076
Background9Slice_Image:Image = 8027481461304769067
Button_Text:RectTransform = 8027481463030904457
Button_Text:TextMeshProUGUI = 8027481463030904456
Button_Text:__instance = 6920765965181414293
```

### Format

Each line is `key = fileID` where:

| Key format | Meaning |
|---|---|
| `GOName` | GameObject document fileID |
| `GOName:ComponentType` | Component document fileID |
| `GOName:Transform` or `GOName:RectTransform` | Transform document fileID |
| `GOName:__instance` | Nested PrefabInstance document fileID |
| `__instance` | (Variants only) The PrefabInstance document fileID |

### AI Interaction

- AI agents **read and edit** STRUCTURE + DETAILS only
- AI agents **do not modify** REFS
- The tool uses REFS to restore fileIDs when converting back to Unity YAML

### New Element FileID Generation

When an AI adds a new GameObject or component in STRUCTURE/DETAILS that has no matching REFS entry:
- The tool auto-generates a random int64 fileID (matching Unity's convention)
- Uses `crypto.randomBytes(8)` for proper randomness
- The generated ID is always a positive 64-bit integer
- If the file is re-exported, the new REFS entries will include the generated IDs

## Prefab Variant Format

For variants, the file shows the full inherited tree from the base prefab with override markers.

### Structure Section (Variant)

When the base prefab can be resolved, the structure shows the full inherited tree (including nested prefab expansion) with `*` markers on overridden components:

```
_Card_Template [CameraFacingBillboard, CardBehaviour*]
├─ Frame [Image]
├─ _Header_Text {_Header_Text}
│  └─ Text [TextMeshProUGUI*]
├─ Paragraph_Text {Paragraph_Text}
│  └─ Text [TextMeshProUGUI*]
└─ small circle {Medal_Template} [MedalDisplayUI*, Animator]
   ├─ Circle_Image [Image*]
   ├─ Small_Circle_Image [Image*]
   ├─ ActivationParticles_Template {ActivationParticles_Template}
   │  ├─ ParticleReferences
   │  │  ├─ Burst_ParticleSystem [ParticleSystem*, ParticleSystemRenderer*]
   │  │  └─ Activated_ParticleSystem [ParticleSystem*, ParticleSystemRenderer*]
   │  ├─ Activated_UIParticles [UIParticles*]
   │  └─ Burst_UIParticles [UIParticles*]
   └─ ProfileIcon_Image {ProfileIcon_Image}
      └─ Image [Image*]
```

`*` = this component has overrides in this variant.

If the base prefab cannot be resolved, falls back to:
```
(variant of 2982fa53447c5c643865bbd0d194eab1)
```

### Details Section (Variant)

Only overridden properties appear. Section headers use `[GOPath:ComponentType]` format, resolved from the base prefab hierarchy — never raw fileID references.

```
[_Card_Template]
m_Name = Card_Explorer_Variant

[_Header_Text:TextMeshProUGUI]
m_text = Explorer

[Paragraph_Text:TextMeshProUGUI]
m_text = Agility and speed. A fast mode for exploring and reaching new heights.

[small circle/Circle_Image:Image]
m_Sprite = {21300000, 42d984ce295234641b1cb18df0854078}
m_Color.a = -0.044181824

[_Card_Template:CardBehaviour]
cardData = {11400000, 1fe163de0e6ff604d9ba3bd3b6228a5b}
```

Path resolution rules:
- **Direct base objects**: Use the GO name from the base hierarchy (e.g. `_Card_Template:CardBehaviour`)
- **Nested prefab objects**: Use the instance name + component type (e.g. `_Header_Text:TextMeshProUGUI`)
- **Disambiguation**: When the same component type appears on multiple GOs within a nested prefab, the source GO name is appended (e.g. `small circle/Circle_Image:Image` vs `small circle/Small_Circle_Image:Image`)
- **Deep nesting**: For objects inside nested prefabs within nested prefabs, the full path is shown (e.g. `small circle/ActivationParticles_Template/Activated_ParticleSystem:ParticleSystem`)

Boilerplate variant modifications are filtered (transform positions, rotation orders, etc.).

### REFS Section (Variant)

Maps resolved paths to target fileIDs in the **base prefab**:
```
--- REFS
__instance = 4987371547573211178
_Card_Template:RectTransform = 8368714169436892108
_Card_Template = 3640861149533394057
_Header_Text:TextMeshProUGUI = 7213628277689136018
Paragraph_Text:TextMeshProUGUI = 4010685728728214465
small circle/Circle_Image:Image = 6683245448512787790
small circle/Small_Circle_Image:Image = 2153683003282787722
```

The `__instance` entry stores the PrefabInstance document's own fileID. Other entries map to target fileIDs used in the base prefab, enabling the tool to reconstruct `target: {fileID: X, guid: Y, type: 3}` modification entries.

## File Metadata

First line of the file is a header comment:
```
# ubridge v1 | prefab | guid:2982fa53447c5c643865bbd0d194eab1
```

Format: `# ubridge v1 | <type> | guid:<guid>`
- type: `prefab`, `variant`, `scene`
- guid: the Unity asset GUID (from .meta file, if available)

## Token Efficiency Notes

Tested on real Unity projects (142 prefabs across 2 projects, 1,045,195 total YAML lines):
- **Round-trip fidelity: 0 diff lines** (perfect byte-identical round-trip)
- Button.prefab: 9,488 → 698 bytes (92.6% reduction)
- _Card_Template.prefab: 25,643 → 873 bytes (96.6% reduction)
- Card_Explorer_Variant.prefab: 14,081 → 3,233 bytes (77.0% reduction)
- Ellen_Variant.prefab: 2,349 → 434 bytes (81.5% reduction)
- Most savings from: omitting boilerplate fields, structural dedup, compact value syntax
