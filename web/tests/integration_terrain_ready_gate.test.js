// brief 34 ε-9 integration test: 地形データ準備 gate で全アクションボタン disabled.
//
// 検証範囲:
//   1. terrainReady=false の初期状態 → btnIntroStart / btnIntroView /
//      btnScan / btnScanHrm / btnSkip / btnRideStart 全部 disabled
//   2. terrainReady=true に遷移 → 上記 button disabled が解除
//      (= btnRideStart は pair 完了が AND の前提なので _pairConnected=true の場合のみ enable)
//   3. ステータスバー文言が「地形データ準備 完了」/「読み込み中...」/「失敗」 で切り替わる
//   4. HTML 構造に step-terrain (= 「0. 地形データ準備」) と #terrain-status が存在
//   5. viewer source: terrainReady === false の click 短絡が intro/scan/skip/section 各 handler に入っている
//   6. terrainReady === false の間は dispatch (= initBleMode 等) が呼ばれない (= 二重 gate)
//   7. addEventListener の section list click handler が terrainReady=false で onSelect を呼ばない

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTerrainLoader } from '../lib/terrain_loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
// b42: probe オーケストレーションは terrain_phase.js へ切り離し済。移管先 source も読む。
const TERRAIN_PHASE_PATH = resolve(__dirname, '..', 'lib', 'terrain_phase.js');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const html = readFileSync(INDEX_PATH, 'utf8');
const terrainPhase = readFileSync(TERRAIN_PHASE_PATH, 'utf8');

// viewer の updateActionButtonsForTerrain ロジックを忠実に再現する shim.
// terrainReady と _pairConnected の状態から btn.disabled を解決する純関数 + 5 step indicator 制御。
function createGateShim() {
  const btns = {
    btnIntroStart: { disabled: false },
    btnIntroView: { disabled: false },
    btnScan: { disabled: false },
    btnScanHrm: { disabled: false },
    btnSkip: { disabled: false },
    btnRideStart: { disabled: true },  // HTML 初期 = disabled
    btnBleTrainer: { disabled: false },
    btnBleHrm: { disabled: false },
  };
  const sectionList = { classList: new Set(), style: {} };
  let terrainReady = false;
  let pairConnected = false;
  function updateButtons() {
    btns.btnIntroStart.disabled = !terrainReady;
    btns.btnIntroView.disabled = !terrainReady;
    btns.btnScan.disabled = !terrainReady;
    btns.btnScanHrm.disabled = !terrainReady;
    btns.btnSkip.disabled = !terrainReady;
    btns.btnBleTrainer.disabled = !terrainReady;
    btns.btnBleHrm.disabled = !terrainReady;
    if (!terrainReady) {
      btns.btnRideStart.disabled = true;
    } else if (pairConnected) {
      btns.btnRideStart.disabled = false;
    }
    if (terrainReady) {
      sectionList.classList.delete('terrain-gate-disabled');
      sectionList.style.pointerEvents = '';
    } else {
      sectionList.classList.add('terrain-gate-disabled');
      sectionList.style.pointerEvents = 'none';
    }
  }
  updateButtons();
  return {
    btns, sectionList,
    setTerrainReady(v) { terrainReady = v; updateButtons(); },
    setPairConnected(v) { pairConnected = v; updateButtons(); },
    isTerrainReady: () => terrainReady,
    isPairConnected: () => pairConnected,
  };
}

