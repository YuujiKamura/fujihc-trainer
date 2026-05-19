// web/lib/mode_toggle.js の純関数 unit test。
//
// buildToggledSearch が `test` 引数だけを付け外しし、 それ以外の引数
// (consent=dev / debug / bridge 等) を保持することを pin する。
// 「他引数の保持」は viewer の切替ボタンが consent=dev (開発者 bypass) や
// bridge (python bridge 経路指定) を落とさないことの唯一の機械化された防衛線
// ── grep テストでは検証できないため純関数 + 実テストで担保する。
import { describe, it, expect } from 'vitest';
import {
  buildToggledSearch,
  MODE_LABEL_TEST, MODE_LABEL_PROD,
  SWITCH_BTN_TO_PROD, SWITCH_BTN_TO_TEST,
} from '../lib/mode_toggle.js';

describe('buildToggledSearch — test 引数の付け外し', () => {
  it('enableTest=true: test が無い search に test=1 を付ける', () => {
    const r = new URLSearchParams(buildToggledSearch('', true));
    expect(r.get('test')).toBe('1');
  });

  it('enableTest=false: test=1 を外す', () => {
    const r = new URLSearchParams(buildToggledSearch('test=1', false));
    expect(r.has('test')).toBe(false);
  });

  it('enableTest=false: test 以外の引数 (consent=dev / debug) を保持する', () => {
    const r = new URLSearchParams(buildToggledSearch('test=1&consent=dev&debug=1', false));
    expect(r.has('test')).toBe(false);
    expect(r.get('consent')).toBe('dev');   // 開発者 bypass を落とさない
    expect(r.get('debug')).toBe('1');
  });

  it('enableTest=true: test 以外の引数 (consent / bridge) を保持する', () => {
    const r = new URLSearchParams(buildToggledSearch('consent=dev&bridge=1', true));
    expect(r.get('test')).toBe('1');
    expect(r.get('consent')).toBe('dev');
    expect(r.get('bridge')).toBe('1');      // python bridge 経路指定を落とさない
  });

  it('先頭 ? 付きの search も受け付ける (location.search 形式)', () => {
    const r = new URLSearchParams(buildToggledSearch('?test=1&consent=dev', false));
    expect(r.has('test')).toBe(false);
    expect(r.get('consent')).toBe('dev');
  });

  it('edge: 既にテスト ON で ON 要求 → test=1 のまま冪等', () => {
    const r = new URLSearchParams(buildToggledSearch('test=1', true));
    expect(r.get('test')).toBe('1');
  });

  it('edge: 既にテスト OFF で OFF 要求 → test 無しのまま、 他引数を保持', () => {
    const r = new URLSearchParams(buildToggledSearch('consent=dev', false));
    expect(r.has('test')).toBe(false);
    expect(r.get('consent')).toBe('dev');
  });
});

describe('文言定数 (viewer / E2E の SoT)', () => {
  it('現在モード表示の文言', () => {
    expect(MODE_LABEL_TEST).toBe('テストモード');
    expect(MODE_LABEL_PROD).toBe('本番モード');
  });

  it('切替ボタンの文言', () => {
    expect(SWITCH_BTN_TO_PROD).toBe('本番モードに切替');
    expect(SWITCH_BTN_TO_TEST).toBe('テストモードに切替');
  });
});
