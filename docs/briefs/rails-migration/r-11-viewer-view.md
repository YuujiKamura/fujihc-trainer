# r-11 Rails viewer view (= GLB + rider_marker の最小、 `/v2` 並走)

depends-on: r-00, r-02, r-04, r-05, r-10

## はじめに

r-10 で焼いた `public/models/fuji_course.glb` を Rails view で load し、 Three.js scene に add、 `rider_marker` mesh を course 起点に置いて表示する最小 viewer。 「動く 3D 画面」 のゴールを最短で達成する slice。

ただし NG-R5-4 / NG-R5-8 / NG-R5-10 / NG-R5-11 / NG-R5-14 を本 brief で物理化:

1. **`/v2` 並走起動**: `root "viewer#show"` の Tier 1 切替はせず、 `/v2` に mount。 `/` は welcome page 残置、 旧 viewer は `web/index.html` を `file:///` で開ける形で並走。 root 切替は Tier 7 の r-80-root-cutover で行う
2. **importmap CDN 物理 gate**: `bin/importmap pin three --download` で vendor 取得、 `config/importmap.rb` に CDN URL ゼロを grep で物理確認
3. **Stimulus controller の 11 責務を pure module 分解**: `viewer_3d_controller.js` は connect/disconnect のみ、 scene_setup / lighting / rider_placement / camera_positioner / glb_loader を pure module 化、 unit test 可能
4. **system test 強化**: canvas 存在 1 件 assert (= NG-R5-14 misleading) から、 GLB load 成否を `data-state="loaded" / "error"` で expose し 3 件 assert
5. **語彙整理**: 旧 `Rider cube` は `rider_marker` に rename、 Rider PORO (= r-20) と viewer 上の placeholder mesh の概念混線を阻止
6. **CSP baseline 明示**: `default-src 'none'; script-src 'self'; img-src 'self' data:; connect-src 'self' ws://localhost:* wss://localhost:*; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'`

## 何

- `ViewerController#show` を新規追加
- `app/views/viewer/show.html.erb` で canvas を 1 個出す
- `app/javascript/controllers/viewer_3d_controller.js` (Stimulus) で Three.js mount
- `app/javascript/lib/{scene_setup, lighting, glb_loader, rider_placement, camera_positioner}.js` の 5 pure module
- importmap-rails で `three` / `three/addons/loaders/GLTFLoader` / `three/addons/controls/OrbitControls` を vendor 取得 pin
- `routes.rb` で `get "/v2", to: "viewer#show"` (= `/` は変更しない)
- `config/initializers/content_security_policy.rb` で CSP baseline 明示
- system test 3 件 (= happy / error / mount only)

## なぜ

- 「動く 3D 画面」 を最短で見せて、 後続 brief の土台 (= HUD / minimap / 区間 panel) を載せる host を確保
- importmap + Stimulus の正しい使い方の見本を 1 個確立、 後続 brief で reuse
- vendor 取得で外部 CDN 依存なし (= 2026-05-14 訂正「ローカル DB に整備」 と整合、 OSM 公式直叩き fallback 撤去と同じ原則)
- `/v2` 並走で旧 viewer を retire せず、 段階移行の戻し方を確保 (= r-00 § 並走 URL 戦略 / revert 容易 と整合)
- Stimulus `connect()` の責務肥大は viewer-maplibre.js (= 2200 行) の失敗 vector を brief 段階で再演しないため

## 仕様

### controller / view

```ruby
# app/controllers/viewer_controller.rb
class ViewerController < ApplicationController
  def show
  end
end
```

```erb
<%# app/views/viewer/show.html.erb %>
<div data-controller="viewer-3d"
     data-viewer-3d-glb-url-value="<%= asset_path('models/fuji_course.glb') %>"
     class="w-screen h-screen relative bg-black">
  <canvas data-viewer-3d-target="canvas"
          data-state="initial"
          class="absolute inset-0 w-full h-full"></canvas>
  <div class="absolute top-4 left-4 text-yellow-400 font-mono text-sm">
    fujihill viewer (Rails 版 / v2)
  </div>
</div>
```

(= `data-state` 属性で controller が state を expose、 system test が verify)

### routes (= NG-R5-4 fix)

```ruby
# config/routes.rb
Rails.application.routes.draw do
  get "/v2", to: "viewer#show", as: :viewer
  # root path は welcome page のまま、 Tier 7 の r-80 で切替
end
```

### Stimulus controller (= 責務最小、 pure module に投げる)

