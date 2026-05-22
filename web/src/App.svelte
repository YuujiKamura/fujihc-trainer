<script>
  import TerrainLoader from './components/TerrainLoader.svelte';
  import SetupOverlay from './components/SetupOverlay.svelte';
  import Map3D from './components/Map3D.svelte';
  import Hud from './components/Hud.svelte';
  import Minimap from './components/Minimap.svelte';
  import Controls from './components/Controls.svelte';
  import { setupStore } from './stores/setupStore.svelte.js';
  import { startSetupSync } from './stores/setupSync.js';
  
  // URLパラメータを見て、開発者モード(?test, ?map, ?ble, ?bridge) なら地形ローダー画面をスキップする
  let urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  let skipIntro = urlParams.has('map') || urlParams.has('test') || urlParams.has('ble') || urlParams.has('bridge');
  let isSvelteMapMode = urlParams.has('svelte_map');
  
  let showTerrainLoader = $state(!skipIntro && !isSvelteMapMode);

  function handleTerrainDone() {
    showTerrainLoader = false;
    // viewer-maplibre.js にエクスポートしてもらったコールバックを呼ぶ
    if (window.fujihillInterop && window.fujihillInterop.onTerrainLoaderDone) {
      window.fujihillInterop.onTerrainLoaderDone();
    }
  }

  // Vanilla JS から Svelte に状態を同期
  if (typeof window !== 'undefined' && !isSvelteMapMode) {
    startSetupSync();
  }
  let svelteOverlayEnabled = $state(false);
</script>

{#if isSvelteMapMode}
  <!-- 完全Svelte化されたスタンドアロンマップモード -->
  <style>
    /* Hide Vanilla JS DOM elements to prevent overlap */
    #hud, #rider-hud, #minimap-container, #debug-hud, #controls {
      display: none !important;
    }
  </style>
  <Map3D />
  <Hud />
  <Minimap />
  <Controls />
{:else}
  <!-- 既存のVanilla JS基盤に相乗りするオーバーレイモード -->
  <TerrainLoader visible={showTerrainLoader} onDone={handleTerrainDone} />

  {#if svelteOverlayEnabled}
    <style>
      #setup-overlay { display: none !important; }
    </style>
  {/if}

  <button 
    style="position:fixed; top:10px; right:10px; z-index:9999; padding:8px; background:#ffd54a; color:#000; border:none; border-radius:4px; font-weight:bold; cursor:pointer;"
    onclick={() => { svelteOverlayEnabled = !svelteOverlayEnabled }}
  >
    {svelteOverlayEnabled ? 'Svelte UI を使用中' : 'Vanilla JS UI を使用中'}
  </button>

  {#if svelteOverlayEnabled}
  <SetupOverlay 
    onStartRide={() => document.getElementById('btnRideStart')?.click()}
    onStartViewMode={() => document.getElementById('btnSetupGoView')?.click()}
    onScanTrainer={() => document.getElementById('btnScan')?.click()}
    onScanHrm={() => document.getElementById('btnScanHrm')?.click()}
    onClosePairing={() => document.getElementById('btnClosePairing')?.click()}
    onBleTrainer={() => document.getElementById('btn-ble-trainer')?.click()}
    onBleHrm={() => document.getElementById('btn-ble-hrm')?.click()}
    onDeviceSelect={(index) => {
      const list = document.getElementById('setup-list');
      if (list && list.children[index]) list.children[index].click();
    }}
    onStravaConnect={() => document.getElementById('btnStravaConnect')?.click()}
    onStravaDisconnect={() => document.getElementById('btnStravaDisconnect')?.click()}
    onStravaSetupSave={() => document.getElementById('btnStravaSetupSave')?.click()}
    onStravaSetupCancel={() => document.getElementById('btnStravaSetupCancel')?.click()}
  />
  {/if}
{/if}
