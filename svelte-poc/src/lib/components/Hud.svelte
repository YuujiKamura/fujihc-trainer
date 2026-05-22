<script>
  import { appState, openPairingScreen } from '../store.svelte.js';

  // HUDにはダミーの現在速度や勾配を表示
</script>

<div class="hud">
  <div class="metrics">
    <div class="metric">
      <span class="label">SPEED</span>
      <span class="value">{appState.isViewMode ? '20.0' : '25.4'} <small>km/h</small></span>
    </div>
    <div class="metric">
      <span class="label">GRADE</span>
      <span class="value">5.5 <small>%</small></span>
    </div>
  </div>

  <div class="controls">
    <!-- 実走モードでも設定画面は開ける -->
    {#if !appState.isViewMode}
      <button class="settings-btn" onclick={openPairingScreen}>
        ⚙️ ペアリング画面を開く
      </button>
    {/if}
  </div>
  
  <div class="mode-badge">
    {#if appState.isViewMode}
      <span class="view-badge">👀 観るモード中</span>
    {:else}
      <span class="ride-badge">🚴‍♂️ 実走中</span>
    {/if}
  </div>
</div>

<style>
  .hud {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 20px; background: rgba(0,0,0,0.7);
    padding: 15px 30px; border-radius: 12px; color: white;
    align-items: center; z-index: 500;
  }
  .metric { display: flex; flex-direction: column; align-items: center; }
  .label { font-size: 0.7rem; color: #aaa; }
  .value { font-size: 1.5rem; font-weight: bold; }
  .value small { font-size: 0.8rem; font-weight: normal; }
  .settings-btn { 
    background: transparent; border: 1px solid #666; color: white; 
    padding: 8px 12px; border-radius: 4px; cursor: pointer;
  }
  .settings-btn:hover { background: rgba(255,255,255,0.1); }
  .mode-badge { margin-left: 20px; font-size: 0.9rem; font-weight: bold; }
  .view-badge { color: #4a90e2; }
  .ride-badge { color: #e24a4a; }
</style>
