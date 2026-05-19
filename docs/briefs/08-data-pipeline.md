---
brief: 08-data-pipeline
title: ride データ蓄積 — 「過去と未来を繋ぐ」class への適合
---

# Brief 08: ride データの蓄積

## yuuji の goal「過去と未来を繋ぐ」class 適合

ride を 1 回走って終わりにせず、**過去 ride との比較** / **長期トレンド** / **Strava 連携** で AI サブスクの ROI を出す。

## 保存形式

### 1 ride 単位

- raw: `~/user-context-vault/rides/fujihc/<date>-<id>.csv`
- 1 row = (timestamp, distance_m, speed_kmh, power_w, hr_bpm, cadence_rpm, slope_pct, elevation_m, lat, lon)
- 1Hz 記録、24km 90 分 ride で約 5500 行、20-50KB

### ride summary (集計)

- `~/user-context-vault/rides/fujihc/summary.csv`
- 1 row = (date, time_total_s, time_segment_s[1..N], avg_power, max_hr, np, if, tss, weather)
- 過去比較がここで完結

## 過去比較機能 (MVP 後 Phase 2)

- 過去 ride の最速タイム/標高距離での速度を ghost rider として 3D 上に並走
- ride 中 HUD で「PR まで残り X 秒」表示
- 完走後 dashboard で趨勢 (week-over-week / month-over-month)

## Strava 連携 (Phase 2)

- 完走後 .fit ファイル生成 → Strava 手動 upload
- 自動 upload は OAuth 必要、ToS C2 class (本人データのみ)、後回し

## 過去未来 hook 整合性

- ride 蓄積で yuuji 自身の体調 / fitness のトレンドが見える (= strava-pmc-viewer と同 class)
- skill-miner DB / vault と独立、別 dir (rides/) で運用

## 残らない情報

- 動画録画 (= 容量爆発、現状不要)
- spatial audio (= scope オーバー)
