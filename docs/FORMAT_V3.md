# `.ubridge` v3 standalone format (experimental)

v3 is a desired-state prefab document. Unlike v1/v2, compiling it does not
read or merge an original Unity YAML file.

```text
# ubridge v3 | prefab | profile:unity-generic-v1
--- STRUCTURE
Root @g1 [BoxCollider @c1]
└─ Child @g2
--- DETAILS
[g1 | Root]
m_IsActive = 1

[t1 | Root:Transform]
m_LocalPosition = {"x":0,"y":0,"z":0}
--- IDENTITY
g1 = gameObject | fileID:100 | type:1 | typeName:GameObject
t1 = transform | fileID:200 | type:4 | typeName:Transform | owner:g1
c1 = component | fileID:300 | type:65 | typeName:BoxCollider | owner:g1
g2 = gameObject | fileID:400 | type:1 | typeName:GameObject
t2 = transform | fileID:500 | type:4 | typeName:Transform | owner:g2
```

## Contract

- `STRUCTURE` is the authoritative hierarchy and component attachment list.
- `DETAILS` contains semantic serialized properties. Values use JSON syntax.
- `IDENTITY` binds stable machine identities to Unity type and fileID data.
- GameObject names and paths are display state, not identity.
- Structural Unity fields such as `m_Component`, `m_Children`, `m_Father`,
  `m_GameObject`, and `m_Name` are synthesized by the compiler.
- Unknown, ambiguous, or unsupported states must fail instead of falling back
  to an original YAML file.

A resolved inherited nested prefab in a source-backed variant is represented by
its source-root GameObject, not by its PrefabInstance document and not by an
extra same-name child level. The PrefabInstance machine identity is explicit
metadata on that GameObject line:

```text
└─ NestedRoot @ig3 {prefab:@ip1 source:0123456789abcdef0123456789abcdef} [BoxCollider @ic7]
```

Here `ig3` is a `gameObject` identity whose `sourceGuid`/`sourceFileID` identify
the nested prefab's source root. `ip1` is the separate `prefabInstance`
identity owned by the containing prefab source; `ig3`, its Transform, root
components, and descendants bind directly to it through `prefabOwner:ip1`.
The reader continues to accept the earlier experimental
`Name @ip1 {source:<guid>}` form for unresolved/current v3 files. The
source-backed variant writer emits the source-root form when the nested source
resolves.

## Current implementation slice

The current slices support regular prefabs, including:

- GameObject hierarchies and sibling order
- Transform and RectTransform documents
- native components
- MonoBehaviours with an explicit script GUID identity
- complete JSON property values
- preservation of existing fileIDs
- deterministic canonical YAML output
- stable internal references such as `{"$ref":"c4"}`
- local rename, reparent, reorder, subtree/component removal, and deterministic
  creation when new identity records omit `fileID`
- cold-roundtrip reconstruction of PrefabInstance, stripped, and other
  ownership documents without an original YAML file

An internal reference targets machine identity rather than a display path or
raw fileID:

```text
target = {"$ref":"c4"}
```

If `c4` is removed from desired STRUCTURE, compilation fails until the
reference is removed or redirected in the same edit.

