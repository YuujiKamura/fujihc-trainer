// brief 35: Rider (= Terrain 内のある位置に存在する主体).
//
// 役割:
// - 「rider が今 distance d を走ってる、 速度 v / cadence c / power w / hr で、
//   pause 中 or active、 sensor 値はこう」 を保持する mutable agent.
// - 「今いる lat/lon/heading/slope」 は Terrain への query で取る (= 自分では持たない).
//   これが「Terrain ⊃ Rider」 の責務分離 (= Rider は course / 補間 / 方位算出を持たない).
//
// 設計:
// - DOM / browser global 依存ゼロ (= node test 容易).
// - 既存 ride_state.js を上位 wrap する形式は採らず、 Rider が直接 distanceTraveled を保持.
//   ride_state.js は後方互換 shim 化 (= 既存 12+9+8 件の test を壊さない).
// - viewer-maplibre.js の tick 内 inline 計算 (= curIdx / curDist / playSpeed / 補間 frac
//   / courseBearing / smoothBearing / riderHeadingRad / spinAngle 等) を移送先する.

/**
 * Rider を生成する.
 *
 * @param {{terrain: ReturnType<import('./terrain.js').createTerrain>, lookAhead?: number}} opts
 * @returns {ReturnType<typeof _shape>}
 */
