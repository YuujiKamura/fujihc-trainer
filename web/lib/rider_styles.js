// rider マーカーの GeoJSON 生成。
//
// viewer-map3d.js の rider source (= fill-extrusion レイヤー rider-body) に流す GeoJSON を
// 作る。 旧来は viewer 内のローカル関数が「自転車シルエット」(暗色車体 + cyan rider の押し出し
// 立体) を返していたが、 fill-extrusion では自転車らしさを表現できず、 上から見たリング +
// 進行方向の三角に置き換えた。 純粋関数なので単体テスト可能 (viewer-map3d.js は
// maplibre-gl / DOM 依存で単体 import 不可)。
//
// 形: 上から見た平面マーカー ── 外円 + 内円の穴を持つ annulus polygon で細いリング、
// その中に進行方向 (+y) を向いた大きい三角形。 全て fill-extrusion polygon の
// FeatureCollection、 各 feature の property は { color, base, height }。 既存 rider-body
// レイヤーがそのまま描画する (新レイヤーは足さない)。
// カメラは pitch 85° の傾き視点なので平面図形は foreshorten するが、 それで正しい。

const RING_COLOR = '#00ffff';
const FLOAT_M = 0.15;        // 地面からの浮き (m) ── 路面 polygon との z-fighting 回避 + 視認性
const RING_THICK_M = 0.08;   // リング / 三角の厚み (m) ── ほぼ平面
// rider マーカーの大きさ倍率。 路面 (幅 5m) に対して埋もれず見えるよう拡大。
const RIDER_SCALE = 1.8;
const RING_OUTER_M = 1.20 * RIDER_SCALE;  // リング外円の半径 (m)
const RING_INNER_M = 1.02 * RIDER_SCALE;  // リング内円の半径 (m)

/**
 * rider 中心の局所平面座標 (メートル, +y = 進行方向) を [lng, lat] に変換する関数を返す.
 */
function makeProjector(lat, lon, heading) {
  const M_LAT = 1 / 111320;
  const M_LON = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  return (x, y) => {
    const rx = x * cosH + y * sinH;
    const ry = -x * sinH + y * cosH;
    return [lon + rx * M_LON, lat + ry * M_LAT];
  };
}

/** 局所座標の頂点列 [[x,y],...] を閉じた polygon feature にする (= 1 外周リング). */
function polyFeature(proj, pts, color, base, height) {
  const ring = pts.map(([x, y]) => proj(x, y));
  ring.push(ring[0]);  // 閉合
  return {
    type: 'Feature',
    properties: { color, base, height },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** 円周の頂点列を局所座標で返す (閉合はしない、 呼び側で閉じる). */
function circlePts(cx, cy, r, n = 36) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * rider マーカー (= リング + 進行方向の三角) の GeoJSON を生成する.
 *
 * @param {number} lat rider の緯度
 * @param {number} lon rider の経度
 * @param {number} heading 進行方向 (rad)
 * @param {number} [spin] 自転車のスピン角 ── 現マーカーでは未使用、 signature 互換のため受ける
 * @returns {{type:'FeatureCollection', features:Array}}
 */
export function buildRiderFeatures(lat, lon, heading /* , spin */) {
  const proj = makeProjector(lat, lon, heading);

  // リング: 外円 RING_OUTER_M / 内円 RING_INNER_M の細い輪。 外円 + 内円の穴を持つ
  // annulus polygon (= 2 リング目が穴、 fill で輪になる)。 地面から少し浮かせる。
  const outer = circlePts(0, 0, RING_OUTER_M);
  const inner = circlePts(0, 0, RING_INNER_M);
  const ringFeature = {
    type: 'Feature',
    properties: { color: RING_COLOR, base: FLOAT_M, height: FLOAT_M + RING_THICK_M },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [...outer.map(([x, y]) => proj(x, y)), proj(outer[0][0], outer[0][1])],
        [...inner.map(([x, y]) => proj(x, y)), proj(inner[0][0], inner[0][1])],
      ],
    },
  };

  // 進行方向の三角形: 頂点が +y (= heading 方向)、 底辺が後方。 内円いっぱいまで
  // 広げた大きい三角形でリングの中をほぼ埋める。 リングと同じだけ地面から浮かせる。
  // 基準形 [[0,1.0],[-0.82,-0.52],[0.82,-0.52]] を RIDER_SCALE 倍する。
  const triangle = polyFeature(
    proj,
    [[0, 1.0 * RIDER_SCALE], [-0.82 * RIDER_SCALE, -0.52 * RIDER_SCALE], [0.82 * RIDER_SCALE, -0.52 * RIDER_SCALE]],
    RING_COLOR, FLOAT_M, FLOAT_M + RING_THICK_M,
  );

  return { type: 'FeatureCollection', features: [ringFeature, triangle] };
}
