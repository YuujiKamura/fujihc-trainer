# r-10 GLB build script (= 富士山 + course + 区間色を 1 GLB)

depends-on: r-00, r-03, r-04, r-05

## はじめに

旧 viewer は起動毎に DEM 16 タイル fetch + heightmap 構築 + course を 1968 segment の polygon に展開、 GPU 負荷と起動時間の両方を毎回支払っていた。 user 訂正「最初から完成したものを置いたほうが早い」 を反映し、 **build 時に 1 個の `.glb` に焼いて `public/models/` に配置**、 viewer は GLTFLoader で load するだけにする。

ただし NG-R5-9 (= GSI 大量アクセス再演リスク) と NG-R5-15 (= terrain ロジック Ruby/JS 重複実装) と NG-R5-5 (= build 入力 / 成果物 lifecycle 不明) を本 brief で物理化:

1. **GSI DEM 取得経路を本 build script から削除** ── 入力は「手元 cache に既にある GSI tile」 限定、 再取得が必要な時は別 brief (= 富士スバルライン以外の course 対応時) で rate-limit + UA + 利用規約 attribution と一緒に encode
2. **Terrain SoT は Ruby `app/domain/terrain.rb`** ── terrarium decode / lat/lon projection / classifyGrade / heightmap 構築は Ruby 側で計算、 JSON dump、 node script は読んで Three.js mesh に焼くだけ (= r-04 配置規範に整合)
3. **GLB に attribution metadata** ── `asset.copyright` で GSI / 富士スバルライン の出典明示
4. **pure function 単位の test** ── node:test で terrarium / projection / classify_grade / heightmap を unit (= r-05 質的 gate)

## 何

2 段階の build pipeline:

```
[Stage 1: Ruby SoT]
  app/domain/terrain.rb (= PORO)
    入力: web/static/tiles/gsi_dem/{z}/{x}/{y}.png (= 手元 cache、 fetch しない)
          web/static/course.json (= 1968 点)
    処理: terrarium decode → bbox 算出 → heightmap grid → projection
    出力: config/terrain.json (= heightmap + bbox + projection meta + course points)
    trigger: bin/rails terrain:dump

[Stage 2: node thin layer]
  rails-app/script/build_terrain_glb.mjs
    入力: config/terrain.json
    処理: Three.js PlaneGeometry に setZ、 BufferGeometry で course、 ConeGeometry で start/goal、 GLTFExporter
    出力: rails-app/public/models/fuji_course.glb (= 想定 1-10MB)
    trigger: bin/rails terrain:build (= 内部で terrain:dump → node script を sh)
```

### GLB の中身 (= mesh name 固定)

- `terrain` — 富士山周辺の DEM heightmap mesh (= PlaneGeometry + setZ)
- `course` — 富士スバルラインのコース polyline (= BufferGeometry、 区間色 vertex color)
- `start` — 起点 marker (= 緑 cone)
- `goal` — 終点 marker (= 赤 cone)

(= viewer 側 (r-11) は `gltf.scene.getObjectByName(...)` で各 mesh を引く)

### GLB attribution metadata (= NG-R5-9 fix)

`GLTFExporter` の `asset` extension に:

```js
exporter.parse(scene, (gltf) => { ... }, {
  // GLTFExporter は options.asset を上書きしないので、 dump 後に手動 patch
  trs: false,
  onlyVisible: true,
  binary: true,
});
// GLB は binary なので JSON chunk 取り出し → asset.copyright 追加 → 再 pack
```

または GLTFExporter の出力前に scene.userData に置き、 GLTF parser で参照可能形にする (= 実装は thin layer で):

```
asset.copyright = "Terrain: 国土地理院 DEM | Course: 富士スバルライン | License: 旧 fujihc-trainer 利用規約準拠"
asset.generator = "fujihc-trainer build_terrain_glb.mjs"
```

### Ruby SoT 側の責務 (= app/domain/terrain.rb、 詳細は r-20 で実装)

```ruby
# app/domain/terrain.rb (本 brief は scope 内、 ただし full impl は r-20)
class Terrain
  def self.build_from_cache(tile_dir:, course_path:)
    tiles = load_terrarium_tiles(tile_dir)  # png decode、 GSI 取得なし
    bbox = course_bbox(course_path)
    heightmap = compose_heightmap(tiles, bbox)
    course = load_course(course_path)
    new(heightmap:, bbox:, course:)
  end

  def dump_json(path:)
    File.write(path, JSON.dump({
      heightmap: @heightmap.to_a,
      bbox: @bbox,
      projection: { meter_per_lon_deg: 90730, meter_per_lat_deg: 111320 },
      course: @course,
    }))
  end

  def elevation_at(lat, lon)
    # bilinear sampling、 runtime に viewer / Rider が query
  end

  private

  def self.load_terrarium_tiles(dir)
    # terrarium decode: (R * 256 + G + B / 256) - 32768
    # dir は web/static/tiles/gsi_dem/{z}/{x}/{y}.png、 存在しない時は raise
    # fetch なし、 手元 cache 限定 (NG-R5-9 fix)
  end
end
```

