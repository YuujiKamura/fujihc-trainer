// 地図描画モジュール (b12 Phase 2).
//
// viewer-maplibre.js に散っていた MapLibre 直接依存 ―― プロトコル登録 / style 構築 /
// 地図インスタンス生成 / source・layer 操作 / カメラ操作 ―― を 1 つに集約する。
// viewer 本体は map インスタンスを持たず、 createMapRenderer() が返す renderer の
// メソッド経由でしか地図を触らない (= 差し替え口 / 描画エンジンの seam)。
//
// この Phase では中身は MapLibre のまま (= 動作不変)。 Phase 3 で同じメソッド群を
// Three.js 実装で満たし、 viewer 本体は無改修で描画エンジンだけ差し替わる。
//
// maplibregl は index.html の <script src="...maplibre-gl.js"> が立てる global を参照する
// (= viewer-maplibre.js が従来そうしていたのと同じ、 import せず global)。

import { gsiToTerrariumUpsampled } from './terrain_mesh.js';
import { parseTileCoord, terrainTileKey, terrainCacheKind } from './frame_diff.js';
import { getMeshCache, setMeshCache } from './mesh_cache.js';
import { registerPmtilesProtocol } from './pmtiles_loader.js';

// upsample 倍率. 2 で 256x256 -> 512x512。 bilinear upsample は元 DEM に無い情報を
// 生まない (= ただの補間)、 4 は 1 タイル 4 MB RGBA を生んで VRAM / 転送帯域を浪費する。
// 低 VRAM GPU (= RX 6400 等) では DEM テクスチャ転送が描画の支配項になるため 2 に下げる。
const TERRAIN_UPSAMPLE_FACTOR = 2;

// タイル取得経路の base URL (= viewer-maplibre.js と同一の location 由来導出)。
// BRIDGE: bridge.py が proxy する localhost /tiles/...、 STATIC: GitHub Pages 静的経路。
const BASE_PATH = location.pathname.replace(/\/[^/]*$/, '/');
const BRIDGE_TILE_BASE_URL = `${location.origin}/tiles`;
const STATIC_TILE_BASE_URL = `${location.origin}${BASE_PATH}static`;

// === GSI 標高 PNG を terrarium 形式 PNG に変換するカスタムプロトコル ===
// brief 21: 変換ロジックは web/lib/terrain_mesh.js に切出し済 (= test 6 件で pin)、
// ここはタイル DL + Canvas decode + lib 呼出 + Blob 出力の thin adapter のみ.
// b12 Phase 2: viewer-maplibre.js module top から移設 (= 登録タイミングは import 時で不変)。
maplibregl.addProtocol('gsidem', (params) => {
  const url = params.url.replace(/^gsidem:\/\//, '');
  return new Promise((resolve, reject) => {
    // brief b2 Critical-2: terrarium 変換結果 (= 重い CPU 処理) を mesh_cache に persist。
    // key = z/x/y タイル座標、 kind = terrain-u<倍率> (= 倍率変更で旧 cache を物理的に
    // hit させず stale を防ぐ)。 2 回目以降は DL + Canvas decode + upsample を完全 bypass。
    const coord = parseTileCoord(url);
    const cacheKind = terrainCacheKind(TERRAIN_UPSAMPLE_FACTOR);
    const tileKey = coord ? terrainTileKey(coord.z, coord.x, coord.y) : null;

    // 既存経路: タイル DL → Canvas decode → 純関数 upsample → PNG bytes。
    // 成功時、 PNG bytes を mesh_cache へ fire-and-forget で書く (= 書き込み失敗で
    // 起動を block しない、 次回 reload で再 attempt)。
    const decodeAndUpsample = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const W = img.width, H = img.height;
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = W; srcCanvas.height = H;
        const sctx = srcCanvas.getContext('2d');
        sctx.drawImage(img, 0, 0);
        let srcImage;
        try { srcImage = sctx.getImageData(0, 0, W, H); }
        catch (e) { reject(e); return; }
        // 純関数で bilinear upsample + GSI -> terrarium 変換 (= brief 21).
        const result = gsiToTerrariumUpsampled(srcImage.data, W, H, TERRAIN_UPSAMPLE_FACTOR);
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = result.width;
        dstCanvas.height = result.height;
        const dctx = dstCanvas.getContext('2d');
        const dstImage = dctx.createImageData(result.width, result.height);
        dstImage.data.set(result.data);
        dctx.putImageData(dstImage, 0, 0);
        dstCanvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          blob.arrayBuffer().then((buf) => {
            const bytes = new Uint8Array(buf);
            if (tileKey) {
              setMeshCache(tileKey, cacheKind, { png: bytes }).catch(() => {});
            }
            resolve({ data: bytes });
          }).catch(reject);
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('GSI tile load failed: ' + url));
      img.src = url;
    };

    if (tileKey) {
      // cache lookup → hit で decode/upsample を bypass。 miss / 例外いずれも
      // getMeshCache は null を返すので既存経路に fail-open する。
      getMeshCache(tileKey, cacheKind).then((rec) => {
        if (rec && rec.arrays && rec.arrays.png) {
          resolve({ data: rec.arrays.png });
        } else {
          decodeAndUpsample();
        }
      }).catch(() => decodeAndUpsample());
    } else {
      decodeAndUpsample();
    }
  });
});

