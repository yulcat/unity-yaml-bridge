# Unity YAML Bridge

## Goal
Bidirectional parser between Unity YAML (.prefab/.scene/.asset) and an AI-friendly compact format.

## Design Principles
1. **2-section format**: Structure tree + Component details
2. **Token efficiency**: Minimize tokens for AI context windows
3. **Lossless round-trip**: Parse to compact → edit → write back to valid Unity YAML
4. **Variant support**: base + delta pattern with markers (* modified, + added, - removed)

## Format Design (from discussion with owner)

### Structure Section
```
Canvas
├─ CanvasScaler, GraphicRaycaster
├─ Background [Image, Clickable]
│  └─ Graphic [Image*, Animator]
├─ Title [TextMeshProUGUI*]
└─ + Badge [Image]
```

### Component Details Section
- Use GO path for disambiguation (name collisions are common in Unity)
- Value format: explore options (INI, YAML subset, custom DSL) based on real data
- For variants: show overrides only, with `# base:` comments for context

### Name Collision Handling
- Needs investigation with real examples
- Options: path-based, index suffix, fileID abbreviation

## Constraints
- Node.js / TypeScript preferred (npm publishable)
- Must handle: Prefabs, Prefab Variants, Scenes
- Test with real Unity project examples from GitHub
