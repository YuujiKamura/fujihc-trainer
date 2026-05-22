// b12 Phase 3 部品4: Three.js カメラ部品。
//
// terrain3d.html L602-679 のオービット / 追従カメラ操作と L759-765 の画面投影を、
// 受け身の描画 API として切り出したもの。 rAF ループは持たない ── viewer 本体の
// tick() が毎フレーム update() / projectToScreen() を呼ぶ。
//
// 座標系: 東=+X, 上=+Y(標高 m), 北=-Z (terrain3d.js / rider_placement.js と一致)。
//
// THREE は createCamera3d の引数で注入する。 こうすると (1) この file は 'three' を
// import しないので web/tests から node 上で直接読めて純関数を単体テストできる、
// (2) facade が単一の THREE instance を全部品に配れる。 純ロジック (orbit / follow /
// 投影の数式) は下記 export 関数、 THREE オブジェクト生成は createCamera3d に分けた。

import { adjustPitch } from '../camera_controller.js';

// === 純関数 (three 非依存、 単体テスト対象) ===

// 球面オービット: target を中心に bearing(度) / pitch(度) / radius(m) でカメラ位置を出す。
// pitch 0=真上, 85=ほぼ水平。 初期方位 θ=π (= 北 -Z 側からコースを見る) に bearing を積算。
// terrain3d.html applyCamera (L632-643) の非 top 経路と同じ式。
export function orbitPosition(target, bearingDeg, pitchDeg, radius) {
  const phi = Math.max(0.06, Math.min(Math.PI * 0.49, pitchDeg * Math.PI / 180));
  const theta = Math.PI + bearingDeg * Math.PI / 180;
  return {
    x: target.x + radius * Math.sin(phi) * Math.sin(theta),
    y: target.y + radius * Math.cos(phi),
    z: target.z + radius * Math.sin(phi) * Math.cos(theta),
  };
}

// 真上俯瞰 (= ?cam=top の検証ビュー): target の真上にカメラを置く。
export function topPosition(target, radius) {
  return { x: target.x, y: target.y + radius, z: target.z };
}

// 追従カメラ: forward の水平成分でカメラを後方 back / 上方 up に置き、 前方 ahead を注視する。
// 坂の上下振れを抑えるため forward の y 成分は使わず XZ だけで方向を取る (terrain3d.html L727-743)。
export function followPlacement(riderPos, forward, back, up, ahead) {
  const fwdLen = Math.sqrt(forward.x * forward.x + forward.z * forward.z) || 1;
  const nx = forward.x / fwdLen;
  const nz = forward.z / fwdLen;
  return {
    position: { x: riderPos.x - nx * back, y: riderPos.y + up, z: riderPos.z - nz * back },
    lookAt: { x: riderPos.x + nx * ahead, y: riderPos.y, z: riderPos.z + nz * ahead },
  };
}

// カメラ投影後の NDC (= 正規化デバイス座標、 各軸 -1..1) を画面 pixel に変換する。
// visible: ndc.z <= 1 ならカメラ前方にあり画面に映る (terrain3d.html L762-765 の behindCamera)。
export function ndcToScreen(ndc, width, height) {
  return {
    x: (ndc.x * 0.5 + 0.5) * width,
    y: (-ndc.y * 0.5 + 0.5) * height,
    visible: ndc.z <= 1,
  };
}

// 水平ドラッグ → bearing 回転 (= 0.5 度/px、 0..360 で正規化、 terrain3d.html L659)。
export function dragToBearing(bearingDeg, dxPx) {
  return ((bearingDeg + dxPx * 0.5) % 360 + 360) % 360;
}

// 垂直ドラッグ → pitch (= 上ドラッグで水平へ、 0.5 度/px、 terrain3d.html L661)。
// 範囲クランプは既存 lib の adjustPitch に委譲 (= MapLibre 経路と同じ pitch 範囲)。
export function dragToPitch(pitchDeg, dyPx) {
  return adjustPitch(pitchDeg, -dyPx * 0.5);
}

// ホイール → radius 倍率 (= 奥に回すと拡大 1.1 / 手前は縮小 0.9)、 [min,max] でクランプ。
export function wheelRadius(radius, deltaY, min, max) {
  const r = radius * (deltaY > 0 ? 1.1 : 0.9);
  return Math.min(max, Math.max(min, r));
}

