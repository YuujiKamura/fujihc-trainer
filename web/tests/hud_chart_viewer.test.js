// hud_chart_viewer.test.js ── viewer-maplibre.js / index.html / hud.js の source string を grep で
// pin する gate test. impl の挙動でなく impl の string 構造 (= 「正しい結線が書かれていること」
// + 「不可侵契約 file が touch されていないこと」) を物理 verify する。
// 既存 segment_labels_viewer.test.js と同型 pattern.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER = readFileSync(resolve(__dirname, '../viewer-maplibre.js'), 'utf-8');
const HTML   = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
const HUD_JS = readFileSync(resolve(__dirname, '../lib/hud.js'), 'utf-8');

describe('viewer-maplibre.js: chart 結線 (= 新規結線が書かれていることを物理 verify)', () => {
  it('hud_chart_buffer import が存在 (= 落ちると chart push helper が未結線、 1 Hz sample が積まれない)', () => {
    expect(VIEWER).toMatch(/import\s*\{[^}]*\bcreateChartBuffer\b[^}]*\}\s*from\s*['"]\.\/lib\/hud_chart_buffer\.js['"]/);
  });
  it('hud_chart import が存在 (= 落ちると chart renderer / CANVAS_HEIGHT_PX が未結線、 描画されない)', () => {
    expect(VIEWER).toMatch(/import\s*\{[^}]*\bcreateChartRenderer\b[^}]*\}\s*from\s*['"]\.\/lib\/hud_chart\.js['"]/);
  });
  it('decideChartPush 呼出が存在 (= 落ちると paused 判定 SoT を経由しない、 paused 中 0 値汚染再演)', () => {
    expect(VIEWER).toMatch(/decideChartPush\s*\(/);
  });
  it('chartBuffer.push 呼出が存在 (= 落ちると sample が buffer に積まれず chart 永久に空)', () => {
    expect(VIEWER).toMatch(/chartBuffer\.push\s*\(/);
  });
  it('chartRenderer.render 呼出が存在 (= 落ちると buffer は埋まるが画面に描かれない)', () => {
    expect(VIEWER).toMatch(/chartRenderer\.render\s*\(/);
  });
  it('chartBuffer.clear 呼出が存在 (= ride 終了時の buffer cut、 落ちると次 ride に前回データが残る)', () => {
    expect(VIEWER).toMatch(/chartBuffer\.clear\s*\(/);
  });
  it('paused 識別子が ≥ 2 件 (= 既存 hud.speed の paused + 新規 decideChartPush 引数の paused、 paused 中 push 停止物理 pin)', () => {
    const pausedRefs = (VIEWER.match(/paused/g) || []).length;
    expect(pausedRefs).toBeGreaterThanOrEqual(2);
  });
});

describe('viewer-maplibre.js: 既存 hud 呼出不変 (= 不可侵契約、 floor pin)', () => {
  // 既存呼出件数の floor pin (= 削除されていないことを物理 verify)
  it('hud.trainer(...) 呼出が最低 1 件', () => {
    expect((VIEWER.match(/hud\.trainer\s*\(/g) || []).length).toBeGreaterThanOrEqual(1);
  });
  it('hud.ride(...) 呼出が最低 1 件', () => {
    expect((VIEWER.match(/hud\.ride\s*\(/g) || []).length).toBeGreaterThanOrEqual(1);
  });
  it('hud.speed(...) 呼出が最低 1 件', () => {
    expect((VIEWER.match(/hud\.speed\s*\(/g) || []).length).toBeGreaterThanOrEqual(1);
  });
  it('hud.eta(...) 呼出が最低 1 件 (= b39 由来)', () => {
    expect((VIEWER.match(/hud\.eta\s*\(/g) || []).length).toBeGreaterThanOrEqual(1);
  });
  it('hud.ack(...) 呼出が最低 1 件', () => {
    expect((VIEWER.match(/hud\.ack\s*\(/g) || []).length).toBeGreaterThanOrEqual(1);
  });
  it('hud.total(...) 呼出が最低 1 件', () => {
    expect((VIEWER.match(/hud\.total\s*\(/g) || []).length).toBeGreaterThanOrEqual(1);
  });
});

describe('index.html: chart panel DOM + CSS', () => {
  it('id="hud-chart" が存在 (= 落ちると chart の親 div が無い、 canvas マウント先消失)', () => {
    expect(HTML).toContain('id="hud-chart"');
  });
  it('id="hud-chart-canvas" が存在 (= 落ちると canvas 要素が無い、 renderer は null fallback)', () => {
    expect(HTML).toContain('id="hud-chart-canvas"');
  });
  it('CSS rule #hud-chart { が存在 (= 落ちると panel に位置 / 背景がない、 画面に出ても見えない)', () => {
    expect(HTML).toMatch(/#hud-chart\s*\{/);
  });
  it('state gate body.state-checking #hud-chart が存在 (= setup 中に chart を隠す)', () => {
    expect(HTML).toMatch(/body\.state-checking[^,{]*#hud-chart/);
  });
  it('state gate body.state-dbinit #hud-chart が存在 (= DB 構築中に chart を隠す)', () => {
    expect(HTML).toMatch(/body\.state-dbinit[^,{]*#hud-chart/);
  });
  it('state gate body.state-pairing #hud-chart が存在 (= BLE ペアリング中に chart を隠す)', () => {
    expect(HTML).toMatch(/body\.state-pairing[^,{]*#hud-chart/);
  });
});

describe('hud.js 不可侵契約 (= chart 概念を hud.js に混入させない、 整形 + DOM 書き込み SoT 維持)', () => {
  it('export 行数が 11 行 (= b39 後の確定値、 増減で即 fail)', () => {
    // formatElapsed/Speed/Power/Cadence/Hr/TrainerSpeed/Ack/Eta + ACK_OK_COLOR + ACK_NG_COLOR + createHud = 11
    const exportLines = (HUD_JS.match(/^export\s/gm) || []).length;
    expect(exportLines).toBe(11);
  });
  it('hud.js に chart / Chart 文字列が含まれない (= chart 概念混入の物理排除)', () => {
    // case insensitive、 Chart / CHART / chartRenderer すべて catch
    expect(HUD_JS).not.toMatch(/\bchart\b/i);
  });
  it('hud.js に chartBuffer / chartRenderer 文字列が含まれない', () => {
    expect(HUD_JS).not.toContain('chartBuffer');
    expect(HUD_JS).not.toContain('chartRenderer');
  });
  it('hud.js に canvas / ctx 文字列が含まれない (= canvas 描画責務の混入排除)', () => {
    expect(HUD_JS).not.toMatch(/\b(canvas|ctx)\b/i);
  });
});