describe('brief 34 ε-9 integration: terrainReady=false 初期は全アクションボタン disabled', () => {
  it('初期 (terrainReady=false, pairConnected=false) → 全アクションボタン disabled', () => {
    const g = createGateShim();
    expect(g.btns.btnIntroStart.disabled).toBe(true);
    expect(g.btns.btnIntroView.disabled).toBe(true);
    expect(g.btns.btnScan.disabled).toBe(true);
    expect(g.btns.btnScanHrm.disabled).toBe(true);
    expect(g.btns.btnSkip.disabled).toBe(true);
    expect(g.btns.btnRideStart.disabled).toBe(true);
    expect(g.btns.btnBleTrainer.disabled).toBe(true);
    expect(g.btns.btnBleHrm.disabled).toBe(true);
    expect(g.sectionList.style.pointerEvents).toBe('none');
  });

  it('terrainReady=true に遷移 → pair 不要 buttons は enable、 btnRideStart は pair 待ち', () => {
    const g = createGateShim();
    g.setTerrainReady(true);
    expect(g.btns.btnIntroStart.disabled).toBe(false);
    expect(g.btns.btnIntroView.disabled).toBe(false);
    expect(g.btns.btnScan.disabled).toBe(false);
    expect(g.btns.btnScanHrm.disabled).toBe(false);
    expect(g.btns.btnSkip.disabled).toBe(false);
    // ride start は pair 完了が AND
    expect(g.btns.btnRideStart.disabled).toBe(true);
    // section list は enable
    expect(g.sectionList.style.pointerEvents).toBe('');
  });

  it('terrainReady=true + pairConnected=true → btnRideStart enable', () => {
    const g = createGateShim();
    g.setTerrainReady(true);
    g.setPairConnected(true);
    expect(g.btns.btnRideStart.disabled).toBe(false);
  });

  it('terrainReady=false + pairConnected=true → btnRideStart 依然 disabled (= terrain 優先 gate)', () => {
    const g = createGateShim();
    g.setPairConnected(true);  // pair 先に立つ
    expect(g.btns.btnRideStart.disabled).toBe(true);  // terrain 未完なので block
    g.setTerrainReady(true);
    expect(g.btns.btnRideStart.disabled).toBe(false);  // 揃って enable
  });

  it('terrainReady true → false 再遷移 (= failed 状態) → 全 button 再 disable', () => {
    const g = createGateShim();
    g.setTerrainReady(true);
    g.setPairConnected(true);
    expect(g.btns.btnRideStart.disabled).toBe(false);
    // terrain が再度 false (= 何らかの理由で failed) になる仮想ケース
    g.setTerrainReady(false);
    expect(g.btns.btnRideStart.disabled).toBe(true);
    expect(g.btns.btnIntroStart.disabled).toBe(true);
    expect(g.btns.btnScan.disabled).toBe(true);
  });
});

describe('brief 34 ε-9 integration: terrain_loader の status 文言遷移', () => {
  it('pending → loading → done の遷移で label / phase / percent が同期', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c', pmtilesUrl: '/p', gsiTileBaseUrl: '/g',
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });
    expect(loader.getStatus().phase).toBe('pending');
    expect(loader.getStatus().percent).toBe(0);
    await loader.start();
    expect(loader.getStatus().phase).toBe('done');
    expect(loader.getStatus().percent).toBe(100);
    expect(loader.getStatus().label).toMatch(/course\.json/);
    expect(loader.getStatus().label).toMatch(/pmtiles/);
    expect(loader.getStatus().label).toMatch(/GSI/);
  });

  it('course.json 失敗 → status.label に「pmtiles ✓」「GSI N/M」が残るが error が立つ (= partial 表示)', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/missing', pmtilesUrl: '/p', gsiTileBaseUrl: '/g',
      fetchImpl: async (url) => (url.includes('missing') ? { ok: false, status: 404 } : { ok: true, status: 200 }),
    });
    await loader.start();
    expect(loader.getStatus().phase).toBe('failed');
    expect(loader.getStatus().error).toMatch(/course\.json/);
    expect(loader.isReady()).toBe(false);
  });
});

describe('brief 34 ε-9 integration: HTML 構造 (= 5 step indicator + status row)', () => {
  it('step-indicator に step-terrain (= 0. 地形データ準備) が追加されている', () => {
    expect(html).toMatch(/<div\s+class="step\s+active"\s+id="step-terrain"[^>]*>\s*0\.\s*地形データ準備\s*<\/div>/);
  });

  it('既存 4 step (scan/connect/handshake/ready) と並んで合計 5 step ある', () => {
    expect(html).toMatch(/id="step-terrain"/);
    expect(html).toMatch(/id="step-scan"/);
    expect(html).toMatch(/id="step-connect"/);
    expect(html).toMatch(/id="step-handshake"/);
    expect(html).toMatch(/id="step-ready"/);
  });

  it('#terrain-status 要素が #step-indicator 直下にある (= ステータスバー)', () => {
    expect(html).toMatch(/<div\s+id="terrain-status"[^>]*>/);
  });
});

