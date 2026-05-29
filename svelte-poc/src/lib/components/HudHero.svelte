<script>
  import { appState } from '../store.svelte.js';
</script>

<div class="hud-hero">
  <div class="metric grade">
    <!-- 将来的に実データとバインドします -->
    <span class="value t-meter--hero">5.5</span>
    <span class="unit">%</span>
  </div>
  <div class="sub-metrics">
    <div class="metric">
      <span class="value t-meter--md">{appState.isViewMode ? '0.0' : '24.5'}</span>
      <span class="unit">km/h</span>
    </div>
    <div class="metric">
      <span class="value t-meter--md">{appState.isViewMode ? '0' : '185'}</span>
      <span class="unit">W</span>
    </div>
    <div class="metric">
      <span class="value t-meter--md">{appState.isViewMode ? '0' : '85'}</span>
      <span class="unit">rpm</span>
    </div>
    <div class="metric">
      <span class="value t-meter--md">{appState.isViewMode ? '0' : '150'}</span>
      <span class="unit">bpm</span>
    </div>
  </div>
</div>

<style>
  .hud-hero {
    position: absolute;
    top: var(--space-5);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--glass-strong);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    z-index: 50;
    backdrop-filter: blur(8px);
  }

  .metric {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }

  .grade .value {
    color: var(--primary);
  }

  .sub-metrics {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }

  .unit {
    font-size: var(--fs-caption);
    color: var(--text-muted);
    font-weight: 500;
  }
</style>
