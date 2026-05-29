<script>
  import { onMount } from 'svelte';
  import { appState, startRealRide, abortPairing } from '../store.svelte.js';
  import { loadProfile, saveProfile } from '../profile.js';

  let currentStep = $state(1); // 1: 機器選択, 2: 接続, 3: 基本情報, 4: 保存設定, 5: 完了
  let profile = $state(null);
  let consentData = $state(false);

  const STEPS = [
    { id: 1, label: '機器' },
    { id: 2, label: '接続' },
    { id: 3, label: '情報' },
    { id: 4, label: '保存' },
    { id: 5, label: '完了' }
  ];

  onMount(() => {
    profile = loadProfile();
  });

  function nextStep() {
    if (currentStep < 5) currentStep++;
  }

  function finishSetup() {
    if (profile) {
      saveProfile(profile);
    }
    // TODO: ここで実際のデバイス接続状態を appState.trainerConnected に反映させる等の処理
    startRealRide();
  }
</script>

<div class="setup-container">
  <div class="stepper">
    {#each STEPS as step}
      <div class="step {currentStep === step.id ? 'active' : ''} {currentStep > step.id ? 'completed' : ''}">
        <div class="circle">
          {#if currentStep > step.id}
            ✓
          {:else}
            {step.id}
          {/if}
        </div>
        <span class="label">{step.label}</span>
      </div>
    {/each}
  </div>

  <div class="step-content">
    {#if !profile}
      <p>データを読み込み中...</p>
    {:else}
      {#if currentStep === 1}
        <h2>1. 機器の選択</h2>
        <p class="desc">使用するスマートトレーナーを選択してください。</p>
        <!-- モックのデバイス選択 -->
        <button class="primary action-btn" onclick={nextStep}>仮想トレーナーを選択</button>
        
      {:else if currentStep === 2}
        <h2>2. 接続確認</h2>
        <p class="desc">トレーナーとの通信を確立しています...</p>
        <button class="primary action-btn" onclick={nextStep}>接続成功 (次に進む)</button>

      {:else if currentStep === 3}
        <h2>3. 基本情報の入力</h2>
        <p class="desc">物理計算に必要なあなたの情報です。外部には送信されません。</p>
        
        <div class="form-group">
          <label for="weight">体重: <span class="val">{profile.riderWeight} kg</span></label>
          <input type="range" id="weight" min="40" max="120" step="1" bind:value={profile.riderWeight} />
        </div>
        
        <div class="form-group">
          <label for="bike">自転車重量: <span class="val">{profile.bikeWeight} kg</span></label>
          <input type="range" id="bike" min="5" max="20" step="0.1" bind:value={profile.bikeWeight} />
        </div>
        
        <details class="advanced">
          <summary>詳細設定</summary>
          <div class="form-group">
            <label for="ftp">FTP: <span class="val">{profile.ftp} W</span></label>
            <input type="range" id="ftp" min="50" max="400" step="5" bind:value={profile.ftp} />
          </div>
        </details>

        <button class="primary action-btn" onclick={nextStep}>次へ</button>

      {:else if currentStep === 4}
        <h2>4. 保存設定（同意）</h2>
        <p class="desc">走行記録（位置情報・パワー等）をブラウザ内に保存しますか？</p>
        
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={consentData} />
          走行データをローカルに保存することに同意する
        </label>
        
        <button class="primary action-btn" onclick={nextStep}>確認</button>

      {:else if currentStep === 5}
        <h2>5. 準備完了</h2>
        <p class="desc">すべての設定が完了しました。走行を開始します。</p>
        <button class="primary action-btn" onclick={finishSetup}>トレーニング開始</button>
      {/if}
    {/if}
  </div>

  <div class="footer-actions">
    <button class="text-btn" onclick={abortPairing}>キャンセル（戻る）</button>
  </div>
</div>

<style>
  .setup-container {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
  }

  /* ステッパーのスタイル */
  .stepper {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--space-7);
    position: relative;
  }
  
  .stepper::before {
    content: '';
    position: absolute;
    top: 20px;
    left: 40px;
    right: 40px;
    height: 2px;
    background: var(--border);
    z-index: 0;
  }

  .step {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .circle {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--surface);
    border: 2px solid var(--border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    color: var(--text-faint);
    transition: all var(--dur-fast);
  }

  .step.active .circle {
    border-color: var(--primary);
    color: var(--primary);
    box-shadow: 0 0 0 4px var(--primary-soft);
  }

  .step.completed .circle {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--text-on-fill);
  }

  .label {
    font-size: var(--fs-caption);
    font-weight: 500;
    color: var(--text-muted);
  }
  .step.active .label { color: var(--primary); font-weight: 600; }

  /* コンテンツ領域 */
  .step-content {
    background: var(--surface);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    box-shadow: var(--shadow-2);
    text-align: center;
  }

  .desc {
    color: var(--text-muted);
    margin-bottom: var(--space-5);
  }

  .form-group {
    margin-bottom: var(--space-4);
    text-align: left;
  }

  .form-group label {
    display: block;
    font-weight: 500;
    margin-bottom: var(--space-2);
  }

  .form-group .val {
    font-family: var(--font-mono);
    color: var(--primary);
    font-weight: 600;
  }

  input[type="range"] {
    width: 100%;
  }

  .advanced {
    text-align: left;
    margin-top: var(--space-4);
    margin-bottom: var(--space-5);
    padding: var(--space-3);
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
  }
  .advanced summary {
    cursor: pointer;
    font-weight: 500;
    color: var(--text-muted);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
    cursor: pointer;
  }

  .action-btn {
    width: 100%;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: none;
    font-weight: 600;
    font-size: var(--fs-body);
    cursor: pointer;
    background: var(--primary);
    color: var(--text-on-fill);
    margin-top: var(--space-2);
  }
  .action-btn:hover { background: var(--primary-hover); }

  .footer-actions {
    margin-top: var(--space-4);
    text-align: center;
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--text-faint);
    text-decoration: underline;
    cursor: pointer;
  }
  .text-btn:hover { color: var(--text); }
</style>
