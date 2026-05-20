// b36 配布元境界規律 ── 過去 fetch 済 fixture との SHA verify。 fixture 改竄 PR を
// social gate (CODEOWNERS) + cryptographic gate (SHA-256) の 2 重で catch する。
//
// decode 純関数の互換 test (= bitmapToHeightGrid に PNG を流して標高 grid 検証) は browser-only
// API (createImageBitmap / OffscreenCanvas) 依存のため本 file では SHA verify のみ実装、
// decode 経路 test は b36-decode-test 別 brief で track。
//
// 詳細: ~/.agents/scratch/fujihc-trainer-project/b36-tile-distributor-courtesy.md § 直すこと 4

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PNG = resolve(__dirname, 'fixtures', 'gsi_dem_v1_sample.png');
const FIXTURE_SHA = resolve(__dirname, 'fixtures', 'gsi_dem_v1_sample.png.sha256');
const FIXTURE_README = resolve(__dirname, 'fixtures', 'README.md');

describe('b36 fixture verify (= 過去 fetch 済 GSI dem_png タイルとの SHA 一致)', () => {
  it('fixture PNG 存在 + SHA file 存在 + README 存在', () => {
    // BREAK-VERIFY: いずれかを削除すると test 落ちる
    expect(existsSync(FIXTURE_PNG), 'fixture PNG').toBe(true);
    expect(existsSync(FIXTURE_SHA), 'fixture SHA').toBe(true);
    expect(existsSync(FIXTURE_README), 'fixture README').toBe(true);
  });

  it('PNG の SHA-256 が .sha256 file と一致 (= fixture 改竄 catch)', () => {
    // BREAK-VERIFY: PNG を別 byte で差し替えると hash 不一致で test 落ちる
    const bytes = readFileSync(FIXTURE_PNG);
    const actual = createHash('sha256').update(bytes).digest('hex');
    const expected = readFileSync(FIXTURE_SHA, 'utf8').trim().split(/\s+/)[0];
    expect(actual).toBe(expected);
  });

  it('PNG が PNG signature で始まる (= 別形式に書き換えで catch)', () => {
    // BREAK-VERIFY: PNG を JPEG / 任意 binary に差し替えると signature mismatch で test 落ちる
    const bytes = readFileSync(FIXTURE_PNG);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4E);
    expect(bytes[3]).toBe(0x47);
  });

  it('README に GSI 出典 + 取得日 + tile 座標が明示されている', () => {
    // BREAK-VERIFY: README から「国土地理院」「2026-」「z=14」 等を消すと test 落ちる
    const readme = readFileSync(FIXTURE_README, 'utf8');
    expect(readme).toMatch(/国土地理院/);
    expect(readme).toMatch(/取得日.*2026-/);
    expect(readme).toMatch(/z=14/);
    expect(readme).toMatch(/14506/);
    expect(readme).toMatch(/6418/);
  });
});
