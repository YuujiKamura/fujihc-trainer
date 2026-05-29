// Svelte 5 の Runes を用いた状態管理 (正解の源泉)
// ここにある状態が変更されると、表示は自動的に更新されます。

export const appState = $state({
  // アプリの進行段階: 'intro' -> 'terrain_loading' -> 'pairing' -> 'riding' -> 'postride'
  phase: 'intro',
  
  // フラグ類
  isViewMode: false,
  trainerConnected: false,

  // 観る様態用: 疑似進行のためのダミー
  currentSection: null,
});

// 状態遷移の操作（ここで各フラグを一括管理し、矛盾を物理的に排除する）

export function startApp() {
  // 導入段階から地形読み込みへ
  appState.phase = 'terrain_loading';
}

export function completeTerrainLoad() {
  // 読み込み完了後、観る様態なら直接走行へ、そうでなければ準備段階へ
  if (appState.isViewMode) {
    appState.phase = 'riding';
  } else {
    appState.phase = 'pairing';
  }
}

export function connectTrainer() {
  appState.trainerConnected = true;
}

export function enterViewMode() {
  // 「コースを観る」を押した時
  appState.isViewMode = true;
  appState.phase = 'terrain_loading'; // まずは地形読み込みから開始
}

export function startRealRide() {
  // 準備段階から実走を開始した時。観る様態を必ず解除する。
  appState.isViewMode = false;
  appState.phase = 'riding';
}

export function openPairingScreen() {
  // 走行中に設定画面を開く
  appState.phase = 'pairing';
}

export function abortPairing() {
  // 準備を中断して走行に戻る
  appState.phase = 'riding';
}

export function endRide() {
  // 走行終了。観る様態の場合は導入へ戻り、実走なら走行後画面へ。
  if (appState.isViewMode) {
    backToIntro();
  } else {
    appState.phase = 'postride';
  }
}

export function backToIntro() {
  // 導入段階へ戻る（状態のリセット）
  appState.phase = 'intro';
  appState.isViewMode = false;
  appState.trainerConnected = false;
}
