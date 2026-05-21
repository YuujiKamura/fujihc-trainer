// b40 配布元見張り ── 国土地理院 / OpenStreetMap への実通信を物理的に止める共通 base test。
// 手動 config (e2e/playwright.pages-live.config.js) を除く全 spec は @playwright/test を
// 直 import せず、 本ファイルから test / expect を import する。
//
// 役割は「見張り」だけ。 偽タイルでの肩代わりはしない:
//  - 各 test の page で、 配布元 host への request を route で捕まえる。
//  - 捕まえた request は abort する (= 実サーバには 1 byte も出ない)。
//  - test 終了時、 捕まえた request が 1 件でもあれば、 その test を fail させる。
// 緑で隠さず、 配布元を叩こうとした事実を必ず赤で出す。
//
// 現状、 地形を読む viewer を冷起動する spec は配布元へ request するため、 この見張りで
// 赤になる ── それは正しい。「テスト時に viewer が地形を読まない」 形にする (b41) まで、
// これらの test は赤で居るべきで、 その間も実通信はゼロに保たれる。
//
// tile_load_budget / user_journey の系統2 spec は自前で page.route を張って GSI 通信を
// 制御する。 それらの route は本 fixture より後に register されるため Playwright の評価順
// (後 register 優先) でそちらが勝ち、 本見張りの route は fallback となって干渉しない。
import { test as base, expect } from '@playwright/test';

// brief b40 の「配布元」 定義: 国土地理院 と OpenStreetMap のタイル配布 host の 2 つ。
const DISTRIBUTOR_HOST_RE = /(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/;

export const test = base.extend({
  // auto fixture: 全 test で配布元 host への request を見張る。
  distributorAccessGate: [async ({ page }, use) => {
    const violations = [];
    await page.route(DISTRIBUTOR_HOST_RE, async (route) => {
      violations.push(`${route.request().method()} ${route.request().url()}`);
      await route.abort('blockedbyclient');  // 実サーバへ出さずに止める
    });
    await use(violations);
    // 配布元へ request が出ようとしていたら、 緑で隠さず test を赤にする。
    expect(
      violations,
      `配布元 (国土地理院 / OpenStreetMap) へ request が出ようとした (b40 見張り発火、 ${violations.length} 件)`,
    ).toEqual([]);
  }, { auto: true }],
});

export { expect };
