import { setupStore } from './setupStore.svelte.js';

export function startSetupSync() {
  if (typeof window === 'undefined') return;

  // Sync text elements
  const textIds = [
    'setup-status', 'terrain-status',
    'p-device', 'p-state', 'p-ack',
    'p-power', 'p-cadence', 'p-speed', 'p-hr',
    'scan-mode-label', 'strava-status', 'setup-error'
  ];

  textIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    // Initial sync
    syncText(id, el.innerHTML);

    // Observe changes
    new MutationObserver((mutations) => {
      syncText(id, el.innerHTML);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  function syncText(id, text) {
    switch (id) {
      case 'setup-status': setupStore.setupStatusText = text; break;
      case 'terrain-status': setupStore.terrainStatusText = text; break;
      case 'p-device': setupStore.deviceStatus.trainerName = text; break;
      case 'p-state': setupStore.deviceStatus.trainerState = text; break;
      case 'p-ack': setupStore.deviceStatus.trainerAck = text; break;
      case 'p-power': setupStore.liveValues.power = text; break;
      case 'p-cadence': setupStore.liveValues.cadence = text; break;
      case 'p-speed': setupStore.liveValues.speed = text; break;
      case 'p-hr': setupStore.liveValues.hr = text; break;
      case 'scan-mode-label': setupStore.scanModeLabel = text; break;
      case 'strava-status': setupStore.stravaStatusHtml = text; break;
      case 'setup-error': setupStore.scanError = text; break;
    }
  }

  // Sync disabled states on buttons
  const buttonIds = [
    'btnRideStart', 'btnSetupGoView', 
    'btnScan', 'btnScanHrm', 
    'btn-ble-trainer', 'btn-ble-hrm'
  ];

  buttonIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    syncButton(id, el.disabled);

    new MutationObserver(() => {
      syncButton(id, el.disabled);
    }).observe(el, { attributes: true, attributeFilter: ['disabled'] });
  });

  function syncButton(id, disabled) {
    switch (id) {
      case 'btnRideStart': setupStore.btnRideStartDisabled = disabled; break;
      case 'btnSetupGoView': setupStore.btnViewModeDisabled = disabled; break;
      case 'btnScan': setupStore.btnScanDisabled = disabled; break;
      case 'btnScanHrm': setupStore.btnScanHrmDisabled = disabled; break;
      case 'btn-ble-trainer': setupStore.btnBleTrainerDisabled = disabled; break;
      case 'btn-ble-hrm': setupStore.btnBleHrmDisabled = disabled; break;
    }
  }

  // Sync visibility (hidden attribute or .visible class or display:none)
  const visibilityEls = [
    { id: 'setup-overlay', type: 'class', check: el => el.classList.contains('visible') },
    { id: 'ble-section', type: 'hidden', check: el => !el.hidden },
    { id: 'btnClosePairing', type: 'hidden', check: el => !el.hidden },
    { id: 'strava-setup-overlay', type: 'style', check: el => el.style.display !== 'none' }
  ];

  visibilityEls.forEach(({ id, type, check }) => {
    const el = document.getElementById(id);
    if (!el) return;

    syncVis(id, check(el));

    const options = type === 'class' ? { attributes: true, attributeFilter: ['class'] } :
                    type === 'hidden' ? { attributes: true, attributeFilter: ['hidden'] } :
                    { attributes: true, attributeFilter: ['style'] };

    new MutationObserver(() => {
      syncVis(id, check(el));
    }).observe(el, options);
  });

  function syncVis(id, isVisible) {
    switch (id) {
      case 'setup-overlay': setupStore.visible = isVisible; break;
      case 'ble-section': setupStore.bleSectionVisible = isVisible; break;
      case 'btnClosePairing': setupStore.btnClosePairingVisible = isVisible; break;
      case 'strava-setup-overlay': setupStore.stravaSetupVisible = isVisible; break;
    }
  }

  // Sync step indicators
  const steps = ['step-terrain', 'step-scan', 'step-connect', 'step-handshake', 'step-ready'];
  steps.forEach((id, index) => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
      if (el.classList.contains('active')) {
        const stepName = id.replace('step-', '');
        setupStore.activeStep = stepName;
      }
      if (id === 'step-terrain') {
        setupStore.terrainReady = el.classList.contains('done');
      }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  // Sync scan list
  const setupListEl = document.getElementById('setup-list');
  if (setupListEl) {
    new MutationObserver(() => {
      setupStore.scanList = Array.from(setupListEl.children).map((li, index) => ({
        index,
        name: li.querySelector('.dev-name')?.textContent || '',
        meta: li.querySelector('.dev-meta')?.textContent || '',
        isFtms: li.classList.contains('ftms')
      }));
    }).observe(setupListEl, { childList: true });
  }

  // Bind input values (Strava Client ID)
  const stravaInput = document.getElementById('stravaClientIdInput');
  if (stravaInput) {
    stravaInput.addEventListener('input', () => {
      setupStore.stravaClientIdInput = stravaInput.value;
    });
    // Inversely, when Svelte store updates, update the DOM
    $effect.root(() => {
      $effect(() => {
        if (stravaInput.value !== setupStore.stravaClientIdInput) {
          stravaInput.value = setupStore.stravaClientIdInput || '';
        }
      });
    });
  }
}
