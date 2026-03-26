# ubridge Roundtrip Test Report

## Summary

Tested 20 random prefabs (UI, Entity, Enemy) with zero-edit roundtrip. **13 pass, 7 fail.**

- All Entity/Enemy prefabs (simple, no nested prefab instances): **100% pass**
- UI prefabs without nested prefab instances: **100% pass**
- UI prefabs with nested prefab instances: **5 issue patterns found**

Test prefabs are in `test-prefabs/` alongside this report.

## Environment

- unity-yaml-bridge: 1.0.0 (commit `a07d8d9`, 2026-03-26)
- Node.js: 24.2.0, macOS Darwin 25.3.0

## Reproduction

```bash
cd /tmp && rm -rf unity-yaml-bridge
git clone https://github.com/yulcat/unity-yaml-bridge.git
cd unity-yaml-bridge && npm install && npm run build && npm i -g .

# Roundtrip (zero edits) — run against prefabs in test-prefabs/
ubridge parse <file.prefab> --project <unity-project-root> -o /tmp/rt.ubridge
ubridge write /tmp/rt.ubridge --yaml <file.prefab> -o /tmp/rt.prefab
diff <file.prefab> /tmp/rt.prefab
```

---

## Test Results

| # | Prefab | Size | Nested Prefab Instances | Result |
|---|--------|------|:-:|--------|
| 1 | BTN_Spin.prefab | 14KB | 0 | **Pass** |
| 2 | SubTab.prefab | 20KB | 0 | **Pass** |
| 3 | PackageBadge01.prefab | 8KB | 0 | **Pass** |
| 4 | CookieGachaPortrait.prefab | 8KB | 0 | **Pass** |
| 5 | CookieListCellEdit.prefab | 9KB | 0 | **Pass** |
| 6 | CodexEffectDetailCell.prefab | 8KB | 0 | **Pass** |
| 7 | MissionPopup.prefab | 747KB | 0 | **Pass** |
| 8 | Buff_DOT_scorpion.prefab | 2KB | 0 | **Pass** |
| 9 | skill_c4021_s03_01_spawner.prefab | 3KB | 0 | **Pass** |
| 10 | skill_c0570_s00_01_spawner.prefab | 4KB | 0 | **Pass** |
| 11 | Enemy_m00001_chocoking.prefab | 5KB | 0 | **Pass** |
| 12 | Enemy_m30101_CubPirate.prefab | 5KB | 0 | **Pass** |
| 13 | Enemy_m10417-DreamingLibrarian.prefab | 5KB | 0 | **Pass** |
| 14 | MailCell.prefab | 63KB | 96 | **Fail** (12 diff lines) |
| 15 | SweetBlessingBenefitsCell.prefab | 18KB | 25 | **Fail** (13 diff lines) |
| 16 | TutorialChatBox.prefab | 47KB | 82 | **Fail** (3 diff lines) |
| 17 | OvenPage.prefab | 1.7MB | 548 | **Fail** (170 diff lines) |
| 18 | ArenaStart.prefab | 794KB | 296 | **Fail** (32 diff lines) |
| 19 | ContentsShopCell.prefab | 450KB | 124 | **Fail** (24 diff lines) |
| 20 | CookieDetailBottom.prefab | 376KB | 406 | **Fail** (22 diff lines) |

Fail한 프리팹 7개는 `test-prefabs/`에 포함되어 있음. Pass한 프리팹은 프로젝트 어디서든 nested PrefabInstance 없는 프리팹으로 재현 가능.

---

## Issue Patterns (all in prefabs with nested PrefabInstance)

### Issue 1: Color `r/g/b/a` → `x/y/z/w` key rename + block style (Data Corruption)

PrefabInstance m_Modifications 내 Color 값의 키가 `r/g/b/a`에서 `x/y/z/w`로 변경되고, flow style이 block style로 바뀜.

**Affected**: MailCell, SweetBlessingBenefitsCell, OvenPage, ContentsShopCell, CookieDetailBottom

### Issue 2: Asset reference `type: 2` → `type: 3` (Data Corruption)

`type: 2` (native Unity asset)가 `type: 3` (external asset)으로 변경됨. `parseReferenceValue`가 type을 `3`으로 기본값 처리.

**Affected**: TutorialChatBox, OvenPage, ArenaStart, ContentsShopCell, CookieDetailBottom

### Issue 3: `{fileID: 0}` null ref → empty (Data Corruption)

배열 내 `{fileID: 0}` null 참조가 빈 값으로 소실됨. 인라인 null ref도 동일.

**Affected**: OvenPage, ArenaStart, ContentsShopCell, CookieDetailBottom

### Issue 4: Transform override values changed (Data Corruption)

PrefabInstance의 transform 프로퍼티 오버라이드(`m_AnchorMin`, `m_AnchorMax`, `m_Pivot`, `m_LocalRotation`, `m_SizeDelta`, `m_AnchoredPosition`, `m_LocalScale`) 값이 다른 값으로 대체됨. compact의 transform 속성과 PrefabInstance의 m_Modifications가 잘못 머지되는 것으로 추정.

**Affected**: OvenPage, ContentsShopCell, CookieDetailBottom

### Issue 5: Multiline string truncation (Data Loss)

PrefabInstance modifications 내 한국어 멀티라인 문자열이 잘림.

**Affected**: SweetBlessingBenefitsCell, TutorialChatBox

---

## Issue Count by Prefab

| Prefab | Issue 1 (Color) | Issue 2 (type) | Issue 3 (null ref) | Issue 4 (transform) | Issue 5 (string) |
|--------|:-:|:-:|:-:|:-:|:-:|
| MailCell | **Yes** | - | - | - | - |
| SweetBlessingBenefitsCell | **Yes** | - | - | - | **Yes** |
| TutorialChatBox | - | **Yes** | - | - | **Yes** |
| OvenPage | **Yes** | **Yes** | **Yes** | **Yes** | - |
| ArenaStart | - | **Yes** | **Yes** | - | - |
| ContentsShopCell | **Yes** | **Yes** | **Yes** | **Yes** | - |
| CookieDetailBottom | **Yes** | **Yes** | **Yes** | **Yes** | - |

---

## Conclusion

- **Prefabs without nested PrefabInstance**: lossless roundtrip confirmed (13/13 pass)
- **Prefabs with nested PrefabInstance**: 5 distinct issue patterns, all related to PrefabInstance `m_Modifications` array handling
- Common root: PrefabInstance overrides are flat property-path/value pairs in Unity YAML, and ubridge's compact format doesn't fully preserve their semantics (Color key names, asset type field, null references, multiline strings, transform merge logic)
