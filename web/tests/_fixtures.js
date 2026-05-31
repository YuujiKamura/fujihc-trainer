// vitest 共通 Arrange: course.json の path / loader を 1 箇所に集約する helper。
// SoT (= web/static/course.json) の path 文字列を各 test に散らさないための単独定義点。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const COURSE_PATH = resolve(__dirname, '..', 'static', 'course.json');

/** course.json を読んで配列で返す (= 各 test の readFileSync + JSON.parse 重複撤去用)。 */
export function loadCourse() {
  return JSON.parse(readFileSync(COURSE_PATH, 'utf8'));
}