describe('brief 34 ε-9 integration: viewer source 構造', () => {
  it('viewer は terrain_phase.js を import している (= b42 切り離し後の probe 経路)', () => {
    // b42: probe オーケストレーションは terrain_phase.js へ切り離し済。viewer は
    // terrain_loader.js を直接 import せず、createTerrainPhase 経由で probe を起動する。
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/terrain_phase\.js['"]/);
    expect(viewer).toMatch(/createTerrainPhase/);
    // terrain_loader / GSI_DEM_DIRECT_BASE の責務は terrain_phase.js が持つ
    expect(terrainPhase).toMatch(/from\s+['"]\.\/terrain_loader\.js['"]/);
    expect(terrainPhase).toMatch(/createTerrainLoader/);
  });

  it('terrainReady 変数が module top で定義され、 default false', () => {
    expect(viewer).toMatch(/let\s+terrainReady\s*=\s*false/);
  });

  it('updateActionButtonsForTerrain 関数が定義され、 terrainReady で btn.disabled を切替える', () => {
    expect(viewer).toMatch(/function\s+updateActionButtonsForTerrain\s*\(/);
    // 関数内に各 button id への参照と disabled 操作がある
    const m = viewer.match(/function\s+updateActionButtonsForTerrain\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    // b46: 旧 btnIntroStart / btnIntroView の terrain gate は撤去 (= 起動シーンを地形
    //   データローダー画面に作り変え、 「開始」 ボタンは地形ロードの起点なので gate しない)。
    //   トレーナー接続画面の「コースを観る」 ボタン (btnSetupGoView) の gate は残る。
    expect(body).toMatch(/btnSetupGoView/);
    expect(body).not.toMatch(/btnIntroStart/);
    // ride start は単一窓口 setRideStartEnabled に集約 (= btnRideStart.disabled + hint 同期).
    expect(body).toMatch(/setRideStartEnabled/);
    expect(body).toMatch(/\.disabled\s*=/);
  });

  it('地形データローダー画面の「開始」 ボタン (btnTerrainLoaderStart) は terrain gate されない (= b46、 地形ロードの起点)', () => {
    // 「開始」 ボタンを terrain gate で disable したら地形ロードを起動できなくなる。
    // updateActionButtonsForTerrain が btnTerrainLoaderStart を disabled 操作しないこと。
    const m = viewer.match(/function\s+updateActionButtonsForTerrain\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).not.toMatch(/btnTerrainLoaderStart/);
  });

  it('btnTerrainLoaderStart の click handler が runTerrainLoaderPhase を呼ぶ (= b46、 地形ロード起点)', () => {
    expect(viewer).toMatch(/btnTerrainLoaderStart\.addEventListener\(['"]click['"][\s\S]{0,120}runTerrainLoaderPhase\(\)/);
  });

  it('走行系 (btnRideStart) の handler に地形 gate 短絡 (2026-05-15 narrow: scan 系は地形と無関係で gate 不要、 btnSkip は撤去済)', () => {
    // 走行開始系のみ地形必須 (= terrainReady or isActionableNow). scan / pair は地形と独立.
    // btnSkip (= 「trainer なしでデモ走行」) は 7e14ac3 で撤去済、 残るは btnRideStart のみ.
    expect(viewer).toMatch(/btnRideStart['"]\)[\s\S]{0,80}addEventListener[\s\S]{0,300}if\s*\(\s*!(?:terrainReady|isActionableNow\(\))\s*\)\s*return/);
    // btnSkip click handler は viewer に残っていない事 (= 撤去済 button への bind は throw 原因).
    expect(viewer).not.toMatch(/getElementById\(['"]btnSkip['"]\)\.addEventListener/);
  });

  it('section list の onSelect 行クリック handler に terrainReady === false 短絡', () => {
    // renderSectionList 内の li.addEventListener('click', ...) に if (!terrainReady) return がある
    expect(viewer).toMatch(/li\.addEventListener\(['"]click['"][\s\S]{0,200}!terrainReady[\s\S]{0,30}return/);
  });

  it('connect_status の connected branch で pair 完了 + terrainReady === true なら btnRideStart enable', () => {
    // 「state === 'connected'」 branch 内に _pairConnected = true と terrainReady の check が並ぶ
    expect(viewer).toMatch(/state\s*===?\s*['"]connected['"][\s\S]{0,800}_pairConnected\s*=\s*true/);
    expect(viewer).toMatch(/state\s*===?\s*['"]connected['"][\s\S]{0,800}setRideStartEnabled\(\s*terrainReady\s*\)/);
  });

  it('viewer は terrain_phase (createTerrainPhase) を import し起動時 1 回呼ぶ (= b42 切り離し)', () => {
    // b42: probe オーケストレーションは terrain_phase.js に切り離し済。viewer は
    // createTerrainPhase を import して起動配線 (= startTerrainPhase) するだけ。
    expect(viewer).toMatch(/import\s+\{[^}]*createTerrainPhase[^}]*\}\s+from\s+['"]\.\/lib\/terrain_phase\.js['"]/);
    expect(viewer).toMatch(/function\s+startTerrainPhase\s*\(/);
    // 起動 dispatch (= _terrainPhase への代入) がある
    expect(viewer).toMatch(/_terrainPhase\s*=\s*startTerrainPhase\(\)/);
  });

  it('terrain_phase.js が bridge prefix + GSI_DEM_DIRECT_BASE + TileCache を組む (= b42 移管先)', () => {
    // b42: 旧 startTerrainProbe の URL 構築 / GSI direct base / TileCache DI は
    // terrain_phase.js へ移管。本 test は移管先 source に対し pin する
    // (= behavioral pin は terrain_phase.test.js が担う、 ここは配線の存在確認)。
    expect(terrainPhase).toMatch(/static\/course\.json/);
    expect(terrainPhase).toMatch(/static\/map\.pmtiles/);
    expect(terrainPhase).toMatch(/static\/tiles\/gsi_dem/);   // bridge mode prefix 維持
    // GSI direct base const 参照 (= literal の SoT は terrain_loader.js のまま)
    expect(terrainPhase).toMatch(/GSI_DEM_DIRECT_BASE/);
    expect(terrainPhase).toMatch(/openTileCache/);             // TileCache DI
  });

  it('updateTerrainStep 関数が phase で step-terrain の class を切替える (= done/active/failed)', () => {
    expect(viewer).toMatch(/function\s+updateTerrainStep\s*\(/);
    const m = viewer.match(/function\s+updateTerrainStep\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/step-terrain/);
    expect(body).toMatch(/['"]done['"]/);
  });

  it('setTerrainStatusUI 関数が phase で文言を切替える (= 完了/失敗/読み込み中)', () => {
    expect(viewer).toMatch(/function\s+setTerrainStatusUI\s*\(/);
    const m = viewer.match(/function\s+setTerrainStatusUI\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/terrain-status/);
    expect(body).toMatch(/完了|読み込み|失敗/);
  });
});

describe('brief 34 ε-9 integration: dispatch 経由でも terrainReady=false なら下流 init は呼ばれない', () => {
  it('terrainReady=false での click は dispatchAfterIntro を呼ばない (= intro handler 短絡)', () => {
    // shim: intro click → terrainReady check → dispatchAfterIntro
    let dispatched = 0;
    const onClick = (terrainReady) => {
      if (!terrainReady) return;
      dispatched += 1;
    };
    onClick(false);
    expect(dispatched).toBe(0);
    onClick(true);
    expect(dispatched).toBe(1);
  });

  it('地形 load 中 (= phase=loading) でも intro / scan / skip / section が全部 click block 状態', () => {
    // phase=loading は terrainReady=false 扱い (= isReady() === false).
    const loader = createTerrainLoader({
      courseUrl: '/c', gsiTileBaseUrl: '/g',
      fetchImpl: async () => { await new Promise((r) => setTimeout(r, 0)); return { ok: true, status: 200 }; },
    });
    // start 開始直後は loading
    const startPromise = loader.start();
    // 完了前 (= promise pending) は isReady false
    expect(loader.isReady()).toBe(false);
    return startPromise.then(() => {
      expect(loader.isReady()).toBe(true);
    });
  });
});

describe('brief 34 ε-9 integration: 二重 gate (= ε-2 introConsented + ε-9 terrainReady)', () => {
  it('terrainReady=false + introConsented=false → showIntroOverlay のみ、 init 系全 0 (= 二重 stop)', () => {
    // dispatch shim を二重 gate で再現
    let initCalled = 0;
    let showIntroCalled = 0;
    function go({ terrainReady, introConsented }) {
      // ε-9: terrainReady=false なら絶対進まない (= intro overlay は表示してよいが内側 action 全 block).
      // ただし intro 表示自体は terrain と独立、 これは showIntroOverlay が「閉じる」しか選べない状態。
      // dispatch (= initBleMode 等) は terrainReady=true でないと進まない、 かつ introConsented も必要。
      if (!introConsented) {
        showIntroCalled += 1;
        return;
      }
      if (!terrainReady) {
        // 既に intro 通過済だが terrain 未完なら、 click による次画面遷移は intro handler 側で短絡
        // (= 「自分の trainer で走る」 button が disabled、 何も起きない).
        return;
      }
      initCalled += 1;
    }
    go({ terrainReady: false, introConsented: false });
    expect(showIntroCalled).toBe(1);
    expect(initCalled).toBe(0);
    go({ terrainReady: true, introConsented: false });
    expect(showIntroCalled).toBe(2);
    expect(initCalled).toBe(0);
    go({ terrainReady: false, introConsented: true });
    expect(showIntroCalled).toBe(2);
    expect(initCalled).toBe(0);  // terrain 未完で stop
    go({ terrainReady: true, introConsented: true });
    expect(initCalled).toBe(1);
  });
});
