<script>
  import { appState, backToIntro } from '../store.svelte.js';
  import mountainIcon from '../assets/fujihill/mountain.svg?raw';
  import settingsIcon from '../assets/fujihill/settings.svg?raw';
</script>

<header class="top-bar">
  <div class="left">
    <button class="logo-btn" onclick={backToIntro}>
      <span class="icon">{@html mountainIcon}</span>
      <span class="label">fujihill</span>
    </button>
  </div>

  <div class="center">
    {#if appState.phase !== 'intro'}
      <div class="phase-info">
        {appState.phase === 'terrain_loading' ? '地形読み込み中' : 
         appState.phase === 'pairing' ? '準備' : 
         appState.phase === 'riding' ? '走行' : '終了'}
      </div>
    {/if}
  </div>

  <div class="right">
    {#if appState.phase === 'riding'}
      <button class="icon-btn" onclick={() => appState.phase = 'postride'} title="走行終了 (デモ用)">
        🏁
      </button>
      <button class="icon-btn" onclick={() => appState.phase = 'pairing'}>
        {@html settingsIcon}
      </button>
    {/if}
  </div>
</header>

<style>
  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: var(--glass);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-4);
    z-index: 1000;
  }

  .left, .right {
    display: flex;
    align-items: center;
    width: 200px;
  }

  .right {
    justify-content: flex-end;
  }

  .logo-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--primary);
    padding: 0;
  }

  .logo-btn .icon {
    width: 32px;
    height: 32px;
  }

  .logo-btn .label {
    font-weight: 700;
    font-size: var(--fs-h3);
    letter-spacing: var(--tracking-wide);
  }

  .phase-info {
    font-weight: 500;
    color: var(--text-muted);
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text);
    border-radius: var(--radius-sm);
    transition: background var(--dur-fast);
  }

  .icon-btn:hover {
    background: var(--primary-soft);
  }

  .icon-btn :global(svg) {
    width: 24px;
    height: 24px;
  }
</style>
