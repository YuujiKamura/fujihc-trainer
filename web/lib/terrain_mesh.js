// brief 21: GSI 標高タイルのメッシュ補完 (= bilinear upsample) で ride 視点を滑らかに
//
// GSI dem_png は zoom 14 で 256x256、 ピクセル解像度約 6m grid.
// ride 視点 (= userZoom 23.95) では 6m grid がカクついて見える、
// bilinear 4x で 1024x1024 (= 1.5m grid 等価) に upsample する.
//
// 関数 2 つ:
//   - bilinearUpsample: pure RGBA upsample (= terrarium 形式の中で 4 個の隣ピクセル線形補間)
//   - gsiToTerrariumUpsampled: GSI decode -> 標高 grid -> bilinear -> terrarium encode の合成

/**
 * Bilinear upsample for RGBA pixel array.
 *
 * @param {Uint8ClampedArray} src - RGBA pixel array of size srcW * srcH * 4
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} factor - integer >= 1
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 *
 * 各 channel (R, G, B) を 4 近傍の重み付き平均で補間、 alpha は 255 固定.
 * factor=1 は identity (= 入力 RGBA をそのまま戻す).
 */
export function bilinearUpsample(src, srcW, srcH, factor) {
  if (factor === 1) {
    // identity copy (= input/output 独立 array のため)
    const data = new Uint8ClampedArray(src);
    return { data, width: srcW, height: srcH };
  }
  const dstW = srcW * factor;
  const dstH = srcH * factor;
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  for (let dy = 0; dy < dstH; dy++) {
    // block-center sampling: 各 source pixel が factor×factor の dst block を生成、
    // dst pixel の中心位置を source space で取って補間 (= mip-map / texture sampling 流儀).
    const syf = Math.max(0, Math.min(srcH - 1, (dy + 0.5) / factor - 0.5));
    const sy0 = Math.floor(syf);
    const sy1 = Math.min(sy0 + 1, srcH - 1);
    const fy = syf - sy0;
    for (let dx = 0; dx < dstW; dx++) {
      const sxf = Math.max(0, Math.min(srcW - 1, (dx + 0.5) / factor - 0.5));
      const sx0 = Math.floor(sxf);
      const sx1 = Math.min(sx0 + 1, srcW - 1);
      const fx = sxf - sx0;
      // 4 corners
      const i00 = (sy0 * srcW + sx0) * 4;
      const i10 = (sy0 * srcW + sx1) * 4;
      const i01 = (sy1 * srcW + sx0) * 4;
      const i11 = (sy1 * srcW + sx1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const di = (dy * dstW + dx) * 4;
      for (let c = 0; c < 3; c++) {
        dst[di + c] = Math.round(
          src[i00 + c] * w00 +
          src[i10 + c] * w10 +
          src[i01 + c] * w01 +
          src[i11 + c] * w11,
        );
      }
      dst[di + 3] = 255;
    }
  }
  return { data: dst, width: dstW, height: dstH };
}

/**
 * GSI dem_png (= R*65536+G*256+B encoding, R=128 で無効) を読んで
 * bilinear upsample してから terrarium 形式に再 encode.
 *
 * @param {Uint8ClampedArray} gsiRgba - GSI PNG の RGBA array
 * @param {number} w - 元画像 width (典型 = 256)
 * @param {number} h - 元画像 height (典型 = 256)
 * @param {number} factor - upsample 倍率 (= 4 推奨)
 * @returns {{ data: Uint8ClampedArray, width: number, height: number }}
 *   出力 RGBA は terrarium 形式 (= MapLibre の raster-dem encoding=terrarium).
 *
 * 補間は **標高値の grid に対して** 行う (= RGB バイト列の補間ではなく).
 * 無効ピクセル (R=128, G=B=0) は標高 0m として補間に参加.
 */
export function gsiToTerrariumUpsampled(gsiRgba, w, h, factor) {
  // 1. GSI decode: 標高 m の grid に変換
  const heightGrid = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = gsiRgba[i * 4];
    const g = gsiRgba[i * 4 + 1];
    const b = gsiRgba[i * 4 + 2];
    let height_m = 0;
    if (!(r === 128 && g === 0 && b === 0)) {
      let hVal = r * 65536 + g * 256 + b;
      if (hVal >= 8388608) hVal -= 16777216;
      height_m = hVal / 100;
    }
    heightGrid[i] = height_m;
  }
  // 2. bilinear upsample on the height grid
  const dstW = w * factor;
  const dstH = h * factor;
  const upH = new Float32Array(dstW * dstH);
  if (factor === 1) {
    upH.set(heightGrid);
  } else {
    for (let dy = 0; dy < dstH; dy++) {
      const syf = Math.max(0, Math.min(h - 1, (dy + 0.5) / factor - 0.5));
      const sy0 = Math.floor(syf);
      const sy1 = Math.min(sy0 + 1, h - 1);
      const fy = syf - sy0;
      for (let dx = 0; dx < dstW; dx++) {
        const sxf = Math.max(0, Math.min(w - 1, (dx + 0.5) / factor - 0.5));
        const sx0 = Math.floor(sxf);
        const sx1 = Math.min(sx0 + 1, w - 1);
        const fx = sxf - sx0;
        const h00 = heightGrid[sy0 * w + sx0];
        const h10 = heightGrid[sy0 * w + sx1];
        const h01 = heightGrid[sy1 * w + sx0];
        const h11 = heightGrid[sy1 * w + sx1];
        upH[dy * dstW + dx] =
          h00 * (1 - fx) * (1 - fy) +
          h10 * fx * (1 - fy) +
          h01 * (1 - fx) * fy +
          h11 * fx * fy;
      }
    }
  }
  // 3. terrarium encode: (R, G, B) = encode(height + 32768)
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const MAX_ENC = 65535 * 256 + 255;
  for (let i = 0; i < dstW * dstH; i++) {
    const enc = Math.max(0, Math.min(MAX_ENC, Math.round((upH[i] + 32768) * 256)));
    out[i * 4] = Math.floor(enc / 65536);
    out[i * 4 + 1] = Math.floor((enc % 65536) / 256);
    out[i * 4 + 2] = enc % 256;
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: dstW, height: dstH };
}
