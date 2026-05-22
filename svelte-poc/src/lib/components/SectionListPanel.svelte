<script>
  import { appState, openPairingScreen } from '../store.svelte.js';

  const sections = [
    { id: 1, dist: "0.0 - 5.0", grade: "5.5%" },
    { id: 2, dist: "5.0 - 10.0", grade: "6.2%" },
    { id: 3, dist: "10.0 - 15.0", grade: "7.1%" },
  ];

  function startSection(sec) {
    appState.currentSection = sec.id;
    appState.phase = 'riding'; // 念のためridingをセット
  }
</script>

<div class="panel">
  <h3>コース区間リスト (観るモード)</h3>
  <p class="hint">ここからいつでも別の区間にジャンプできます。</p>
  
  <ul>
    {#each sections as sec}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li 
        class:active={appState.currentSection === sec.id}
        onclick={() => startSection(sec)}
      >
        区間 {sec.id}: {sec.dist}km (平均 {sec.grade})
      </li>
    {/each}
  </ul>

  <!-- 観るモード中にも設定画面は開ける -->
  <button class="settings-btn" onclick={openPairingScreen}>
    ⚙️ ペアリング・設定画面を開く
  </button>
</div>

<style>
  .panel {
    position: fixed; right: 20px; top: 20px; width: 300px;
    background: rgba(0, 0, 0, 0.8); color: white; border: 1px solid #444;
    padding: 15px; border-radius: 8px; z-index: 1000;
  }
  h3 { margin: 0 0 10px 0; color: #ffd54a; font-size: 1rem; }
  .hint { font-size: 0.8rem; color: #aaa; margin: 0 0 10px 0; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { 
    padding: 10px; border-bottom: 1px solid #333; cursor: pointer; 
    font-size: 0.9rem;
  }
  li:hover { background: #333; }
  li.active { background: #4a90e2; font-weight: bold; }
  .settings-btn {
    margin-top: 15px; width: 100%; padding: 8px; background: #333; 
    color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer;
  }
  .settings-btn:hover { background: #444; }
</style>
