<script>
  import { splitCourseIntoSections } from '$legacy/course_sections.js';
  import { onMount } from 'svelte';

  // ダミーデータ：24kmを1968点で分割するようなコースデータを模倣
  const dummyCourse = Array.from({ length: 1968 }, (_, i) => {
    const frac = i / 1967;
    const distance_m = frac * 24000;
    const elevation_m = 1000 + frac * 1200; // 標高1000m〜2200m
    const slope_pct = 5.0 + Math.sin(frac * Math.PI * 10) * 3; // 2%〜8%
    return { distance_m, elevation_m, slope_pct };
  });

  const sections = splitCourseIntoSections(dummyCourse, 10);
  
  // 今走っているセクション（モック）
  let currentActiveIndex = 2; 

  function formatDist(m) {
    return (m / 1000).toFixed(1);
  }
</script>

<div class="section-list-panel">
  <h3>区間情報</h3>
  <div class="sections">
    {#each sections as sec, i}
      <div class="section-item {i === currentActiveIndex ? 'active' : ''} {i < currentActiveIndex ? 'passed' : ''}">
        <div class="sec-index">{(i + 1).toString().padStart(2, '0')}</div>
        <div class="sec-details">
          <div class="sec-dist">{formatDist(sec.start_dist)}km - {formatDist(sec.end_dist)}km</div>
          <div class="sec-stats">
            <span class="avg-slope">Avg {sec.avg_slope_pct.toFixed(1)}%</span>
            <span class="max-slope">Max {sec.max_slope_pct.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .section-list-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  h3 {
    margin-top: 0;
    font-size: var(--fs-h3);
    color: var(--fuji-blue-900);
    border-bottom: 2px solid var(--border);
    padding-bottom: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .sections {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-right: var(--space-1);
  }

  .section-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-soft);
    color: var(--text);
    transition: background var(--dur-fast);
  }

  .section-item.passed {
    opacity: 0.5;
  }

  .section-item.active {
    background: var(--primary);
    color: var(--text-on-fill);
    box-shadow: var(--shadow-1);
    transform: scale(1.02);
  }

  .sec-index {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    font-weight: 600;
    opacity: 0.8;
  }

  .sec-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sec-dist {
    font-size: var(--fs-small);
    font-weight: 500;
  }

  .sec-stats {
    font-size: var(--fs-caption);
    display: flex;
    gap: var(--space-3);
    font-family: var(--font-mono);
  }

  .active .sec-stats {
    color: rgba(255, 255, 255, 0.8);
  }

  .max-slope {
    color: var(--danger);
  }
  .active .max-slope {
    color: #ffcccc;
  }
</style>
