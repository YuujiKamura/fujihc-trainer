// b36 配布元境界規律 ── 物理 gate の vitest 二重走査 layer。
// pre-commit hook (= .git/hooks/pre-commit) が install されない経路 (= CI runner / fresh fork /
// --no-verify) を catch する 2 重層 gate、 b33 既存 audit.yml 二重走査 pattern を踏襲。
//
// 詳細: ~/.agents/scratch/fujihc-trainer-project/b36-tile-distributor-courtesy.md
// 各 test の break ↔ 落ちる 真正性確認は test 関数内コメント `// BREAK-VERIFY: ...` に記録。

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function readRepoFile(relPath) {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
}

// yaml mapping 形式のみ accept、 list / inline list を throw で明示 reject する regex strategy。
// 詳細根拠は brief b36 § 直すこと 3。 worker は別実装に逸れるな。
function extractOnBlockSubKeys(yaml) {
  // BREAK-VERIFY: on: を `on: [push]` に書き換え → throw `inline list style not allowed`
  // BREAK-VERIFY: on: を `on:\n  - push\n` に書き換え → throw `sequence list style not allowed`
  // BREAK-VERIFY: on: 配下に `push:` を追加 → Set 等価 fail
  const onMatch = yaml.match(/^on:\s*(\[[^\]]*\])?\s*\n((?:[ \t]+.*\n?)*)/m);
  if (!onMatch) throw new Error('on: block not found');
  if (onMatch[1]) throw new Error('inline list style not allowed, use mapping form');
  const block = onMatch[2];
  // 2-space indent の `- ` のみ catch (= `on:` 直下 sequence)、 4-space indent 以上の nested
  // sequence (= `schedule:` 配下の `    - cron:` 等) は許容する。
  if (/^  -\s/m.test(block)) throw new Error('sequence list style not allowed, use mapping form');
  const keys = new Set();
  for (const line of block.split('\n')) {
    const km = line.match(/^  ([a-z_]+):/);
    if (km) keys.add(km[1]);
  }
  return keys;
}

describe('b36 配布元境界規律: L3 workflow yaml gate', () => {
  it('pages.yml は `pages_live` 文字列を含まない (= Pages live test を CI 自動経路に混入させない)', () => {
    // BREAK-VERIFY: pages.yml に `pages_live` 文字列を 1 行追加すると本 test が落ちる
    const yaml = readRepoFile('.github/workflows/pages.yml');
    expect(yaml).not.toMatch(/pages_live/);
  });

  it('pages-live-verify.yml の `on:` direct sub-keys が {workflow_dispatch} 完全一致 (= positive whitelist)', () => {
    // BREAK-VERIFY: pages-live-verify.yml の `on:` 配下に `push:` を追加すると Set 等価 fail
    // BREAK-VERIFY: `on: [workflow_dispatch]` に書き換えると throw `inline list style`
    // BREAK-VERIFY: `on:\n  - workflow_dispatch` に書き換えると throw `sequence list style`
    const yaml = readRepoFile('.github/workflows/pages-live-verify.yml');
    expect(extractOnBlockSubKeys(yaml)).toEqual(new Set(['workflow_dispatch']));
  });

  it('monthly-watch-reminder.yml の `on:` direct sub-keys が {schedule, workflow_dispatch} 完全一致', () => {
    // BREAK-VERIFY: monthly-watch-reminder.yml の `on:` 配下に `push:` を追加すると Set 等価 fail
    const yaml = readRepoFile('.github/workflows/monthly-watch-reminder.yml');
    expect(extractOnBlockSubKeys(yaml)).toEqual(new Set(['schedule', 'workflow_dispatch']));
  });

  it('pages-live-verify.yml の inputs に user_agent_email + reason が両 required', () => {
    // BREAK-VERIFY: いずれかの input を `required: false` に変えると test 落ちる
    const yaml = readRepoFile('.github/workflows/pages-live-verify.yml');
    expect(yaml).toMatch(/user_agent_email:[\s\S]*?required:\s*true/);
    expect(yaml).toMatch(/reason:[\s\S]*?required:\s*true/);
  });

  it('pages-live-verify.yml の reason validate に TLD-anchored 配布元 URL grep が含まれる', () => {
    // BREAK-VERIFY: validate step の grep を消すと test 落ちる
    const yaml = readRepoFile('.github/workflows/pages-live-verify.yml');
    expect(yaml).toMatch(/gsi\\\.go\\\.jp/);
    expect(yaml).toMatch(/openstreetmap\\\.org/);
    expect(yaml).toMatch(/protomaps\\\.com/);
  });

  it('pages-live-verify.yml / monthly-watch-reminder.yml の if: に github.repository_owner == vars.AUTHOR_HANDLE を含む', () => {
    // BREAK-VERIFY: いずれかの workflow から fork 防衛 if を消すと test 落ちる
    const pagesLive = readRepoFile('.github/workflows/pages-live-verify.yml');
    const monthly = readRepoFile('.github/workflows/monthly-watch-reminder.yml');
    expect(pagesLive).toMatch(/github\.repository_owner\s*==\s*vars\.AUTHOR_HANDLE/);
    expect(monthly).toMatch(/github\.repository_owner\s*==\s*vars\.AUTHOR_HANDLE/);
  });

  it('全 workflow yaml に `YuujiKamura` literal が出現しない (= literal hardcode drift 検出、 vars 経由のみ)', () => {
    // BREAK-VERIFY: workflow yaml に `YuujiKamura` literal を直書きすると test 落ちる
    const files = ['pages.yml', 'audit.yml', 'pages-live-verify.yml', 'monthly-watch-reminder.yml'];
    for (const f of files) {
      const yaml = readRepoFile(`.github/workflows/${f}`);
      expect(yaml, `${f} should not contain YuujiKamura literal`).not.toMatch(/YuujiKamura/);
    }
  });
});

