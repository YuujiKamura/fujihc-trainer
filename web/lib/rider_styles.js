// rider マーカーの表示スタイル。
//
// viewer-maplibre.js の rider source (= fill-extrusion レイヤー rider-body) に流す GeoJSON を
// 生成する。 旧来は viewer 内のローカル関数 buildRiderFeatures 1 個が「自転車シルエット」
// 固定の GeoJSON を作っていた。 複数スタイルから選べるよう、 スタイル別の純粋関数に分割し
// この module に切り出した。 純粋関数なので単体テスト可能 (viewer-maplibre.js は
// maplibre-gl / DOM 依存で単体 import 不可)。
//
// 全スタイルとも fill-extrusion polygon の FeatureCollection を返す ── 既存 rider-body
// レイヤーがそのまま描画する (新レイヤーは足さない)。 各 feature の property は
// { color, base, height }。 平面マーカー (gits) は height を小さくしてほぼ平面にする。
// カメラは pitch 85° の傾き視点なので平面図形は foreshorten するが、 それで正しい。

/** 選べる rider 表示スタイル。 viewer のピッカーはこの配列を単一の出所として populate する。 */
export const RIDER_STYLES = [
  { id: 'bike', label: '自転車シルエット' },
  { id: 'gits', label: 'リング + 進行方向の三角' },
];

/** 既定スタイル。 localStorage に有効値が無い / 不正値の時のフォールバック先。 */
export const DEFAULT_RIDER_STYLE = 'bike';

/** style 文字列が RIDER_STYLES の有効 ID か (= localStorage 改竄値 / 空 / null の allowlist 照合)。 */
export function isValidRiderStyle(style) {
  return typeof style === 'string' && RIDER_STYLES.some((s) => s.id === style);
}

/**
 * rider 中心の局所平面座標 (メートル, +y = 進行方向) を [lng, lat] に変換する関数を返す.
 * 旧 buildRiderFeatures の toLngLat と同一式 (= bike スタイルを 1bit も変えないため).
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

/** 円周の頂点列を局所座標で返す (閉合はしない、 呼び側で feature 化時に閉じる). */
function circlePts(cx, cy, r, n = 36) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// === スタイル [bike] = 現行の自転車シルエット ============================
// 旧 viewer の buildRiderFeatures をそのまま移植 (= 暗色車体 + cyan rider の押し出し立体)。
function buildRiderBike(lat, lon, heading /* , spin */) {
  const proj = makeProjector(lat, lon, heading);
  const rect = (x0, x1, y0, y1, color, base, height) =>
    polyFeature(proj, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], color, base, height);
  return {
    type: 'FeatureCollection',
    features: [
      rect(-0.22, 0.22, -0.95, 0.95, '#23272f', 0, 0.55),    // 車体: 低く長い暗色
      rect(-0.21, 0.21, -0.28, 0.34, '#00ffff', 0.55, 1.9),  // rider: cyan、 車体上に立つ
    ],
  };
}

// === スタイル [gits] = リング + 進行方向の三角 ============================
// 上から見た平面マーカー。 外円 + 内円の穴を持つ annulus polygon で細い「リング」を、
// その中に進行方向 (+y) を向いた大きい三角形を描く。 height はごく小さくほぼ平面。
function buildRiderGits(lat, lon, heading) {
  const proj = makeProjector(lat, lon, heading);
  // リング: 外円 1.20m / 内円 1.02m ── 幅 0.18m の細い輪。
  const outer = circlePts(0, 0, 1.20);
  const inner = circlePts(0, 0, 1.02);
  const ringFeature = {
    type: 'Feature',
    properties: { color: '#00ffff', base: 0, height: 0.08 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [...outer.map(([x, y]) => proj(x, y)), proj(outer[0][0], outer[0][1])],
        [...inner.map(([x, y]) => proj(x, y)), proj(inner[0][0], inner[0][1])],
      ],
    },
  };
  // 進行方向の三角形: 頂点が +y (= heading 方向)、 底辺が後方。 内円 (1.02m) いっぱいまで
  // 広げた大きい三角形 ── リングの中をほぼ埋める。
  const triangle = polyFeature(
    proj,
    [[0, 1.0], [-0.82, -0.52], [0.82, -0.52]],
    '#00ffff', 0, 0.10,
  );
  return { type: 'FeatureCollection', features: [ringFeature, triangle] };
}

/**
 * 選択スタイルで rider GeoJSON を生成する dispatch 関数.
 * 不正 / 未知の style は bike にフォールバック.
 *
 * @param {string} style RIDER_STYLES の ID
 * @param {number} lat rider の緯度
 * @param {number} lon rider の経度
 * @param {number} heading 進行方向 (rad)
 * @param {number} [spin] 自転車のスピン角 (bike スタイルでも現状未使用、 signature 互換のため受ける)
 * @returns {{type:'FeatureCollection', features:Array}}
 */
export function buildRiderFeatures(style, lat, lon, heading, spin) {
  switch (style) {
    case 'gits': return buildRiderGits(lat, lon, heading);
    case 'bike':
    default:     return buildRiderBike(lat, lon, heading, spin);
  }
}
