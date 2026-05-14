// brief 32: FTMS / HRM binary parser を JS へ port.
// src/fujihc/bridge.py L89-151 (_parse_heart_rate / _parse_indoor_bike_data)、
// L231-248 (_parse_control_response)、 L251-270 (_encode_set_indoor_bike_simulation)
// と完全一致の挙動を持つ pure function 群。 DataView ベース、 little-endian。
//
// 「同 binary を投げると同 dict が返る」を vitest fixture と pytest fixture で
// 共有 (= 16 進シーケンスを test 内で hardcode、 NG-R1-8 再演回避).

/**
 * BLE Heart Rate Measurement (UUID 0x2A37) を decode.
 * flags byte の bit0 で BPM が uint8 か uint16 か判別.
 * @param {DataView|Uint8Array} input - notification の payload
 * @returns {{hr_bpm?: number}} - parse 不可なら空 object
 */
export function parseHeartRate(input) {
  const view = _asDataView(input);
  if (!view || view.byteLength < 1) return {};
  const flags = view.getUint8(0);
  let offset = 1;
  const out = {};
  if (flags & 0x01) {
    if (view.byteLength >= offset + 2) {
      out.hr_bpm = view.getUint16(offset, true);
      offset += 2;
    }
  } else {
    if (view.byteLength >= offset + 1) {
      out.hr_bpm = view.getUint8(offset);
      offset += 1;
    }
  }
  return out;
}

/**
 * FTMS Indoor Bike Data (UUID 0x2AD2) を decode.
 * spec FTMS 1.0 § 4.9: 16-bit flags + 各 field の little-endian.
 * flag bit assignment は bridge.py L120-150 と完全一致.
 * @param {DataView|Uint8Array} input
 * @returns {{speed_mps?: number, cadence_rpm?: number, distance_m?: number, power_w?: number}}
 */
export function parseIndoorBikeData(input) {
  const view = _asDataView(input);
  if (!view || view.byteLength < 2) return {};
  const flags = view.getUint16(0, true);
  let offset = 2;
  const out = {};

  const more_data = !!(flags & 0x0001);
  if (!more_data && view.byteLength >= offset + 2) {
    const raw = view.getUint16(offset, true);
    offset += 2;
    const speed_kmh = raw / 100.0;
    out.speed_mps = speed_kmh / 3.6;
  }
  if ((flags & 0x0002) && view.byteLength >= offset + 2) { offset += 2; } // Average Speed
  if ((flags & 0x0004) && view.byteLength >= offset + 2) {
    const raw = view.getUint16(offset, true);
    offset += 2;
    out.cadence_rpm = raw * 0.5;
  }
  if ((flags & 0x0008) && view.byteLength >= offset + 2) { offset += 2; } // Average Cadence
  if ((flags & 0x0010) && view.byteLength >= offset + 3) { // Total Distance (uint24 LE)
    const b0 = view.getUint8(offset);
    const b1 = view.getUint8(offset + 1);
    const b2 = view.getUint8(offset + 2);
    offset += 3;
    out.distance_m = b0 | (b1 << 8) | (b2 << 16);
  }
  if ((flags & 0x0020) && view.byteLength >= offset + 2) { offset += 2; } // Resistance Level
  if ((flags & 0x0040) && view.byteLength >= offset + 2) { // Instantaneous Power (sint16)
    out.power_w = view.getInt16(offset, true);
    offset += 2;
  }
  return out;
}

/**
 * FTMS Control Point indication payload を (req_op, result, result_name) に分解.
 * spec § 4.16: Response Op Code 0x80, Request Op Code, Result Code [, ...].
 * @param {DataView|Uint8Array} input
 * @returns {{req_op:number, result:number, result_name:string} | null}
 */
export function parseControlResponse(input) {
  const view = _asDataView(input);
  if (!view || view.byteLength < 3) return null;
  if (view.getUint8(0) !== 0x80) return null;
  const req_op = view.getUint8(1);
  const result = view.getUint8(2);
  const names = {
    0x01: 'OK',
    0x02: 'Op-Not-Supported',
    0x03: 'Invalid-Parameter',
    0x04: 'Operation-Failed',
    0x05: 'Control-Not-Permitted',
  };
  const result_name = names[result] || `Result=0x${result.toString(16).padStart(2, '0').toUpperCase()}`;
  return { req_op, result, result_name };
}

/**
 * FTMS Set Indoor Bike Simulation Parameters payload (opcode 0x11) を pack.
 * bridge.py L251-270 の clamp / scale 因子と完全一致.
 *   grade ×100 (0.01% units, signed)
 *   wind  ×1000 (0.001 m/s units, signed)
 *   crr  ÷0.0001 (uint8)
 *   cw   ÷0.01 (uint8)
 * @param {number} gradePct - -32.0 ~ +32.0
 * @param {number} [windMps=0]
 * @param {number} [crr=0.004]
 * @param {number} [cw=0.51]
 * @returns {Uint8Array} - 7 bytes
 */
export function encodeSetIndoorBikeSimulation(gradePct, windMps = 0, crr = 0.004, cw = 0.51) {
  const FTMS_OP_SET_INDOOR_BIKE_SIMULATION = 0x11;
  const clampedGrade = Math.max(-32.0, Math.min(32.0, gradePct));
  const grade_raw = Math.round(clampedGrade * 100.0);
  const wind_raw = Math.round(windMps * 1000.0);
  const crr_raw = Math.max(0, Math.min(255, Math.round(crr / 0.0001)));
  const cw_raw = Math.max(0, Math.min(255, Math.round(cw / 0.01)));
  const buf = new ArrayBuffer(7);
  const view = new DataView(buf);
  view.setUint8(0, FTMS_OP_SET_INDOOR_BIKE_SIMULATION);
  view.setInt16(1, wind_raw, true);
  view.setInt16(3, grade_raw, true);
  view.setUint8(5, crr_raw);
  view.setUint8(6, cw_raw);
  return new Uint8Array(buf);
}

function _asDataView(input) {
  if (!input) return null;
  if (input instanceof DataView) return input;
  if (input instanceof Uint8Array) return new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (input.buffer && typeof input.byteLength === 'number') {
    // ArrayBufferView 一般 (= Buffer 等)
    return new DataView(input.buffer, input.byteOffset || 0, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new DataView(input);
  return null;
}
