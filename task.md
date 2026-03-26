# Unity YAML Bridge — Phase 1: Research & Prototype

## Context
You are building a bidirectional parser between Unity YAML and an AI-friendly compact format.
Read AGENTS.md for the full design spec.

## Phase 1 Tasks

### 1. Get Sample Unity Project
- Clone a suitable open-source Unity project from GitHub that has:
  - Multiple prefabs (simple and complex)
  - Prefab variants (at least 2 levels)
  - Scenes with various GameObjects
  - UI prefabs (Canvas, buttons, text etc.)
  - Common patterns: nested hierarchies, component references, name collisions
- Good candidates: Unity's own sample projects, or community projects with rich prefab usage

### 2. Analyze Real Unity YAML
Examine the sample prefabs and document:
- Common field value types and their YAML representation:
  - Primitives (int, float, bool, string)
  - Vectors (Vector2, Vector3, Vector4, Quaternion)
  - Colors (Color, Color32)
  - Asset references (fileID + guid)
  - Component references (same-file fileID)
  - Arrays/Lists
  - Nested objects (AnimationCurve, Gradient, etc.)
  - Enums (serialized as int)
- Name collision patterns (same-name GameObjects)
- Prefab variant override structure (m_Modifications)
- How stripped/removed objects appear

### 3. Design the Compact Format
Based on real data analysis, design and document:

**Structure tree format:**
- Tree drawing characters (├─ └─ │)
- Component listing syntax: [Comp1, Comp2]
- Variant markers: * (modified), + (added), - (removed)

**Component details format:**
- Try multiple approaches on the SAME real prefab:
  a) INI-style: `[Path/To/GO:Component]\nkey = value`
  b) Indented YAML subset: minimal YAML without Unity noise
  c) Custom DSL: designed specifically for this use case
- Compare token counts (use tiktoken or cl100k_base estimation)
- Handle structured values (vectors, colors, refs) naturally
- Pick the winner or hybrid

**Name collision resolution:**
- Analyze actual collision frequency in sample project
- Test approaches: path, index suffix (#1, #2), short hash

### 4. Build the Parser (TypeScript)
- `npm init` with TypeScript setup
- Core modules:
  - `unity-yaml-parser.ts` — Parse Unity YAML into internal AST
  - `compact-writer.ts` — AST → compact format
  - `compact-reader.ts` — Compact format → AST
  - `unity-yaml-writer.ts` — AST → Unity YAML
- Handle the Unity YAML quirks:
  - `%YAML 1.1` / `%TAG !u! tag:unity3d.com,2011:`
  - Multiple documents in one file (--- separators)
  - Custom tags like `!u!114 &1234567`
  - Stripped objects in variants

### 5. Round-Trip Test
- Parse sample prefab → compact → back to YAML
- Diff original vs round-tripped YAML
- Document any information loss

### 6. Variant Test
- Parse a prefab variant
- Verify the 2-section output:
  - Structure with markers
  - Overrides only in details
- Test: modify an override in compact format → write back → Unity can open it

## Output
- Working TypeScript package in this directory
- `samples/` directory with example Unity YAML files and their compact representations
- `docs/FORMAT.md` documenting the final format spec
- Test results showing round-trip fidelity

## Important Notes
- The format should optimize for AI token efficiency above all
- Don't over-engineer — start simple, iterate based on real data
- If INI doesn't work for structured values, that's fine — find what does
- Name your compact format files `.ubridge` (Unity Bridge)
