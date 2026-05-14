// brief 31: registerPmtilesProtocol helper の単体 test。
// 純 helper なので import + mock で実走可能 (= viewer 全体は maplibre 依存で import 不可、
// pmtiles_loader.js は依存ゼロ)。
import { describe, it, expect, vi } from 'vitest';
import { registerPmtilesProtocol } from '../lib/pmtiles_loader.js';

function makeMockMaplibre() {
  return {
    addProtocol: vi.fn(),
  };
}

function makeMockPmtiles() {
  // pmtiles.Protocol コンストラクタを mock、 tile プロパティを返す。
  const fakeTile = vi.fn();
  const Protocol = vi.fn(function () {
    this.tile = fakeTile;
  });
  return { Protocol, _fakeTile: fakeTile };
}

describe('brief 31: registerPmtilesProtocol', () => {
  it('maplibregl.addProtocol("pmtiles", protocol.tile) を呼ぶ', () => {
    const mlbr = makeMockMaplibre();
    const pmt = makeMockPmtiles();
    registerPmtilesProtocol(mlbr, pmt);
    expect(mlbr.addProtocol).toHaveBeenCalledWith('pmtiles', pmt._fakeTile);
  });

  it('2 回呼んでも throw しない (= 冪等性、 bridge / static mode 重複登録に耐える)', () => {
    const mlbr = makeMockMaplibre();
    const pmt = makeMockPmtiles();
    expect(() => {
      registerPmtilesProtocol(mlbr, pmt);
      registerPmtilesProtocol(mlbr, pmt);
    }).not.toThrow();
    expect(mlbr.addProtocol).toHaveBeenCalledTimes(2);
  });

  it('pmtiles global 不在 (= 第 2 引数 falsy) で明示 throw', () => {
    const mlbr = makeMockMaplibre();
    expect(() => registerPmtilesProtocol(mlbr, null)).toThrow(/pmtiles global not loaded/);
    expect(() => registerPmtilesProtocol(mlbr, undefined)).toThrow(/pmtiles global not loaded/);
  });

  it('maplibregl.addProtocol が無いと throw (= 引数 1 の defensive check)', () => {
    const pmt = makeMockPmtiles();
    expect(() => registerPmtilesProtocol({}, pmt)).toThrow(/addProtocol/);
    expect(() => registerPmtilesProtocol(null, pmt)).toThrow(/addProtocol/);
  });
});
