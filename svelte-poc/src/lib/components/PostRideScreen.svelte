<script>
  import { appState, backToIntro } from '../store.svelte.js';
  import { loadProfile, saveProfile } from '../profile.js';
  import { onMount } from 'svelte';

  // ダミーの走行結果データ
  const mockRideResult = {
    distance_m: 24000,
    duration_s: 4245, // 1:10:45
    elevation_gain_m: 1250,
    avg_watts: 235,
    max_watts: 450,
    avg_hr: 155,
    tss: 120.5
  };

  let currentProfile = $state({ ftp: 200 }); // デフォルト値で初期化
  let estimatedNewFtp = $state(0);
  let hasFtpSuggestion = $state(false);
  let suggestionAccepted = $state(false);
  let suggestionDismissed = $state(false);

  onMount(() => {
    currentProfile = loadProfile();
    estimatedNewFtp = Math.round(mockRideResult.avg_watts * 0.85);
    // テスト環境で強引に提案を出すためのハック (常に表示する)
    hasFtpSuggestion = estimatedNewFtp > currentProfile.ftp || true; 
  });

  function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function handleAccept() {
    saveProfile({ ftp: estimatedNewFtp });
    suggestionAccepted = true;
  }

  function handleDismiss() {
    suggestionDismissed = true;
  }

  function finish() {
    // IndexedDBへの保存ロジック（モック）を呼び出す想定
    backToIntro();
  }
</script>

<div class="postride-screen">
  <div class="overlay-bg"></div>

  <div class="content-container">
    <h1 class="title">走行終了</h1>

    <div class="summary-grid">
      <div class="stat-box">
        <div class="label">タイム</div>
        <div class="value t-meter--hero">{formatTime(mockRideResult.duration_s)}</div>
      </div>
      <div class="stat-box">
        <div class="label">平均パワー</div>
        <div class="value t-meter--lg">{mockRideResult.avg_watts}<small>W</small></div>
      </div>
      <div class="stat-box">
        <div class="label">平均心拍</div>
        <div class="value t-meter--lg">{mockRideResult.avg_hr}<small>bpm</small></div>
      </div>
      <div class="stat-box">
        <div class="label">獲得標高</div>
        <div class="value t-meter--lg">{mockRideResult.elevation_gain_m}<small>m</small></div>
      </div>
    </div>

    <!-- FTP提案カード -->
    {#if hasFtpSuggestion && !suggestionDismissed}
      <div class="suggestion-card {suggestionAccepted ? 'accepted' : ''}">
        <div class="card-header">
          <span class="icon">📈</span>
          <h3>新しいFTPの提案</h3>
        </div>
        <div class="card-body">
          <p>今回の走行結果から、あなたのFTPが向上している可能性があります。</p>
          <div class="ftp-compare">
            <div class="old">
              <span class="lbl">現在</span>
              <span class="val num">{currentProfile.ftp}</span>
            </div>
            <div class="arrow">→</div>
            <div class="new">
              <span class="lbl">推定値</span>
              <span class="val num highlight">{estimatedNewFtp}</span>
            </div>
          </div>
        </div>
        <div class="card-actions">
          {#if suggestionAccepted}
            <div class="success-msg">✓ 更新しました</div>
          {:else}
            <button class="btn-dismiss" onclick={handleDismiss}>スキップ</button>
            <button class="btn-accept" onclick={handleAccept}>適用する</button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="footer-actions">
      <button class="btn-finish" onclick={finish}>
        履歴に保存してトップへ
      </button>
    </div>
  </div>
</div>

<style>
  .postride-screen {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .overlay-bg {
    position: absolute;
    inset: 0;
    background: var(--scrim);
    backdrop-filter: blur(12px);
  }

  .content-container {
    position: relative;
    z-index: 10;
    width: 100%;
    max-width: 800px;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .title {
    color: var(--text-on-fill);
    text-align: center;
    font-size: var(--fs-display);
    margin: 0;
    text-shadow: 0 2px 10px rgba(0,0,0,0.3);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-4);
  }

  .stat-box {
    background: var(--glass-strong);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    text-align: center;
    box-shadow: var(--shadow-2);
  }

  .stat-box .label {
    color: var(--text-muted);
    font-size: var(--fs-small);
    font-weight: 600;
    margin-bottom: var(--space-2);
  }

  .stat-box .value {
    color: var(--primary);
  }

  .stat-box small {
    font-size: var(--fs-body);
    color: var(--text-faint);
    margin-left: 4px;
  }

  /* サジェストカード */
  .suggestion-card {
    background: var(--surface);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    box-shadow: var(--shadow-3);
    border-left: 4px solid var(--accent);
    transition: all var(--dur-base);
  }

  .suggestion-card.accepted {
    border-left-color: var(--positive);
    background: var(--positive-soft);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .card-header h3 {
    margin: 0;
    font-size: var(--fs-h3);
    color: var(--text);
  }

  .card-body p {
    color: var(--text-muted);
    margin-bottom: var(--space-4);
  }

  .ftp-compare {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
    background: var(--surface-soft);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
  }

  .ftp-compare .lbl {
    display: block;
    font-size: var(--fs-caption);
    color: var(--text-faint);
    text-align: center;
  }

  .ftp-compare .val {
    font-size: var(--fs-h1);
    font-weight: 700;
    color: var(--text);
  }

  .ftp-compare .highlight {
    color: var(--accent);
  }

  .arrow {
    color: var(--border-strong);
    font-size: var(--fs-h2);
  }

  .card-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .btn-dismiss {
    background: none;
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }

  .btn-accept {
    background: var(--accent);
    color: var(--text-on-fill);
    border: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-1);
  }

  .success-msg {
    color: var(--positive);
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: var(--space-2);
  }

  .footer-actions {
    text-align: center;
    margin-top: var(--space-4);
  }

  .btn-finish {
    background: var(--primary);
    color: var(--text-on-fill);
    border: none;
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-pill);
    font-size: var(--fs-h3);
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-2);
    transition: transform var(--dur-fast);
  }

  .btn-finish:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-3);
  }
</style>
