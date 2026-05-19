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
export const MODE_LABEL_TEST = 'テストモード';
export const MODE_LABEL_PROD = '本番モード';
export const SWITCH_BTN_TO_PROD = '本番モードに切替';
export const SWITCH_BTN_TO_TEST = 'テストモードに切替';

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