### node thin layer 側の責務 (= script/build_terrain_glb.mjs)

```
config/terrain.json を読む
  ↓
script/lib/scene_builder.mjs
  - PlaneGeometry を heightmap.length x heightmap[0].length で作る
  - heightmap[i][j] を vertex.z に setZ
  - course points を BufferGeometry の Line に
  - start/goal を ConeGeometry に
  - mesh.name 固定
  ↓
GLTFExporter で binary 出力
  ↓
asset.copyright を patch
  ↓
public/models/fuji_course.glb に書く
```

(= terrarium / projection / classifyGrade の計算は **node 側に持ち込まない**、 Ruby 側で完結、 JS は mesh 化 only)

### rake task

```ruby
# rails-app/lib/tasks/terrain.rake
namespace :terrain do
  task dump: :environment do
    terrain = Terrain.build_from_cache(
      tile_dir: Rails.root.join("..", "web", "static", "tiles", "gsi_dem"),
      course_path: Rails.root.join("..", "web", "static", "course.json")
    )
    terrain.dump_json(path: Rails.root.join("config", "terrain.json"))
    puts "Wrote config/terrain.json"
  end

  task build: :dump do
    sh "node script/build_terrain_glb.mjs"
  end
end
```

`bin/rails terrain:build` で `dump` → `node script` の 2 段、 通常は手動。 課題: course.json or DEM が更新された時に rebuild が必要、 検出は別 brief で。

## なぜ

1. **起動時間短縮**: 16 タイル fetch + decode + polygon 構築 → 1 GLB load + GPU upload。 数秒 → 100ms オーダー
2. **再現性**: GLB は immutable bytes、 viewer 起動毎の結果ブレなし
3. **キャッシュ親和**: 1 ファイル / 1 ETag、 ブラウザキャッシュが効く
4. **配信容易**: GitHub Pages 等の静的配信でも viewer が動く
5. **build-time 計算**: course bbox / DEM 範囲 / 区間色 の決定はサーバ起動時より build 時の方が決定論的
6. **SoT 単一化**: Ruby 側に terrain 計算ロジックを集約することで、 runtime の Rider PORO (= r-20) も同じ `Terrain` を使い、 JS / Ruby で同じ計算を 2 回書く負債を未然回避
7. **GSI 規約遵守**: build 経路で GSI 直 fetch すると NG-R1-16 再演 (= 利用規約「大量アクセス自粛」 違反)、 build 入力を手元 cache 限定にすれば物理的に違反不能

## 仕様

### 入力 (= 既に手元にある cache 限定)

- `web/static/course.json` (= 1968 点、 `[{distance_m, elevation_m, slope_pct, lat, lon}, ...]`)
- `web/static/tiles/gsi_dem/{z}/{x}/{y}.png` (= GSI 標高タイル terrarium encoding、 z=10-14、 17MB、 **既に旧 fujihc-trainer 開発時に取得済**)
- 必要 tile が cache に欠ければ build 失敗、 「自動 fetch」 はしない (= 違反防止)

### 出力

- `rails-app/config/terrain.json` (= Stage 1 出力、 SoT、 git commit する)
- `rails-app/public/models/fuji_course.glb` (= Stage 2 出力、 想定サイズ 1-10MB、 git commit する)

### 出力の lifecycle (= NG-R5-5 fix)

- `config/terrain.json` と `public/models/fuji_course.glb` は git commit する (= viewer の動作前提、 fresh-clone でも動く)
- 再生成 trigger: course.json 更新時、 DEM tile 更新時、 計算ロジック (= terrain.rb / scene_builder.mjs) 更新時
- 再生成手順: `bin/rails terrain:build` 1 コマンド
- 配布: GitHub Pages / production deploy で `public/models/fuji_course.glb` を static asset として配信
- 再生成不能の場合: GSI cache 全消失時のみ、 旧 fujihc-trainer の cache (= `web/static/tiles/gsi_dem/`) を git 履歴から復元 (= 旧 git LFS or zip backup) する手順を r-23 backfill brief と並べて記載 (= 後で別 brief)

### terrain mesh の作り方 (= scene_builder.mjs)

- `config/terrain.json` から `heightmap` 2D 配列 + bbox + projection を読む
- Three.js PlaneGeometry (= 横幅 = bbox 経度差 × `projection.meter_per_lon_deg`、 縦幅 = bbox 緯度差 × `projection.meter_per_lat_deg`)
- 各 vertex に y 座標として heightmap 値を setZ
- material: MeshStandardMaterial、 vertex color で陰影 (= height で gradient、 計算は Ruby 側 `config/terrain.json` に色 hex 付きで dump 済)
- `mesh.name = "terrain"`

