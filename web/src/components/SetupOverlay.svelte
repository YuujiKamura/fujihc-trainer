<script>
  import { setupStore } from '../stores/setupStore.svelte.js';

  // Events that Vanilla JS will handle
  let { 
    onStartRide, 
    onStartViewMode, 
    onScanTrainer, 
    onScanHrm, 
    onClosePairing,
    onBleTrainer,
    onBleHrm,
    onDeviceSelect,
    onStravaConnect,
    onStravaDisconnect,
    onStravaSetupSave,
    onStravaSetupCancel
  } = $props();

</script>

<!-- The main setup overlay -->
<div id="s-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="s-pairing-title" class:visible={setupStore.visible}>
  <div id="s-setup-panel">
    <h2 id="s-pairing-title">fujihill trainer ライド準備 (Svelte 版)</h2>
    <div class="status-line" id="s-setup-status">{setupStore.setupStatusText}</div>
    
    <div id="s-step-indicator">
      <div class="step" id="s-step-terrain" class:active={setupStore.activeStep === 'terrain'} class:done={setupStore.terrainReady}>0. 地形データ準備</div>
      <div class="step" id="s-step-scan" class:active={setupStore.activeStep === 'scan'} class:done={setupStore.activeStep === 'connect' || setupStore.activeStep === 'handshake' || setupStore.activeStep === 'ready'}>1. 機器検索</div>
      <div class="step" id="s-step-connect" class:active={setupStore.activeStep === 'connect'} class:done={setupStore.activeStep === 'handshake' || setupStore.activeStep === 'ready'}>2. BLE 接続</div>
      <div class="step" id="s-step-handshake" class:active={setupStore.activeStep === 'handshake'} class:done={setupStore.activeStep === 'ready'}>3. ハンドシェイク</div>
      <div class="step" id="s-step-ready" class:active={setupStore.activeStep === 'ready'} class:done={setupStore.activeStep === 'ready'}>4. 走行準備完了</div>
    </div>
    
    <div id="s-terrain-status" class="status-line" style="color:{setupStore.terrainStatusColor}; margin:0.3rem 0;">{setupStore.terrainStatusText}</div>
    
    <details id="s-device-status-fold">
      <summary style="cursor:pointer; color:#ffd54a; font-size:14px; font-weight:bold;">機器の状態</summary>
      <div class="pair-cols" style="margin-top:0.4rem;">
        <section><h3>trainer</h3><dl>
          <dt>機種</dt><dd><span id="s-p-device">{setupStore.deviceStatus.trainerName}</span></dd>
          <dt>状態</dt><dd><span id="s-p-state">{setupStore.deviceStatus.trainerState}</span></dd>
          <dt>応答</dt><dd><span id="s-p-ack">{setupStore.deviceStatus.trainerAck}</span></dd>
        </dl></section>
        <section><h3>live values</h3><dl>
          <dt>power</dt><dd><span id="s-p-power">{setupStore.liveValues.power}</span> W</dd>
          <dt>cadence</dt><dd><span id="s-p-cadence">{setupStore.liveValues.cadence}</span> rpm</dd>
          <dt>speed</dt><dd><span id="s-p-speed">{setupStore.liveValues.speed}</span> km/h</dd>
          <dt>hr</dt><dd><span id="s-p-hr">{setupStore.liveValues.hr}</span> bpm</dd>
        </dl></section>
      </div>
    </details>
    
    <details id="s-bridge-scan-section">
      <summary style="cursor:pointer; color:#ffd54a; font-size:14px; font-weight:bold;">機器検索 <span id="s-scan-mode-label" style="color:#aaa; font-weight:normal; font-size:11px;">{setupStore.scanModeLabel}</span></summary>
      <ul id="s-setup-list">
        {#each setupStore.scanList as dev}
          <li class:ftms={dev.isFtms} onclick={() => onDeviceSelect && onDeviceSelect(dev.id)}>
            <div class="dev-name">{dev.name}</div>
            <div class="dev-meta">{dev.meta}</div>
          </li>
        {/each}
      </ul>
      <div id="s-setup-error">{@html setupStore.scanError}</div>
      <div id="s-setup-buttons">
        <button id="s-btnScan" disabled={setupStore.btnScanDisabled} onclick={onScanTrainer}>trainer スキャン</button>
        <button id="s-btnScanHrm" disabled={setupStore.btnScanHrmDisabled} onclick={onScanHrm}>心拍計スキャン</button>
        <button id="s-btnClosePairing" hidden={!setupStore.btnClosePairingVisible} onclick={onClosePairing}>ライドに戻る</button>
      </div>
    </details>
    
    <section id="s-ble-section" hidden={!setupStore.bleSectionVisible}>
      <h3>Web Bluetooth 直接接続</h3>
      <p style="color:#aaa; font-size:11px; margin:0 0 0.4rem;">bridge.py 無し、 ブラウザから直接 FTMS trainer と心拍計に接続します。</p>
      <button id="s-btn-ble-trainer" disabled={setupStore.btnBleTrainerDisabled} onclick={onBleTrainer}>Trainer に接続 (BLE)</button>
      <button id="s-btn-ble-hrm" disabled={setupStore.btnBleHrmDisabled} onclick={onBleHrm}>心拍計に接続 (BLE、 任意)</button>
    </section>

    <div style="display:flex; gap:0.6rem; margin-top:0.6rem;">
      <button id="s-btnSetupGoView" style="flex:1; padding:0.5rem; font:inherit; background:#1a3322; color:#7fff00; border:1px solid #7fff00; border-radius:4px; cursor:pointer;" disabled={setupStore.btnViewModeDisabled} onclick={onStartViewMode}>コースを観る (走らない)</button>
    </div>

    <button id="s-btnRideStart" disabled={setupStore.btnRideStartDisabled} onclick={onStartRide}>▶ 富士スバルラインを走る</button>

    <div id="s-strava-section">
      <h3>Strava 連携</h3>
      <div class="strava-status" id="s-strava-status">{@html setupStore.stravaStatusHtml}</div>
      <div style="display:flex;">
        <button id="s-btnStravaConnect" onclick={onStravaConnect}>連携する</button>
        <button id="s-btnStravaDisconnect" onclick={onStravaDisconnect}>連携解除</button>
        <a href="https://github.com/mizofumi0411/fujihc-trainer?tab=readme-ov-file#strava-%E3%81%B8%E3%81%AE%E8%B5%B0%E8%A1%8C%E3%83%AD%E3%82%B0%E3%82%A2%E3%83%83%E3%83%97%E3%83%AD%E3%83%BC%E3%83%89" target="_blank" rel="noopener noreferrer" style="margin-left:auto;">設定手順</a>
      </div>
    </div>
    <div id="s-strava-setup-overlay" style="display:{setupStore.stravaSetupVisible ? 'flex' : 'none'}; flex-direction:column; gap:0.5rem; background:#14141a; border:1px solid #333; border-radius:4px; padding:0.8rem; margin-top:0.8rem;">
      <p style="margin:0; font-size:12px; color:#ddd;">Strava API の Client ID を入力してください。<br>自身の API Application (作成無料) を使うことで、 ローカルブラウザから直接アップロードします。</p>
      <input type="text" id="s-stravaClientIdInput" placeholder="Client ID (例: 123456)" style="padding:0.4rem; font:inherit; background:#0c0c10; color:#ddd; border:1px solid #333; border-radius:4px;" bind:value={setupStore.stravaClientIdInput}>
      <div style="display:flex; gap:0.4rem; margin-top:0.4rem;">
        <button id="s-btnStravaSetupSave" style="background:#ffd54a; color:#000; border:none; padding:0.4rem 0.8rem; border-radius:4px; font:inherit; cursor:pointer;" onclick={onStravaSetupSave}>保存して連携</button>
        <button id="s-btnStravaSetupCancel" style="background:transparent; color:#aaa; border:1px solid #444; padding:0.4rem 0.8rem; border-radius:4px; font:inherit; cursor:pointer;" onclick={onStravaSetupCancel}>キャンセル</button>
      </div>
    </div>
  </div>
</div>
