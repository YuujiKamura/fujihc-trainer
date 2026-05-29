# Brief 21 audit (= 地形メッシュ補完、 single-axis 1 体担当)

target: `briefs/21-terrain-mesh-interpolation.md` (= draft、 未実装)
catalog: `audit-drift-catalog.md` Round 1 を LOAD-BEARING 参照

## 総括 (= 3 段落)

Brief 21 は bookend (はじめに / まとめ) 完備、 scope 境界 (やらないこと) も明示、 既存 `web/lib/terrarium.js` の pure module + test pattern を踏襲する設計判断は drift catalog の NG-R1-9 (export 無し unit test 不能) を正しく回避している。 「inline 実装 + pure module で test」の二重実装宣言 (line 85) は writer 自身が trade-off を articulate しており、 ES modules 化保留の brief 17b 判断との整合も明示済み (line 80-81)。 register 軸はほぼ Clear、 catalog 再演リスクは register/構造軸では検出されない。

ただし **数値見積もり (line 87-94) に LOAD-BEARING な不整合**がある。 brief 内に「200 タイル × 4 MB = 800 MB の VRAM 圧迫、 ただし実際は viewport 内のみ常駐で 9 タイル × 4 MB = 36 MB」と書かれているが、 (a) MapLibre の `maxTileCacheSize` default は 50-200 range で provider 依存、 「200 タイル」の根拠が brief 内不在 (= NG-R1-1 再演)、 (b) 4 MB は 1024² × RGBA 8bit = 4 MiB の raw 値だが、 MapLibre は内部で texture を保持する場合があり倍率不明、 (c) **800 MB と 36 MB のどちらが「実際の VRAM pressure」か brief 自体が決め切れていない** ── 「ただし」の語で逃げているが、 implementer は MapLibre cache config を触らず 800 MB 側に振れた時の OOM を踏む。

テスト網羅軸では 6-8 件提示の中に「**factor=2 / 非正方形 / src=1×1 縮退**」の境界値が欠落、 「無効ピクセル GSI R=128 → 0m として補間に参加」を test 1 件で確定させると brief 罠 (line 126) の「skip するか有効として使うか」の判断が test で pin される (= silent decision にしない)、 これは追加すべき。 設計境界軸の「inline 実装 + pure module の二重実装」は、 viewer 側 inline と lib 側 export が **logic divergence** した時に test で守れない構造的弱点を持つ ── catalog NG-R1-11 (Cesium / MapLibre 双子コピペ) と同型の drift を新規に作る危険があり、 viewer 側を pure module 呼出に統一する選択肢を redraft で再評価すべき。

## 7 軸 verdict table

| 軸 | verdict | severity | 一行 |
|---|---|---|---|
| 1. register/構造 | PASS | low | bookend / scope / depends_on / blocks 完備、 「次の atom」明示で reader 自走可能 |
| 2. 語彙 | PASS | low | bilinear / bicubic / upsample / terrarium / GSI の qualifier 明示、 NG-R1-3 再演なし |
| 3. 抽象段差 | PARTIAL | medium | 「なぜ 4x」「なぜ bilinear」の中段根拠は line 33-38 に articulate 済、 ただし「なぜ 200 タイル」の中段が VRAM 計算で抜けている (= NG-R1-1 再演リスク) |
| 4. テスト網羅 | PARTIAL | medium | 6-8 件は happy / size / alpha / 無効値を覆うが境界値 (factor=2, src=1×1, 非正方形) 不在、 cross-language 不要 (= JS only で完結) |
| 5. 設計境界 | REDRAFT | **high** | viewer inline + lib pure module の二重実装は NG-R1-11 (双子コピペ) と同型 drift、 viewer 側を `gsiToTerrariumUpsampled` 呼出に統一すべき |
| 6. マイグレ可逆 | PARTIAL | medium | 4x → 8x / bicubic 切替は factor 引数で済む設計 (= 可逆性 OK)、 ただし viewport pressure 800 MB が実用域か brief 自身が決め切れていない (line 92 「ただし」で逃げ) |
| 7. セキュリティ | PASS | low | 外部 fetch ゼロ維持、 GSI は既存 `addProtocol` 経由のローカル DB tile、 PII / 第三者データなし、 NG-R1-15/16 再演なし |

## 主要 NG (= main session が即時 fix できる、 優先順)

1. **(設計境界、 high)** line 83-85 の「inline 実装 + pure module の二重実装」を撤回、 viewer-map3d.js の `addProtocol('gsidem', ...)` callback 内は `gsiToTerrariumUpsampled(src.data, W, H, 4)` の **1 行呼出に統一**、 logic は lib 側のみに置く。 既存 `web/lib/terrarium.js` が同じ pattern (viewer から呼ぶだけ) なので踏襲。 二重実装は test では守れない drift を新規に生む (NG-R1-11 同型)。

2. **(抽象段差 + マイグレ可逆、 medium)** 「数値見積もり」section line 92 の「200 タイル × 4 MB = 800 MB」の **200 の根拠を明示**するか、 MapLibre `maxTileCacheSize` を brief 21 で 50 に **explicit に設定**して 200 MB 上限を保証しろ。 「ただし viewport 9 タイル」での 36 MB は瞬間値であって cache 保持タイル数とは別概念、 brief 内で混同している。

3. **(テスト網羅、 medium)** 完了条件 (line 108-115) に下記境界値を追加:
   - `bilinearUpsample` factor=2 で 2×2 → 4×4 の中央が補間値 (= factor=4 だけでなく)
   - `bilinearUpsample` 非正方形 src (= 2×3) で出力サイズ正しい
   - `gsiToTerrariumUpsampled` 富士山頂周辺の R=128 (無効) を含む 2×2 → 4×4 で 0m として参加することを assert (= line 126 罠の判断を test で pin)

4. **(register、 low)** line 138 「次の atom: brief 22 ... or brief 19 ..., user 判断」は bookend 流儀として OK だが、 brief 21 の「ship される」「ship されない」を line 135-136 で言い切った後で「user 判断」を残すと reader が「で、 結局?」になる。 user 判断は frontmatter `blocks: []` で済んでいるので削るか「brief 21 完了後の方向は別 turn」と短く書く。

5. **(マイグレ可逆、 low)** 「ハマる罠」line 128 「zoom 23 ではどうせ overzoom で再粗化」は **brief 21 の価値否定**に読める。 「補間効果は zoom 17-20 で最大、 zoom 23 では MapLibre 再 sample で効果限定」と書き分けて、 brief 21 が ride 視点全 zoom レンジで効くわけではないことを完了条件側でも明示しろ (= 「目視確認は user 必須」と整合)。

## 総合判定

**REDRAFT** (= 1 round 目、 設計境界の二重実装が high severity、 NG 候補 1-3 を main session が即時 fix で CONVERGED 見込み)

NG 1 (= viewer inline + lib 二重実装の統一) が landing しないと、 catalog Round 2 で NG-R1-11 同型の新規 drift として登録される。 他 4 件は medium/low、 fix 容易。

DONE: brief 21 audit / REDRAFT