Nested prefab effective-tree structural editing and versioned default profiles
remain intentionally unsupported. When a variant base prefab is available through
the source resolver, v3 exposes its inherited GameObject/component hierarchy and inherited
nested PrefabInstances in the effective STRUCTURE, applies existing name
overrides, records `origin:inherited` source identities, and cold-compiles the untouched
view without emitting source objects as local documents. Nested instances retain their
nested source GUID while their PrefabInstance identity is bound to the variant's direct
source GUID/fileID. When that nested source also resolves, this slice exposes
its source-root GameObject directly at the instance's visible hierarchy
position, with the inherited PrefabInstance identity linked as
`{prefab:@<id> source:<guid>}` metadata. This expansion recurses through
nested-in-nested sources: every resolved boundary exposes that source's root
GameObject with its own metadata, retains that boundary's source GUID/fileIDs,
and binds its root and internals directly through `prefabOwner` to the boundary
PrefabInstance. A nested PrefabInstance identity is in turn directly owned by
the containing boundary; the outermost inherited boundary is directly owned by
the leaf variant's emitted root PrefabInstance. This preserves an unambiguous
ownership chain without adding duplicate same-name source-root levels. Nested
source cycles and ambiguous direct-owner metadata fail closed. Expanded nested
source-root/internal GameObjects can now be renamed, and string/number DETAILS on
their GameObjects/components can be added as property overrides, at any resolved
nested depth. The compiler walks `prefabOwner` to the emitted leaf-variant
PrefabInstance, then upserts an `m_Modification.m_Modifications` entry whose
`target` reuses the edited identity's nested-source GUID/fileID, whose
`propertyPath` is `m_Name` or the DETAILS key, and whose string/number value is
stringified into `value`. It never emits the nested source GameObject/component or an
inherited PrefabInstance source document. Missing/cyclic owner chains and
ambiguous duplicate owner/source/property targets fail closed. Boolean, null,
object/array DETAILS and structural DETAILS fields remain unsupported. Reparenting,
reordering, removing, adding, or duplicating expanded internals still fails
closed; untouched cold compilation emits only the leaf variant's own
documents. Variant-of-variant sources are expanded through an unambiguous
source chain; intermediate name overrides and inherited GameObject/component
removals become effective state while emitted identities remain owned by the
variant's direct source. An untouched leaf cold-compiles only its own
PrefabInstance documents and does
not replay intermediate removal deltas. Intermediate removal targets must belong
uniquely to that intermediate variant's direct source; indirect, missing, or duplicate
ownership fails closed. Cycles, missing intermediate sources, and other ambiguous
ownership also fail closed. Structural edits to inherited nested PrefabInstances are
not yet supported and fail rather than compiling as no-ops. An inherited GameObject
removal is an explicit tombstone, for example
`└─ - LegacyButton @ig2 [Button @ic4]`; it compiles to `m_RemovedGameObjects`, while
removing an inherited component from the brackets compiles to `m_RemovedComponents`.
A new local child beneath an inherited node compiles to `m_AddedGameObjects` using
the inherited parent Transform identity. A local component listed on an inherited
GameObject compiles to a local component document, a direct-owner stripped
GameObject, and the root PrefabInstance's `m_AddedComponents`; new fileIDs are
deterministic, while exported existing additions preserve their component and
stripped-object fileIDs. Export and compilation fail closed when the target source
GameObject, direct PrefabInstance owner, or stripped-object ownership is missing or
ambiguous. Existing removed and added-component deltas are projected back into the
same effective representation. A direct source effective tree can also be mixed with
pre-existing variant-added GameObject roots: each local root is attached beneath its
inherited source Transform from `m_AddedGameObjects`, remains locally owned in
IDENTITY, and cold-compiles with its original local and stripped-parent fileIDs.
Missing, duplicate, indirect, or otherwise ambiguous added-root ownership fails
closed. Intermediate variants' added components and variant-added GameObject roots
are projected through source chains into the leaf effective tree. Their inherited
IDENTITY records bind to the leaf's direct source GUID and the intermediate local
fileIDs, while untouched leaf compilation emits only the leaf PrefabInstance and does
not replay intermediate addition deltas. Added-root parent stubs and added-component
targets must resolve to exactly one direct PrefabInstance owner; ambiguous, indirect,
missing, or duplicate ownership fails closed. Recursively expanded inherited nested
internals support the rename/string-or-number-DETAILS override slice above; their
reparent/reorder/add/remove/duplicate structural edits remain fail-closed. Without
a source resolver, nested and variant baseline ownership documents remain standalone,
and existing PrefabInstance delta values can be edited in DETAILS. Local objects not yet
exposed in the effective STRUCTURE are kept as explicit `owned` identity/details records
until ownership-aware reconciliation is implemented.

## CLI

```bash
ubridge parse Input.prefab --format v3 -o Input.ubridge
ubridge compile Input.ubridge -o Rebuilt.prefab
```

`compile` deliberately has no `--yaml` argument.
