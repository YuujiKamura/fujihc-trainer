// b127: viewer-maplibre.js が ride_resume.js を import + showHistoryOverlay で bind する pin.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-maplibre.js'), 'utf8');

describe('b127: viewer (= Controller) が ride_resume (= Model) を import + bind', () => {
  it('ride_resume.js から resumeFromRecord を import', () => {
    expect(src).toMatch(
      /import\s+\{[^}]*resumeFromRecord[^}]*\}\s+from\s+['"]\.\/lib\/ride_resume\.js['"]/
    );
  });

  it('appendHistoryRow 呼出に onResume callback が渡されている', () => {
    expect(src).toMatch(/onResume\s*:/);
  });

  it('resumeFromRecord が rider / physicsState / rideClock / nowMs を deps として渡される', () => {
    expect(src).toMatch(/resumeFromRecord\s*\(/);
    const idx = src.indexOf('resumeFromRecord(');
    expect(idx).toBeGreaterThan(0);
    const slice = src.slice(idx, idx + 500);
    expect(slice).toMatch(/\brider\b/);
    expect(slice).toMatch(/\bphysicsState\b/);
    expect(slice).toMatch(/rideClock\s*:\s*clock/);
    expect(slice).toMatch(/nowMs/);
  });

  it('buildRideSummary に schemaVersion=2 / physicsSnap / riderDistance が入っている', () => {
    expect(src).toMatch(/schemaVersion:\s*2/);
    expect(src).toMatch(/physicsSnap:\s*physicsState\.snapshot\s*\(\s*\)/);
    expect(src).toMatch(/riderDistance/);
  });
});
