<script>
  import { appState } from './lib/store.svelte.js';
  import TerrainLoader from './lib/components/TerrainLoader.svelte';
  import SetupScreen from './lib/components/SetupScreen.svelte';
  import Hud from './lib/components/Hud.svelte';
  import SectionListPanel from './lib/components/SectionListPanel.svelte';
</script>

<main>
  <!-- 3Dマップの背景（ダミー） -->
  <div class="map-background">
    <h1>Fujihill Trainer (Map Mock)</h1>
    <p>現在のフェーズ: {appState.phase}</p>
    <p>観るモード: {appState.isViewMode ? 'ON' : 'OFF'}</p>
  </div>

  <!-- フェーズに応じたUIの出し分け（ルーター） -->
  {#if appState.phase === 'terrain_loading'}
    <TerrainLoader />
  {:else if appState.phase === 'pairing'}
    <SetupScreen />
  {:else if appState.phase === 'riding'}
    <Hud />
    <!-- 観るモード中のみセクションリストを表示する（DOMの出し入れが自動化されている） -->
    {#if appState.isViewMode}
      <SectionListPanel />
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    margin: 0; padding: 0; font-family: sans-serif;
    overflow: hidden;
  }
  .map-background {
    position: fixed; inset: 0; background: #2c3e50; color: #ecf0f1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 100; opacity: 0.5;
  }
</style>
