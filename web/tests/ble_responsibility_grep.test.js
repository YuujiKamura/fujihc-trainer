// brief 32 完了条件 7: 物理 grep gate.
// (a) viewer-maplibre.js は navigator.bluetooth を直叩きしない (= ble_client に閉じる)
// (b) ble_client.js は WebSocket を持たない
// (c) ws_client.js は bluetooth を持たない
// この 3 件が落ちれば必ず止まる物理層、 inline doc には書かない.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLE = resolve(__dirname, '..', 'lib', 'ble_client.js');
const WS = resolve(__dirname, '..', 'lib', 'ws_client.js');
const VIEWER = resolve(__dirname, '..', 'viewer-maplibre.js');

describe('brief 32: BLE / WS / viewer の責務分離 (物理 grep gate)', () => {
  it('ble_client.js に WebSocket 文字列ゼロ', () => {
    const src = readFileSync(BLE, 'utf8');
    expect(/\bWebSocket\b/.test(src)).toBe(false);
  });

  it('ws_client.js に bluetooth 文字列ゼロ (case-insensitive)', () => {
    const src = readFileSync(WS, 'utf8');
    expect(/\bbluetooth\b/i.test(src)).toBe(false);
  });

  it('viewer-maplibre.js に navigator.bluetooth 直叩きゼロ (= ble_client.js に閉じる)', () => {
    const src = readFileSync(VIEWER, 'utf8');
    expect(/navigator\.bluetooth/.test(src)).toBe(false);
  });
});
