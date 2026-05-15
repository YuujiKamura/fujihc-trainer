// 2026-05-15 user 指示「ストラバ連携とかめんどくさいからフォールドしてていいと思うが」
// setup-overlay と postride-overlay の Strava 連携 UI は default 折りたたみ、
// 開けば見える形にする (= 機能は残す、 視覚負担を下げる)。
// 「過去 ride を見る」 と GPX 系は表に残す (= user の前回発話「ストラバなしでも GPX DL」 を尊重)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const html = readFileSync(INDEX_PATH, 'utf8');

describe('Strava 関連 UI を default 折りたたみ', () => {
  it('setup-overlay の Strava 連携 button (btnStravaConnect) が <details> 内に入っている', () => {
    // <details> ... <button id="btnStravaConnect"> ... </details> の構造を要求.
    // 「過去 ride を見る」 (btnViewHistoryFromSetup) は details の外に出ている事も同時に確認.
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const hasStravaConnectInDetails = detailsBlocks.some(
      (block) => /id="btnStravaConnect"/.test(block)
    );
    expect(hasStravaConnectInDetails).toBe(true);
  });

  it('setup-overlay の Strava の details は default で閉じている (= open 属性なし)', () => {
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const stravaDetails = detailsBlocks.find((b) => /id="btnStravaConnect"/.test(b));
    expect(stravaDetails).toBeTruthy();
    // <details open> ではない事 (= 閉じた状態で起動).
    expect(stravaDetails).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it('「過去 ride を見る」 (btnViewHistoryFromSetup) は details の外に出ている', () => {
    // details 内に btnViewHistoryFromSetup が含まれていない事を確認.
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const hidden = detailsBlocks.some((b) => /id="btnViewHistoryFromSetup"/.test(b));
    expect(hidden).toBe(false);
  });

  it('postride-overlay の Strava upload button (btnStravaUpload) が <details> 内に入っている', () => {
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const hasStravaUploadInDetails = detailsBlocks.some(
      (block) => /id="btnStravaUpload"/.test(block)
    );
    expect(hasStravaUploadInDetails).toBe(true);
  });

  it('postride の GPX download button (btnGpxDownload) は details の外に残っている', () => {
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const hidden = detailsBlocks.some((b) => /id="btnGpxDownload"/.test(b));
    expect(hidden).toBe(false);
  });

  it('postride の Strava details も default で閉じている', () => {
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const stravaDetails = detailsBlocks.find((b) => /id="btnStravaUpload"/.test(b));
    expect(stravaDetails).toBeTruthy();
    expect(stravaDetails).not.toMatch(/<details[^>]*\sopen[\s>]/);
  });

  it('summary 文言は「Strava」「連携」「アップロード」 等を含む (= 何が折りたたまれてるか user に分かる)', () => {
    const detailsBlocks = html.match(/<details[^>]*>[\s\S]*?<\/details>/g) || [];
    const stravaBlocks = detailsBlocks.filter((b) => /id="btnStrava/.test(b));
    expect(stravaBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of stravaBlocks) {
      const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      expect(summaryMatch).toBeTruthy();
      expect(summaryMatch[1]).toMatch(/Strava/);
    }
  });
});
