<script>
  import { appState } from './lib/store.svelte.js';
  import TopBar from './lib/components/TopBar.svelte';
  import IntroScreen from './lib/components/IntroScreen.svelte';
  import TerrainLoader from './lib/components/TerrainLoader.svelte';
  import SetupScreen from './lib/components/SetupScreen.svelte';
  import HudHero from './lib/components/HudHero.svelte';
  import AttributionBar from './lib/components/AttributionBar.svelte';
  import SectionListPanel from './lib/components/SectionListPanel.svelte';
  import MetricsPanel from './lib/components/MetricsPanel.svelte';
  import PostRideScreen from './lib/components/PostRideScreen.svelte';
  import fujiSilhouette from './lib/assets/fujihill/fuji-silhouette.svg?raw';
</script>

<TopBar />

<main>
  {#if appState.phase === 'intro'}
    <IntroScreen />
  {:else if appState.phase === 'terrain_loading'}
    <div class="map-background">
      <TerrainLoader />
    </div>
  {:else if appState.phase === 'pairing'}
    <SetupScreen />
  {:else if appState.phase === 'riding'}
    <div class="riding-layout">
      <!-- 3D View Layer -->
      <div class="view-3d-layer">
        <div class="fuji-bg">
          {@html fujiSilhouette}
        </div>
        <div class="placeholder-3d">3D View Area</div>
      </div>

      <!-- HUD Layer -->
      <aside class="side-panel left-panel">
        <SectionListPanel />
      </aside>

      <div class="center-hud-container">
        <HudHero />
      </div>

      <aside class="side-panel right-panel">
        <MetricsPanel />
      </aside>

      <AttributionBar />
    </div>
  {:else if appState.phase === 'postride'}
    <PostRideScreen />
  {/if}
</main>

<style>
  main {
    margin-top: 60px; /* TopBar の高さ分 */
    min-height: calc(100vh - 60px);
    background-color: var(--bg);
  }

  .map-background {
    position: fixed;
    inset: 60px 0 0 0;
    background: #2c3e50;
    color: #ecf0f1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 100;
    opacity: 0.5;
  }

  /* 走行中画面の3列グリッドレイアウト */
  .riding-layout {
    display: grid;
    grid-template-columns: 300px 1fr 300px;
    height: calc(100vh - 60px); /* TopBar分を引く */
    position: relative;
    overflow: hidden;
  }

  .view-3d-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
    background: var(--fuji-sky-100);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }

  .fuji-bg {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    opacity: 0.3;
    pointer-events: none;
    display: flex;
    justify-content: center;
  }

  .fuji-bg :global(svg) {
    width: 100%;
    max-width: 1200px;
    height: auto;
    color: var(--fuji-blue-300);
  }

  .placeholder-3d {
    color: var(--fuji-blue-300);
    font-size: var(--fs-h2);
    font-weight: 600;
  }

  .side-panel {
    position: relative;
    z-index: 10;
    background: var(--glass);
    backdrop-filter: blur(8px);
    padding: var(--space-4);
  }

  .left-panel {
    border-right: 1px solid var(--border);
  }

  .right-panel {
    border-left: 1px solid var(--border);
  }

  .panel-desc {
    color: var(--text-faint);
    text-align: center;
    margin-top: var(--space-8);
  }

  .center-hud-container {
    position: relative;
    z-index: 20;
    pointer-events: none; /* 背景の3Dビューの操作を妨げないようにする */
  }

  /* 中央HUDの要素自体は操作可能に戻す */
  .center-hud-container :global(> *) {
    pointer-events: auto;
  }
</style>
