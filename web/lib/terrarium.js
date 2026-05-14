// GSI 標高 PNG ↔ terrarium 形式 PNG の RGB 変換 (pure functions).
// API は Uint8ClampedArray 入出力 (= Node で test 可能、 ImageData polyfill 不要).
//
// GSI spec:
//   h = (R*65536 + G*256 + B) / 100
//   ただし h >= 0x800000 (= 8388608) なら h -= 0x1000000 (= 16777216) で符号付き化
//   (R, G, B) = (128, 0, 0) は無効値マーカー、 海面は (0, 0, 0) → 0m
//
// terrarium spec:
//   h = (R*256 + G + B/256) - 32768
//   encode: enc = round((h + 32768) * 256); R = enc / 65536, G = (enc % 65536) / 256, B = enc % 256

const GSI_INVALID_R = 128;
const GSI_INVALID_G = 0;
const GSI_INVALID_B = 0;

/**
 * GSI dem_png の 1 ピクセル (RGB) を標高 (meter) に変換.
 * 無効値 (128, 0, 0) は null を返す.
 */
export function gsiPixelToHeight(r, g, b) {
  if (r === GSI_INVALID_R && g === GSI_INVALID_G && b === GSI_INVALID_B) {
    return null;
  }
  let h = r * 65536 + g * 256 + b;
  if (h >= 8388608) h -= 16777216;
  return h / 100;
}

/**
 * meter の標高を terrarium 形式の (R, G, B) に変換.
 * h は実数 (cm 精度).
 */
export function heightToTerrariumRGB(h) {
  const enc = Math.max(0, Math.min(65535 * 256 + 255, Math.round((h + 32768) * 256)));
  const r = Math.floor(enc / 65536);
  const g = Math.floor((enc % 65536) / 256);
  const b = enc % 256;
  return [r, g, b];
}

/**
 * GSI dem_png の RGBA Uint8ClampedArray を terrarium 形式の RGBA に変換.
 * 入出力ともに長さ = W * H * 4.
 * 無効ピクセル (GSI 128/0/0) は height=0 として encode する
 * (= MapLibre 側で terrarium として読めるよう数値を入れる. alpha は常に 255).
 */
export function convertGsiPixelsToTerrariumPixels(rgba) {
  if (!(rgba instanceof Uint8ClampedArray)) {
    throw new TypeError('convertGsiPixelsToTerrariumPixels: input must be Uint8ClampedArray');
  }
  if (rgba.length % 4 !== 0) {
    throw new RangeError('convertGsiPixelsToTerrariumPixels: length must be multiple of 4');
  }
  const out = new Uint8ClampedArray(rgba.length);
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const h = gsiPixelToHeight(r, g, b);
    const heightM = (h === null) ? 0 : h;
    const [tr, tg, tb] = heightToTerrariumRGB(heightM);
    out[i * 4] = tr;
    out[i * 4 + 1] = tg;
    out[i * 4 + 2] = tb;
    out[i * 4 + 3] = 255;
  }
  return out;
}
