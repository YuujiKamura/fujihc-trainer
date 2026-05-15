// verify_glb.mjs
//
// rails-app/public/models/fuji_course.glb の最低限の validity を assert する。
//
// 検査項目:
//   1. ファイル存在 + サイズが 100KB - 50MB の合理的範囲
//   2. 先頭 12 bytes の binary glTF header:
//        magic   = 'glTF' (= 0x46546c67 little-endian)
//        version = 2
//        length  = ファイル全体サイズと一致
//   3. JSON chunk header (= chunk type = 0x4E4F534A = 'JSON' little-endian)、
//      JSON chunk body が parse 可能
//   4. JSON 内に必須 mesh node が含まれる:
//        "terrain" (= terrain mesh)
//        "course"  (= course polyline)
//        "start"   (= 緑 cone)
//        "goal"    (= 赤 cone)
//        "rider"   (= 空 anchor)
//      → node 数が 3 個以上 (terrain, course, rider anchor が最低限)
//
// 全 assert が pass したら exit 0、 1 件でも fail なら exit 1。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLB_PATH = path.resolve(__dirname, '..', 'public', 'models', 'fuji_course.glb');

const REQUIRED_MESH_NAMES = ['terrain', 'course', 'start', 'goal', 'rider'];

const errors = [];
const passes = [];

function assert(cond, label, detail) {
  if (cond) {
    passes.push(label + (detail ? ` (${detail})` : ''));
  } else {
    errors.push(label + (detail ? ` (${detail})` : ''));
  }
}

// 1. ファイル存在 + サイズ
if (!fs.existsSync(GLB_PATH)) {
  console.error(`[verify_glb] GLB not found: ${GLB_PATH}`);
  process.exit(1);
}
const buf = fs.readFileSync(GLB_PATH);
const sizeBytes = buf.length;
const sizeMB = sizeBytes / 1024 / 1024;
const MIN_BYTES = 100 * 1024; // 100KB
const MAX_BYTES = 50 * 1024 * 1024; // 50MB
assert(
  sizeBytes >= MIN_BYTES && sizeBytes <= MAX_BYTES,
  'file size in [100KB, 50MB]',
  `${sizeBytes} bytes = ${sizeMB.toFixed(2)} MB`,
);

// 2. binary glTF header
assert(sizeBytes >= 12, 'header length >= 12 bytes');
if (sizeBytes >= 12) {
  // magic (= 'glTF')
  const magic = buf.toString('ascii', 0, 4);
  assert(magic === 'glTF', 'magic = "glTF"', `got "${magic}"`);
  // version (= 2)
  const version = buf.readUInt32LE(4);
  assert(version === 2, 'version = 2', `got ${version}`);
  // length (= ファイル全体)
  const totalLength = buf.readUInt32LE(8);
  assert(
    totalLength === sizeBytes,
    'declared total length == file size',
    `declared=${totalLength}, file=${sizeBytes}`,
  );

  // 3. JSON chunk
  // GLB header (12) + chunk0 header (8) = 20 bytes minimum.
  if (sizeBytes >= 20) {
    const jsonChunkLength = buf.readUInt32LE(12);
    const jsonChunkType = buf.readUInt32LE(16);
    // 'JSON' = 0x4E4F534A (little-endian).
    assert(
      jsonChunkType === 0x4e4f534a,
      'first chunk is JSON type',
      `got 0x${jsonChunkType.toString(16)}`,
    );

    // chunk body offset: 20.
    if (20 + jsonChunkLength <= sizeBytes) {
      const jsonStr = buf.toString('utf-8', 20, 20 + jsonChunkLength);
      let json;
      try {
        json = JSON.parse(jsonStr);
        passes.push('JSON chunk parses');
      } catch (err) {
        errors.push(`JSON chunk parse failed: ${err.message}`);
        json = null;
      }

      if (json) {
        // 4. mesh / node 検証
        const nodes = Array.isArray(json.nodes) ? json.nodes : [];
        const meshes = Array.isArray(json.meshes) ? json.meshes : [];
        const namedNodes = nodes.filter((n) => n && typeof n.name === 'string');
        const namedMeshes = meshes.filter((m) => m && typeof m.name === 'string');
        const nodeNames = new Set(namedNodes.map((n) => n.name));
        const meshNames = new Set(namedMeshes.map((m) => m.name));

        assert(
          nodes.length >= 3,
          'node count >= 3',
          `got ${nodes.length}`,
        );
        // mesh は terrain / course / start / goal の 4 個前後想定 (rider は Group なので mesh ではない).
        assert(
          meshes.length >= 3,
          'mesh count >= 3 (terrain + course + start/goal markers)',
          `got ${meshes.length}`,
        );

        // 必須 node 名は node か mesh のいずれかに必ず居ることを確認.
        for (const required of REQUIRED_MESH_NAMES) {
          const found = nodeNames.has(required) || meshNames.has(required);
          assert(
            found,
            `required name "${required}" present`,
            found ? null : 'missing in nodes/meshes',
          );
        }

        // 補助情報: print summary.
        console.log(`[verify_glb] nodes: ${nodes.length}`);
        console.log(`  named nodes: ${[...nodeNames].join(', ')}`);
        console.log(`[verify_glb] meshes: ${meshes.length}`);
        console.log(`  named meshes: ${[...meshNames].join(', ')}`);
        if (Array.isArray(json.accessors)) {
          console.log(`[verify_glb] accessors: ${json.accessors.length}`);
        }
        if (Array.isArray(json.bufferViews)) {
          console.log(`[verify_glb] bufferViews: ${json.bufferViews.length}`);
        }
      }
    } else {
      errors.push(
        `JSON chunk body overruns file (chunkLen=${jsonChunkLength}, fileLen=${sizeBytes})`,
      );
    }
  }
}

// summary print
console.log('');
console.log(`[verify_glb] file: ${GLB_PATH}`);
console.log(`[verify_glb] size: ${sizeBytes} bytes (${sizeMB.toFixed(2)} MB)`);
console.log('');
console.log(`[verify_glb] PASSES (${passes.length}):`);
for (const p of passes) console.log(`  ok: ${p}`);
if (errors.length > 0) {
  console.log('');
  console.log(`[verify_glb] FAILURES (${errors.length}):`);
  for (const e of errors) console.log(`  FAIL: ${e}`);
  process.exit(1);
}
console.log('');
console.log(`[verify_glb] ALL ${passes.length} CHECKS PASSED`);
process.exit(0);