### course polyline の作り方

- `config/terrain.json` の `course` 列を読む (= Ruby 側で既に projection 済の `[{x, y, z, color_hex}, ...]`)
- BufferGeometry + LineSegments (= 区間色は vertex color)
- 区間色の semantics は **始点側** (= a.slope_pct、 2026-05-15 commit c969b1b と同じ)
- `mesh.name = "course"`

### start / goal marker

- ConeGeometry (= radius=10, height=20、 真値はテスト時に調整)
- 緑 (#7fff00) / 赤 (#ff3030)
- 位置は course[0] / course[-1]
- `mesh.name = "start"` / `"goal"`

### verify script (= script/verify_glb.mjs)

- 先頭 12 bytes が `glTF` magic + version 2
- JSON chunk の `asset.copyright` に "国土地理院 DEM" と "富士スバルライン" が含まれる
- JSON chunk の `meshes` 配列に `terrain` / `course` / `start` / `goal` の 4 name が含まれる
- ファイルサイズが 100KB-10MB の範囲

### test (= r-05 質的 gate 準拠)

Ruby (= Minitest):

- `test/domain/terrain_test.rb`:
  - happy: known tile + known course → known elevation_at 値 (= 1 件)
  - error: 存在しない tile_dir → raise
  - edge: bbox 境界 lat/lon の elevation_at (= bilinear 境界)

Node (= node:test):

- `script/test/scene_builder.test.mjs`:
  - happy: 小さい heightmap (= 3x3) + 2 点 course → 期待 mesh.name set
  - error: heightmap が空配列 → raise
  - edge: course 1 点だけ → line zero-length (= polyline 生成自体は成功)

(= 「触った関数全部 test」 ではなく、 misleading でない 3 種ずつ。 happy/error/edge を 1 module で 3 件 = `4 modules × 3 件 = 12 test` 程度の規模)

## 完了条件

- `app/domain/terrain.rb` (= 最小 impl、 詳細は r-20 で拡張) で `build_from_cache` + `dump_json` 実装完了
- `rails-app/script/build_terrain_glb.mjs` (= thin layer) 実装完了
- `rails-app/script/package.json` で `three` + `pngjs` (or `sharp`) の build-time deps、 ただし pngjs は Stage 1 移行後 Ruby 側に逃せる
- `rails-app/script/verify_glb.mjs` 実装完了
- `rails-app/lib/tasks/terrain.rake` 実装完了
- `bin/rails terrain:dump` 実走で `config/terrain.json` 生成成功
- `bin/rails terrain:build` 実走で `public/models/fuji_course.glb` 生成成功
- `node script/verify_glb.mjs` で magic + attribution + mesh name + サイズ全 pass
- `bin/rails test test/domain/terrain_test.rb` 全緑
- `node --test script/test/*.test.mjs` 全緑
- 1-2 commit で landing、 push 禁止

## 参照

公式 doc:

- Three.js GLTFExporter: https://threejs.org/docs/#examples/en/exporters/GLTFExporter
- Three.js PlaneGeometry: https://threejs.org/docs/#api/en/geometries/PlaneGeometry
- Three.js BufferGeometry: https://threejs.org/docs/#api/en/core/BufferGeometry
- glTF 2.0 spec — asset.copyright: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-asset
- 国土地理院タイル利用規約: https://maps.gsi.go.jp/development/ichiran.html
- Node.js Test Runner: https://nodejs.org/api/test.html

ローカル:

- 既存 `web/lib/route_styling.js` (= classifyGrade、 Ruby 側 `Terrain` に移植する semantics の source)
- 既存 `web/lib/road_polygon.js` (= segment color 始点側 semantics、 2026-05-15 commit c969b1b)
- 既存 `web/lib/heading.js` (= 進行方向計算)
- r-04 layered-architecture.md § Terrain SoT の置き場
- r-05 test-baseline.md § node 側 pure function test
- drift catalog NG-R1-15 / NG-R1-16 (= 第三者 tile 直叩き履歴)、 NG-R5-9 (= GSI build 内 fetch 再演リスク)

## まとめ

build 時 1 GLB 化により、 viewer 起動時間と GPU 負荷を桁で下げ、 再現性 / キャッシュ親和 / 静的配信を同時に満たす。 terrain 計算は Ruby SoT (= `app/domain/terrain.rb` → `config/terrain.json`)、 node script は Three.js mesh 化の thin layer。 GSI 取得経路は build から削除 (= 手元 cache 限定)、 GLB に attribution metadata、 4 pure module を node:test で unit。 viewer (r-11) は GLTFLoader で load するだけになる。
