<script>
  // propsとして親(App.svelte)から完了コールバックを受け取る
  let { onDone, visible } = $props();

  let phase = $state('idle'); // 'idle' | 'loading' | 'error'
  let progressDone = $state(0);
  let progressTotal = $state(0);
  let errorMessage = $state('');

  function startLoad() {
    phase = 'loading';
    
    // Vanilla JSの既存のロジック(startTerrainPhase)を呼び出す
    if (window.fujihillInterop && window.fujihillInterop.startTerrainPhase) {
      try {
        const terrainPhase = window.fujihillInterop.startTerrainPhase();
        if (terrainPhase) {
          terrainPhase.subscribe((snap) => {
            if (snap.total > 0) {
              progressDone = snap.done;
              progressTotal = snap.total;
            }
            if (snap.phase === 'done') {
              onDone(); // 完了したらApp.svelteに通知する
            } else if (snap.phase === 'failed') {
              phase = 'error';
              errorMessage = snap.error 
                ? `地形データの読み込みに失敗しました (${snap.error})。`
                : '地形データの読み込みに失敗しました。';
            }
          });
        }
      } catch (e) {
        console.warn('[fujihill] terrain phase init failed:', e);
        phase = 'error';
        errorMessage = '地形データの読み込みを開始できませんでした。';
      }
    } else {
      phase = 'error';
      errorMessage = 'Svelte Interop failed: startTerrainPhase not found.';
    }
  }
</script>

<div id="intro-overlay" role="dialog" aria-modal="true" aria-labelledby="intro-title" class:visible={visible} data-intro-state={phase === 'idle' ? 'visible' : phase === 'loading' ? 'loading' : 'failed'}>
  <div id="intro-panel">
    <h2 id="intro-title">fujihill-trainer (= 富士ヒルクライム シミュレータ)</h2>
    <p>このアプリは富士ヒルクライムコースを室内 trainer で再現する練習補助シミュレータです。 データはこの browser のローカルのみで完結します (= サーバ送信なし、 cookie 不使用)。</p>
    <p class="intro-disclaimer">元 GPX は屋外計測の GPS データで、 受信状態によって位置・標高に誤差を含みます (= 実際の富士スバルラインの勾配と完全一致しません、 大体合ってる程度の精度です)。 この不確実性を許容してご利用ください。</p>
    <p id="terrain-loader-lead" class="terrain-loader-lead">「開始」 を押すと地形データ (国土地理院 / OpenStreetMap タイル) の読み込みを始めます。 読み込み完了後にトレーナー接続画面へ進みます。</p>
    
    {#if phase === 'loading' || phase === 'error'}
      <div id="terrain-loader-progress" class="terrain-loader-progress">
        {#if phase === 'loading'}
          <p id="terrain-loader-status">地形データを読み込んでいます… {progressTotal > 0 ? `(${progressDone}/${progressTotal})` : ''}</p>
        {:else if phase === 'error'}
          <p id="terrain-loader-error" class="terrain-loader-error">{errorMessage}</p>
        {/if}
      </div>
    {/if}

    <div class="actions">
      {#if phase === 'idle'}
        <button id="btnTerrainLoaderStart" type="button" onclick={startLoad}>地形データを読み込んで開始</button>
      {:else if phase === 'error'}
        <button id="btnTerrainLoaderRetry" type="button" onclick={startLoad}>再試行</button>
      {/if}
    </div>
  </div>
</div>

<style>
  /* 既存の CSS (index.css等) に依存するため、ここでは minimal にするか、そのまま使う */
  /* index.css の #intro-overlay 等のスタイルがそのまま当たります */
</style>
