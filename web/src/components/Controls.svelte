<script>
  import { rideStore } from '../stores/rideStore.svelte.js';
  import { bleStore } from '../stores/bleStore.svelte.js';

  function handleRideStart() {
    bleStore.startRide();
  }

  function handleBack() {
    window.location.search = '';
  }
</script>

<div id="s-controls" class="controls">
  <div style="display: flex; gap: 8px;">
    <!-- bleStore.ready corresponds to handler having connected to trainer -->
    <button id="s-btnRideStart" disabled={!bleStore.ready} onclick={handleRideStart}>
      スタート
    </button>
    <button id="s-btnBackToSetup" onclick={handleBack}>
      セットアップに戻る
    </button>
  </div>
  {#if !bleStore.ready}
    <div id="s-ride-start-hint" class="hint">trainer のハンドシェイク完了後に押せるようになります</div>
  {/if}
</div>

<style>
  .controls {
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 1500;
  }
  button {
    padding: 10px 20px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 16px;
    cursor: pointer;
  }
  button:disabled {
    background: #555;
    cursor: not-allowed;
  }
  .hint {
    color: yellow;
    font-size: 12px;
    margin-top: 4px;
  }
</style>