// === Map style 構築 ===
// brief 31: bridge mode と GitHub Pages 静的 mode で source URL が違うため、
// style 構築を 1 関数に切り出して 2 mode 共有。
// COMMON_LAYERS / COMMON_SKY は mode 非依存 (= layers は source.id 名で参照、
// 物理化された 1 コピー、 NG-R1-11 双子コピペ回避)。
export const COMMON_LAYERS = [
  // 背景の単色 (= PMTiles 未整備時の fallback、 灰白で地形の凹凸が見える)
  { id: 'bg', type: 'background', paint: { 'background-color': '#e8e8e8' } },
  // Protomaps の標準 vector layer (= name は Protomaps OpenMapTiles 互換 schema 前提)
  // PMTiles に layer が存在しない場合は MapLibre が silent skip、 fallback bg が見える
  { id: 'earth', type: 'fill', source: 'osm', 'source-layer': 'earth',
    paint: { 'fill-color': '#f5f5f0' } },
  { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water',
    paint: { 'fill-color': '#a8d8ea' } },
  { id: 'landuse-forest', type: 'fill', source: 'osm', 'source-layer': 'landuse',
    filter: ['in', 'kind', 'forest', 'wood', 'park'],
    paint: { 'fill-color': '#cfe7c8', 'fill-opacity': 0.7 } },
  { id: 'roads', type: 'line', source: 'osm', 'source-layer': 'roads',
    paint: { 'line-color': '#888', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 1.5, 22, 6] } },
  { id: 'roads-major', type: 'line', source: 'osm', 'source-layer': 'roads',
    filter: ['in', 'kind', 'highway', 'major_road'],
    paint: { 'line-color': '#ffb84d', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 15, 3, 22, 12] } },
  // 地形シェーディング + 光源方向 (= 朝の太陽を南東から、 山の片面を明るく / 反対面を陰に).
  // illumination-direction 135 = 南東 (= 0=北、 90=東、 180=南、 270=西)、
  // illumination-anchor 'map' で地理北基準 (= viewport rotate に追従しない).
  // exaggeration 1.0 + shadow #000000 + highlight #ffffff で凹凸クッキリ.
  { id: 'hillshade', type: 'hillshade', source: 'gsi-terrain',
    paint: {
      'hillshade-exaggeration': 1.0,
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#ffffff',
      'hillshade-accent-color': '#404040',
      'hillshade-illumination-direction': 135,
      'hillshade-illumination-anchor': 'map',
    } },
  // brief 17b: prefetch 削除済、 fetch 経路は MapLibre on-demand のみ
];

// 空のグラデ: 上が濃青、 下 (= 水平線寄り) が白っぽい (= 朝/昼の自然な空).
export const COMMON_SKY = { 'sky-color': '#3a7cc4', 'horizon-color': '#e8f0f8', 'fog-color': '#d8d0c8' };

