// b50: course_loader.js (loadCourse から切り出した純粋ローダ) のユニットテスト。
//
// loadCourseData は fetchImpl 注入口を持つので node 上で実 fetch せず検証できる。
import { describe, it, expect } from 'vitest';
import { loadCourseData } from '../lib/course_loader.js';
import { withCumulativeDistance } from './_helpers/course_fixture.js';

// 11 点・5% 一定勾配の単純 course (= integration_view_mode と同型の fixture)。
function buildCourse() {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    pts.push({
      elevation_m: 100 + i * 50,
      slope_pct: 5,
      lat: 35.0 + i * 0.001,
      lon: 138.7 + i * 0.001,
    });
  }
  return withCumulativeDistance(pts);
}

// fetch レスポンスの最小スタブ。
function fakeResp(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe('b50 course_loader: loadCourseData', () => {
  it('fetchImpl 注入で course を読み terrain と totalDist を返す', async () => {
    const course = buildCourse();
    const result = await loadCourseData('course.json', {
      fetchImpl: async () => fakeResp(course),
    });
    expect(result.course.length).toBe(course.length);
    expect(result.terrain).toBeTruthy();
    // totalDist は terrain.totalDistance と同値、かつ正の haversine 累積長。
    expect(result.totalDist).toBe(result.terrain.totalDistance);
    expect(result.totalDist).toBeGreaterThan(0);
  });

  it('course は smoothCourse を通った後の配列 (= 平滑化済)', async () => {
    const course = buildCourse();
    const result = await loadCourseData('course.json', {
      fetchImpl: async () => fakeResp(course),
    });
    // smoothCourse は破壊しないので別 instance、点数は不変。
    expect(result.course).not.toBe(course);
    expect(result.course.length).toBe(course.length);
  });

  it('HTTP エラー (ok:false) は `HTTP <status>` 例外', async () => {
    await expect(
      loadCourseData('course.json', { fetchImpl: async () => fakeResp(null, { ok: false, status: 404 }) }),
    ).rejects.toThrow('HTTP 404');
  });

  it('空 course は `course.json empty` 例外 (= 呼び出し側で status 表示する契約)', async () => {
    await expect(
      loadCourseData('course.json', { fetchImpl: async () => fakeResp([]) }),
    ).rejects.toThrow('course.json empty');
  });

  it('fetch 自体が reject (= network エラー) は素通しで例外', async () => {
    await expect(
      loadCourseData('course.json', { fetchImpl: async () => { throw new Error('network down'); } }),
    ).rejects.toThrow('network down');
  });
});
