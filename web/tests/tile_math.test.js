import { describe, it, expect } from 'vitest';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../lib/tile_math.js';

describe('tile_math', () => {
  it('lonToTileX: happy path z=14 lon=138.7', () => {
    // 2^14 = 16384. (138.7 + 180) / 360 * 16384 = 14504.3911...
    const x = lonToTileX(138.7, 14);
    expect(x).toBeCloseTo(14504.3911, 3);
    expect(Math.floor(x)).toBe(14504);
  });

  it('lonToTileX: boundary lon=-180 → 0', () => {
    expect(lonToTileX(-180, 14)).toBeCloseTo(0, 9);
  });

  it('lonToTileX: boundary lon=180 → 2^z', () => {
    expect(lonToTileX(180, 14)).toBeCloseTo(16384, 9);
  });

  it('latToTileY: happy path z=14 lat=35.4 (富士ヒル域)', () => {
    // lat=35.4, z=14 → 富士山域の y タイル.
    const y = latToTileY(35.4, 14);
    // 既知の正しい範囲: 6450〜6470 程度
    expect(y).toBeGreaterThan(6400);
    expect(y).toBeLessThan(6500);
  });

  it('latToTileY: Mercator 極限 lat=85 (上端付近)', () => {
    const y = latToTileY(85, 14);
    // lat=85 は Mercator のほぼ上端、 y は 0 付近 (小さい正の値)
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(50);
  });

  it('lon → x → lon の往復が誤差内で復元する', () => {
    const orig = 138.7587;
    const z = 14;
    const x = lonToTileX(orig, z);
    const back = tileXToLon(x, z);
    expect(back).toBeCloseTo(orig, 9);
    // lat も同様に往復確認 (Mercator は中緯度で可逆)
    const origLat = 35.4521;
    const y = latToTileY(origLat, z);
    const backLat = tileYToLat(y, z);
    expect(backLat).toBeCloseTo(origLat, 9);
  });
});
