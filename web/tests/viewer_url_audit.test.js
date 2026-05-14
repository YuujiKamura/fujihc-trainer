// brief 17b: viewer-maplibre.js の外部 fetch ゼロを物理的に pin する source-grep gate。
// 1 ヶ月後に誰かが OSM 直叩きを復活させた瞬間に test が fail する。
// brief 13/17b の「外部第三者 endpoint への runtime fetch ゼロ」を維持するための
// 唯一の機械化された防衛線。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');

describe('viewer 外部 fetch ゼロ (brief 17b)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('tile.openstreetmap.org を直接叩いていない', () => {
    expect(viewer).not.toMatch(/https?:\/\/tile\.openstreetmap\.org/);
  });

  it('cyberjapandata.gsi.go.jp を直接叩いていない', () => {
    expect(viewer).not.toMatch(/https?:\/\/cyberjapandata\.gsi\.go\.jp/);
  });

  it('TILE_BASE_URL を使う (= localhost /tiles/... 経由)', () => {
    expect(viewer).toMatch(/TILE_BASE_URL/);
  });

  it('prefetchTilesAlongCourse 関数定義を含まない (= dead code 削除済)', () => {
    expect(viewer).not.toMatch(/function\s+prefetchTilesAlongCourse/);
    expect(viewer).not.toMatch(/prefetchTilesAlongCourse\s*=\s*function/);
  });

  // brief 21: 標高補完を inline 実装ではなく lib 経由で呼ぶ (= 二重実装防止)
  it('gsiToTerrariumUpsampled を web/lib/terrain_mesh.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*gsiToTerrariumUpsampled[^}]*\}\s+from\s+['"]\.\/lib\/terrain_mesh\.js['"]/);
  });

  it('addProtocol callback 内に標高 decode の inline loop が無い (= 純関数に委譲)', () => {
    // GSI decode の inline 数式 (= R*65536 + G*256 + B) は terrain_mesh.js 側に閉じる、
    // viewer 内で再定義していないことを確認
    expect(viewer).not.toMatch(/r\s*\*\s*65536\s*\+\s*g\s*\*\s*256\s*\+\s*b/);
  });

  // brief 22: trainer / bridge 不要の画面操作確認モード
  it('TEST_MODE flag を URL parameter ?test で起動する', () => {
    expect(viewer).toMatch(/TEST_MODE/);
    expect(viewer).toMatch(/URLSearchParams\(location\.search\)/);
  });

  it('initTestMode が fake state を 1Hz でループする', () => {
    expect(viewer).toMatch(/function\s+initTestMode/);
    expect(viewer).toMatch(/setInterval/);
  });

  it('TEST_MODE 時は connectBridge を skip する', () => {
    expect(viewer).toMatch(/if\s*\(\s*TEST_MODE\s*\)\s*initTestMode\(\)/);
  });

  // brief 23: GPS ジッター除去 (= 短距離ジグザグ補正のみ、 window=5)
  it('smoothCourse を web/lib/gpx_smooth.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*smoothCourse[^}]*\}\s+from\s+['"]\.\/lib\/gpx_smooth\.js['"]/);
  });

  // brief 24 + 25: 勾配グレード色分けで道路幅 polygon 描画
  it('buildGradeColoredRoadPolygons を web/lib/road_polygon.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*buildGradeColoredRoadPolygons[^}]*\}\s+from\s+['"]\.\/lib\/road_polygon\.js['"]/);
  });

  it('route layer は line ではなく fill (= 道幅 polygon)', () => {
    // route-fill layer が定義されている、 旧 route-line (only) の置き換え済
    expect(viewer).toMatch(/id:\s*['"]route-fill['"]/);
    expect(viewer).toMatch(/['"]fill-color['"]:\s*\[['"]get['"],\s*['"]color['"]\]/);
  });
});
