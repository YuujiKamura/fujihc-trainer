// b39 区間名標識 + ゴール ETA の viewer 結線を source-grep で物理 pin。
//
// 既存 segment_labels_viewer.test.js / sw_cache_version.test.js と同じ source-grep pattern
// (= readFileSync で source string を検査、 実 map runtime に依存しない) を踏襲する。
//
// 役割:
//   - viewer-map3d.js: mapRenderer.setLandmarks 経由必須 + scene 直接 touch 禁止 (= 契約 gate)
//   - terrain3d.html: createMapRenderer 経由しない直結 form (= scene 直接 touch を明示許可)
//   - index.html: <span id="eta"> 存在 (= hud.eta の DOM 出力先)
//
// 詳細: ~/.agents/scratch/fujihc-trainer-project/b39-section-markers-and-finish-eta.md

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewerJs = readFileSync(resolve(__dirname, '..', 'viewer-map3d.js'), 'utf8');
const terrain3dHtml = readFileSync(resolve(__dirname, '..', 'terrain3d.html'), 'utf8');
const indexHtml = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

describe('b39 viewer-map3d.js 結線 (= mapRenderer 経由必須、 scene 直接 touch 禁止)', () => {
  it('FUJIHC_LANDMARKS と snapLandmarksToCourse を course_landmarks.js から import している', () => {
    expect(viewerJs).toMatch(/import\s*\{[^}]*FUJIHC_LANDMARKS[^}]*\}\s*from\s*['"]\.\/lib\/course_landmarks\.js['"]/);
    expect(viewerJs).toMatch(/import\s*\{[^}]*snapLandmarksToCourse[^}]*\}\s*from\s*['"]\.\/lib\/course_landmarks\.js['"]/);
  });

  it('snapLandmarksToCourse 呼出が 1 件以上 (= 起動時 snap の結線)', () => {
    expect(viewerJs).toMatch(/snapLandmarksToCourse\s*\(/);
  });

  it('mapRenderer.setLandmarks 経由で 3D 走路に流す (= 22 番目の意味メソッド)', () => {
    expect(viewerJs).toMatch(/mapRenderer\.setLandmarks\s*\(/);
  });

  it('hud.eta 呼出が 1 件以上 (= ride loop での残り時間表示)', () => {
    expect(viewerJs).toMatch(/hud\.eta\s*\(/);
  });

  it('scene.add の直接呼出が含まれない (= scene 直接 touch 禁止の契約 gate)', () => {
    // 「scene.add(」 という形での直接呼出を禁止 (= mapRenderer 経由必須)。
    // コメント / 文字列内の参照は許容するため、 同行に `(` が続く実呼出のみ検出する
    // (= 既存 source に「scene.add」 という文字列が含まれても呼出でなければ OK)。
    const matches = viewerJs.match(/(?<![\/\*\.\w])scene\.add\s*\(/g) || [];
    expect(matches.length).toBe(0);
  });

  it('createLandmarks3d を viewer-map3d.js が直接 import していない (= mapRenderer 経由必須の契約)', () => {
    // landmarks3d.js は map3d/index.js (= mapRenderer.setLandmarks 内部) からのみ import。
    expect(viewerJs).not.toMatch(/from\s*['"]\.\/lib\/map3d\/landmarks3d\.js['"]/);
  });
});

describe('b39 terrain3d.html 結線 (= 別契約、 scene 直接 touch 明示許可)', () => {
  it('FUJIHC_LANDMARKS と snapLandmarksToCourse を course_landmarks.js から import している', () => {
    expect(terrain3dHtml).toMatch(/import\s*\{[^}]*FUJIHC_LANDMARKS[^}]*\}\s*from\s*['"]\.\/lib\/course_landmarks\.js['"]/);
    expect(terrain3dHtml).toMatch(/import\s*\{[^}]*snapLandmarksToCourse[^}]*\}\s*from\s*['"]\.\/lib\/course_landmarks\.js['"]/);
  });

  it('createLandmarks3d を landmarks3d.js から import している (= scene 直接経路で factory を呼ぶ)', () => {
    expect(terrain3dHtml).toMatch(/import\s*\{[^}]*createLandmarks3d[^}]*\}\s*from\s*['"]\.\/lib\/map3d\/landmarks3d\.js['"]/);
  });

  it('createLandmarks3d 呼出が 1 件以上 + scene.add(landmarks.group) 経路 (= 直結 form の結線)', () => {
    expect(terrain3dHtml).toMatch(/createLandmarks3d\s*\(\s*THREE\s*,/);
    expect(terrain3dHtml).toMatch(/scene\.add\s*\(\s*landmarks\.group\s*\)/);
  });
});

describe('b39 index.html 結線 (= hud.eta の出力先 DOM)', () => {
  it('<span id="eta"> が存在 (= hud.eta() が #eta に textContent を書く前提)', () => {
    expect(indexHtml).toMatch(/<span\s+id="eta">/);
  });
});
