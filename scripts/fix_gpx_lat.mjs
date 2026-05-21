// 2026-05-15: GPX trkpt lat 固定 bug で吐かれた既存 GPX を救済。 元 file は touch せず別 file 出力。
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COURSE_PATH = resolve(__dirname, '..', 'web', 'static', 'course.json');

function parseTrkpts(gpx) {
  const blocks = [];
  const re = /<trkpt\s+[^>]*>[\s\S]*?<\/trkpt>/g;
  let m;
  while ((m = re.exec(gpx)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return blocks;
}

function interpolateAtDistance(course, targetDist) {
  if (targetDist <= course[0].distance_m) return { lat: course[0].lat, lon: course[0].lon, ele: course[0].elevation_m };
  const last = course[course.length - 1];
  if (targetDist >= last.distance_m) return { lat: last.lat, lon: last.lon, ele: last.elevation_m };
  let lo = 0, hi = course.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (course[mid].distance_m <= targetDist) lo = mid; else hi = mid;
  }
  const a = course[lo], b = course[hi];
  const segLen = b.distance_m - a.distance_m;
  const t = segLen > 0 ? (targetDist - a.distance_m) / segLen : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    ele: a.elevation_m + (b.elevation_m - a.elevation_m) * t,
  };
}

const fmt7 = (v) => Number(v).toFixed(7);
const fmt2 = (v) => Number(v).toFixed(2);

function rewriteTrkpt(text, lat, lon, ele) {
  return text
    .replace(/lat="[^"]*"/, `lat="${fmt7(lat)}"`)
    .replace(/lon="[^"]*"/, `lon="${fmt7(lon)}"`)
    .replace(/<ele>[^<]*<\/ele>/, `<ele>${fmt2(ele)}</ele>`);
}

const argv = process.argv.slice(2);
if (argv.length < 1) {
  console.error('Usage: node fix_gpx_lat.mjs <input.gpx> [output.gpx]');
  process.exit(2);
}
const inputPath = argv[0];
const outputPath = argv[1] || (() => {
  const dir = dirname(inputPath);
  const base = basename(inputPath, extname(inputPath));
  return join(dir, `${base}-fixed.gpx`);
})();

const gpx = readFileSync(inputPath, 'utf8');
const course = JSON.parse(readFileSync(COURSE_PATH, 'utf8'));
const totalDist = course[course.length - 1].distance_m;
const blocks = parseTrkpts(gpx);
if (blocks.length === 0) { console.error('No trkpt found'); process.exit(3); }

const N = blocks.length;
console.log(`input: ${inputPath}`);
console.log(`trkpt count: ${N}, course total: ${totalDist.toFixed(0)}m`);

let out = gpx;
for (let i = N - 1; i >= 0; i--) {
  const blk = blocks[i];
  const targetDist = (i / Math.max(1, N - 1)) * totalDist;
  const pos = interpolateAtDistance(course, targetDist);
  const newText = rewriteTrkpt(blk.text, pos.lat, pos.lon, pos.ele);
  out = out.slice(0, blk.start) + newText + out.slice(blk.end);
}

writeFileSync(outputPath, out, 'utf8');
console.log(`output: ${outputPath}`);
console.log(`size: ${out.length} bytes`);
