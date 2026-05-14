// brief 31: buildMapStyle({bridgeReachable}) の 2 mode 切替を pin。
// viewer-maplibre.js 全体は maplibre-gl global 不在で import 失敗するため、
// source-grep で sources / layers 共有を pin する。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const viewer = readFileSync(VIEWER_PATH, 'utf8');

describe('brief 31: buildMapStyle 関数の構造', () => {
  it('export function buildMapStyle({ bridgeReachable })', () => {
    expect(viewer).toMatch(/export\s+function\s+buildMapStyle\s*\(\s*\{\s*bridgeReachable\s*\}\s*\)/);
  });

  it('bridge mode の osm source は tiles 配列形式 + BRIDGE_TILE_BASE_URL prefix', () => {
    // bridgeReachable 分岐の bridge 側 (= true 分岐) で `tiles: [...]` を取る
    expect(viewer).toMatch(/tiles:\s*\[\s*`\$\{BRIDGE_TILE_BASE_URL\}\/osm\/\{z\}\/\{x\}\/\{y\}\.pbf`\s*\]/);
  });

  it('static mode の osm source は url 形式 + pmtiles:// scheme', () => {
    expect(viewer).toMatch(/url:\s*`pmtiles:\/\/\$\{STATIC_TILE_BASE_URL\}\/map\.pmtiles`/);
  });

  it('gsi-terrain は両 mode で encoding === "terrarium"', () => {
    // 2 箇所 (= bridge / static) で encoding: 'terrarium' が現れる
    const count = (viewer.match(/encoding:\s*['"]terrarium['"]/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('static mode gsi-terrain は ${STATIC_TILE_BASE_URL}/tiles/gsi_dem/{z}/{x}/{y}.png 経路', () => {
    expect(viewer).toMatch(/gsidem:\/\/\$\{STATIC_TILE_BASE_URL\}\/tiles\/gsi_dem\/\{z\}\/\{x\}\/\{y\}\.png/);
  });

  it('layers / sky は COMMON_LAYERS / COMMON_SKY const に共有化 (= NG-R1-11 双子コピペ回避)', () => {
    expect(viewer).toMatch(/const\s+COMMON_LAYERS\s*=\s*\[/);
    expect(viewer).toMatch(/const\s+COMMON_SKY\s*=\s*\{/);
    expect(viewer).toMatch(/layers:\s*COMMON_LAYERS/);
    expect(viewer).toMatch(/sky:\s*COMMON_SKY/);
  });
});
