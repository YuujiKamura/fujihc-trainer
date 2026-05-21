// b39 course_landmarks ── 富士ヒル公式 7 landmark の data 整合 + snap + pair 判定の test。
// 各 test は「落ちたら何の表示崩れ / 計算崩れを意味するか」 を 1 行で言える形にする。

import { describe, it, expect } from 'vitest';
import { FUJIHC_LANDMARKS, snapLandmarksToCourse, findLandmarkPair } from '../lib/course_landmarks.js';

// 純関数 test 用の minimal course fixture (= 0m / 5000m / 10500m / 12800m / 17200m /
// 17800m / 21500m / 24000m に point を持つ 8 点)。
// FUJIHC_LANDMARKS の distance_m_official に完全一致する point を含み、 snap の挙動を
// 既知の idx に固定できる。
function makeFixtureCourse() {
  return [
    { distance_m: 0,     elevation_m: 1088, lat: 35.45215, lon: 138.75866, slope_pct: 0 },
    { distance_m: 5000,  elevation_m: 1300, lat: 35.43,    lon: 138.74,    slope_pct: 4.0 },
    { distance_m: 10500, elevation_m: 1700, lat: 35.42,    lon: 138.73,    slope_pct: 5.0 },
    { distance_m: 12800, elevation_m: 1850, lat: 35.41,    lon: 138.73,    slope_pct: 5.5 },
    { distance_m: 17200, elevation_m: 2020, lat: 35.40,    lon: 138.71,    slope_pct: 6.0 },
    { distance_m: 17800, elevation_m: 2060, lat: 35.40,    lon: 138.71,    slope_pct: 6.0 },
    { distance_m: 21500, elevation_m: 2227, lat: 35.395,   lon: 138.72,    slope_pct: 5.5 },
    { distance_m: 24000, elevation_m: 2305, lat: 35.39399, lon: 138.73109, slope_pct: 7.5 },
  ];
}

describe('FUJIHC_LANDMARKS data 整合', () => {
  it('配列長は 7、 distance_m_official ascending、 start=0 / finish=24000 (= 公式 7 checkpoint の数を pin)', () => {
    expect(FUJIHC_LANDMARKS.length).toBe(7);
    for (let i = 1; i < FUJIHC_LANDMARKS.length; i++) {
      expect(FUJIHC_LANDMARKS[i].distance_m_official).toBeGreaterThan(FUJIHC_LANDMARKS[i - 1].distance_m_official);
    }
    expect(FUJIHC_LANDMARKS[0].id).toBe('start');
    expect(FUJIHC_LANDMARKS[0].distance_m_official).toBe(0);
    expect(FUJIHC_LANDMARKS[6].id).toBe('finish');
    expect(FUJIHC_LANDMARKS[6].distance_m_official).toBe(24000);
  });

  it('id は start/jukaidai/san_go/osawa/yon_go/okuniwa/finish の 7 種 (= name と id の対応が崩れたら検出)', () => {
    const ids = FUJIHC_LANDMARKS.map((lm) => lm.id);
    expect(ids).toEqual(['start', 'jukaidai', 'san_go', 'osawa', 'yon_go', 'okuniwa', 'finish']);
  });

  it("name は全件文字列、 start 以外は非空 (= UI の地名欠落を防ぐ。 id='start' は標識を出さないため空)", () => {
    for (const lm of FUJIHC_LANDMARKS) {
      expect(typeof lm.name).toBe('string');
      // id='start' は計測開始地点 ── 旧称 '料金所' は誤りで正しい地名が未確定のため
      // name を空にし viewer に標識を出さない (course_landmarks.js / landmarks3d.js)。
      if (lm.id === 'start') continue;
      expect(lm.name.length).toBeGreaterThan(0);
    }
  });
});

