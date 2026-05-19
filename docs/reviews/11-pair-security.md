# Brief 11 ペアリングフロー — セキュリティ軸レビュー

## はじめに

Brief 11 は scan / connect / disconnect コマンドを ws://localhost:8765 (= 既存の bridge.py) に追加し、browser viewer から実機トレーナーを操作可能にする提案。**機能的には合理だが、現在の bridge.py は WebSocket 接続元を一切検証していない**。viewer.js が出すコマンド (set_slope / scan / connect / disconnect) は、**同 PC 上のどんな web ページからでも、外部 native アプリからでも、同じ port に送ればそのまま実行される**。Phase 0/1 の set_slope のみであれば damage は「画面のトレーナー勾配が暴れる」程度で済んでいた。Phase 11 で **BLE 機器スキャン + ペア接続 + ペア解除を browser コマンドから許可する**と、damage class が「実機 BLE の制御権を悪意ある他プロセスに渡す」まで上がる。

結論を先に言う:

1. **問題の本質は port 公開ではなく「接続 origin 認証ゼロ」**。`websockets.serve(self._ws_handler, "localhost", ...)` は既に 127.0.0.1 bind になっているので、外部 LAN / WAN からは届かない。ここは OK、Brief 11 末尾の「0.0.0.0 ではなく 127.0.0.1 のみ listen」は **既に満たされている**。
2. **`localhost` bind だけでは「同 PC 上の悪意ある web page」を防げない**。これが Brief 11 の主リスク。ブラウザの Same-Origin Policy は **WebSocket には適用されない** (= CORS は HTTP fetch のみ、ws:// は cross-origin で自由に dial-out できる)。yuuji が訪れた他 tab の広告スクリプトが `new WebSocket('ws://localhost:8765')` を叩けば、bridge は viewer と区別せず受け入れる。
3. **対策は二段**: **(a) WebSocket handshake の `Origin` header を `http://localhost:8000` (= viewer 配信元) に whitelist**、**(b) bridge 起動時に乱数 token を発行 + viewer 配信時に embed + 全コマンドに含める**。(a) だけで CSRF 系の攻撃は **大半** 止まるが、ローカルに `Origin` 偽造可能な native アプリ (= curl, custom script) が居れば抜ける。(b) を併用すれば native アプリも token を知らない限り通らない。**Brief 11 の scope では (a) は必須、(b) は強く推奨**。
4. **trainer 自体の BLE pairing には認証が無い (FTMS 標準)** ── ペア済の trainer は誰でも GATT write 可能。bridge を抜かれた瞬間に trainer は「他人にコマンド送られる」状態。bridge 側を堅くするしか防げない。
5. **C2 data class (CLAUDE.md Rule 11) との関係**: trainer デバイス情報 (MAC アドレス / 機器名 / RSSI) は yuuji 本人の機器で第三者 ToS 制約は無いが、**MAC アドレスは家庭内の機器を identify する情報** (= 引っ越し前後で MAC fingerprint が漏れると追跡可能)、ログ / CSV / GitHub push に乗せると class B → C2 に upgrade する潜在性あり。Brief 11 の scope では ride CSV に MAC は出ていないので OK だが、scan_result を JSON ログに残す実装をすると class が変わる。

---

## 攻撃シナリオ ── 「localhost なら安全」が崩れるパターン 3 つ

### Shenario A. 悪意ある web page (= 一番現実的)

yuuji が ride 中に同 ブラウザの別 tab で広告埋め込みのある web page を開く。広告 JS が下記を実行:

```js
const ws = new WebSocket('ws://localhost:8765');
ws.onopen = () => ws.send(JSON.stringify({type: 'set_slope', slope_pct: -25}));
```

**今この瞬間に動く**。viewer は ride 中の slope を 1Hz で送っているが、攻撃 JS が間に挟まれば trainer は両方のコマンドを受ける (= 一番直近の `write_gatt_char` が勝つ)。Phase 11 後はさらに悪い:

```js
ws.send(JSON.stringify({type: 'disconnect'}));   // ride 中の接続を切る
ws.send(JSON.stringify({type: 'scan'}));         // 他の家電 / 健康機器を晒す
ws.send(JSON.stringify({type: 'connect', address: 'XX:..'}));  // 別 device に勝手に繋ぐ
```

**Same-Origin Policy が及ばないので、攻撃元 page の origin がなんであっても bridge は viewer の command と区別できない**。`Origin: http://example-adnet.com` でも `Origin: http://localhost:8000` でも、現コードは header を読まずに通す。

### Shenario B. 同 PC 上の他 native アプリ

malware / 信用してない CLI ツール / VS Code extension など、yuuji の userland で動く何かが port 8765 に接続できる。`Origin` header check を入れても、native client は header を任意に偽造できる (= curl で `--header "Origin: http://localhost:8000"`)。

**Shenario A より敷居が高い** (browser tab は誰でも開けるが native exec はそうでない) が、ゼロではない。

### Shenario C. browser extension

ユーザがインストールした拡張機能 (権限「全 page でスクリプト実行」) は viewer page 内から WebSocket を叩ける ── つまり実質 Origin 偽造なしで攻撃 A を実行できる。extension は通常「自分が installed page と同じ origin」を持つので、Origin check すり抜けあり。これは bridge 側では止められない (browser 側の責任)、token check で止める。

---

## 各防御策の OK / NG 判定

### Defense 1. `localhost` bind (現コード `websockets.serve(..., "localhost", port)`)

**OK だが不十分。**

- LAN / WAN からの接続は遮断、これは Brief 11 末尾「127.0.0.1 のみ listen」要件を**既に満たす**
- 同 PC 上の他プロセス (browser tab / native client / extension) は素通り、Shenario A/B/C 全部に効かない
- **これ単独を「セキュリティ対策」と呼ぶのは誤り**、port 公開範囲の確認に過ぎない

### Defense 2. WebSocket handshake の `Origin` header check

**必須。**

bridge.py の `_ws_handler` で `ws.request_headers.get('Origin')` を確認、`http://localhost:8000` 以外を拒否。`websockets` ライブラリは `process_request` callback で接続前に reject 可能:

```python
async def _check_origin(path, headers):
    origin = headers.get('Origin', '')
    if origin not in ('http://localhost:8000', 'http://127.0.0.1:8000'):
        return http.HTTPStatus.FORBIDDEN, [], b'origin not allowed\n'
    return None  # accept

async with websockets.serve(self._ws_handler, "localhost", self.port,
                            process_request=_check_origin):
```

- **Shenario A (悪意 web page) を止める**: ブラウザは Origin を上書き不可、攻撃元 tab の origin がそのまま乗る、reject される
- **Shenario B (native client) は止まらない**: header 偽造可能
- **Shenario C (browser extension) は要 case 確認**: extension が viewer page 内で動けば Origin は viewer のものになる、すり抜け
- 実装コスト: 10 行未満、既存 protocol 変更なし、副作用ゼロ

### Defense 3. 起動 token を viewer に embed + 全コマンドに必須化

**Defense 2 と併用で強く推奨、Brief 11 scope なら可能なら実装。**

bridge 起動時に `secrets.token_urlsafe(32)` で乱数生成 → web/ 配信時 (= `python -m http.server 8000` ではなく bridge.py 側から HTML を返すか、token を別 file に書いて viewer が読む) に viewer.js に渡す → viewer は全 WebSocket コマンドに `token` フィールドを付加 → bridge は token 不一致を reject。

実装の中で trade-off:

**path A: bridge が HTTP も serve する** (= 8765 で WebSocket + 8766 で HTML/JS、token を HTML に埋めて返す)。port 数増えるが token は HTML response 内に閉じる、viewer.js は side effect で token を持つ。シンプル。
**path B: bridge が `~/.fujihc/token` file に書く + viewer.js が `fetch('/token')` で取得**。`python -m http.server 8000` を捨てるか、bridge と並走させる調整必要。
**path C: 認証 endpoint** (`POST /auth` で session token 返す) ── overkill、scope 外。

**path A が一番素直**、Brief 11 の `python -m fujihc.bridge` 1 コマンド起動の design 思想と整合。

- **Shenario A/B/C 全部止まる**: token を知らない接続元は全部 reject
- 実装コスト: 30-50 行、`python -m http.server 8000` を捨てる場合 viewer 配信もここに統合
- 副作用: 既存の「`python -m http.server 8000` で配信」フローが変わる、ドキュメント更新必要

### Defense 4. command-level rate limit

scan は 1 秒に 1 回まで、connect は 5 秒に 1 回まで、等。**任意。**

- Shenario A の slope 高速書換による「trainer 暴走」は緩和される
- 認証突破された後の damage 抑制策、認証の代わりにはならない
- Brief 11 では Phase 2 で十分

### Defense 5. trainer 側 BLE pairing 認証

**bridge では制御不可、FTMS 標準が認証を要求していない**。

- 一度 ペア成立した trainer は MAC アドレスを知る誰でも GATT 操作可能 (= Zwift も TrainerRoad も bridge.py も区別なし)
- bridge を堅くしても、別 PC が同 trainer に接続しに来れば trainer 側は受け入れる
- Brief 11 scope 外、機器仕様の問題

---

## CLAUDE.md Rule との照合

### Rule 10 (API call destination): 該当なし

trainer は外部 API ではない、yuuji の機器に対する BLE 接続。pre-call gate は trivially 通る (provider=自分、destination=自分、ToS 制約なし)。

### Rule 11 (data class): C2 への upgrade 注意

現状の Brief 11 scope:

- **scan_result**: device address (MAC) + name + RSSI → **class B** (yuuji 本人の機器情報、第三者制約なし、ただし MAC は識別子)
- **ride state**: speed / power / cadence / distance → **class A** (自分の運動データ、CSV ローカル保存)
- **slope command**: viewer → bridge への数値 → **class A**

**potential upgrade vector**:
- scan_result の MAC を ride CSV / GitHub push 対象 log に書き込むと、識別子としての MAC が公開され class C2 寄りになる。Brief 11 scope では CSV column に MAC は出ないので OK
- 将来 trainer pairing 履歴を `~/.fujihc/pairings.json` に保存する場合、その file を `.gitignore` 必須
- bridge.py の log output (`log.info("connected to %s", addr)`) は stderr 出力のみで GitHub 押し対象ではない、OK

### Rule 9 (物理層 gate): 該当なし

fujihc-trainer repo は sensitive data class を抱えていない (= places-map / strava-collector とは別)、pre-push hook 追加は不要。Brief 11 で sensitive data を抱える設計変更があれば再評価。

### Rule 3 (per-action 認可) との関係

Brief 11 は実装提案であって push / PR 提案ではない、Rule 3 直接該当なし。**ただし bridge.py に security 関連変更を加えた後の push** は Rule 1 (test 先) + Rule 3 (per-action 認可) 両方の対象。

---

## 推奨実装順序

1. **Defense 2 (Origin header check)** を bridge.py の `process_request` callback で実装、Brief 11 の Phase 0 (= scan/connect protocol 拡張の前) に landing
2. **Defense 4 (rate limit)** は scan/connect コマンドに対し最低限実装 (scan は 5 秒 cooldown、connect は 3 秒 cooldown) ── 認証ではなく UX 暴走防止
3. **Defense 3 (token auth)** は Phase 11 の本体実装と同時、`python -m http.server 8000` を bridge.py 統合配信に置き換え。これを landing しない場合、Brief 11 完成基準に「**他 tab で悪意ある page 開いていないこと**」を user 自衛責任として書く ── これは AI 設計として推奨しない
4. **Defense 5 (BLE pairing)** は scope 外、ただし Phase 11 ドキュメント末尾に「FTMS 機器は GATT write に認証を要求しない、bridge を信頼境界として運用」と注記

## まとめ

Brief 11 の最重要セキュリティ問題は **「localhost bind だけで安全と誤認する」こと**。WebSocket は Same-Origin Policy 対象外、同 PC 上の他 process (= ブラウザ別 tab / native client / extension) は全部素通り。

**最低限の対策は Origin header の whitelist check (Defense 2)**、これは 10 行未満で Brief 11 の Phase 0 に landing 可能、副作用ゼロ。これで Shenario A (= 攻撃ベクトルの 8 割を占める「悪意 web page」) は止まる。

**Defense 3 (token auth) を併用すれば Shenario B/C も止まる**、Brief 11 Phase 11 本体実装と同時 landing を推奨。これを実装しない選択肢は **「ride 中に変な page 開かない」を yuuji の運用責任とする**ことを意味する、AI 設計としては勧めない。

Brief 11 末尾の「localhost binding (= 0.0.0.0 でなく 127.0.0.1) で十分か?」への回答は **NO、十分ではない**。localhost bind は既に達成済 (現 bridge.py コードがそうなっている)、Brief 11 で追加する必要があるのは **Origin check (必須) + token auth (強く推奨)**。

C2 data class への upgrade は現 scope では発生しないが、scan_result の MAC を log / CSV に永続化する実装に進む場合は class 再評価必須 (CLAUDE.md Rule 11)。

DONE: 11-pair-security
