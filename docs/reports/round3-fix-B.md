# Round 3 fix B report

## 修正件数: 2 件 (= 3 ファイル中 2 ファイル touch, 1 ファイル no-op)

### 1. README.md — OSS clone した人向け section 追記 (= 末尾)

追記 section:
- `## OSS clone した人へ (= 第三者 ToS / 規約遵守)` (level 2 heading、 既存 style 準拠)
- データ source: OpenStreetMap (ODbL) と 国土地理院標高タイルの表記義務
- `tile.openstreetmap.org` 直叩き禁止 (= Tile Usage Policy)
- `scripts/fetch_gsi_dem.py --user-agent` で自分の連絡先を含む文字列に書き換える指示 (= default の YuujiKamura URL のままだとリポ作者を僭称)
- `data/*.sqlite` と PMTiles 元ファイルを repo に commit するな
- `bridge.py` の `127.0.0.1` bind が ODbL 再配布事故を物理層で止めている、 `0.0.0.0` 化禁止

### 2. pyproject.toml — dep に semver major upper bound 追加

```
"aiohttp>=3.9,<4",
"bleak>=0.22.0,<1",
"gpxpy>=1.6.0,<2",
"pmtiles>=3.0,<4",
"websockets>=12.0,<16",
```

### 3. package.json — 修正不要 (= no-op)

`vitest: "^1.0.0"` 既に caret prefix で major lock 済。 触らない。

## Regression check

`python -m pytest`: **104 passed, 4 skipped in 3.80s** (= baseline 維持)

## peer 干渉

- peer A (gpu_poll/measurement_diff/bridge bind): touch なし
- peer C (encoding/maxzoom): touch なし
- peer D (bridge integration test): touch なし

触った file は README.md / pyproject.toml のみ、 peer 領域ゼロ。

## 完了

DONE: round3 fix B (= 修正 2 件、 no-op 1 件、 regression なし)
