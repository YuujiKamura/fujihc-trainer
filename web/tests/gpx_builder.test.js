// brief 33 atom A: gpx_builder.js の unit test (= Python 版 byte-level 一致).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildGpxXml, escXml } from '../lib/gpx_builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('escXml', () => {
  it('escapes & < > " (5 chars per gpx_export.py L17-22)', () => {
    expect(escXml('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e');
  });
  it('passes through plain ASCII', () => {
    expect(escXml('plain text 123')).toBe('plain text 123');
  });
  it('does not escape single quote (Python版同様)', () => {
    expect(escXml("a'b")).toBe("a'b");
  });
});

describe('buildGpxXml', () => {
  it('empty trkpts → 有効 GPX with empty <trkseg>', () => {
    const xml = buildGpxXml([], { name: 'fujihc ride' });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<trkseg>');
    expect(xml).toContain('</trkseg>');
    expect(xml).not.toContain('<trkpt');
  });

  it('1 trkpt 全フィールドあり: lat/lon/ele/time/power/cad/hr 全出力', () => {
    const xml = buildGpxXml([
      { t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000.0, power: 210, cad: 85, hr: 142 },
    ]);
    expect(xml).toContain('<trkpt lat="35.4000000" lon="138.7000000">');
    expect(xml).toContain('<ele>1000.00</ele>');
    expect(xml).toContain('<time>2026-05-15T07:30:00Z</time>');
    expect(xml).toContain('<gpxtpx:cad>85</gpxtpx:cad>');
    expect(xml).toContain('<gpxtpx:hr>142</gpxtpx:hr>');
    expect(xml).toContain('<gpxpx:PowerInWatts>210</gpxpx:PowerInWatts>');
    expect(xml).toContain('<power>210</power>');  // Strava 独自
  });

  it('power のみ: gpxpx + 独自 power のみ並ぶ', () => {
    const xml = buildGpxXml([
      { t: '2026-05-15T07:30:01Z', lat: 35.4, lon: 138.7, ele: 1010.5, power: 215, cad: null, hr: null },
    ]);
    expect(xml).toContain('<gpxpx:PowerInWatts>215</gpxpx:PowerInWatts>');
    expect(xml).toContain('<power>215</power>');
    expect(xml).not.toContain('gpxtpx:TrackPointExtension');
  });

  it('cad のみ: gpxtpx:TrackPointExtension に cad だけ載る、 power タグなし', () => {
    const xml = buildGpxXml([
      { t: '2026-05-15T07:30:02Z', lat: 35.4, lon: 138.7, ele: 1021.0, power: null, cad: 88, hr: null },
    ]);
    expect(xml).toContain('<gpxtpx:TrackPointExtension><gpxtpx:cad>88</gpxtpx:cad></gpxtpx:TrackPointExtension>');
    expect(xml).not.toContain('PowerInWatts');
    expect(xml).not.toContain('<power>');
  });

  it('全 null: <extensions> ブロック自体なし', () => {
    const xml = buildGpxXml([
      { t: '2026-05-15T07:30:03Z', lat: 35.4, lon: 138.7, ele: 1031.5, power: null, cad: null, hr: null },
    ]);
    expect(xml).not.toContain('<extensions>');
  });

  it('lat 欠落 (null) は skip (= gpx_export.py L55-56 と同挙動)', () => {
    const xml = buildGpxXml([
      { t: '2026-05-15T07:30:04Z', lat: null, lon: 138.7, ele: 1040.0 },
      { t: '2026-05-15T07:30:05Z', lat: 35.405, lon: 138.7, ele: 1052.0 },
    ]);
    // 出力 trkpt は 1 件のみ
    const m = xml.match(/<trkpt/g);
    expect(m.length).toBe(1);
    expect(xml).toContain('lat="35.4050000"');
  });

  it('activity_type default = "Virtual Ride" (= gpx_export.py L28 と同値)', () => {
    const xml = buildGpxXml([], {});
    expect(xml).toContain('<type>Virtual Ride</type>');
  });

  it('activity_type override 反映 + XML escape 効く', () => {
    const xml = buildGpxXml([], { activity_type: 'Run & Walk' });
    expect(xml).toContain('<type>Run &amp; Walk</type>');
  });

  it('Python 版 (gpx_export.py) と byte-level 一致 (= 完了条件 §11)', () => {
    const fixtureRaw = readFileSync(
      join(__dirname, 'fixtures', 'py_gpx_builder_basic.json'),
      'utf-8',
    );
    const fixture = JSON.parse(fixtureRaw);
    const xml = buildGpxXml(fixture.input_trkpts, fixture.opts);
    expect(xml).toBe(fixture.expected_gpx);
  });
});
