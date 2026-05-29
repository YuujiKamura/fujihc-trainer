// 基本情報のスキーマ定義と状態管理

export const PROFILE_DEFAULTS = {
  schemaVersion: 1,
  riderWeight: 68,
  bikeWeight: 7,
  ftp: 200,
  labelSize: 1.0,
  aero: 'standard',
  rotation: 'normal'
};

const LS_KEY_PROFILE = 'fujihill.profile';

// 旧データのマイグレーション用キーリスト
const LEGACY_KEYS = [
  'fujihill.inertiaKg',
  'fujihill.lastBleDeviceId',
  'fujihill.labelSize',
  'fujihill.consent.intro.v1',
  'fujihill.consent.ride.v1'
];

/**
 * 初回起動時などに、旧版のlocalStorageキーを退避（.bak化）する
 */
export function migrateLegacyData() {
  if (typeof window === 'undefined' || !window.localStorage) return;

  LEGACY_KEYS.forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) {
      // 退避
      localStorage.setItem(`${key}.bak`, val);
      // 古いものは削除
      localStorage.removeItem(key);
    }
  });
}

/**
 * プロフィールデータを読み込む（無効ならフォールバック）
 */
export function loadProfile() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...PROFILE_DEFAULTS };
  }

  migrateLegacyData();

  try {
    const raw = localStorage.getItem(LS_KEY_PROFILE);
    if (!raw) return { ...PROFILE_DEFAULTS };

    const parsed = JSON.parse(raw);
    
    // スキーマ検証（簡易）とフォールバック
    if (!parsed || parsed.schemaVersion !== 1) {
      return { ...PROFILE_DEFAULTS };
    }

    return {
      ...PROFILE_DEFAULTS,
      ...parsed,
      // 型キャストや必須保証が必要な場合はここで行う
      riderWeight: Number(parsed.riderWeight) || PROFILE_DEFAULTS.riderWeight,
      ftp: Number(parsed.ftp) || PROFILE_DEFAULTS.ftp
    };
  } catch (e) {
    console.error('Failed to parse profile data', e);
    return { ...PROFILE_DEFAULTS };
  }
}

/**
 * プロフィールデータを保存する
 */
export function saveProfile(data) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  
  const toSave = { ...PROFILE_DEFAULTS, ...data, schemaVersion: 1 };
  localStorage.setItem(LS_KEY_PROFILE, JSON.stringify(toSave));
}
