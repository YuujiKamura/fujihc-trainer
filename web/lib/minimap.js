// b51: viewer-map3d.js の minimap (course polyline + OSM 1-shot + 標高プロファイル)
// を切り出した framework 非依存モジュール。
//
// createMinimap() factory が minimap の状態 (上下 base 画像 / 共有幾何 stats /
// per-frame 再描画判定フレーム) を内側に閉じ込める。viewer は buildTopBase /
// buildBottomBase / update を呼ぶだけ。DOM canvas (#minimap-top / #minimap-bottom)
// は従来どおり id で参照する (= DOM 契約の再設計は b51 の対象外、 挙動不変を保つ)。
//
// 元コードからの差分は「viewer のモジュールグローバルを引数 / closure に移した」のみ。
// 描画ロジックは brief 29 当時のまま。

import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from './tile_math.js';
import { minimapDirty } from './frame_diff.js';

export function createMinimap() {
  // minimapTopBase: 上半分 (#minimap-top) の base 画像 (off-screen canvas)、 1 回作成。
  // minimapBottomBase: 下半分 (#minimap-bottom) の標高プロファイル base 画像、 1 回作成。
  // minimapStats: 上下共有の幾何 (= 上半分は projectLatLon / rotateTop、 下半分は
  //   minE/maxE/totalD/PAD/botInner*/botBaseY/botTopY)。
  let minimapTopBase = null;
  let minimapBottomBase = null;
  let minimapStats = null;
  // brief b2 High-5: getContext は lazy 1 回キャッシュ、 前フレーム値で再描画判定。
  let _minimapTopCtx = null;
  let _minimapBotCtx = null;
  let _minimapTopFrame = null;  // 前フレームの rider 位置/向き (= 上 canvas 再描画判定)
  let _minimapBotFrame = null;  // 前フレームの dot 位置 (= 下 canvas 再描画判定)

  // loadOsmTile: brief 30 で DB cache 化、 brief 31 で mode 分岐。
  // bridge mode: 一次 ${bridgeTileBase}/osm_raster/{z}/{x}/{y}.png (= bridge.py が SQLite から PNG)。
  // static mode (= GitHub Pages): minimap 用 OSM raster を bridge に依存するため一次経路を
  //   最初から無効化 (= 即 resolve)。 bridge URL を叩くと static 訪問者が公式 tile server を
  //   heavy use する第三者 harm vector になる。
  // 失敗時は resolve のみ (= reject しない)。 cache miss は silent resolve、 該当タイルは透明で OK。
  function loadOsmTile(ctx, tx, ty, z, projectLatLon, clipRect, env, bridgeTileBase) {
    return new Promise((resolve) => {
      if (!env || env.mode !== 'bridge') {
        resolve();
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const lonW = tileXToLon(tx, z), lonE = tileXToLon(tx + 1, z);
        const latN = tileYToLat(ty, z), latS = tileYToLat(ty + 1, z);
        const [x1, y1] = projectLatLon(latN, lonW);
        const [x2, y2] = projectLatLon(latS, lonE);
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
        ctx.clip();
        ctx.drawImage(img, x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
        resolve();
      };
      img.onerror = () => {
        // OSM 公式への直叩き fallback は撤去済 (= CSP img-src 違反 + 第三者 heavy use 回避)。
        resolve();
      };
      // brief 30 一次経路: bridge 経由で DB tiles table から hit (= source='osm_raster')。
      img.src = `${bridgeTileBase}/osm_raster/${z}/${tx}/${ty}.png`;
    });
  }

  // drawDirTriangle: rider の進行方向を示す三角形を canvas 上半分に描画。
  function drawDirTriangle(ctx, x, y, heading, size) {
    const cosH = Math.cos(heading), sinH = Math.sin(heading);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(sinH * size, -cosH * size);
    ctx.lineTo(sinH * -size * 0.6 + cosH * size * 0.6, -cosH * -size * 0.6 + sinH * size * 0.6);
    ctx.lineTo(sinH * -size * 0.6 - cosH * size * 0.6, -cosH * -size * 0.6 - sinH * size * 0.6);
    ctx.closePath();
    ctx.fillStyle = 'cyan';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 上半分 (#minimap-top) の base 画像を生成。9-16 OSM タイル (= z=11) を 1-shot 並列
  // fetch、 course polyline + start/goal dot を描き 180 度回転して minimapTopBase に保存。
  // env / bridgeTileBase / httpBase / skipTerrain は viewer から渡す (= 元モジュール
  // グローバル ENV / BRIDGE_TILE_BASE_URL / HTTP_BASE_URL / SKIP_TERRAIN)。
  async function buildTopBase({ course, env, bridgeTileBase, httpBase, skipTerrain }) {
    const onscreen = document.getElementById('minimap-top');
    if (!onscreen || course.length === 0) return;
    // brief 30: 起動時 1 回、 bridge に minimap raster の DB cache 構築を fire-and-forget で依頼。
    // b41: ?noterrain= では依頼を出さない (= e2e bridge の 501 で console error を汚さない)。
    if (!skipTerrain) {
      fetch(`${httpBase}/tiles/_fetch_minimap_raster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => { /* silent: fallback は loadOsmTile が担う */ });
    }
    const W = onscreen.width, H = onscreen.height;
    const PAD = 12;
    // course bbox を 20% margin で広げる
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of course) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const latM = (maxLat - minLat) * 0.20, lonM = (maxLon - minLon) * 0.20;
    minLat -= latM; maxLat += latM; minLon -= lonM; maxLon += lonM;
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.cos(midLat * Math.PI / 180);
    const dLat = maxLat - minLat, dLon = (maxLon - minLon) * lonScale;
    const innerW = W - 2 * PAD, innerH = H - 2 * PAD;
    const scale = Math.min(innerW / dLon, innerH / dLat);
    const projW = dLon * scale, projH = dLat * scale;
    const offsetX = PAD + (innerW - projW) / 2;
    const offsetY = PAD + (innerH - projH) / 2;
    // 普通の projection (北上向き)、 180 度回転は最後に canvas 全体に rotate を掛けて実現
    function project(lat, lon) {
      const x = offsetX + (lon - minLon) * lonScale * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return [x, y];
    }
    minimapStats = Object.assign(minimapStats || {}, {
      projectLatLon: project,
      rotateTop: { W, H },
    });

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.fillStyle = 'rgba(10,18,18,0.88)';
    ctx.fillRect(0, 0, W, H);

    // OSM タイル 1-shot 並列 fetch (= z=11 周辺、 buffer=1 で 9-16 タイル)
    const z = 11;
    const buffer = 1;
    const minTx = Math.floor(lonToTileX(minLon, z)) - buffer;
    const maxTx = Math.floor(lonToTileX(maxLon, z)) + buffer;
    const minTy = Math.floor(latToTileY(maxLat, z)) - buffer;
    const maxTy = Math.floor(latToTileY(minLat, z)) + buffer;
    const clip = { x: PAD, y: PAD, w: W - 2 * PAD, h: H - 2 * PAD };
    const ps = [];
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        ps.push(loadOsmTile(ctx, tx, ty, z, project, clip, env, bridgeTileBase));
      }
    }
    await Promise.all(ps);

    // course polyline (= muted amber)
    ctx.beginPath();
    for (let i = 0; i < course.length; i++) {
      const [x, y] = project(course[i].lat, course[i].lon);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 3;
    ctx.stroke();
    // start dot (= soft green)
    const [sx, sy] = project(course[0].lat, course[0].lon);
    ctx.fillStyle = '#62d0a2';
    ctx.strokeStyle = '#07110f';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    // goal dot (= soft red)
    const [gx, gy] = project(course[course.length - 1].lat, course[course.length - 1].lon);
    ctx.fillStyle = '#e56b6f';
    ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

    // 180 度回転 (= 画面下が進行方向前方になる視覚整合)
    const copy = document.createElement('canvas');
    copy.width = W; copy.height = H;
    copy.getContext('2d').drawImage(off, 0, 0);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI);
    ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(copy, 0, 0);
    ctx.restore();

    minimapTopBase = off;
  }

  // 下半分 (#minimap-bottom) の標高プロファイル base 画像。
  function buildBottomBase({ course, terrain }) {
    const onscreen = document.getElementById('minimap-bottom');
    // terrain 未生成 / totalDistance=0 (= 単一点 course 等) は早期 return。
    if (!onscreen || course.length === 0 || !terrain || terrain.totalDistance === 0) return;
    const W = onscreen.width, H = onscreen.height;
    const PAD = 12;
    const eles = course.map(p => p.elevation_m);
    const minE = Math.min(...eles), maxE = Math.max(...eles);
    // x 軸は terrain の haversine 累積長 (= rider dot の curDistM と同一スケール)。
    const totalD = terrain.totalDistance;
    const botInnerW = W - 2 * PAD;
    const botInnerH = H - 2 * PAD;
    const botBaseY = H - PAD;
    const botTopY = PAD;
    minimapStats = Object.assign(minimapStats || {}, {
      minE, maxE, totalD, PAD, botInnerW, botInnerH, botBaseY, botTopY,
    });

    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.fillStyle = 'rgba(10,18,18,0.88)'; ctx.fillRect(0, 0, W, H);
    // 標高プロファイルの塗り (= gradient)
    ctx.beginPath(); ctx.moveTo(PAD, botBaseY);
    for (let i = 0; i < course.length; i++) {
      const p = course[i];
      const x = PAD + (terrain.distanceAtIdx(i) / totalD) * botInnerW;
      const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(PAD + botInnerW, botBaseY); ctx.closePath();
    const grad = ctx.createLinearGradient(0, botTopY, 0, botBaseY);
    grad.addColorStop(0, 'rgba(98,208,162,0.62)');
    grad.addColorStop(1, 'rgba(242,193,78,0.14)');
    ctx.fillStyle = grad; ctx.fill();
    // 標高プロファイルの白線
    ctx.beginPath();
    for (let i = 0; i < course.length; i++) {
      const p = course[i];
      const x = PAD + (terrain.distanceAtIdx(i) / totalD) * botInnerW;
      const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#eef4f1'; ctx.lineWidth = 2; ctx.stroke();
    // min/max 標高ラベル
    ctx.fillStyle = '#9aaaa5'; ctx.font = '14px ui-monospace, monospace';
    ctx.fillText(`${maxE.toFixed(0)}m`, 4, botTopY + 14);
    ctx.fillText(`${minE.toFixed(0)}m`, 4, botBaseY - 4);
    minimapBottomBase = off;
  }

  // 上下 2 canvas に base 画像を drawImage + rider 描画。rider が量子化単位で動いた
  // フレームだけ再描画する (= 停止中は skip)。
  function update(curDistM, curEleM, curLat, curLon, heading) {
    if (!minimapStats) return;

    const topCanvas = document.getElementById('minimap-top');
    const botCanvas = document.getElementById('minimap-bottom');
    const hasTop = topCanvas && minimapTopBase && minimapStats.projectLatLon;
    const hasBot = botCanvas && minimapBottomBase;
    if (!hasTop && !hasBot) return;

    const { minE, maxE, totalD, PAD, botInnerW, botInnerH, botBaseY, botTopY } = minimapStats;
    // 上半分 rider 位置 (= 描画前に算出して変化検出に使う)
    let rx = 0, ry = 0;
    if (hasTop) { [rx, ry] = minimapStats.projectLatLon(curLat, curLon); }
    // 下半分 dot 位置
    const px = PAD + (curDistM / totalD) * botInnerW;
    const py = botBaseY - ((curEleM - minE) / (maxE - minE)) * botInnerH;

    // 上 rider と下 dot のいずれかが量子化単位で動いたら再描画。
    const frame = { x: rx, y: ry, h: heading * 180 / Math.PI };
    const botMoved = !_minimapBotFrame
      || Math.round(_minimapBotFrame.px) !== Math.round(px)
      || Math.round(_minimapBotFrame.py) !== Math.round(py);
    if (!minimapDirty(_minimapTopFrame, frame) && !botMoved) return;
    _minimapTopFrame = frame;
    _minimapBotFrame = { px, py };

    // 上半分: #minimap-top ── rider 三角形を 180 度回転後の座標系で描画
    if (hasTop) {
      if (!_minimapTopCtx) _minimapTopCtx = topCanvas.getContext('2d');
      const tctx = _minimapTopCtx;
      tctx.clearRect(0, 0, topCanvas.width, topCanvas.height);
      tctx.drawImage(minimapTopBase, 0, 0);
      const { W, H } = minimapStats.rotateTop;
      tctx.save();
      tctx.translate(W / 2, H / 2);
      tctx.rotate(Math.PI);
      tctx.translate(-W / 2, -H / 2);
      drawDirTriangle(tctx, rx, ry, heading, 9);
      tctx.restore();
    }

    // 下半分: #minimap-bottom
    if (hasBot) {
      if (!_minimapBotCtx) _minimapBotCtx = botCanvas.getContext('2d');
      const ctx = _minimapBotCtx;
      ctx.clearRect(0, 0, botCanvas.width, botCanvas.height);
      ctx.drawImage(minimapBottomBase, 0, 0);
      ctx.strokeStyle = 'rgba(0,220,220,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, botTopY); ctx.lineTo(px, botBaseY); ctx.stroke();
      ctx.fillStyle = 'cyan'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
  }

  return { buildTopBase, buildBottomBase, update };
}
