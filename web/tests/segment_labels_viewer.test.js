// brief b-segment-labels / b9: 距離+勾配ラベルの symbol レイヤー統合層を source-grep で pin。
//
// b12 Phase 2.5: ラベルの文字画像生成・symbol レイヤー定義・距離窓フィルタは
// 地図描画モジュール (web/lib/map_renderer.js) の中へ移設済。 viewer 本体は機器設定
// slider から setLabelScale を頼むだけ。 maplibre-gl global 不在で import 失敗するため、
// source 文字列を正規表現で検査して構造を物理 verify する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewer = readFileSync(resolve(__dirname, '..', 'viewer-map3d.js'), 'utf8');
const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

describe('brief b-segment-labels: ラベル symbol レイヤー統合層 (= map_renderer.js)', () => {
  it('segment_labels.js から buildSegmentLabels を import している', () => {
    expect(renderer).toMatch(/import\s*\{\s*buildSegmentLabels\s*\}\s*from\s*['"]\.\/segment_labels\.js['"]/);
  });

  it('buildSegmentLabels を polygonData + 間隔 + 脇offset で呼んでいる', () => {
    // 第2引数 = 間隔(m)、 第3引数 = コース脇への offset(m)。
    expect(renderer).toMatch(/buildSegmentLabels\s*\(\s*polygonData\s*,\s*\d+\s*,\s*\d+\s*\)/);
  });

  it('文字を canvas 画像にして addImage している (= glyphs 不要の icon-image 方式)', () => {
    expect(renderer).toMatch(/function\s+makeSegLabelImage/);
    expect(renderer).toMatch(/\.addImage\s*\(/);
  });

  it("ラベル専用の geojson source と symbol レイヤー 'route-labels' を追加している", () => {
    expect(renderer).toMatch(/addSource\(\s*['"]route-labels['"]/);
    expect(renderer).toMatch(/id:\s*['"]route-labels['"]/);
    expect(renderer).toMatch(/type:\s*['"]symbol['"]/);
  });

  it('billboard 表示: icon-pitch-alignment / icon-rotation-alignment = viewport', () => {
    // pitch 85° の走行 camera でも文字が潰れないよう billboard で立てる。
    expect(renderer).toMatch(/['"]icon-pitch-alignment['"]\s*:\s*['"]viewport['"]/);
    expect(renderer).toMatch(/['"]icon-rotation-alignment['"]\s*:\s*['"]viewport['"]/);
  });

  it('左端基準: icon-anchor=left (= コース側の左端から揃って伸びる)', () => {
    expect(renderer).toMatch(/['"]icon-anchor['"]\s*:\s*['"]left['"]/);
  });

  it('ラベルサイズは slider 連動の icon-size (= renderer 内 labelScale)', () => {
    // route-labels の icon-size は renderer 内の labelScale。 viewer 側は CONTROL_DEFS の
    // labelSize 定義の apply で setLabelScale を頼む (= control_panel.js が localStorage 永続)。
    expect(renderer).toMatch(/['"]icon-size['"]\s*:\s*labelScale/);
    expect(viewer).toMatch(/CONTROL_DEFS/);
    expect(viewer).toMatch(/mapRenderer\.setLabelScale\(/);
  });

  it('機器設定パネルに ラベルサイズ slider コンテナ (= b89 で control-sliders-course に分割) がある', () => {
    // b13-1: control_panel.js が動的生成するため静的 HTML にスライダー行は無い。
    // b89: 旧 #control-sliders を #control-sliders-bike / -course / -atmo に分割、
    //   ラベルサイズは COURSE_DEFS に入ったので -course コンテナで pin。
    expect(html).toMatch(/id="control-sliders-course"/);
  });

  it('rider 距離窓で間引く: setFilter で近傍だけ表示 (= 地平の潰れ対策、 map_renderer.js)', () => {
    expect(renderer).toMatch(/function\s+applyLabelFilter/);
    expect(renderer).toMatch(/\.setFilter\(\s*['"]route-labels['"]/);
    expect(renderer).toMatch(/const\s+LABEL_BACK_M\s*=\s*\d+/);
    expect(renderer).toMatch(/const\s+LABEL_AHEAD_M\s*=\s*\d+/);
    // viewer の tick は renderer.updateLabelWindow を毎フレーム呼び、 間引きは renderer 内。
    expect(viewer).toMatch(/mapRenderer\.updateLabelWindow\(/);
  });

  it('窓内は全表示: icon-allow-overlap=true (= 約100m間隔で並べる)', () => {
    expect(renderer).toMatch(/['"]icon-allow-overlap['"]\s*:\s*true/);
  });

  it('近いラベルを優先: symbol-sort-key に distance_m を使う', () => {
    expect(renderer).toMatch(/['"]symbol-sort-key['"]/);
  });

  it('文字画像は黒ハロー (strokeText) で描く (= 透明背景、 下の勾配色が透ける)', () => {
    // makeSegLabelImage 内でハロー縁取りを使う。 ベタ塗りピル背景は使わない。
    const fn = renderer.slice(renderer.indexOf('function makeSegLabelImage'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    expect(body).toMatch(/strokeText/);
    expect(body).not.toMatch(/fillRect|ctx\.fill\(\)/);
  });
});
