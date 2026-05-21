// テストモード ⇄ 本番モード 切替ボタンの純ロジック。
//
// 設計:
// - viewer-maplibre.js は maplibre / three を要求する巨大 module で unit import 不可。
//   切替ボタンの「URL 引数を付け外しする」核は、 test 以外の引数 (consent / debug /
//   bridge 等) を保持できているかが load-bearing (= 落とすと開発者 bypass や python
//   bridge 経路指定が壊れる)。 これは grep テストでは検証できないため、 純関数として
//   独立させ web/tests/mode_toggle.test.js で実テストする。
// - DOM 配線・confirm・consent 正規化・reload は viewer-maplibre.js 側に置く。
//   本 module は DOM / location に触らない純関数のみ (= node test 可能を保つ)。

// 切替ボタンと現在モード表示の文言。 viewer と E2E の双方がここを唯一の正本 (SoT) とする。
//
// 用語 (= モードは 2 つだけ、 表に出す正式名は「観る」「走る」):
//   観る = トレーナー不要、 コースを眺める / デモ走行する。 走行記録は残さない。
//   走る = 実トレーナーに Web Bluetooth で繋いで走る。 走行記録が残る。
// 内部コードは歴史的経緯で別名 (= エイリアス) を持つ。 意図的なエイリアスとして以下に固定する:
//   観る ≡ TEST / test / ?test / view / mode-view
//   走る ≡ PROD / 本番 / ride / ble
// 定数名 (MODE_LABEL_TEST 等) は内部エイリアス側のまま、 表示値だけ「観る/走る」に統一する。
export const MODE_LABEL_TEST = '観るモード';
export const MODE_LABEL_PROD = '走るモード';
export const SWITCH_BTN_TO_PROD = '走るモードに切替';
export const SWITCH_BTN_TO_TEST = '観るモードに切替';

/**
 * 現在の location.search を受け、 enableTest に応じて `test` 引数だけを付け外しした
 * 新しい search 文字列を返す純関数。 `test` 以外の全引数 (consent / debug / bridge /
 * map / nosw 等) はそのまま保持する。
 *
 * @param {string} currentSearch  location.search (先頭 '?' あり / なしどちらも可)
 * @param {boolean} enableTest    true = test を付ける (テストモード) / false = 外す (本番モード)
 * @returns {string} 新しい search (先頭 '?' なし、 URLSearchParams.toString() 形式)
 */
export function buildToggledSearch(currentSearch, enableTest) {
  // URLSearchParams は先頭 '?' を自動で剥がすため location.search をそのまま渡せる。
  const params = new URLSearchParams(currentSearch || '');
  if (enableTest) params.set('test', '1');
  else params.delete('test');
  return params.toString();
}
