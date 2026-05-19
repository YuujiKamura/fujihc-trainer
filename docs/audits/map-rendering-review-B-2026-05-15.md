# map-rendering review B (= pmtiles serving / インフラ / GitHub Pages 適合性 担当) 2026-05-15

reviewer A (= CSP / security) と並列、 reviewer B 重点は Range serving / 静的 deploy / dev server。

## 1. register (= 責務境界) — **LOAD-BEARING**

map source 構築は viewer-maplibre.js:184-202 (= static mode で `url: pmtiles://${BASE}/map.pmtiles`)、 Range fetch 実装は web/lib/vendor/pmtiles.js:1138-1199 (= `getBytes` で `headers.range='bytes=X-Y'` を fetch)、 server 側 Range 対応は 3 系統に分散 (= GitHub Pages / aiohttp `add_static` / `python -m http.server`)。 後者だけが Range 非対応で症状を引く、 責務は 1 箇所に集まっていない。 fix: README に dev server 推奨を明記 + 起動 helper 1 本に集約。

## 2. 語彙 — **MINOR**

「Byte Serving」「Range request」「Accept-Ranges」「Content-Range」「206 Partial Content」を pmtiles error 文言と整合させて README に置く。 現状 README に Range/Byte-Serving の語は 0、 user は error message から逆引きするしかない。

## 3. 抽象段差 — **BLOCK**

dev server の選択肢 (= `python -m http.server` / `python -m RangeHTTPServer` / aiohttp bridge / `npx serve` / GitHub Pages prod) が user の認知に並ぶが「Range 対応 / 非対応」属性が抽象段差で隠れている。 README:44 は `python -m http.server -d web/ 8000` を **prod と同じ動作**と誤読させる。 fix: README に「dev で pmtiles 触る時は bridge.py 経由 or RangeHTTPServer、 `python -m http.server` は Range 非対応で pmtiles map が灰色になる」を 1 行で明記。

## 4. test (= 物理 pin) — **LOAD-BEARING**

`tests/test_static_serve.py` は aiohttp の `add_static` を test しているが **Range request の test が無い** (= 206 / Content-Range の検証なし)。 ε-9 の `terrain_loader.js:151` は HEAD probe で「pmtiles 存在確認」だけ通すので、 Range 非対応 server でも probe は ok を返し **terrainReady=true** に到達、 UI 上「準備完了」になるが実際の map は描画されない (= 症状の発火経路)。 fix: terrain_loader に Range probe (= `Range: bytes=0-15` + `status===206` 確認) を 1 段追加するか、 test で `range` header 付き request に 206 を返すことを assert。

## 5. 設計境界 — **BLOCK**

GitHub Pages prod は Cloudflare 経由で HTTP byte serving 対応済 (= 静的 file は `Accept-Ranges: bytes` + Range 206)、 prod は問題なし。 問題は **dev だけ**。 ところが現 README は `python -m http.server` を dev 推奨にしていて、 user が「prod でも動かないのでは」と誤診する経路を残している。 fix 方向性 (= 候補から選択):
- **採用案 (= 最小)**: dev は **aiohttp bridge.py を使う**を default 化、 `python -m http.server` は README から削除 or「Range 必要ない `?test=1` 専用」と注記。 bridge.py は既に Range 対応 (= aiohttp FileResponse は Range 実装済)、 追加コストゼロ。
- 副案: `scripts/dev_server.py` を新規追加 (= `aiohttp.web.add_static` の薄 wrapper)、 `python scripts/dev_server.py 8000` で起動。 vendoring 追加ゼロ、 既存 dep のみ。
- 棄却案 C (= pmtiles を Range なし 4MB 一括 DL): pmtiles.js は Range 前提設計、 一括 DL に倒すには pmtiles 経由を廃止して PNG ツリーに置換しかなく、 既に commit 済の brief 31 を巻き戻す大改修。 pmtiles 3.9MB の一括 DL は帯域問題は小だが、 そもそも pmtiles.js が Range で動く前提なので fork 改造が要る。 採用しない。
- 棄却案 D (= RangeHTTPServer 同梱): pip dep 追加 + setup 増、 既存 aiohttp で十分なので冗長。

## 6. マイグレ可逆 — **MINOR**

dev server を bridge.py に集約しても production GitHub Pages 配信には一切影響しない (= pages.yml は `_site` upload のみ)、 完全に revert 可能。 README 改訂 1 段だけ。 ε-1〜ε-9 不変条件にも影響なし (= terrain_loader / pmtiles_loader は server 不問)。

## 7. security / ToS — **MINOR**

bridge.py は 127.0.0.1 bind 明示 (= ODbL 再配布事故防止、 README:79)、 dev 集約しても LAN 漏洩は起きない。 GitHub Pages prod は OSM タイル (= ODbL) を `_site/static/map.pmtiles` として再配布するが、 これは Protomaps 経由の派生 pmtiles で attribution が viewer 内に出る限り ODbL 範囲内 (= phase-design C-5 で監視済)。 Range 化で新規 ToS リスクは発生しない。

## 補足: ε-9 HEAD probe の独立性 — 確認済

`terrain_loader.js:151` の HEAD probe は Range 不要 (= `method: 'HEAD'`)、 python http.server も HEAD は 200 を返す。 したがって HEAD probe は dev でも prod でも通る、 ε-9 の物理 gate と本症状は独立。 ただし上記 (4) の通り **HEAD ok = map 描画 ok ではない**、 terrainReady=true を通っても map が灰色のままになる経路は残る、 terrain_loader に Range probe を 1 段足すのが最短 fix。

---

**集計**: BLOCK 2 (= 抽象段差 / 設計境界)、 LOAD-BEARING 2 (= register / test)、 MINOR 3。 推奨 fix: **dev 用 server を aiohttp bridge.py に集約 + README から `python -m http.server` を削除 (or `?test=1` 限定明記) + terrain_loader に Range probe 1 段追加**。 prod (= GitHub Pages) は Cloudflare で Range 対応済、 改修不要。
