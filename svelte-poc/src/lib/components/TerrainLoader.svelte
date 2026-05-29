<script>
  import { onMount } from 'svelte';
  import { completeTerrainLoad } from '../store.svelte.js';

  onMount(() => {
    // 仮想の地形読み込み
    setTimeout(() => {
      completeTerrainLoad();
    }, 1000);
  });
</script>

<div class="loader">
  <h2>地形データを読み込み中...</h2>
</div>

<style>
  .loader {
    padding: 20px;
    background: rgba(255,255,255,0.1);
    border-radius: 8px;
  }
</style>
