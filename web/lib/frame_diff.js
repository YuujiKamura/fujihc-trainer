// brief b2: viewer の per-frame コスト削減 ── 「変化した時だけ更新する」 の判定を
// 純関数に切り出して unit test 可能にする小モジュール。
//
// 背景: viewer-maplibre.js の rAF ループ tick() が毎フレーム無条件で
//   - rider GeoJSON を再構築 + GPU 再アップロード (setData)
//   - debug ラベルを 30 件超 setText
//   - minimap 2 canvas を全 clear + drawImage
// しており、 低 VRAM GPU で持続 stall を生む。 主犯は「無条件 per-frame 再構築」。
//
// この module は副作用を持たない。 viewer 側は判定関数を呼んで bool を見るだけ、
// DOM / MapLibre / Canvas への実書き込みは viewer に残す (= NG-R1-9 global 直書きで
// unit test 不能、 の回避。 変化検出ロジックだけ web/lib 配下で pin する)。

/**
 * 2 つの角度 (radian) の最短符号付き差分を [-π, π) で返す。
 * heading / spin は角度なので素朴な減算では 2π 境界を跨いだ瞬間に巨大差分になる。
 * @param {number} a
 * @param {number} b
 * @returns {number} b - a を最短回転で表した値
 */
export function angDelta(a, b) {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * rider 描画 source を再アップロード (setData) すべきかを判定。
 * 位置 (lat/lon) と heading / spin のいずれかが ε を超えて動いたら true。
 * prev が falsy (= 初回フレーム) なら常に true。
 *
 * @param {{lat:number,lon:number,heading:number,spin:number}|null} prev
 * @param {{lat:number,lon:number,heading:number,spin:number}} next
 * @param {{pos?:number,ang?:number}} [eps] - pos: 緯度経度の閾値, ang: 角度(rad)の閾値
 * @returns {boolean}
 */
export function riderFrameChanged(prev, next, eps = {}) {
  if (!prev) return true;
  // pos 1e-7 deg ≈ 1.1cm。 ang 1e-3 rad ≈ 0.057°。 これ以下の揺れは GPU 再アップロード不要。
  const posEps = eps.pos != null ? eps.pos : 1e-7;
  const angEps = eps.ang != null ? eps.ang : 1e-3;
  if (Math.abs(prev.lat - next.lat) > posEps) return true;
  if (Math.abs(prev.lon - next.lon) > posEps) return true;
  if (Math.abs(angDelta(prev.heading, next.heading)) > angEps) return true;
  if (Math.abs(angDelta(prev.spin, next.spin)) > angEps) return true;
  return false;
}

/**
 * DEM タイル URL から z/x/y 座標を取り出す。 末尾 `.../<z>/<x>/<y>.png` を拾う。
 * gsidem:// prefix 除去後の URL でも、 query 付き URL でも動く。
 * @param {string} url
 * @returns {{z:number,x:number,y:number}|null} parse 不能なら null
 */
export function parseTileCoord(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png(?:\?|$|#)/);
  if (!m) return null;
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/**
 * DEM タイル 1 枚を mesh_cache に載せる際の hash キー。 z/x/y で地理的に一意。
 * (course fingerprint とは無関係 ── タイルは course ではなく座標の関数)。
 * @param {number} z @param {number} x @param {number} y
 * @returns {string}
 */
export function terrainTileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

/**
 * DEM タイル cache の kind。 upsample 倍率を埋め込むことで、 倍率変更 (commit 8a9e355
 * の 4→2 のような) が起きた瞬間に kind が変わり旧 cache を物理的に hit させない
 * (= NG-R1-14 schema version 欠落 / silent stale drift の回避)。
 * @param {number} upsampleFactor
 * @returns {string}
 */
export function terrainCacheKind(upsampleFactor) {
  return `terrain-u${upsampleFactor}`;
}

/**
 * 値が前回と変わった時だけ DOM へ書き込む setText を生成する factory。
 * 同値フレームの textContent 代入を skip し layout 無効化の連鎖を減らす。
 *
 * @param {(id:string)=>(Element|null)} getEl - id から要素を引く関数 (test では fake を渡す)
 * @returns {(id:string, text:any)=>boolean} 書き込んだら true、 同値 skip なら false
 */
export function createTextWriter(getEl) {
  const last = new Map();
  return function setText(id, text) {
    const s = String(text);
    if (last.get(id) === s) return false;
    last.set(id, s);
    const el = getEl(id);
    if (el) el.textContent = s;
    return true;
  };
}

/**
 * minimap を再描画すべきかを判定。 rider の screen pixel 位置 (x,y) か
 * 向き (h: 度) が量子化単位で変わった時だけ true。 停止中は false で全描画を skip。
 * prev が falsy なら常に true。
 *
 * @param {{x:number,y:number,h:number}|null} prev
 * @param {{x:number,y:number,h:number}} next - h は度 (1° 量子化)
 * @returns {boolean}
 */
export function minimapDirty(prev, next) {
  if (!prev) return true;
  return Math.round(prev.x) !== Math.round(next.x)
      || Math.round(prev.y) !== Math.round(next.y)
      || Math.round(prev.h) !== Math.round(next.h);
}
