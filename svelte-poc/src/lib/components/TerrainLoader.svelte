<script>
  import { completeTerrainLoad } from '../store.svelte.js';
  
  let isLoading = $state(false);

  function startLoad() {
    isLoading = true;
    // フェイクのロード時間 (2秒後に完了)
    setTimeout(() => {
      isLoading = false;
      completeTerrainLoad();
    }, 2000);
  }
</script>

<div class="overlay">
  <h2>fujihill-trainer (Svelte PoC版)</h2>
  <p>地形データの読み込みをシミュレーションします。</p>
  
  {#if !isLoading}
    <button onclick={startLoad}>開始</button>
  {:else}
    <p>Loading terrain data...</p>
    <progress value="50" max="100"></progress>
  {/if}
</div>

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.8); color: white;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 2000;
  }
  button { padding: 10px 20px; font-size: 1.2rem; cursor: pointer; }
</style>
