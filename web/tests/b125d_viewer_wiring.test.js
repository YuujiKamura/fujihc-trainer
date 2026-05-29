// b125d: viewer-maplibre.js が viewer_session + bike_settings labelScale 経由に
// 集約された pin (= grep gate).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-maplibre.js'), 'utf8');

// コメント剥がしの軽量版 (viewer_physics_drive と同型). 同名識別子のコメント混入と
// コード上の identifier を区別する.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '');
}
const srcLive = stripComments(src);

describe('b125d: 4 module-global が viewer-maplibre.js から撤去されている', () => {
  it.each([
    'ENV',
    'scanMode',
    '_advancedFromDbinit',
    'labelSizeScale',
  ])('module-global %s の宣言 (= let X = ...) が live コードに無い', (name) => {
    expect(srcLive).not.toMatch(new RegExp(`^\\s*let\\s+${name}\\b`, 'm'));
  });

  it.each([
    'scanMode',
    '_advancedFromDbinit',
    'labelSizeScale',
  ])('module-global %s への代入 (= X = ...) が無い (live コード)', (name) => {
    expect(srcLive).not.toMatch(new RegExp(`(?<!\\.|:\\s*)\\b${name}\\s*=(?!=)`));
  });

  it('viewer_session.js を import している', () => {
    expect(src).toMatch(/import\s+\{[^}]*createViewerSession[^}]*\}\s+from\s+['"]\.\/lib\/viewer_session\.js['"]/);
  });

  it('module top で viewerSession インスタンスを 1 つ作っている', () => {
    expect(src).toMatch(/const\s+viewerSession\s*=\s*createViewerSession\s*\(/);
  });

  it('bootEnv が viewerSession.setEnv に流し、 旧 ENV = Object.freeze は live コードから消えている', () => {
    expect(src).toMatch(/viewerSession\.setEnv\s*\(/);
    expect(srcLive).not.toMatch(/\bENV\s*=\s*Object\.freeze/);
  });

  it('ENV 読出は viewerSession.getEnv() 経由 (= 旧 ENV?.mode 直接参照は live コードに無い)', () => {
    expect(src).toMatch(/viewerSession\.getEnv\s*\(\s*\)\?\.mode|viewerSession\.getEnv\s*\(\s*\)/);
    expect(srcLive).not.toMatch(/\bENV\?\.mode/);
  });

  it('scanMode は viewerSession.getScanMode / setScanMode 経由', () => {
    expect(src).toMatch(/viewerSession\.getScanMode\s*\(/);
    expect(src).toMatch(/viewerSession\.setScanMode\s*\(/);
  });

  it('_advancedFromDbinit は viewerSession.{is,mark,reset}AdvancedFromDbinit 経由', () => {
    expect(src).toMatch(/viewerSession\.isAdvancedFromDbinit\s*\(/);
    expect(src).toMatch(/viewerSession\.markAdvancedFromDbinit\s*\(/);
    expect(src).toMatch(/viewerSession\.resetAdvancedFromDbinit\s*\(/);
  });

  it('labelSize slider の apply が bikeSettings.setLabelScale 経由', () => {
    expect(src).toMatch(/apply\(raw\)\{\s*bikeSettings\.setLabelScale\s*\(\s*raw\s*\/\s*100\s*\)/);
  });

  it('labelSizeScale 起動時 localStorage 直読みが消えている (= bike_settings が constructor で読む)', () => {
    expect(srcLive).not.toMatch(/parseFloat\(localStorage\.getItem\(['"]fujihill\.labelSize['"]\)\)/);
  });

  // strict gate (2026-05-29 追加): 旧 grep gate は `let X =` 宣言と `X = value` 代入の
  // 2 形式だけ block していたため、 object literal の value 位置 (= `env: ENV`) の identifier
  // 参照を素通りさせていた. 本 gate は live コード全体での identifier 参照 0 件を pin する.
  // 落ちた時はその行を直接読んで「これは viewerSession 経由に置換すべきだった」 と判定する.
  it.each([
    'ENV',
    'scanMode',
    'labelSizeScale',
    '_advancedFromDbinit',
  ])('strict gate: 撤去済 identifier %s が live コードのどこにも参照されていない (object value 位置含む)', (name) => {
    const pattern = new RegExp(`\\b${name}\\b`, 'g');
    const matches = [...srcLive.matchAll(pattern)];
    // 残存があれば該当行を一意に表示するため (= 失敗時の原因究明).
    const lines = matches.map((m) => {
      const before = srcLive.slice(0, m.index);
      const lineNo = before.split('\n').length;
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = srcLive.indexOf('\n', m.index);
      return `L${lineNo}: ${srcLive.slice(lineStart, lineEnd === -1 ? srcLive.length : lineEnd).trim()}`;
    });
    expect({ identifier: name, count: matches.length, lines }).toEqual({
      identifier: name,
      count: 0,
      lines: [],
    });
  });
});
