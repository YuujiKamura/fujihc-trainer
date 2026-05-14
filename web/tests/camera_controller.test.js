import { describe, it, expect } from 'vitest';
import {
  computeCameraParams,
  adjustZoom,
  adjustPitch,
} from '../lib/camera_controller.js';

// 富士ヒル域 (lat≒35) で 0.001 度ずつ動かす. heading.test.js と同 fixture 形式.

describe('camera_controller', () => {
  describe('computeCameraParams', () => {
    it('北向き直線 course の curIdx=0 → bearing ≒ 0°', () => {
      const course = [
        { lat: 35.4, lon: 138.7 },
        { lat: 35.401, lon: 138.7 },
        { lat: 35.402, lon: 138.7 },
        { lat: 35.403, lon: 138.7 },
        { lat: 35.404, lon: 138.7 },
        { lat: 35.405, lon: 138.7 },
      ];
      const params = computeCameraParams(course, { curIdx: 0 }, { userZoom: 20, userPitch: 70 });
      expect(params.bearing).toBeCloseTo(0, 1);
      expect(params.center).toEqual([138.7, 35.4]);
      expect(params.zoom).toBe(20);
      expect(params.pitch).toBe(70);
    });

    it('東向き直線 course → bearing ≒ 90°', () => {
      const course = [
        { lat: 35.4, lon: 138.7 },
        { lat: 35.4, lon: 138.701 },
        { lat: 35.4, lon: 138.702 },
        { lat: 35.4, lon: 138.703 },
        { lat: 35.4, lon: 138.704 },
        { lat: 35.4, lon: 138.705 },
      ];
      const params = computeCameraParams(course, { curIdx: 0 });
      expect(params.bearing).toBeCloseTo(90, 1);
    });

    it('富士ヒル域 course の curIdx=0 で center が start 点になる', () => {
      const course = [
        { lat: 35.36, lon: 138.81 },
        { lat: 35.361, lon: 138.811 },
        { lat: 35.362, lon: 138.812 },
      ];
      const params = computeCameraParams(course, { curIdx: 0 });
      // center は [lon, lat] の順 (MapLibre 規約)
      expect(params.center).toEqual([138.81, 35.36]);
    });

    it('curIdx が course 末尾を超えても clamp して末尾 point を返す', () => {
      const course = [
        { lat: 35.4, lon: 138.7 },
        { lat: 35.401, lon: 138.7 },
        { lat: 35.402, lon: 138.7 },
      ];
      const params = computeCameraParams(course, { curIdx: 999 });
      expect(params.center).toEqual([138.7, 35.402]);
      // 末尾 + lookAhead=5 でも heading が破綻せず数値が返る
      expect(typeof params.bearing).toBe('number');
      expect(Number.isFinite(params.bearing)).toBe(true);
    });

    it('curIdx が負でも clamp して start 点を返す', () => {
      const course = [
        { lat: 35.4, lon: 138.7 },
        { lat: 35.401, lon: 138.7 },
        { lat: 35.402, lon: 138.7 },
      ];
      const params = computeCameraParams(course, { curIdx: -10 });
      expect(params.center).toEqual([138.7, 35.4]);
    });

    it('options 不在 → default (zoom=23.95, pitch=85, lookAhead=5) を使う', () => {
      const course = [
        { lat: 35.4, lon: 138.7 },
        { lat: 35.401, lon: 138.7 },
        { lat: 35.402, lon: 138.7 },
        { lat: 35.403, lon: 138.7 },
        { lat: 35.404, lon: 138.7 },
        { lat: 35.405, lon: 138.7 },
      ];
      const params = computeCameraParams(course, { curIdx: 0 });
      expect(params.zoom).toBe(23.95);
      expect(params.pitch).toBe(85);
      // default lookAhead=5 で北向き直線が bearing ≒ 0
      expect(params.bearing).toBeCloseTo(0, 1);
    });
  });

  describe('adjustZoom', () => {
    it('正の delta で増加し、上限 24 で clamp', () => {
      expect(adjustZoom(16, 1)).toBe(17);
      expect(adjustZoom(23.5, 1)).toBe(24);
      expect(adjustZoom(24, 5)).toBe(24);
    });

    it('負の delta で減少し、下限 13 で clamp', () => {
      expect(adjustZoom(16, -1)).toBe(15);
      expect(adjustZoom(13.5, -1)).toBe(13);
      expect(adjustZoom(13, -5)).toBe(13);
    });

    it('カスタム min/max を受け付ける', () => {
      expect(adjustZoom(10, 100, 0, 22)).toBe(22);
      expect(adjustZoom(10, -100, 5, 22)).toBe(5);
    });
  });

  describe('adjustPitch', () => {
    it('正の delta で増加し、上限 85 で clamp', () => {
      expect(adjustPitch(55, 5)).toBe(60);
      expect(adjustPitch(84, 5)).toBe(85);
      expect(adjustPitch(85, 10)).toBe(85);
    });

    it('負の delta で減少し、下限 0 で clamp', () => {
      expect(adjustPitch(55, -5)).toBe(50);
      expect(adjustPitch(3, -5)).toBe(0);
      expect(adjustPitch(0, -10)).toBe(0);
    });

    it('カスタム min/max を受け付ける', () => {
      expect(adjustPitch(50, 100, 10, 70)).toBe(70);
      expect(adjustPitch(50, -100, 10, 70)).toBe(10);
    });
  });
});
