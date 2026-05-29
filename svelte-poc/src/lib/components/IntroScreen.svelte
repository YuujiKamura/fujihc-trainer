<script>
  import { startApp, enterViewMode } from '../store.svelte.js';
  import mountainIcon from '../assets/fujihill/mountain.svg?raw';
</script>

<div class="intro-screen">
  <div class="sunrise-dot"></div>
  
  <div class="hero-content">
    <div class="logo-mark">
      {@html mountainIcon}
    </div>
    <h1>Fujihill Trainer</h1>
    <p class="description">
      富士ヒルクライムのコースを、室内のスマートトレーナーで再現。<br>
      第2版の意匠体系へようこそ。
    </p>

    <div class="actions">
      <button class="primary" onclick={startApp}>
        鍛錬を開始する
      </button>
      <button class="secondary" onclick={enterViewMode}>
        コースを観る
      </button>
    </div>
  </div>
</div>

<style>
  .intro-screen {
    position: relative;
    width: 100%;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, var(--fuji-sky-100) 0%, var(--fuji-snow) 100%);
    overflow: hidden;
  }

  .sunrise-dot {
    position: absolute;
    width: 150px;
    height: 150px;
    background-color: var(--fuji-coral-500);
    border-radius: 50%;
    z-index: 0;
    /* 見出しの背後に配置するためのオフセット */
    transform: translate(60px, -40px);
    opacity: 0.8;
  }

  .hero-content {
    position: relative;
    z-index: 1;
    text-align: center;
    max-width: 600px;
    padding: var(--space-4);
  }

  .logo-mark {
    width: 80px;
    height: 80px;
    margin: 0 auto var(--space-4);
    color: var(--fuji-blue-500);
  }

  h1 {
    font-size: var(--fs-display);
    color: var(--fuji-blue-900);
    margin-bottom: var(--space-2);
  }

  .description {
    font-size: var(--fs-h3);
    color: var(--text-muted);
    margin-bottom: var(--space-6);
  }

  .actions {
    display: flex;
    gap: var(--space-4);
    justify-content: center;
  }

  button {
    padding: var(--space-3) var(--space-5);
    font-size: var(--fs-body);
    font-weight: 600;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: transform var(--dur-fast) var(--ease-out), background var(--dur-fast);
  }

  button:hover {
    transform: scale(1.05);
  }

  button.primary {
    background-color: var(--primary);
    color: var(--text-on-fill);
    border: none;
    box-shadow: var(--shadow-2);
  }

  button.primary:hover {
    background-color: var(--primary-hover);
  }

  button.secondary {
    background-color: transparent;
    color: var(--primary);
    border: 2px solid var(--primary);
  }

  button.secondary:hover {
    background-color: var(--primary-soft);
  }
</style>