```js
// app/javascript/controllers/viewer_3d_controller.js
import { Controller } from "@hotwired/stimulus"
import { setupScene } from "lib/scene_setup"
import { setupLighting } from "lib/lighting"
import { loadGlb } from "lib/glb_loader"
import { placeRiderMarker } from "lib/rider_placement"
import { positionCamera } from "lib/camera_positioner"

export default class extends Controller {
  static targets = ["canvas"]
  static values = { glbUrl: String }

  async connect() {
    this.ctx = setupScene(this.canvasTarget)
    setupLighting(this.ctx.scene)
    try {
      const gltf = await loadGlb(this.glbUrlValue)
      this.ctx.scene.add(gltf.scene)
      const start = gltf.scene.getObjectByName("start")
      placeRiderMarker(this.ctx.scene, start)
      positionCamera(this.ctx.camera, start)
      this.canvasTarget.setAttribute("data-state", "loaded")
    } catch (e) {
      console.error("[viewer-3d] GLB load failed", e)
      this.canvasTarget.setAttribute("data-state", "error")
      return
    }
    this._tick = () => {
      this.ctx.renderer.render(this.ctx.scene, this.ctx.camera)
      this._raf = requestAnimationFrame(this._tick)
    }
    this._tick()
    window.addEventListener("resize", this._resize = () => {
      const { renderer, camera } = this.ctx
      const w = window.innerWidth, h = window.innerHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
  }

  disconnect() {
    if (this._raf) cancelAnimationFrame(this._raf)
    if (this._resize) window.removeEventListener("resize", this._resize)
    this.ctx?.dispose?.()
  }
}
```

(= controller は orchestration のみ、 計算 / 構築は 5 module に閉じる)

### pure module の責務

| module | path | 引数 | 戻り値 | test 観点 |
|---|---|---|---|---|
| scene_setup | `app/javascript/lib/scene_setup.js` | canvas (= HTMLCanvasElement) | `{ renderer, scene, camera, controls, dispose() }` | renderer / camera が期待値、 dispose() で resource 解放 |
| lighting | `app/javascript/lib/lighting.js` | scene | (void) | HemisphereLight + DirectionalLight が scene に add される |
| glb_loader | `app/javascript/lib/glb_loader.js` | url (= string) | `Promise<gltf>` | 成功で gltf.scene 含む、 404 で reject |
| rider_placement | `app/javascript/lib/rider_placement.js` | scene, anchor (= Object3D) | `Mesh` (= rider_marker、 1m cube cyan) | mesh.name === "rider_marker"、 position が anchor.position |
| camera_positioner | `app/javascript/lib/camera_positioner.js` | camera, anchor | (void) | camera.position が anchor から少し後上方 |

(= 各 module は DOM / global 依存なし、 Three.js object と引数で完結、 unit test 可能)

### 語彙 (= NG-R5-2 fix)

- 旧 `Rider cube` (= BoxGeometry placeholder) は `rider_marker` に rename
- 「Rider PORO (= r-20 で実装) の現在位置を視覚化する mesh」 と定義
- viewer 上の `rider_marker` は Rider PORO の broadcast snapshot を transform で受ける mesh であり、 Rider そのものではない (= viewer は Rider を所有しない、 Flow A 準拠)

### importmap + vendor 取得 (= NG-R5-8 fix)

```ruby
# config/importmap.rb
pin "@hotwired/stimulus", to: "stimulus.min.js"
pin "@hotwired/turbo-rails", to: "turbo.min.js"
pin "three"
pin "three/addons/loaders/GLTFLoader", to: "three-addons-loaders-GLTFLoader.js"
pin "three/addons/controls/OrbitControls", to: "three-addons-controls-OrbitControls.js"

# lib/ pure module も pin
pin_all_from "app/javascript/lib", under: "lib"
```

物理 gate (= 完了条件で verify):

```sh
# CDN URL がゼロ
grep -E 'https?://' rails-app/config/importmap.rb && echo "FAIL: CDN URL exists" && exit 1
# vendor 配置済
test -f rails-app/vendor/javascript/three.js
test -f rails-app/vendor/javascript/three-addons-loaders-GLTFLoader.js
test -f rails-app/vendor/javascript/three-addons-controls-OrbitControls.js
```

`bin/importmap pin three --download` 等で `vendor/javascript/` に static 配置。 後段 r-72 で CSP baseline を全 view に拡張する時、 本 brief の物理 gate が前提。

### CSP baseline (= 本 brief + r-72 で拡張)

`config/initializers/content_security_policy.rb`:

```ruby
Rails.application.config.content_security_policy do |policy|
  policy.default_src :none
  policy.script_src  :self
  policy.style_src   :self, :unsafe_inline  # Tailwind / inline class 許可
  policy.img_src     :self, :data           # GLB 内 base64 texture / data URL
  policy.connect_src :self, "ws://127.0.0.1:3000", "wss://127.0.0.1:3000"  # ActionCable (= r-00 §認可境界 の 127.0.0.1 bind と整合、 文字列 drift 防止 / NG-R3-4 系再演阻止)
  policy.font_src    :self
  policy.worker_src  :self, :blob           # Three.js worker (= 必要時)
  policy.frame_ancestors :none
end
```

(= production では `ws://127.0.0.1` を server domain に置換、 r-72 で encode)

### test (= r-05 質的 gate 準拠、 NG-R5-14 fix)

