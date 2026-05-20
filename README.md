# fujihill-trainer

富士ヒルクライム (= Mt. Fuji HC) コースを室内 trainer (FTMS) で再現する練習補助 app。

## 初回セットアップ

### コースデータ (= web/course.json)

GPX (例えば公式 [fujihc.jp/course](https://fujihc.jp/course/) で公開されているもの) を `src/fujihill/course.py` で変換した派生 JSON。 距離 / 標高 / 勾配 / lat / lon の列で、 元 GPX とは別物。 自分の GPX を使いたい場合は:

```sh
python -m fujihill.course ~/path/to/your.gpx > web/course.json
```

- 富士ヒル以外のコースでも動作する、 minimap bbox は `tile_constants.MINIMAP_BBOX` を要書換

### タイル DB セットアップ

タイル DB (= 国土地理院 DEM + OSM 地名 PMTiles) をローカルに用意する:

```sh
python scripts/init_tile_db.py
# → data/tiles.sqlite (空 schema_v1) を作成
```

その後、 個別 fetch スクリプト (brief 15 / 16 で landing 予定) で実データを投入:

```sh
python scripts/fetch_gsi_dem.py    # GSI DEM タイル (= zoom 17, 約 36 秒)
python scripts/fetch_osm_pmtiles.py # OSM 地名抽出 (= 数秒)
```

- **想定 DB サイズ**: 約 16 MB (= zoom 17 単一化、 富士ヒル course ±1km buffer / corridor=3)
- **DL 時間**: 約 36 秒 (GSI DEM) + 数秒 (OSM PMTiles 抽出)
- DB は `.gitignore` 済 (= `data/*.sqlite`)、 リポには含めない

## 画面操作確認 (= trainer / bridge 不要、 brief 22)

viewer の操作系 (= camera / wheel zoom / pitch drag / ride 進行 button) を
trainer や bridge.py を起動せずに確認できる. fake state が 1Hz で流れて
ride_start ボタンで pairing → riding 遷移、 button 全部押せる。

**dev server 選択 (brief 34 ε-10)**: pmtiles を経由した地図描画 (= 観るモード /
走るモードの map 表示) は **HTTP Range request (Byte Serving)** が必須。
`python -m http.server` は Range 非対応のため、 `?test=1` の純粋な UI 操作確認以外
(= 観るモード / 地図描画を含む動作) では使えない (= pmtiles が「Server returned no
content-length header」error で読めず、 地図が灰色のまま)。

```sh
# (A) 観るモード / 走るモード を含む fully functional な local 確認 (= 推奨)
#     aiohttp 経由で Range request 対応、 地図描画 (pmtiles) が動く。
python -m fujihill.bridge --dummy
# その後 browser で http://localhost:8000/?test=1 (= ?test=1 で fake state、 trainer 不要)

# (B) UI 操作のみの軽量確認 (= 地図描画は機能しない、 limited)
#     Range request 非対応、 tile が 404 で灰色背景になり pmtiles map も読めない。
#     `index.html` / script の 200 配信を見るだけの用途に限定。
python -m http.server -d web/ 8000
```

- (A) は tile + WebSocket + dummy ride loop が全部走る、 GPU 負荷 / FPS / 温度 実測も可
- (B) は `python -m http.server` 由来の Range 非対応で pmtiles map が描画できない、 観るモード遷移しても地図が空白
- GitHub Pages 本番は Cloudflare 経由で `Accept-Ranges: bytes` 対応済、 prod では (A)/(B) の差異は問題にならない

## テスト

```sh
python -m pytest
```

## OSS clone した人へ (= 第三者 ToS / 規約遵守)

このアプリは地図タイルとして以下のデータ source を使う:

- **OpenStreetMap (ODbL ライセンス)**: 表示時 `© OpenStreetMap contributors (ODbL)` の表記義務。 Protomaps が再配布する PMTiles ファイル経由のみで取得、 `tile.openstreetmap.org` (= OSMF 公式 tile server) は **絶対に直接叩くな** (Tile Usage Policy 違反、 brief 13/17b 参照)
- **国土地理院標高タイル**: 表示時「国土地理院 標高タイル」の出典明示義務、 大量アクセス自粛 (= `scripts/fetch_gsi_dem.py` は 1 req/s で 36 タイルだけ取得する設計)

### 考え方 (= 規約の文字より上位)

国土地理院は国民の税金で運営される公的機関、 OSM は寄付ベースの市民プロジェクト。 どちらも「全員のため」 と引き受けて無償公開してくれている。 規約の文字を逐語的に守るだけでなく、 **配布元の立場で「やってほしくないこと」 を想像する** ことを設計の軸にする。 具体的には:

- 一度取ったタイルは手元 `data/tiles.sqlite` に永久保存して、 配布元には二度と取りに行かない (= 「キャッシュは活かす、 再配布はしない」 の本意)
- テスト自動化で実 endpoint を毎日 / push 毎に叩かない、 contract verify は手動 trigger だけにする
- `--user-agent` には自分の連絡先 (= email) を必ず入れる、 default の URL のままにしない (= 他人を僭称する form を避ける)
- bbox / zoom を増やす変更は配布元負荷を直に増やすので、 必要性を 1 度問うてから書く

AI エージェント向けの詳細指針は `CLAUDE.md` § 考え方 を参照 (= 過去 AI が踏んだ anti-example も記録)。

### scripts/fetch_gsi_dem.py を走らせる前に

`--user-agent` 引数で **自分の連絡先を含む文字列**に書き換えろ:
```bash
python scripts/fetch_gsi_dem.py --user-agent "fujihill-trainer/0.1 (your-email@example.com)"
```

地理院側で heavy user 同定に email が使われる、 default の `(https://github.com/YuujiKamura/fujihc-trainer)` のままだと他人 (= リポ作者) の連絡先を僭称することになる。

### 公開リポに DB ファイルを commit するな

`data/*.sqlite` は `.gitignore` で除外済、 PMTiles 元ファイルもリポ外配置 (= `~/Downloads/japan.pmtiles` 等) が前提。 数百 MB ~ 数 GB の binary をリポに含めるな。

### bind は 127.0.0.1 限定

`bridge.py` は HTTP server (port 8000) も WebSocket server (port 8765) も `127.0.0.1` bind 明示、 LAN 内の他端末からアクセス不可。 これは ODbL タイルを LAN 内に再配布する事故を物理的に止めるため、 `0.0.0.0` への変更は禁止。

## Strava 連携 (brief 33)

ride 終了画面から (a) GPX を browser download、 (b) Strava に直送 (= OAuth PKCE)、 (c) IndexedDB に履歴保存 の 3 分岐が browser だけで完結する。

### Strava app の用意

repo に固定 client_id は埋め込まない (= 各 user の activity が混線しないため)。 各自で自分の Strava app を作って setup する:

1. [Strava API Settings](https://www.strava.com/settings/api) で My API Application を作成
2. Authorization Callback Domain に GitHub Pages の host (例: `<your>.github.io`) を登録
3. browser dev console で `localStorage.setItem('fujihill.strava.client_id', '<your_client_id>')` を実行

### 連携解除

setup-overlay 内の「連携を解除」 button で localStorage の token を削除可能。 ただし**これだけでは Strava 側に app 登録が残ったまま**になる、 完全に断つには [Strava 設定 → 連携アプリ](https://www.strava.com/settings/apps) から fujihill-trainer を revoke すること。

### ToS 適合性 (= Rule 11 class C2)

本実装は Strava API Agreement §5.1 「本人 OAuth で取得した自分のデータを本人 UI で扱う」例外の範囲内:

- upload は user 自身の Strava アカウントへの self-publish (= 第三者再配布ではない)
- IndexedDB の trkpts 保存先は user の browser local のみ (= cloud sync / server upload なし)
- 履歴 UI は本人 UI 内の本人 ride 一覧のみ (= §2.10 publicly viewable 制約から外)

公開リポに ride 実データを commit しない (= `data/`, IndexedDB は repo 外)、 第三者の Strava activity を扱わない。

### XSS 防御 / token 漏洩境界

`access_token` / `refresh_token` は `localStorage` 保存、 XSS で読み取られると本人の Strava への任意 upload (= scope=`activity:write`) が可能になる。 防御は (a) `index.html` / `oauth-callback.html` の CSP `script-src 'self'`、 (b) 外部 CDN / analytics / font CDN 一切なし (= `web/lib/vendor/` 配下に self-host)、 (c) inline `<script>` を avoid (= oauth-callback の token 交換は `web/lib/oauth_callback_main.js` に externalize) の 3 重 gate。 完了条件として grep gate (`web/tests/brief33_grep_gate.test.js`) で CI 上 pin。