describe('b36 配布元境界規律: L2 test runner config + L4 spec', () => {
  it('playwright.pages.config.js の testMatch が pages_audit.spec.js literal (= b35 spec は呼ばれていない)', () => {
    // BREAK-VERIFY: testMatch を array 化して pages_live を含めると test 落ちる
    const config = readRepoFile('e2e/playwright.pages.config.js');
    expect(config).toMatch(/testMatch:\s*['"]pages_audit\.spec\.js['"]/);
    expect(config).not.toMatch(/pages_live/);
  });

  it('pages_live_*.spec.js 冒頭に「配布元境界規律」 コメント文字列を含む', () => {
    // BREAK-VERIFY: spec 冒頭コメントを削ると test 落ちる
    const fetch = readRepoFile('e2e/pages_live_fetch.spec.js');
    const render = readRepoFile('e2e/pages_live_terrain_render.spec.js');
    expect(fetch).toMatch(/配布元境界規律/);
    expect(render).toMatch(/配布元境界規律/);
  });

  it('pages_live_*.spec.js が extraHTTPHeaders で User-Agent + LIVE_VERIFY_EMAIL を埋める', () => {
    // BREAK-VERIFY: extraHTTPHeaders 行を消すと test 落ちる
    const fetch = readRepoFile('e2e/pages_live_fetch.spec.js');
    const render = readRepoFile('e2e/pages_live_terrain_render.spec.js');
    expect(fetch).toMatch(/extraHTTPHeaders[\s\S]*?LIVE_VERIFY_EMAIL/);
    expect(render).toMatch(/extraHTTPHeaders[\s\S]*?LIVE_VERIFY_EMAIL/);
  });
});

describe('b36 配布元境界規律: L5 fork 防衛 + L6 月 1 watch', () => {
  it('.github/CODEOWNERS が web/tests/fixtures/** を author 必須 review に gate', () => {
    // BREAK-VERIFY: CODEOWNERS から fixtures 行を消すと test 落ちる
    const codeowners = readRepoFile('.github/CODEOWNERS');
    expect(codeowners).toMatch(/web\/tests\/fixtures\/\*\*\s+@\w+/);
  });

  it('docs/distributor-watch.md 存在 + frontmatter (= last_reviewed_at / next_review_at / last_reviewer)', () => {
    // BREAK-VERIFY: frontmatter のいずれかを消すと test 落ちる
    const docsPath = resolve(REPO_ROOT, 'docs/distributor-watch.md');
    expect(existsSync(docsPath), 'docs/distributor-watch.md must exist').toBe(true);
    const docs = readFileSync(docsPath, 'utf8');
    expect(docs).toMatch(/^last_reviewed_at:\s*\d{4}-\d{2}-\d{2}/m);
    expect(docs).toMatch(/^next_review_at:\s*\d{4}-\d{2}-\d{2}/m);
    expect(docs).toMatch(/^last_reviewer:\s*\S+/m);
  });

  it('docs/distributor-watch.md に GSI / OSM / Protomaps の 3 source URL が含まれる', () => {
    // BREAK-VERIFY: いずれかの source URL を消すと test 落ちる
    const docs = readRepoFile('docs/distributor-watch.md');
    expect(docs).toMatch(/gsi\.go\.jp/);
    expect(docs).toMatch(/openstreetmap\.org/);
    expect(docs).toMatch(/protomaps\.com/);
  });
});

describe('b36 配布元境界規律: fixture 改竄 catch', () => {
  it('gsi_dem_v1_sample.png の SHA-256 が .sha256 file の値と一致', () => {
    // BREAK-VERIFY: fixture PNG を別 byte で差し替えると hash 不一致で test 落ちる
    const pngPath = resolve(REPO_ROOT, 'web/tests/fixtures/gsi_dem_v1_sample.png');
    const shaPath = resolve(REPO_ROOT, 'web/tests/fixtures/gsi_dem_v1_sample.png.sha256');
    expect(existsSync(pngPath), 'fixture PNG must exist').toBe(true);
    expect(existsSync(shaPath), 'fixture SHA file must exist').toBe(true);
    const pngBytes = readFileSync(pngPath);
    const actualHash = createHash('sha256').update(pngBytes).digest('hex');
    const expectedHash = readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0];
    expect(actualHash).toBe(expectedHash);
  });
});