```ruby
# test/system/viewer_test.rb
require "application_system_test_case"

class ViewerTest < ApplicationSystemTestCase
  test "/v2 mounts canvas with initial state" do
    visit "/v2"
    assert_selector "div[data-controller='viewer-3d']"
    assert_selector "canvas[data-viewer-3d-target='canvas']", visible: :all
    # data-state は最初 'initial'、 GLB load 完了で 'loaded' / 'error' に遷移
  end

  test "/v2 transitions to data-state=loaded when GLB is present" do
    # public/models/fuji_course.glb が r-10 で配置済の前提
    visit "/v2"
    assert_selector "canvas[data-state='loaded']", visible: :all, wait: 15
  end
end
```

(= 2 件 = mount + loaded。 misleading な canvas 単独 assert は不採用、 data-state='loaded' まで verify することで「3D pipeline 動作」 を assert。
error path = GLB 不在時の data-state='error' 遷移は **system test ではなく glb_loader.js の unit test** で担保
── 理由: Windows + Puma 環境では `File.rename(glb, bak)` が Puma の file 握りで ensure 復元できず flaky 化、
brief r-05 の「misleading test 禁止」 の延長で「環境差で flaky な system test を残すより、
同等機能を pure module unit test で deterministic に担保」 を採用。
unit test は `glb_loader.js` を「404 URL を渡したら reject される」 で 1 件、 controller 側は loaded path で十分覆われる)

pure module の node:test は **本 brief 内では postpone**、 後段で Three.js 依存 pure module が増える段階 (= r-50 HUD / r-90 観るモード等) で `rails-app/package.json` + `node_modules/three` の test setup を 1 個立て、 まとめて unit test を書く。 本 brief の検証は system test の loaded path (= 5 module 経由で GLB load + `data-state='loaded'` 立ち) で果たす ── module 経路が壊れていれば loaded path が落ちる、 つまり integration test が pure module の経路 contract をまとめて verify する。

(= 「使う前に検証するな」 / 「機械的にやれることを優先」 の合成解: rails-app に test 専用 node_modules を一つ作る投資は、 実 use case が増えてから回収率が上がる)

## 完了条件

- `bin/rails generate controller Viewer show` 実行済
- `config/routes.rb` に `get "/v2", to: "viewer#show"`
- `root` path は welcome page のまま (= 変更禁止)
- 5 pure module (= scene_setup / lighting / glb_loader / rider_placement / camera_positioner) 実装完了
- Stimulus controller `viewer_3d_controller.js` 実装完了、 行数 100 行以下を目標 (= 責務最小)
- importmap で three / GLTFLoader / OrbitControls の vendor 取得 pin
- 物理 gate (= 完了確認時):
  - `grep -E 'https?://' rails-app/config/importmap.rb` 出力ゼロ
  - `vendor/javascript/three*.js` 3 file 存在
- `config/initializers/content_security_policy.rb` で CSP baseline encode
- `bin/rails s -b 127.0.0.1` で `/v2` を開いて canvas 表示 + GLB load (= r-10 で配置済の前提)
- `bin/rails test test/system/viewer_test.rb` 全緑 (= 3 件 pass)
- `node --test app/javascript/test/*.test.mjs` 全緑
- `curl http://127.0.0.1:3000/v2` で 200 + canvas タグ含む HTML 返却
- `curl http://127.0.0.1:3000/` は welcome page (= 200 で Rails default 表示)
- 1-2 commit で landing、 push 禁止

## 参照

公式 doc (= NG-R5-11 fix):

- Three.js Docs (= 全体): https://threejs.org/docs/
- Three.js GLTFLoader: https://threejs.org/docs/#examples/en/loaders/GLTFLoader
- Three.js OrbitControls: https://threejs.org/docs/#examples/en/controls/OrbitControls
- Three.js WebGLRenderer: https://threejs.org/docs/#api/en/renderers/WebGLRenderer
- importmap-rails README: https://github.com/rails/importmap-rails
- Stimulus Reference: https://stimulus.hotwired.dev/reference/controllers
- Rails 8 Guides — Content Security Policy: https://guides.rubyonrails.org/security.html#content-security-policy-csp
- Rails 8 Guides — System Testing: https://guides.rubyonrails.org/testing.html#system-testing

ローカル:

- r-00 § 並走 URL 戦略 / 認可境界
- r-04 § channel の書き方 (= 後段 r-21 で BLE controller との分担)
- r-05 § system test の規律 (= NG-R5-14 misleading 阻止)
- r-10 (= GLB の mesh.name SoT)
- drift catalog NG-R5-4 / NG-R5-8 / NG-R5-10 / NG-R5-11 / NG-R5-14

## まとめ

GLB を load して画面に出すだけの薄い viewer を `/v2` に mount (= `/` は welcome 残置)。 Stimulus controller は 5 pure module に責務分散、 各 module unit test、 system test 3 件 (= mount / loaded / error)、 importmap 物理 gate で外部 CDN ゼロ、 CSP baseline 明示。 HUD / minimap / 区間 panel 等は後続 brief で順次 add、 `/` への昇格は r-80 で。 これが Rails 化の「最初の動く絵」、 後続全 brief の host になる。
