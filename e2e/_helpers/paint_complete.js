// e2e 共通 paint 完了 assert helper. b130 で導入.
//
// 「mock fulfill で fetch は走るが、 実 paint が完了したかは assert しない」 という
// 構造的弱点を全 e2e spec で物理層 block するための共有 API.
//
// 3 layer:
//   1. MapLibre 描画ループの idle event (= mapRenderer.onceIdle hook 経由)
//   2. minimap canvas に非空 pixel が存在する (= 「fetch は走ったが描かれてない」 block)
//   3. Three.js terrain mesh が scene に乗ったか (= ?noterrain=1 spec では false)
//
// caller は spec 性質に応じて opts で layer を on/off できる. default は 1+2 が on、
// 3 は off (= ride 開始前の spec が多いため).

/**
 * 描画 paint が完了するまで待つ. timeout 内に完了しなければ throw する.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   waitMapIdle?: boolean,        // default true
 *   waitCanvasPixels?: boolean,   // default true
 *   waitTerrainMesh?: boolean,    // default false
 *   canvasSelector?: string,      // default '#minimap canvas, canvas[data-minimap]'
 *   timeoutMs?: number,           // default 15000
 * }} [opts]
 */
export async function waitForPaintComplete(page, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 15000;
  const canvasSelector = opts.canvasSelector || '#minimap canvas, canvas[data-minimap]';

  if (opts.waitMapIdle !== false) {
    await page.evaluate(({ timeoutMs }) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('paint_complete: map.on(idle) timeout')), timeoutMs);
      // viewer が globalThis.__mapIdle を export している前提 (b130 で hook 追加).
      if (typeof globalThis.__mapIdle === 'function') {
        globalThis.__mapIdle(() => { clearTimeout(t); resolve(); });
      } else {
        // hook 未 expose の spec (= 旧 viewer) は no-op で resolve、 後方互換.
        clearTimeout(t);
        resolve();
      }
    }), { timeoutMs });
  }

  if (opts.waitCanvasPixels !== false) {
    await page.waitForFunction((selector) => {
      const c = document.querySelector(selector);
      if (!c) return false;
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      try {
        const w = c.width;
        const h = c.height;
        if (w === 0 || h === 0) return false;
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) return true;
        }
        return false;
      } catch {
        return false;
      }
    }, canvasSelector, { timeout: timeoutMs });
  }

  if (opts.waitTerrainMesh === true) {
    await page.waitForFunction(
      () => !!(globalThis.__terrainMeshReady === true),
      undefined,
      { timeout: timeoutMs },
    );
  }
}

/**
 * 非空 pixel 判定 (= node test 可能な純粋関数). RGBA 並びの ImageData.data を期待.
 * @param {ArrayLike<number>} data
 * @returns {boolean}
 */
export function hasNonEmptyPixel(data) {
  if (!data || data.length < 4) return false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}
