export const setupStore = $state({
  visible: false,
  
  // Status and Steps
  setupStatusText: '起動中...',
  terrainReady: false,
  terrainStatusText: '地形データ準備中...',
  terrainStatusColor: '#ffd54a',
  activeStep: 'terrain', // 'terrain', 'scan', 'connect', 'handshake', 'ready'
  
  // Device Status (Trainer / HR)
  deviceStatus: {
    trainerName: '--',
    trainerState: '--',
    trainerAck: '--',
  },
  
  // Live Values
  liveValues: {
    power: '--',
    cadence: '--',
    speed: '--',
    hr: '--'
  },
  
  // Bridge Scan Section
  scanModeLabel: '(trainer モード、 FTMS を自動接続)',
  scanList: [], // Array of { id, name, type, meta, isFtms }
  scanError: '',
  btnScanDisabled: false,
  btnScanHrmDisabled: false,
  btnClosePairingVisible: false,
  
  // BLE Section (Web Bluetooth)
  bleSectionVisible: false,
  btnBleTrainerDisabled: false,
  btnBleHrmDisabled: false,
  
  // Ride Buttons
  btnRideStartDisabled: true,
  btnViewModeDisabled: true,

  // Strava
  stravaStatusHtml: '未連携',
  stravaSetupVisible: false,
});
