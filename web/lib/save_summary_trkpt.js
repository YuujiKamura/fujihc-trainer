// b124: rider の現在 sensor 値から trkpt 1 点分の sensor field を null 正規化して組む pure 関数。
// viewer-maplibre.js から切り出した (node import 可能化、trainer_handler.js と同理由)。
//
// 注 (b124 impl-time の grep で判明した brief との差): brief b124 は本関数の使用先を
// viewer-maplibre.js の「save_summary 用 trkpt 記録」と記述したが、実体は runPreflight() に渡す
// trainer snapshot (= ride 開始前の接続チェック) だった。save_summary.js は trkpts 配列を集計する
// 別 module で、trkpt を 1 点ずつ整形する箇所は元コードに無い。よって本関数は「rider から
// null 正規化済の sensor snapshot を取り出す」共通ロジックとして preflight で使う。
//
// null 正規化 (brief の妥協 2): 未受信 (= rider 初期値 0) を null にして、preflight / 保存出力に
// 偽の 0W を出さない。ただし実 0W (= 信号待ち停止) も null になる ── 後続で「最後に sensor を
// 受けた時刻」を rider に足せば「未受信 0」と「実 0」を区別して旧挙動を再現できる。

/**
 * @param {{rider: object|null, t?: string}} arg rider と ISO 時刻文字列。
 * @returns {{t: (string|undefined), power: (number|null), cadence: (number|null), hr: (number|null)}}
 */
export function buildSaveSummaryTrkptPoint({ rider, t } = {}) {
  return {
    t,
    power: rider && Number.isFinite(rider.power) && rider.power > 0 ? rider.power : null,
    cadence: rider && Number.isFinite(rider.cadence) && rider.cadence > 0 ? rider.cadence : null,
    hr: rider && Number.isFinite(rider.hr) && rider.hr > 0 ? rider.hr : null,
  };
}
