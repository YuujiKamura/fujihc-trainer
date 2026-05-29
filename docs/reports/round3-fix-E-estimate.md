# Round 3 Fix E: estimateTileCount JS 移植

## DONE: estimate tile count js

## 変更 file

- `web/lib/tile_coverage.js` — `estimateTileCount` を追加 export
- `web/tests/tile_coverage.test.js` — 5 test 追加 (= 4 unit + 1 cross-language fixture pin)

## 実装

Python 側 `src/fujihc/tile_coverage.py:estimate_tile_count(course, zoom_levels, corridor_tiles=3)` と
同 signature / 同 logic。 戻り型は `Array<[zoom, count]>` (= Python の list of (zoom, count) tuple と等価)。

```js
export function estimateTileCount(course, zoomLevels, corridorTiles = 3) {
  const zooms = Array.from(zoomLevels);
  return zooms.map(z => {
    const tiles = enumerateCoverageTiles(course, [z], corridorTiles);
    return [z, tiles.size];
  });
}
```

zoomLevels は iterable を受けるため `Array.from` で list 化 (Python 版が `zoom_levels` を
2 回走査するための `list(zoom_levels)` と同方針)。

## 追加 test (5 件)

1. **happy [14,15,16,17,18] corridor=3**: `[[14,36],[15,70],[16,148],[17,300],[18,631]]` — brief 14 数値表と一致
2. **単 zoom [17] corridor=3**: `[[17, 300]]`
3. **corridor=1 vs corridor=3**: 107 vs 300、 corridor=3 が多い、 corridor=1 は 107 (brief pin)
4. **空 zoomLevels**: `[]`
5. **cross-language fixture pin**: `py_coverage_z14.json` の `tiles_z17_corridor3.count` (=300) と
   `tiles_z17_corridor1.count` (=107) に JS 出力が一致

## 検証

`npm test` 実行結果:

```
 Test Files  4 passed (4)
      Tests  32 passed (32)
```

- 既存 27 件 → 32 件 (+5 件、 全 pass)
- `tile_coverage.test.js`: 7 → 12 件 (+5)
- pytest は無変更 (Python 側 file 未編集)

## peer との衝突

- 触った file: `web/lib/tile_coverage.js`, `web/tests/tile_coverage.test.js` のみ
- peer A (viewer-map3d.js) / peer C (init_tile_db.py) と file 衝突なし

## 完了条件チェック

- [x] `web/lib/tile_coverage.js` に `estimateTileCount` export
- [x] `web/tests/tile_coverage.test.js` に 4 件以上追加 (= 5 件追加)
- [x] `npm test` 全 green (32/32)
- [x] cross-language fixture pin 追加 (= Python と JS が同 input → 同 count)
- [x] pytest regression なし (Python file 触らず)
- [ ] commit (= main session 一括、 本 subagent は commit しない)