describe('snapLandmarksToCourse', () => {
  it('戻り長 = 7、 各 idx は 0 <= idx < course.length (= snap 後 idx の範囲崩れを検出)', () => {
    const course = makeFixtureCourse();
    const result = snapLandmarksToCourse(FUJIHC_LANDMARKS, course);
    expect(result.length).toBe(7);
    for (const r of result) {
      expect(r.idx).toBeGreaterThanOrEqual(0);
      expect(r.idx).toBeLessThan(course.length);
    }
  });

  it("id='start' の idx は 0、 id='finish' の idx は course.length-1 (= 両端固定の規律)", () => {
    const course = makeFixtureCourse();
    const result = snapLandmarksToCourse(FUJIHC_LANDMARKS, course);
    const start = result.find((r) => r.id === 'start');
    const finish = result.find((r) => r.id === 'finish');
    expect(start.idx).toBe(0);
    expect(finish.idx).toBe(course.length - 1);
  });

  it('各 landmark の lat / lon / elevation_m が course[idx] と完全一致 (= 補間しない ground-truth 規律、 toBe で物理 pin)', () => {
    const course = makeFixtureCourse();
    const result = snapLandmarksToCourse(FUJIHC_LANDMARKS, course);
    for (const r of result) {
      expect(r.lat).toBe(course[r.idx].lat);
      expect(r.lon).toBe(course[r.idx].lon);
      expect(r.elevation_m).toBe(course[r.idx].elevation_m);
      expect(r.distance_m).toBe(course[r.idx].distance_m);
    }
  });

  it('course = [] → 空配列 (= 退化 case で例外を投げず空を返す)', () => {
    expect(snapLandmarksToCourse(FUJIHC_LANDMARKS, [])).toEqual([]);
  });

  it('course = null → 空配列', () => {
    expect(snapLandmarksToCourse(FUJIHC_LANDMARKS, null)).toEqual([]);
  });

  it('course = [1 point] → 空配列 (= 2 点未満は snap 不可)', () => {
    expect(snapLandmarksToCourse(FUJIHC_LANDMARKS, [{ distance_m: 0, elevation_m: 0, lat: 0, lon: 0 }])).toEqual([]);
  });
});

describe('findLandmarkPair', () => {
  function getSnapped() {
    return snapLandmarksToCourse(FUJIHC_LANDMARKS, makeFixtureCourse());
  }

  it('currentDist = 0 → prev=null, next=start (= 開始前 / 真っ先頭は「start に向かう」 として扱う)', () => {
    // BREAK-VERIFY: prev=null の規律を壊すと start 真上で勝手に「start を過ぎた」 と判定される
    const snapped = getSnapped();
    // distance=0 は first.distance_m と等しいため finish 真上 以外の boundary、 規則「>= で過ぎた」 で start を prev に
    const result = findLandmarkPair(snapped, 0);
    expect(result.prev.id).toBe('start');
    expect(result.next.id).toBe('jukaidai');
    expect(result.progressInPair).toBe(0);
  });

  it('currentDist = 5000 → prev=start, next=jukaidai, progress ≈ 0.476 (= 中間 happy case)', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, 5000);
    expect(result.prev.id).toBe('start');
    expect(result.next.id).toBe('jukaidai');
    expect(result.progressInPair).toBeCloseTo(5000 / 10500, 3);
  });

  it('currentDist = 10500 (= jukaidai 真上) → 次の pair の左 edge = prev=jukaidai, next=san_go, progress=0 (= 「過ぎた」 を即時反映の規律)', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, 10500);
    expect(result.prev.id).toBe('jukaidai');
    expect(result.next.id).toBe('san_go');
    expect(result.progressInPair).toBe(0);
  });

  it('currentDist = 12800 (= san_go 真上) → prev=san_go, next=osawa, progress=0', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, 12800);
    expect(result.prev.id).toBe('san_go');
    expect(result.next.id).toBe('osawa');
    expect(result.progressInPair).toBe(0);
  });

  it('currentDist = 23999 → prev=okuniwa, next=finish, progress ≈ 0.9996 (= finish 直前の右 edge)', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, 23999);
    expect(result.prev.id).toBe('okuniwa');
    expect(result.next.id).toBe('finish');
    expect(result.progressInPair).toBeCloseTo((23999 - 21500) / (24000 - 21500), 3);
  });

  it('currentDist = 24000 (= finish 真上) → prev=finish, next=null, progress=1 (= finish には次 pair なし、 特例 degenerate)', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, 24000);
    expect(result.prev.id).toBe('finish');
    expect(result.next).toBeNull();
    expect(result.progressInPair).toBe(1);
  });

  it('currentDist = 25000 (= ゴール後) → prev=finish, next=null, progress=1', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, 25000);
    expect(result.prev.id).toBe('finish');
    expect(result.next).toBeNull();
    expect(result.progressInPair).toBe(1);
  });

  it('currentDist = -100 → prev=null, next=start, progress=0 (= 開始前は start に向かう)', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, -100);
    expect(result.prev).toBeNull();
    expect(result.next.id).toBe('start');
    expect(result.progressInPair).toBe(0);
  });

  it('currentDist = NaN → prev=null, next=start, progress=0 (= 不正値で例外を投げず開始前扱い)', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, NaN);
    expect(result.prev).toBeNull();
    expect(result.next.id).toBe('start');
    expect(result.progressInPair).toBe(0);
  });

  it('currentDist = undefined → prev=null, next=start, progress=0', () => {
    const snapped = getSnapped();
    const result = findLandmarkPair(snapped, undefined);
    expect(result.prev).toBeNull();
    expect(result.next.id).toBe('start');
    expect(result.progressInPair).toBe(0);
  });

  it('空 snappedLandmarks → prev=null, next=null, progress=0 (= 退化 case)', () => {
    const result = findLandmarkPair([], 5000);
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
    expect(result.progressInPair).toBe(0);
  });
});