// 地図 style を組み立てる。 dbBounds は course 定義由来の DB bbox
// [sw_lon, sw_lat, ne_lon, ne_lat]、 source に bounds として渡すと「この範囲外は
// 要求しない」を MapLibre に伝えられる (= 範囲外 tile の 404 量産抑制、 brief 34 ε-7)。
export function buildMapStyle(env, dbBounds) {
  // env (= immutable ENV object) 受け、 bridgeReachable は env.mode で判定。
  // 後方互換のため `{bridgeReachable: bool}` を渡されても動く。
  const bridgeReachable = env && (env.mode === 'bridge' || env.bridgeReachable === true);
  // bridge mode: 個別 PBF / PNG file ツリーを localhost /tiles から fetch (= 従来)。
  // static mode: PMTiles 単一 file (pmtiles:// scheme) + ${BASE_PATH}static/tiles/gsi_dem 配下 PNG。
  const sources = bridgeReachable
    ? {
        'osm': {
          type: 'vector',
          tiles: [`${BRIDGE_TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf`],
          minzoom: 13,
          maxzoom: 15,
          bounds: dbBounds,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${BRIDGE_TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          bounds: dbBounds,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      }
    : {
        'osm': {
          type: 'vector',
          url: `pmtiles://${STATIC_TILE_BASE_URL}/map.pmtiles`,
          bounds: dbBounds,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${STATIC_TILE_BASE_URL}/tiles/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          bounds: dbBounds,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      };
  return { version: 8, sources, layers: COMMON_LAYERS, sky: COMMON_SKY };
}

// === Renderer factory ===
// viewer 本体は createMapRenderer() を 1 回呼んで renderer を得る。 地図インスタンスは
// renderer の内側に閉じ、 viewer は下記メソッド群でのみ地図を操作する。
export function createMapRenderer() {
  let map = null;
  // 'idle' (= viewport 内の全 tile load + render 完了) は MapLibre 仕様上 1 度だけ発火する。
  // 複数の購読者 (= viewer の terrain gate、 MAP MODE の ride 開始待ち) が居るため、
  // 発火済 flag + 購読リストで「後から購読しても 1 度は必ず呼ばれる」を保証する。
  let idleFired = false;
  const idleCbs = [];
  // start / goal の MapLibre Marker (= ride 中 hide 用、 setStartGoalMarkers で生成)。
  let startGoalMarkers = [];

  function fireIdle() {
    if (idleFired) return;
    idleFired = true;
    const cbs = idleCbs.splice(0);
    for (const cb of cbs) {
      try { cb(); } catch (e) { console.warn('[map_renderer] idle callback failed:', e); }
    }
  }

  return {
    // --- ライフサイクル ---
    isBooted() { return map !== null; },

    // 地図インスタンスを生成し、 load / idle / error を結線する。
    // opts: { dbBounds, dbCenter, onLoaded }。 onLoaded は setTerrain + 操作系 disable 完了後、
    // viewer 側の起動継続 (= status / loadCourse / カメラ入力 bind) を回す callback。
    boot(env, opts) {
      opts = opts || {};
      // pmtiles:// protocol は idempotent (= 冪等)、 bridge mode でも害なし。
      if (typeof window !== 'undefined' && window.pmtiles) {
        try { registerPmtilesProtocol(maplibregl, window.pmtiles); }
        catch (e) { console.warn('pmtiles protocol register failed:', e && e.message); }
      }
      map = new maplibregl.Map({
        container: 'map',
        style: buildMapStyle(env, opts.dbBounds),
        // default center を DB bbox 中央に寄せて、 起動直後の view を確実に DB 範囲内に収める。
        center: opts.dbCenter,
        zoom: 13,
        pitch: 60,
        bearing: 0,
        // pitch を default 60 → 85 まで拡張、 zoom 上限も MapLibre の最大 22 まで開放
        maxPitch: 85,  // MapLibre 仕様上の最大値 (= 89 にすると new Map で throw、 map 起動失敗).
        minPitch: 0,
        maxZoom: 24,
        minZoom: 13,
        // タイル memory cache. GSI dem を upsample すると 1 タイルが重い、 50 で約 200 MB 上限。
        maxTileCacheSize: 50,
        // タイルのクロスフェード短縮、 GPU 負荷軽減
        fadeDuration: 0,
      });
      // 2026-05-17 fix: load handler の本体を onMapLoad に括り出し、 'load' 発火と
      // 8 秒 fallback の両方から呼べるようにする (= Range request 非対応サーバ等で
      // 'load' が永遠に発火しない MapLibre 挙動への安全弁)。 _loadHandled で多重実行防止。
      let _loadHandled = false;
      const self = this;
      function onMapLoad() {
        if (_loadHandled) return;
        _loadHandled = true;
        // setTerrain は style 読込後でないと throw する。 style 未完なら try-catch で握り潰し、
        // 地形なしでも course / rider 描画は続行する (= fail-open)。
        try { map.setTerrain({ source: 'gsi-terrain', exaggeration: 1.0 }); }
        catch (e) { console.warn('setTerrain skipped:', e && e.message); }
        // 操作系: マウスホイール zoom / 縦ドラッグ pitch は viewer 側が自前で結線するため、
        // MapLibre 標準の rotate / pan / scrollZoom は無効化する。
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        map.dragPan.disable();
        map.scrollZoom.disable();
        // 'idle' = viewport 内の全 source / tile load 完了。 購読者に 1 度だけ配る。
        map.once('idle', fireIdle);
        if (typeof opts.onLoaded === 'function') opts.onLoaded();
      }
      map.on('load', onMapLoad);
      // fallback: 8 秒待っても 'load' が来なければ強制で onMapLoad を実行。
      setTimeout(() => {
        if (!_loadHandled) {
          console.warn('[fujihill] map load イベント 8 秒未発火、 fallback で起動続行');
          onMapLoad();
        }
      }, 8000);
      map.on('error', (e) => {
        // e.error の中身まで出す (= '[object Object]' だけだとデバッグ不能)。
        const err = e && e.error;
        const detail = err && (err.message || err.url) ? (err.message || err.url) : (err ?? e);
        console.warn('maplibre error:', detail);
      });
      return map;
    },

    // 'idle' を購読する。 既に idle 発火済なら即時 cb を呼ぶ (= 後追い購読でも 1 度は確実)。
    onceIdle(cb) {
      if (typeof cb !== 'function') return;
      if (idleFired) { try { cb(); } catch (e) { console.warn('[map_renderer] idle callback failed:', e); } }
      else idleCbs.push(cb);
    },

    // --- source / layer (= コース描画) ---
    hasSource(id) { return !!(map && map.getSource && map.getSource(id)); },
    addSource(id, def) { map.addSource(id, def); },
    addLayer(def) { map.addLayer(def); },
    hasImage(id) { return !!(map && map.hasImage && map.hasImage(id)); },
    addImage(id, image) { map.addImage(id, image); },
    // geojson source の data を差し替える (= source 未生成なら no-op、 呼び側の存在 check 不要)。
    setSourceData(id, data) {
      const src = map && map.getSource && map.getSource(id);
      if (src && src.setData) src.setData(data);
    },

    // --- start / goal マーカー ---
    // start (緑) / goal (赤) の pin を立てる。 既存マーカーがあれば作り直す。
    setStartGoalMarkers(startLngLat, goalLngLat) {
      for (const m of startGoalMarkers) { try { m.remove(); } catch {} }
      startGoalMarkers = [
        new maplibregl.Marker({ color: '#7fff00' }).setLngLat(startLngLat).addTo(map),
        new maplibregl.Marker({ color: '#ff3030' }).setLngLat(goalLngLat).addTo(map),
      ];
    },
    // ride 中はメイン map から start/goal を退ける (= minimap には残る)。
    setStartGoalMarkersVisible(visible) {
      for (const m of startGoalMarkers) {
        const el = m.getElement && m.getElement();
        if (el) el.style.display = visible ? 'block' : 'none';
      }
    },

    // --- カメラ (= 毎フレーム / 操作入力) ---
    jumpTo(camera) { map.jumpTo(camera); },
    // 地理座標 [lng, lat] を画面 pixel に投影する (= rider 追随 HUD の座標計算)。
    project(lngLat) { return map.project(lngLat); },
    getZoom() { return map.getZoom(); },
    getPitch() { return map.getPitch(); },
    getCenter() { return map.getCenter(); },
    setZoom(z) { map.setZoom(z); },
    setPitch(p) { map.setPitch(p); },
    // wheel / drag イベントを bind する対象の DOM 要素 (= 地図 canvas の container)。
    getContainerEl() { return map.getContainer(); },

    // --- layer プロパティ調整 (= ラベルサイズ / 距離窓 / 光源 slider) ---
    hasLayer(id) { return !!(map && map.getLayer && map.getLayer(id)); },
    setLayoutProperty(layerId, name, value) { map.setLayoutProperty(layerId, name, value); },
    setFilter(layerId, filter) { map.setFilter(layerId, filter); },
    setPaintProperty(layerId, name, value) { map.setPaintProperty(layerId, name, value); },
  };
}
