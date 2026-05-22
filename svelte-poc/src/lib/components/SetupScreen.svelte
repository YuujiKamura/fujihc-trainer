<script>
  import { appState, connectTrainer, enterViewMode, startRealRide, abortPairing } from '../store.svelte.js';
</script>

<div class="overlay">
  <h2>トレーナー接続画面</h2>
  
  <div class="actions">
    <!-- トレーナー接続（モック） -->
    {#if !appState.trainerConnected}
      <button onclick={connectTrainer}>Ble / Bridge トレーナーを接続</button>
    {:else}
      <div class="connected-badge">✅ トレーナー接続済み</div>
    {/if}

    <hr />

    <!-- コースを観る (isViewMode = true になる) -->
    <button class="view-btn" onclick={enterViewMode}>▷ コースを観る (トレーナー不要)</button>

    <!-- ライド開始 (trainerConnected が必須) -->
    <!-- startRealRide によって isViewMode が確実に false になる -->
    <button 
      class="ride-btn" 
      disabled={!appState.trainerConnected}
      onclick={startRealRide}
    >
      実走を開始する
    </button>
    
    {#if !appState.trainerConnected}
      <p class="hint">実走開始はトレーナー接続後に押せます。</p>
    {/if}
  </div>

  <button class="close-btn" onclick={abortPairing}>戻る (キャンセル)</button>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(30,30,40,0.95); color: white;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .actions {
    display: flex; flex-direction: column; gap: 15px; width: 300px;
  }
  button { padding: 12px; font-size: 1.1rem; cursor: pointer; border-radius: 4px; border: none; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .view-btn { background: #4a90e2; color: white; }
  .ride-btn { background: #e24a4a; color: white; font-weight: bold; }
  .connected-badge { background: #2e7d32; color: white; padding: 10px; text-align: center; border-radius: 4px; }
  .hint { font-size: 0.8rem; color: #aaa; text-align: center; margin: 0; }
  .close-btn { margin-top: 30px; background: transparent; border: 1px solid #555; color: #ccc; }
</style>