// MapLibre の zoom 値を Three.js オービット半径 (m) に変換する。
// MapLibre zoom は +1 で地図縮尺が 2 倍になるので、 カメラ半径は zoom が 1 増えるごとに
// 半分にする。 基準点 = 走行視点の zoom 21 をオービット半径 40m に合わせた
// (= ライダー本体 + 前方の路面が画面に収まる距離)。 画面確認で寄り / 引きが
// 合わなければ ZOOM_RADIUS_REF_M を調整する (= 1 行で寄り具合を変えられる)。
export const ZOOM_RADIUS_REF_ZOOM = 21;
export const ZOOM_RADIUS_REF_M = 40;
export function zoomToRadius(zoom) {
  return ZOOM_RADIUS_REF_M * Math.pow(2, ZOOM_RADIUS_REF_ZOOM - zoom);
}

// === ファクトリ (THREE 注入、 描画グルー) ===

// camera3d を生成する。 opts:
//   span    コース外接サイズ (m) ── radius 初期値 / near-far / クランプ域の基準
//   aspect  初期アスペクト比 (= resize で更新)
//   targetY 初期注視点の高さ (m)
//   mode    'orbit' (既定) | 'top' | 'follow'
export function createCamera3d(THREE, opts = {}) {
  const span = opts.span || 1000;
  // far 面は RADIUS_MAX (12000m) を必ず上回らせる ── orbit 半径が far を超えると、
  // 最大ズームアウト時にシーン全体が far クリップ面の外へ出て画面が真っ暗になる
  // (2026-05-22、RADIUS_MAX を 3000→6000 にしたとき far=span*6 を超えて発覚)。
  // RADIUS_MAX を上げたら必ずこの下限もそれを超える値に上げること。
  const camera = new THREE.PerspectiveCamera(50, opts.aspect || 1, 1, Math.max(span * 6, 28000));
  const target = new THREE.Vector3(0, opts.targetY || 0, 0);
  const panOffset = new THREE.Vector3(0, 0, 0);
  // MapLibre 準拠のカメラ操作変数 (terrain3d.html L612-616)。
  let bearing = 0;
  let pitch = 61;             // 初期仰角 ≈ 61° (terrain3d.html の初期 phi と揃える)
  // 初期半径は走行視点寄りの 80m (= setCameraDefaults 未呼出でもライダーに寄った絵)。
  // viewer は loadCourse で setCameraDefaults({zoom,pitch}) を呼ぶのでそこで上書きされる。
  let radius = 80;
  // radius のクランプ域 (m)。 terrain3d.html は span 比例 (span*0.03〜span*3.5) だが、
  // 富士のように span が大きいと最小でも数百 m になり「ライダーに寄れない」。
  // 走行視点が要なので min は固定 5m (= ライダーに肉薄)、 max は 12000m
  // (= コース全体 + 広域の周辺地形まで引ける。 3000m→6000m→12000m と段階拡張、
  //  user 指示 2026-05-22「ズームアウトのキャップをあと 2 倍」を 2 回)。
  // RADIUS_MAX を上げたら上の camera far 面の下限も必ず追従させること。
  const RADIUS_MIN = 5;
  const RADIUS_MAX = 12000;
  // 追従カメラの距離定数 (m、 実スケール自転車に合わせた値、 terrain3d.html L622-624)。
  const FOLLOW_BACK = 8;
  const FOLLOW_UP = 1.8;
  const LOOK_AHEAD = 3;
  let mode = opts.mode || 'orbit';
  let viewW = 1;
  let viewH = 1;

  function applyOrbit() {
    if (mode === 'top') {
      camera.up.set(0, 0, -1);  // 北 (-Z) を画面上に
      const p = topPosition(target, radius);
      camera.position.set(p.x, p.y, p.z);
      camera.lookAt(target);
      return;
    }
    camera.up.set(0, 1, 0);
    const p = orbitPosition(target, bearing, pitch, radius);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(target);
  }

  return {
    // facade が scene に渡す素の THREE.Camera。
    camera,

    // 毎フレーム、 ライダー現在位置 (world {x,y,z}) と進行方向 forward {x,y,z} で
    // カメラを更新する。 orbit/top はライダーを注視点に、 follow は後方固定。
    update(riderPos, forward) {
      target.set(riderPos.x + panOffset.x, riderPos.y + panOffset.y, riderPos.z + panOffset.z);
      if (mode === 'follow') {
        const fp = followPlacement(riderPos, forward || { x: 0, y: 0, z: -1 },
          FOLLOW_BACK, FOLLOW_UP, LOOK_AHEAD);
        camera.up.set(0, 1, 0);
        camera.position.set(fp.position.x, fp.position.y, fp.position.z);
        camera.lookAt(fp.lookAt.x, fp.lookAt.y, fp.lookAt.z);
      } else {
        applyOrbit();
      }
    },

    // rider-hud 用に world 座標を画面 pixel に投影する。 map_renderer.js の
    // projectToScreen と同じ意味 (= rider 追随 HUD の座標) で、 戻りも {x,y} を含む。
    // 入力は world {x,y,z} ── Three.js 描画はメートル world 空間が native なので、
    // MapLibre 版の (lon,lat) とは座標系が違う。 lon/lat→world の変換は facade が担う。
    projectToScreen(world) {
      const v = new THREE.Vector3(world.x, world.y, world.z);
      v.project(camera);
      return ndcToScreen(v, viewW, viewH);
    },

    // container サイズ変更時に aspect と投影解像度を更新する。
    resize(width, height) {
      viewW = width;
      viewH = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    // 初期 zoom / pitch を反映する。 zoom は MapLibre 値 (走行視点 ≈ 21) で来るので
    // zoomToRadius でオービット半径 (m) に変換し、 クランプ域に収める。 pitch は度数で、
    // MapLibre と camera3d で同じ意味 (0=真上, 85=ほぼ水平) なのでそのまま反映する
    // (= applyOrbit 内で phi 範囲に再クランプされる)。 viewer が loadCourse から呼ぶ。
    setCameraDefaults({ zoom, pitch: pitchDeg } = {}) {
      if (Number.isFinite(zoom)) {
        radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, zoomToRadius(zoom)));
      }
      if (Number.isFinite(pitchDeg)) {
        pitch = pitchDeg;
      }
    },

    // マウス操作 hook (= facade が container の drag / wheel イベントを流し込む)。
    onDrag(dxPx, dyPx) {
      bearing = dragToBearing(bearing, dxPx);
      pitch = dragToPitch(pitch, dyPx);
    },
    onPan(dxPx, dyPx) {
      const panSpeed = radius * 0.001; // 半径に比例したパン速度
      const rad = bearing * Math.PI / 180;
      
      const rightX = Math.cos(rad);
      const rightZ = Math.sin(rad);
      const fwdX = -Math.sin(rad);
      const fwdZ = Math.cos(rad);
      
      panOffset.x -= (dxPx * rightX + dyPx * fwdX) * panSpeed;
      panOffset.z -= (dxPx * rightZ + dyPx * fwdZ) * panSpeed;
    },
    resetPan() {
      panOffset.set(0, 0, 0);
    },
    onWheel(deltaY) {
      radius = wheelRadius(radius, deltaY, RADIUS_MIN, RADIUS_MAX);
    },

    // orbit カメラの現在状態 (bearing/pitch/radius) を読む / 復元する。
    // 視点永続化用: facade が drag / wheel 後に getOrbitState() を localStorage に
    // 保存し、 次回起動で applyOrbitState() に流し込むと「最後に置いた視点」が初期
    // カメラになる。 radius は生成時と同じ [RADIUS_MIN, RADIUS_MAX] にクランプ、
    // bearing は 0..360 に正規化する (= 壊れた保存値で異常な画角にならないように)。
    getOrbitState() {
      return { bearing, pitch, radius };
    },
    applyOrbitState(s) {
      if (!s) return;
      if (Number.isFinite(s.bearing)) bearing = ((s.bearing % 360) + 360) % 360;
      if (Number.isFinite(s.pitch)) pitch = s.pitch;
      if (Number.isFinite(s.radius)) {
        radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, s.radius));
      }
    },

    // カメラモードを切り替える ('orbit' | 'top' | 'follow')。
    setMode(m) { mode = m; },
    getMode() { return mode; },
  };
}
