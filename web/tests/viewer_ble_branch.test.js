// brief 32: viewer-maplibre.js の 5-way 起動分岐 (= MAP / TEST / BLE / default).
// maplibre import なしで読めるよう source-grep で検証 (= dbinit_overlay.test.js と同 pattern).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');

describe('brief 32: viewer 起動分岐 5-way 化', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('BLE_MODE 定数が ?ble query から抽出される', () => {
    expect(viewer).toMatch(/const\s+BLE_MODE\s*=\s*new\s+URLSearchParams\(location\.search\)\.has\(['"]ble['"]\)/);
  });

  it('起動分岐に BLE_MODE 経路が含まれる (= initBleMode 呼び出し)', () => {
    expect(viewer).toMatch(/else\s+if\s*\(\s*BLE_MODE\s*\)\s*initBleMode\(\)/);
  });

  it('initBleMode 関数が定義済', () => {
    expect(viewer).toMatch(/(async\s+)?function\s+initBleMode\s*\(/);
  });

  it('initBleMode 内で createBleClient と isWebBluetoothSupported が使われる', () => {
    const m = viewer.match(/function\s+initBleMode[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/createBleClient\s*\(/);
    expect(m[0]).toMatch(/isWebBluetoothSupported\s*\(/);
  });

  it('createBleClient / isWebBluetoothSupported が ./lib/ble_client.js から import される', () => {
    expect(viewer).toMatch(/import\s*\{[^}]*createBleClient[^}]*\}\s*from\s*['"]\.\/lib\/ble_client\.js['"]/);
    expect(viewer).toMatch(/isWebBluetoothSupported/);
  });

  it('既存 3 mode (MAP/TEST/default) の分岐は壊れていない', () => {
    expect(viewer).toMatch(/if\s*\(\s*MAP_MODE\s*\)\s*initMapMode\(\)/);
    expect(viewer).toMatch(/else\s+if\s*\(\s*TEST_MODE\s*\)\s*initTestMode\(\)/);
    expect(viewer).toMatch(/else\s+bootCheckSetupStatus\(\)/);
  });
});

describe('brief 32: index.html の ble-section', () => {
  const html = readFileSync(INDEX_PATH, 'utf8');

  it('#ble-section が default hidden で setup-overlay 内に存在', () => {
    expect(html).toMatch(/<section\s+id="ble-section"[^>]*hidden/);
  });

  it('btn-ble-trainer / btn-ble-hrm の 2 button を持つ', () => {
    expect(html).toMatch(/id="btn-ble-trainer"/);
    expect(html).toMatch(/id="btn-ble-hrm"/);
  });

  it('BLE 非対応案内 (.ble-support-msg) が hidden で同梱', () => {
    expect(html).toMatch(/class="ble-support-msg"[^>]*hidden/);
  });

  it('既存 #setup-buttons の bridge mode 4 button は不変', () => {
    expect(html).toMatch(/id="btnScan"/);
    expect(html).toMatch(/id="btnScanHrm"/);
    expect(html).toMatch(/id="btnSkip"/);
    expect(html).toMatch(/id="btnClosePairing"/);
  });
});
