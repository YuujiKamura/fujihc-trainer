// b39 区間名標識 ── 富士ヒル公式コース (= 富士スバルライン、 ridewithgps 45204897 GPX)
// の主要 checkpoint 7 件と、 course.json への snap + 現在 pair 判定の純関数。
//
// distance / elevation は富士ヒルクライム公式 + 山梨県道路公社 + 山梨観光公式の
// 交差確認で確定 (= brief b39 § 参照)。 ride 中の "ground truth" は course.json snap
// 後の実距離・実標高、 本 module 内の `distance_m_official` は brief 内 hardcode の
// estimate、 実装時 snapLandmarksToCourse() で course.json の最も近い idx に snap
// して正値化する。
//
// 本 module は network / fetch / DOM 一切呼ばない、 brief 内 hardcode data のみ。
// 第三者 ToS / PII: 富士ヒルクライム公式 checkpoint 名は公共情報、 PII risk なし。
//
// 詳細: ~/.agents/scratch/fujihc-trainer-project/b39-section-markers-and-finish-eta.md

/**
 * 富士ヒル公式コースの主要 checkpoint 7 件。
 *
 * 配列は distance 昇順、 `id='start'` (= 料金所) と `id='finish'` (= 五合目) は
 * 両端固定 (= snap で course の両端 idx に必ず張り付く)。
 *
 * `ele_m_official: null` は「公式 reference に標高記載なし」、 実装時 course.json
 * snap 後の elevation で確定する。
 */
export const FUJIHC_LANDMARKS = [
  { id: 'start',    name: '料金所',         distance_m_official: 0,     ele_m_official: 1088 },
  { id: 'jukaidai', name: '樹海台駐車場',    distance_m_official: 10500, ele_m_official: null },
  { id: 'san_go',   name: '三合目',         distance_m_official: 12800, ele_m_official: null },
  { id: 'osawa',    name: '大沢駐車場',      distance_m_official: 17200, ele_m_official: 2020 },
  { id: 'yon_go',   name: '四合目',         distance_m_official: 17800, ele_m_official: null },
  { id: 'okuniwa',  name: '奥庭駐車場',      distance_m_official: 21500, ele_m_official: 2227 },
  { id: 'finish',   name: '五合目',         distance_m_official: 24000, ele_m_official: 2305 },
];

/**
 * 各 landmark の `distance_m_official` を course.json の最も近い idx に snap し、
 * そこの実 lat/lon/elevation を返す。 補間しない (= ground-truth 規律、 docs/reviews/
 * 07-ground-truth.md 踏襲)。
 *
 * `id='start'` は必ず idx=0、 `id='finish'` は必ず idx=course.length-1 に固定
 * (= 公式 distance に依らず両端を course の両端に張り付ける)。
 *
 * @param {Array<{id:string,name:string,distance_m_official:number}>} landmarks
 * @param {Array<{distance_m:number,elevation_m:number,lat:number,lon:number}>} course
 * @returns {Array<{id:string,name:string,idx:number,distance_m:number,lat:number,lon:number,elevation_m:number}>}
 */
export function snapLandmarksToCourse(landmarks, course) {
  if (!Array.isArray(landmarks) || !Array.isArray(course)) return [];
  if (course.length < 2) return [];

  const result = [];
  for (const lm of landmarks) {
    let idx;
    if (lm.id === 'start') {
      idx = 0;
    } else if (lm.id === 'finish') {
      idx = course.length - 1;
    } else {
      // 中間 landmark: distance_m_official に最も近い course point を線形 scan で 1 つ選ぶ。
      let bestIdx = 0;
      let bestDiff = Math.abs(course[0].distance_m - lm.distance_m_official);
      for (let i = 1; i < course.length; i++) {
        const diff = Math.abs(course[i].distance_m - lm.distance_m_official);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      idx = bestIdx;
    }
    const pt = course[idx];
    result.push({
      id: lm.id,
      name: lm.name,
      idx,
      distance_m: pt.distance_m,
      lat: pt.lat,
      lon: pt.lon,
      elevation_m: pt.elevation_m,
    });
  }
  return result;
}

/**
 * 現在距離が landmarks のどの「pair」 (= 隣接 landmark 対) にいるかを判定する純関数。
 *
 * progressInPair: 現在距離が prev から next に向けてどこまで進んだか (= 0-1 にクランプ)。
 *
 * 境界規則:
 *  - currentDist が landmark の真上にちょうど一致した時は「**次の pair の左 edge**」 とする
 *    (= 「過ぎた」 を即時反映、 prev = その landmark、 next = その landmark の次)
 *  - currentDist < 0 / NaN / undefined → prev=null, next=landmarks[0], progress=0
 *  - currentDist > finish.distance_m → prev=landmarks[last], next=null, progress=1
 *  - currentDist === finish.distance_m (= finish 真上) → prev=finish, next=null, progress=1
 *    (= finish には next pair が存在しないので「次の pair の左 edge」 規則は degenerate して特例)
 *
 * @param {Array<{id:string,distance_m:number}>} snappedLandmarks - snap 済 7 件
 * @param {number} currentDist_m - 現在距離 (m)
 * @returns {{prev:object|null, next:object|null, progressInPair:number}}
 */
export function findLandmarkPair(snappedLandmarks, currentDist_m) {
  if (!Array.isArray(snappedLandmarks) || snappedLandmarks.length === 0) {
    return { prev: null, next: null, progressInPair: 0 };
  }
  // NaN / undefined / null は「開始前」 扱い
  if (!Number.isFinite(currentDist_m)) {
    return { prev: null, next: snappedLandmarks[0], progressInPair: 0 };
  }
  const first = snappedLandmarks[0];
  const last = snappedLandmarks[snappedLandmarks.length - 1];

  // 開始前
  if (currentDist_m < first.distance_m) {
    return { prev: null, next: first, progressInPair: 0 };
  }
  // finish 真上 / ゴール後
  if (currentDist_m >= last.distance_m) {
    return { prev: last, next: null, progressInPair: 1 };
  }
  // 中間: 「次の pair の左 edge」 規則 = currentDist >= landmark[i].distance_m を満たす最大の i を探す
  let prevIdx = 0;
  for (let i = 0; i < snappedLandmarks.length - 1; i++) {
    if (currentDist_m >= snappedLandmarks[i].distance_m) {
      prevIdx = i;
    } else {
      break;
    }
  }
  const prev = snappedLandmarks[prevIdx];
  const next = snappedLandmarks[prevIdx + 1];
  const span = next.distance_m - prev.distance_m;
  const progressInPair = span > 0 ? Math.max(0, Math.min(1, (currentDist_m - prev.distance_m) / span)) : 0;
  return { prev, next, progressInPair };
}
