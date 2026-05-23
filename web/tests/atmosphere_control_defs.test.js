// b62: viewer-maplibre.js の CONTROL_DEFS に足した大気散乱スライダー 5 本の定義を pin する。
//
// viewer-maplibre.js は maplibre-gl / DOM 依存で node から import 不可なので、
// viewer_physics_drive.test.js / segment_labels_viewer.test.js と同型に **ソースを
// 文字列 grep** して各 def の数値フィールドを取り出す。control_panel.js の
// isValidControlDef が課す不変条件 (min<max / step>0 / apply 関数あり) と、
// value が [min,max] 内であることを、抽出した数値で検証する。
//
// このファイルが pin するもの:
//   - atmosphere def 4 本 (atmoMie / atmoG / atmoDensity / atmoSun) の存在。
//     Rayleigh (青み) は空気分子由来の物理定数なのでスライダーにしない ── 調整つまみは
//     日々変わる Mie (もや) 側に絞る、という設計判断もここで pin する。
//   - 各 def の min<max / step>0 / value∈[min,max] (= isValidControlDef 相当)
//   - 各 def の apply が mapRenderer.setAtmosphereParams を呼ぶ (= 4 層配線の入口)
//   - atmoMie の default value が const ATMO_BETA_MIE と数値一致 (= SoT 二重定義の照合)
// pin しないもの: スライダー操作で実際に散乱が変わる挙動 (= e2e atmosphere_sliders.spec.js)。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ATMO_BETA_MIE } from '../lib/map3d/atmosphere3d.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewer = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');

// CONTROL_DEFS 内の 1 行 def を key で取り出す。def は 1 行 object literal。
function defLine(key) {
  const m = viewer.match(new RegExp(`\\{\\s*key:'${key}'[^\\n]*\\}`));
  return m ? m[0] : null;
}
// def 行から数値フィールドを取り出す (min:0 / max:42 等)。
function numField(line, field) {
  const m = line.match(new RegExp(`${field}:\\s*(-?[0-9.]+)`));
  return m ? Number(m[1]) : NaN;
}

// b71: 大気散乱 4 本 (= setAtmosphereParams 経由) + 背景スフィア 1 本 (= setSkyIntensity 経由)。
const ATMO_KEYS = ['atmoMie', 'atmoG', 'atmoDensity', 'atmoSun'];
const SKY_KEYS = ['skyIntensity'];
const ALL_KEYS = [...ATMO_KEYS, ...SKY_KEYS];

describe('b62/b71: CONTROL_DEFS の大気・空関連スライダー 5 本', () => {
  it('5 本すべてが CONTROL_DEFS に存在する (= b71 で skyIntensity = 空の青さ を追加)', () => {
    for (const key of ALL_KEYS) {
      expect(defLine(key), `${key} の def が無い`).not.toBeNull();
    }
  });

  it('各 def が isValidControlDef 相当を満たす (min<max / step>0 / value∈[min,max])', () => {
    for (const key of ALL_KEYS) {
      const line = defLine(key);
      const min = numField(line, 'min');
      const max = numField(line, 'max');
      const step = numField(line, 'step');
      const value = numField(line, 'value');
      expect(Number.isFinite(min), `${key} min`).toBe(true);
      expect(Number.isFinite(max), `${key} max`).toBe(true);
      expect(min, `${key}: min<max`).toBeLessThan(max);
      expect(step, `${key}: step>0`).toBeGreaterThan(0);
      expect(value, `${key}: value>=min`).toBeGreaterThanOrEqual(min);
      expect(value, `${key}: value<=max`).toBeLessThanOrEqual(max);
    }
  });

  it('大気散乱 4 本の apply が mapRenderer.setAtmosphereParams を呼ぶ (= 配線の入口)', () => {
    for (const key of ATMO_KEYS) {
      expect(defLine(key)).toMatch(/mapRenderer\.setAtmosphereParams\(/);
    }
  });

  it('空関連 1 本 (skyIntensity) の apply が mapRenderer.setSkyIntensity を呼ぶ (= b71 別配線)', () => {
    expect(defLine('skyIntensity')).toMatch(/mapRenderer\.setSkyIntensity\(/);
  });

  it('apply が流す setAtmosphereParams のキーが atmosphere3d.js の setParams 対応キー', () => {
    // atmoMie→betaMie / atmoG→mieG / atmoDensity→density / atmoSun→sunScale。
    const wiring = {
      atmoMie: 'betaMie', atmoG: 'mieG', atmoDensity: 'density', atmoSun: 'sunScale',
    };
    for (const [key, param] of Object.entries(wiring)) {
      expect(defLine(key), `${key} → ${param}`).toMatch(
        new RegExp(`setAtmosphereParams\\(\\s*\\{\\s*${param}:`));
    }
  });

  it('atmoMie の default value (×10⁻⁶) が const ATMO_BETA_MIE と一致 (SoT 照合)', () => {
    // atmoMie の raw 表現は ATMO_BETA_MIE 生値 ×10⁶。value 5 ⇔ 5e-6。
    const value = numField(defLine('atmoMie'), 'value');
    expect(value * 1e-6).toBeCloseTo(ATMO_BETA_MIE, 12);
  });

  it('atmoMie の default は b61 既定 21e-6 より小さい (= Rayleigh 優位への是正)', () => {
    expect(numField(defLine('atmoMie'), 'value') * 1e-6).toBeLessThan(21e-6);
  });
});
