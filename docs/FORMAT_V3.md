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

## Current implementation slice

The first checked-in slice supports local regular prefabs, including:

- GameObject hierarchies and sibling order
- Transform and RectTransform documents
- native components
- MonoBehaviours with an explicit script GUID identity
- complete JSON property values
- preservation of existing fileIDs
- deterministic canonical YAML output

Nested prefab ownership, variants, structure mutations, readable internal
reference rewriting, and versioned default profiles remain intentionally
unsupported. `writeV3` rejects nested/variant input rather than producing a
partial document.

## CLI

```bash
ubridge parse Input.prefab --format v3 -o Input.ubridge
ubridge compile Input.ubridge -o Rebuilt.prefab
```

`compile` deliberately has no `--yaml` argument.
