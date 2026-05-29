<script>
  import { appState } from '../store.svelte.js';
</script>

<div class="metrics-panel">
  <div class="info-card">
    <div class="card-title">現在の状況</div>
    <div class="card-content">
      <div class="metric-row">
        <span class="label">心拍数</span>
        <span class="val"><span class="t-meter--md">145</span> <small>bpm</small></span>
      </div>
      <div class="metric-row">
        <span class="label">走行距離</span>
        <span class="val"><span class="t-meter--md">5.2</span> <small>km</small></span>
      </div>
    </div>
  </div>

  <div class="info-card">
    <div class="card-title">経過時間</div>
    <div class="card-content">
      <div class="timer">
        <span class="t-meter--lg">00:15:23</span>
      </div>
      <div class="metric-row">
        <span class="label">予想タイム</span>
        <span class="val"><span class="t-meter">01:10:45</span></span>
      </div>
    </div>
  </div>

  <div class="info-card">
    <div class="card-title">サマリー</div>
    <div class="card-content">
      <div class="metric-row">
        <span class="label">平均パワー</span>
        <span class="val"><span class="t-meter">182</span> <small>W</small></span>
      </div>
      <div class="metric-row">
        <span class="label">TSS</span>
        <span class="val"><span class="t-meter">24.5</span></span>
      </div>
    </div>
  </div>
</div>

<style>
  .metrics-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    height: 100%;
  }

  .info-card {
    background: var(--surface);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    box-shadow: var(--shadow-1);
    border: 1px solid var(--border);
  }

  .card-title {
    font-size: var(--fs-small);
    color: var(--text-muted);
    font-weight: 600;
    margin-bottom: var(--space-3);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .card-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .metric-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .label {
    font-size: var(--fs-body);
    color: var(--text);
  }

  .val {
    color: var(--primary);
    font-weight: 600;
  }

  .val small {
    font-size: var(--fs-caption);
    color: var(--text-muted);
    margin-left: 2px;
  }

  .timer {
    text-align: center;
    color: var(--fuji-blue-800);
    margin-bottom: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border);
  }
</style>
