import { Controller } from "@hotwired/stimulus"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

// 3D viewer: load `/models/fuji_course.glb` and place a Rider cube at mesh "start".
// GLB が無くても空 scene + Rider cube だけは出る fail-safe 設計。
export default class extends Controller {
  static targets = ["canvas"]

  connect() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb) // 空色 (sky blue) で「動いてる」を見える化

    const canvas = this.hasCanvasTarget ? this.canvasTarget : this.element.querySelector("canvas")
    this.canvas = canvas
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 50000)
    this.camera.position.set(0, 500, 1500)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(width, height, false)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true

    // 基本 light (= GLB に light が焼かれていない場合に course mesh が真っ黒にならない保険)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0)
    this.scene.add(hemi)
    this.hemi = hemi
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(1000, 2000, 1000)
    this.scene.add(dir)
    this.dir = dir

    // Rider cube (= 1m 角 cyan)、 GLB load 後に "start" mesh のワールド座標へ移動。
    // GLB load 失敗時もこの cube は出る (= 動作確認できる minimum signal)。
    const riderGeom = new THREE.BoxGeometry(1, 1, 1)
    const riderMat = new THREE.MeshStandardMaterial({ color: 0x00ffff })
    this.rider = new THREE.Mesh(riderGeom, riderMat)
    this.scene.add(this.rider)

    // GLB load。 失敗時は warn して空 scene + rider のまま継続。
    this.loader = new GLTFLoader()
    this.loader.load(
      "/models/fuji_course.glb",
      (gltf) => {
        this.courseScene = gltf.scene
        this.scene.add(this.courseScene)
        // start mesh の world position を取って Rider をそこへ。
        const startMesh = this.courseScene.getObjectByName("start")
        if (startMesh) {
          const worldPos = new THREE.Vector3()
          startMesh.getWorldPosition(worldPos)
          this.rider.position.copy(worldPos)
          // camera を course 起点付近へ寄せて見やすく
          this.camera.position.set(worldPos.x + 50, worldPos.y + 50, worldPos.z + 100)
          this.controls.target.copy(worldPos)
          this.controls.update()
        }
      },
      undefined,
      (err) => {
        // GLB 不在 / 壊れている場合は空 scene のまま (= viewer 自体は表示される)
        // eslint-disable-next-line no-console
        console.warn("[viewer-3d] GLB load failed, showing empty scene:", err && err.message)
      }
    )

    // resize handler
    this._onResize = () => {
      const w = canvas.clientWidth || window.innerWidth
      const h = canvas.clientHeight || window.innerHeight
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h, false)
    }
    window.addEventListener("resize", this._onResize)

    this._running = true
    this._tick = this._tick.bind(this)
    this._tick()
  }

  _tick() {
    if (!this._running) return
    this._raf = window.requestAnimationFrame(this._tick)
    if (this.controls) this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  disconnect() {
    this._running = false
    if (this._raf) window.cancelAnimationFrame(this._raf)
    if (this._onResize) window.removeEventListener("resize", this._onResize)
    if (this.controls) this.controls.dispose()
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
    }
    if (this.renderer) this.renderer.dispose()
  }
}
