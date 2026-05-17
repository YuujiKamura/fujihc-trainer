// brief b-segment-labels / b9: viewer-maplibre.js の「ラベル symbol レイヤー統合層」を
// source-grep で pin。
//
// viewer-maplibre.js 全体は maplibre-gl global 不在で import 失敗するため、
// build_map_style.test.js と同じく source 文字列を正規表現で検査して、
// 純粋でない統合層 (= canvas 画像化 / symbol レイヤー) の構造を物理 verify する。
//
// ラベルはコース脇に billboard で立てる ── 走行 camera (pitch 85°) でも文字が
// 正面を向いて大きく読める。 icon-image (canvas 画像) 方式なので glyphs 不要。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewer = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

describe('brief b-segment-labels: viewer のラベル symbol レイヤー統合層', () => {
  it('segment_labels.js から buildSegmentLabels を import している', () => {
    expect(viewer).toMatch(/import\s*\{\s*buildSegmentLabels\s*\}\s*from\s*['"]\.\/lib\/segment_labels\.js['"]/);
  });

  it('buildSegmentLabels を polygonData + 間隔 + 脇offset で呼んでいる', () => {
    // 第2引数 = 間隔(m)、 第3引数 = コース脇への offset(m)。
    expect(viewer).toMatch(/buildSegmentLabels\s*\(\s*polygonData\s*,\s*\d+\s*,\s*\d+\s*\)/);
  });

  it('文字を canvas 画像にして addImage している (= glyphs 不要の icon-image 方式)', () => {
    expect(viewer).toMatch(/function\s+makeSegLabelImage/);
    expect(viewer).toMatch(/map\.addImage\s*\(/);
  });

  it("ラベル専用の geojson source と symbol レイヤー 'route-labels' を追加している", () => {
    expect(viewer).toMatch(/addSource\(\s*['"]route-labels['"]/);
    expect(viewer).toMatch(/id:\s*['"]route-labels['"]/);
    expect(viewer).toMatch(/type:\s*['"]symbol['"]/);
  });

  it('billboard 表示: icon-pitch-alignment / icon-rotation-alignment = viewport', () => {
    // pitch 85° の走行 camera でも文字が潰れないよう billboard で立てる。
    // 地面に寝かせる方式は pitch 85° で地平圧縮され見えなくなるため不採用。
    expect(viewer).toMatch(/['"]icon-pitch-alignment['"]\s*:\s*['"]viewport['"]/);
    expect(viewer).toMatch(/['"]icon-rotation-alignment['"]\s*:\s*['"]viewport['"]/);
  });

  it('左端基準: icon-anchor=left (= コース側の左端から揃って伸びる)', () => {
    expect(viewer).toMatch(/['"]icon-anchor['"]\s*:\s*['"]left['"]/);
  });

  it('ラベルサイズは slider 連動の icon-size (= labelSizeScale)', () => {
    expect(viewer).toMatch(/['"]icon-size['"]\s*:\s*labelSizeScale/);
    expect(viewer).toMatch(/function\s+applyLabelSize/);
    expect(viewer).toMatch(/localStorage\.setItem\(\s*['"]fujihill\.labelSize['"]/);
  });

  it('機器設定パネルに ラベルサイズ slider (#rngLabelSize) がある', () => {
    expect(html).toMatch(/id="rngLabelSize"\s+type="range"/);
    expect(html).toMatch(/id="labelSizeVal"/);
  });

  it('rider 距離窓で間引く: setFilter で近傍だけ表示 (= 地平の潰れ対策)', () => {
    expect(viewer).toMatch(/function\s+updateSegmentLabelFilter/);
    expect(viewer).toMatch(/map\.setFilter\(\s*['"]route-labels['"]/);
    expect(viewer).toMatch(/const\s+LABEL_BACK_M\s*=\s*\d+/);
    expect(viewer).toMatch(/const\s+LABEL_AHEAD_M\s*=\s*\d+/);
    // tick から bucket 刻みで窓を更新する。
    expect(viewer).toMatch(/_lastLabelDistBucket/);
    expect(viewer).toMatch(/_riderDistForLabels/);
  });

  it('窓内は全表示: icon-allow-overlap=true (= 約100m間隔で並べる)', () => {
    expect(viewer).toMatch(/['"]icon-allow-overlap['"]\s*:\s*true/);
  });

  it('近いラベルを優先: symbol-sort-key に distance_m を使う', () => {
    expect(viewer).toMatch(/['"]symbol-sort-key['"]/);
  });

  it('文字画像は黒ハロー (strokeText) で描く (= 透明背景、 下の勾配色が透ける)', () => {
    // makeSegLabelImage 内でハロー縁取りを使う。 ベタ塗りピル背景は使わない。
    const fn = viewer.slice(viewer.indexOf('function makeSegLabelImage'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    expect(body).toMatch(/strokeText/);
    expect(body).not.toMatch(/fillRect|ctx\.fill\(\)/);
  });
});
