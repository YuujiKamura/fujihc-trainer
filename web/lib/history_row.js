// brief 33+: history-overlay の 1 行 (= 1 ride) を組み立てる pure helper.
// `viewer-maplibre.js` の showHistoryOverlay() から呼ばれる (= postride_buttons.js と同じ
// 「inline DOM → testable helper」 extraction 構造).
//
// 過去 ride の .gpx 出力は Strava 連携 / consent と完全独立 (= ローカル Blob のみ).
// → consent flag を読まない、 単純に ride.trkpts → buildGpxXml() → Blob download。
// history overlay 自体への到達経路 (= history consent ON かつ IndexedDB に保存実績あり) は
// caller (= viewer-maplibre.js) が gate 済みなので、 ここでは guard 不要。
//
// 設計:
// - DOM 生成は document.createElement のみ、 globalThis 直叩きは無し
// - storage / IDB / URL / Blob は cfg.* で inject 可能 (= node test で stub)
// - delete / gpx の 2 callback を li 内 button に bind、 row 単位の close-over でリーク防止
// - URL.createObjectURL / revokeObjectURL は globalThis.URL を default 参照、 inject で差替可
//
// brief 11 ガイドライン (= NG-R1-7「inline DOM 直書きで test 不能」予防) を継承.
import { buildGpxXml } from './gpx_builder.js';

/** trkpt 数 / 距離 / 時間 を短く整形 (= 「12.3 km / 1820s / 9100pt」). */
function formatSummary(ride) {
  const s = ride.summary || {};
  const km = Math.round((s.distance_m || 0) / 100) / 10;
  const sec = Math.round(s.duration_s || 0);
  const pts = (ride.trkpts || []).length;
  return `${km} km / ${sec}s / ${pts}pt`;
}

/** ride.date / id から download filename safe 文字列を作る (= ':' は windows 不可 → '-'). */
export function rideFilename(ride) {
  const raw = String(ride.date || ride.id || 'ride').replace(/[:.]/g, '-');
  return `ride-${raw}.gpx`;
}

/**
 * 1 ride の `<li>` を作って `<ul>` に append する.
 *
 * @param {{
 *   document: Document,
 *   listEl: Element,
 *   ride: {id: string, date?: string, summary?: object, trkpts?: Array},
 *   courseName?: string,
 *   onDelete: () => void|Promise<void>,
 *   onGpxDownloaded?: (info: {filename: string, points: number}) => void,
 *   URL?: { createObjectURL: (b: Blob) => string, revokeObjectURL: (u: string) => void },
 *   Blob?: typeof Blob,
 *   setTimeout?: typeof setTimeout,
 * }} cfg
 * @returns {Element} 作成した `<li>`
 */
export function appendHistoryRow(cfg) {
  const doc = cfg.document;
  const list = cfg.listEl;
  const ride = cfg.ride || {};
  const URL_ = cfg.URL || (typeof globalThis !== 'undefined' ? globalThis.URL : null);
  const Blob_ = cfg.Blob || (typeof globalThis !== 'undefined' ? globalThis.Blob : null);
  const setT = cfg.setTimeout || ((fn, ms) => setTimeout(fn, ms));

  const li = doc.createElement('li');

  const meta = doc.createElement('div');
  meta.className = 'ride-meta';
  const dateEl = doc.createElement('div');
  dateEl.className = 'ride-date';
  dateEl.textContent = ride.date || ride.id || '(no date)';
  const sumEl = doc.createElement('div');
  sumEl.className = 'ride-summary';
  sumEl.textContent = formatSummary(ride);
  meta.appendChild(dateEl);
  meta.appendChild(sumEl);

  const actions = doc.createElement('div');
  actions.className = 'ride-actions';

  // GPX download button: Strava 非依存、 trkpts → buildGpxXml → Blob → a.click.
  // history-overlay 自体が history consent 満足下でのみ到達するため、
  // ここで追加の consent check は不要 (= twice-gate 回避).
  const bGpx = doc.createElement('button');
  bGpx.textContent = 'GPX';
  bGpx.setAttribute('data-action', 'gpx-download');
  bGpx.setAttribute('aria-label', 'この ride を GPX としてダウンロード');
  bGpx.addEventListener('click', (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    try {
      const trkpts = ride.trkpts || [];
      const name = (ride.summary && ride.summary.course_name) || cfg.courseName || 'fujihc ride';
      const xml = buildGpxXml(trkpts, { name, activity_type: 'Virtual Ride' });
      if (!Blob_ || !URL_) return;  // 環境上不可、 silent skip (= node test 等)
      const blob = new Blob_([xml], { type: 'application/gpx+xml' });
      const url = URL_.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = rideFilename(ride);
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      setT(() => URL_.revokeObjectURL(url), 1000);
      if (cfg.onGpxDownloaded) {
        cfg.onGpxDownloaded({ filename: a.download, points: trkpts.length });
      }
    } catch {
      /* download 失敗時 silent (= status は caller 側で別経路、 ここは pure 寄り) */
    }
  });
  actions.appendChild(bGpx);

  const bDel = doc.createElement('button');
  bDel.textContent = '削除';
  bDel.setAttribute('data-action', 'delete');
  bDel.addEventListener('click', (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    Promise.resolve(cfg.onDelete && cfg.onDelete()).catch(() => {});
  });
  actions.appendChild(bDel);

  li.appendChild(meta);
  li.appendChild(actions);
  list.appendChild(li);
  return li;
}
