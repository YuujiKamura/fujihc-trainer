import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadProfile, saveProfile, PROFILE_DEFAULTS, migrateLegacyData } from './profile.js';

describe('b121: プロフィール管理の検証', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('マイグレーションと退避 (.bak)', () => {
    it('旧バージョンのキーが存在する場合、.bakを付けて退避し、元のキーを削除すること', () => {
      localStorage.setItem('fujihill.inertiaKg', '70');
      localStorage.setItem('fujihill.lastBleDeviceId', 'device123');

      migrateLegacyData();

      expect(localStorage.getItem('fujihill.inertiaKg')).toBeNull();
      expect(localStorage.getItem('fujihill.inertiaKg.bak')).toBe('70');
      expect(localStorage.getItem('fujihill.lastBleDeviceId')).toBeNull();
      expect(localStorage.getItem('fujihill.lastBleDeviceId.bak')).toBe('device123');
    });
  });

  describe('デフォルト値の適用', () => {
    it('データが存在しない場合、デフォルト値（68kg等）が適用されること', () => {
      const profile = loadProfile();

      // 強固な断定検証（5件以上）
      expect(profile.riderWeight).toBe(68);
      expect(profile.bikeWeight).toBe(7);
      expect(profile.ftp).toBe(200);
      expect(profile.labelSize).toBe(1.0);
      expect(profile.schemaVersion).toBe(1);
    });
  });

  describe('異常系（不正なデータ構造）のフォールバック', () => {
    it('JSONパースエラー時に例外を投げずデフォルト値を返すこと', () => {
      localStorage.setItem('fujihill.profile', '{invalid json');
      
      // console.error をモックしてコンソールを汚さないようにする
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const profile = loadProfile();
      
      expect(profile.riderWeight).toBe(68);
      expect(profile.schemaVersion).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('スキーマバージョンが異なる場合、デフォルト値にフォールバックすること', () => {
      localStorage.setItem('fujihill.profile', JSON.stringify({
        schemaVersion: 999, // 未来のバージョン
        riderWeight: 50
      }));

      const profile = loadProfile();
      expect(profile.riderWeight).toBe(68); // 50ではなくデフォルトに戻る
    });

    it('必須項目が欠落または不正な型の場合、デフォルト値で補完されること', () => {
      localStorage.setItem('fujihill.profile', JSON.stringify({
        schemaVersion: 1,
        riderWeight: 'invalid_string',
        ftp: null
      }));

      const profile = loadProfile();
      expect(profile.riderWeight).toBe(68); // parseInt失敗でデフォルト
      expect(profile.ftp).toBe(200);        // nullでデフォルト
    });
  });

  describe('保存処理', () => {
    it('プロフィールが正しいJSON文字列としてlocalStorageに保存されること', () => {
      saveProfile({ riderWeight: 75, ftp: 250 });

      const raw = localStorage.getItem('fujihill.profile');
      expect(raw).toBeTruthy();
      
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.riderWeight).toBe(75);
      expect(parsed.ftp).toBe(250);
      // 未指定のものはデフォルトが維持される
      expect(parsed.bikeWeight).toBe(7);
    });
  });
});
