// Svelte 5 の Runes を用いたグローバル状態管理 (Single Source of Truth)
// ここにある状態が変更されると、UIは自動的に再描画されます。

export const appState = $state({
  // アプリの進行フェーズ: 'terrain_loading' -> 'pairing' -> 'riding'
  phase: 'terrain_loading',
  
  // フラグ類
  isViewMode: false,
  trainerConnected: false,

  // 観るモード用: 疑似進行のためのダミー
  currentSection: null,
});

// 状態遷移アクション（ここで各フラグを一括管理するため、矛盾が起きない）

export function completeTerrainLoad() {
  appState.phase = 'pairing';
}

export function connectTrainer() {
  appState.trainerConnected = true;
}

export function enterViewMode() {
  // 「コースを観る」を押した時
  appState.isViewMode = true;
  appState.phase = 'riding'; // 観るモードでのセクション待機状態
}

export function startRealRide() {
  // 意図的に実走を開始した時。ここで isViewMode を必ず false に落とす。
  // これにより「実走中なのに観るモード」という矛盾状態が絶対に起こらなくなる。
  appState.isViewMode = false;
  appState.phase = 'riding';
}

export function openPairingScreen() {
  // 走行中・観るモード中に設定画面を開く
  // 状態を pairing に戻すだけで、元の状態は一旦隠れる
  appState.phase = 'pairing';
}

export function abortPairing() {
  // ペアリング画面をキャンセルして走行画面に戻る
  appState.phase = 'riding';
}