export function createRider({ terrain, lookAhead = 5 } = {}) {
  if (!terrain || typeof terrain.getPositionAtDistance !== 'function') {
    throw new TypeError('createRider: terrain must be a Terrain instance');
  }

  // === 内部 state ===
  // 「rider 自身が持つべき主観 state」 のみ. lat/lon/heading 等の客観値は Terrain query で算出.
  let distanceTraveled = 0;
  let speed = 0;          // mps. 外部 (= fake state / BLE / ws / 観るモード即時セット) からの入力.
  let paused = true;
  let active = false;
  // sensor 値 (= state push 由来). 旧 currentCadence / currentPower / currentHr を集約.
  let cadence = 0;
  let power = 0;
  let hr = 0;
  // spinAngle (= rider 上スピナーの累積回転角、 cadence rpm に比例). viewer の描画用、 ride 状態の
  // 一部として保持. tick(dt) で進める.
  let spinAngle = 0;
  // trkpts (= ride 中の {t,lat,lon,ele,power,cad,hr} 時系列). brief 33 で ride_state.js に landed
  // していた機能を Rider に移送.
  let trkpts = [];

  const totalDistance = terrain.totalDistance;

  function clampDist(d) {
    if (!Number.isFinite(d) || d < 0) return 0;
    if (d > totalDistance) return totalDistance;
    return d;
  }

  function _atGoal() {
    return totalDistance > 0 && distanceTraveled >= totalDistance;
  }

  // === position 算出 (= Terrain への query 経由) ===
  function _position() {
    return terrain.getPositionAtDistance(distanceTraveled, lookAhead);
  }

  function _appendTrkptInternal(extras) {
    if (terrain.length === 0) return;
    const pos = _position();
    const lat = Number.isFinite(pos.lat) ? pos.lat : null;
    const lon = Number.isFinite(pos.lon) ? pos.lon : null;
    if (lat === null || lon === null) return;
    const ele = Number.isFinite(pos.elevation) ? pos.elevation : null;
    const ex = extras || {};
    trkpts.push({
      t: typeof ex.t === 'string' && ex.t ? ex.t : new Date().toISOString(),
      lat, lon, ele,
      power: (ex.power === null || ex.power === undefined || !Number.isFinite(Number(ex.power))) ? null : Number(ex.power),
      cad: (ex.cad === null || ex.cad === undefined || !Number.isFinite(Number(ex.cad))) ? null : Number(ex.cad),
      hr: (ex.hr === null || ex.hr === undefined || !Number.isFinite(Number(ex.hr))) ? null : Number(ex.hr),
    });
  }

  const api = {
    // === getter (= 公開 read-only state) ===
    get distanceTraveled() { return distanceTraveled; },
    get speed() { return speed; },
    get paused() { return paused; },
    get active() { return active; },
    get atGoal() { return _atGoal(); },
    get cadence() { return cadence; },
    get power() { return power; },
    get hr() { return hr; },
    get spinAngle() { return spinAngle; },
    /** Terrain への query 結果 (= lat/lon/elevation/slope/heading/segmentIdx). */
    get position() { return _position(); },

    // === 配置 / 進行制御 ===

    /**
     * course idx に瞬間移動 (= 観るモードで section click).
     * 「ジャンプ」 動作だが速度設定は別経路、 placeAtIdx の責任は座標移動のみ.
     * paused / active flag は変えない (= 「観る」 から呼ぶ時に外で resume するのも、
     * trainer ride 中に呼ぶのも両対応).
     */
    placeAtIdx(idx) {
      if (terrain.length === 0) return;
      const safeIdx = Math.max(0, Math.min(terrain.length - 1, Math.floor(Number(idx) || 0)));
      distanceTraveled = clampDist(terrain.distanceAtIdx(safeIdx));
    },

    placeAtDistance(d) {
      distanceTraveled = clampDist(d);
    },

    /**
     * 速度を外部入力としてセット (= mps). fake state push / BLE / ws / 観るモード即時セット
     * すべて本 API を経由させて 1 経路に統一.
     */
    setSpeed(mps) {
      const v = Number(mps);
      if (!Number.isFinite(v) || v < 0) return;
      speed = v;
    },

    /**
     * sensor 値 (= cadence / power / hr) をまとめてセット. 旧 currentCadence 等の
     * module global を吸収. undefined は変更しない (= 部分更新可).
     */
    setSensors({ power: pw, cad, hr: heart } = {}) {
      if (pw !== undefined) {
        const v = Number(pw);
        if (Number.isFinite(v)) power = v;
      }
      if (cad !== undefined) {
        const v = Number(cad);
        if (Number.isFinite(v)) cadence = v;
      }
      if (heart !== undefined) {
        const v = Number(heart);
        if (Number.isFinite(v)) hr = v;
      }
    },

    // === ride 状態遷移 ===

    /**
     * ride 開始. start からの開始は distance=0 にリセット (= 旧 rideState.start() と同義).
     * trkpts もクリア (= brief 33 既存挙動).
     */
    start() {
      distanceTraveled = 0;
      paused = false;
      active = true;
      trkpts = [];
    },

    /**
     * 観るモード用 ── 既存位置を保ったまま active に遷移 (= placeAtIdx → resume の合成 helper).
     * trkpts はクリアする (= 観るモードは記録対象外、 過去 trkpt も残らない方が安全).
     */
    startFromIdx(idx) {
      this.placeAtIdx(idx);
      paused = false;
      active = true;
      trkpts = [];
    },

    end() {
      paused = true;
      active = false;
    },

    pause() {
      paused = true;
    },

    resume() {
      paused = false;
    },

    togglePause() {
      paused = !paused;
    },

    /** 位置をゼロに、 paused/active は変えない. trkpts もクリア. */
    reset() {
      distanceTraveled = 0;
      trkpts = [];
      spinAngle = 0;
    },

    // === tick (= 60Hz hot path) ===

    /**
     * 1 step 進める. dt は秒、 speed は内部値 (setSpeed で外部から入る).
     *
     * options:
     *   - speedMultiplier (= viewer の speedMult、 user slider 経由), default 1
     *   - appendTrkpt (= true なら現位置を trkpt に push、 default false).
     *     旧 viewer の「ride active && !paused なら 1Hz で appendTrkpt」 は呼出側 (= tick cadence)
     *     で頻度制御、 Rider は「呼ばれたら push」 の単純動作.
     *   - trkptExtras: { t, power, cad, hr } を override 可 (= setSensors で渡してる値を毎フレーム
     *     上書きしたい場合).
     */
    tick(dt, options = {}) {
      if (paused) return;
      if (terrain.length === 0) return;
      if (!(dt > 0)) return;
      const mult = Number.isFinite(options.speedMultiplier) ? options.speedMultiplier : 1;
      const effectiveSpeed = speed * mult;
      if (effectiveSpeed > 0 && distanceTraveled < totalDistance) {
        distanceTraveled = clampDist(distanceTraveled + effectiveSpeed * dt);
      }
      // cadence rpm → rad/s = rpm * 2π / 60. cadence=0 ならスピナー停止.
      spinAngle += cadence * (2 * Math.PI / 60) * dt;
      if (options.appendTrkpt) {
        const extras = options.trkptExtras || { power, cad: cadence, hr };
        _appendTrkptInternal(extras);
      }
    },

    /**
     * 区間ジャンプ用のスムーズ移動 (= 旧 ride_state.seekToward). 「ワープではなく時速 100km で
     * 道沿いに移動」 用途. distanceTraveled を targetDist に近づける、 1 step では速度×dt 分.
     * paused / dt<=0 / speedMps<=0 は no-op で false を返す.
     *
     * @param {number} targetDist
     * @param {number} dt
     * @param {number} speedMps
     * @returns {boolean} 到達したら true.
     */
    seekToward(targetDist, dt, speedMps) {
      if (paused) return false;
      if (terrain.length === 0) return false;
      if (!(dt > 0) || !(speedMps > 0)) return false;
      const target = clampDist(targetDist);
      const diff = target - distanceTraveled;
      const step = speedMps * dt;
      if (Math.abs(diff) <= step) {
        distanceTraveled = target;
        return true;
      }
      distanceTraveled = clampDist(distanceTraveled + Math.sign(diff) * step);
      return false;
    },

    // === trkpts ===

    appendTrkpt(extras) {
      _appendTrkptInternal(extras);
    },

    getTrkpts() {
      return trkpts.map((p) => ({ ...p }));
    },

    // === snapshot ===

    /**
     * 全 state の immutable copy. tick 後の 1 source-of-truth として viewer に渡す.
     */
    snapshot() {
      const pos = _position();
      return {
        // 「自分の状態」
        distance: distanceTraveled,
        speed,
        paused,
        active,
        atGoal: _atGoal(),
        cadence,
        power,
        hr,
        spinAngle,
        trkptCount: trkpts.length,
        // 「今ここ」 (= Terrain への query 結果). 旧 viewer tick 内の inline 計算と同等.
        position: {
          lat: pos.lat,
          lon: pos.lon,
          elevation: pos.elevation,
          slope_pct: pos.slope_pct,
          heading: pos.heading,
          segmentIdx: pos.segmentIdx,
          fracInSegment: pos.fracInSegment,
        },
      };
    },
  };

  return api;
}
