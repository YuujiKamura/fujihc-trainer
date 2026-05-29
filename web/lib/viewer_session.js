// model: viewer の boot / scan / dbinit 経路の session state を 1 closure に閉じる. b124 -
// b125c の module-global 撤去シリーズの続き. DOM / window 参照ゼロ、 純粋寄りで Svelte 移植
// 時の reactive store の素地. caller は値を取り出す / 入れるだけ.
//
// 集約する 3 state:
// - env: bootEnv() で 1 度確定する immutable な起動環境 (= ENV.mode の参照に使う).
//   `setEnv` は idempotent、 同 instance を 2 度書こうとしたら最初の Object.freeze を返す.
// - scanMode: BLE scan の対象種別 ('ftms' or 'hrm'). 不正値は ignore + 既存値維持.
// - advancedFromDbinit: dbinit overlay から次画面に進んだか (= setup overlay 再表示防止 flag).

const VALID_SCAN_MODES = Object.freeze(['ftms', 'hrm']);

/**
 * viewer session の closure factory.
 *
 * @returns {{
 *   getEnv(): object|null,
 *   setEnv(env: object|null): object|null,
 *   getScanMode(): string,
 *   setScanMode(mode: string): void,
 *   isAdvancedFromDbinit(): boolean,
 *   markAdvancedFromDbinit(): void,
 *   resetAdvancedFromDbinit(): void,
 *   snapshot(): {env:object|null, scanMode:string, advancedFromDbinit:boolean}
 * }}
 */
export function createViewerSession() {
  let env = null;
  let scanMode = 'ftms';
  let advancedFromDbinit = false;

  return {
    getEnv() { return env; },
    // setEnv は idempotent: 既に確定済なら同 instance を返す (= bootEnv の 2 度呼出し許容).
    // null / undefined は no-op で現在値を返す.
    setEnv(newEnv) {
      if (env != null) return env;
      if (newEnv == null) return null;
      env = Object.freeze(newEnv);
      return env;
    },
    getScanMode() { return scanMode; },
    // 不正値は ignore + 既存値維持 (= UI 入力ミスで scan 経路が壊れないように).
    setScanMode(mode) {
      if (VALID_SCAN_MODES.includes(mode)) {
        scanMode = mode;
      }
    },
    isAdvancedFromDbinit() { return advancedFromDbinit; },
    markAdvancedFromDbinit() { advancedFromDbinit = true; },
    resetAdvancedFromDbinit() { advancedFromDbinit = false; },
    snapshot() {
      return { env, scanMode, advancedFromDbinit };
    },
  };
}

export const VIEWER_SESSION_VALID_SCAN_MODES = VALID_SCAN_MODES;
