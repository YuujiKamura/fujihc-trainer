// brief 35 / rider-position-model: Rider (= Terrain 内のある位置に存在する主体).
//
// 役割:
// - 「rider が今センターラインのどこに居て、 速度 v / cadence c / power w / hr で、
//   pause 中 or active、 sensor 値はこう」 を保持する mutable agent.
// - 「今いる lat/lon/heading/slope/distance」 は Terrain への query で取る (= 自分では
//   持たない). これが「Terrain ⊃ Rider」 の責務分離.
//
// 位置モデル (= rider-position-model で作り直した核 ── ユーザー指示の設計):
// - rider の一次情報は **位置**. センターライン上の一点を `(segIdx, segFrac)`
//   (= セグメント番号, セグメント内進捗 0..1) で保持する. これが唯一の保持 state.
// - tick(dt) は「センターラインに沿って 速度×speedMult×dt の実メートルぶん前進」.
//   セグメント長を消費しながらポリラインを歩く (= 距離からの逆算ではない).
// - distanceTraveled は位置から導出する getter (= terrain.distanceAt(segIdx, segFrac)).
//   保持 state ではない. これで距離と位置が構造的に食い違えない.
// - 自由な 2D 点 (lat/lon を独立に積分) として持つことは禁止 ── 位置は定義上
//   センターライン上に固定され、 横ずれが起きえない.
//
// 設計:
// - DOM / browser global 依存ゼロ (= node test 容易).
// - ride_state.js は後方互換 shim (= 既存 test を壊さない、 内部で同じ Rider を使う).

/**
 * Rider を生成する.
 *
 * @param {{terrain: ReturnType<import('./terrain.js').createTerrain>, lookAhead?: number}} opts
 * @returns {ReturnType<typeof _shape>}
 */
export function createRider({ terrain, lookAhead = 5 } = {}) {
  if (!terrain || typeof terrain.getPositionAt !== 'function'
      || typeof terrain.segmentLength !== 'function') {
    throw new TypeError('createRider: terrain must be a Terrain instance');
  }

  // === 内部 state ===
  // 一次情報は位置 (segIdx, segFrac). distanceTraveled は保持しない (= 位置から導出).
  let segIdx = 0;         // セグメント番号 (0..segmentCount-1).
  let segFrac = 0;        // セグメント内進捗 (0..1).
  let speed = 0;          // mps. 外部 (= fake state / BLE / ws / 観るモード即時セット) からの入力.
  let paused = true;
  let active = false;
  // sensor 値 (= state push 由来). 旧 currentCadence / currentPower / currentHr を集約.
  let cadence = 0;
  let power = 0;
  let hr = 0;
  // spinAngle (= rider 上スピナーの累積回転角、 cadence rpm に比例). viewer の描画用.
  let spinAngle = 0;
  // trkpts (= ride 中の {t,lat,lon,ele,power,cad,hr} 時系列).
  let trkpts = [];

  const segmentCount = terrain.segmentCount;
  const totalDistance = terrain.totalDistance;

  // === position / distance 算出 (= Terrain への query 経由) ===
  function _position() {
    return terrain.getPositionAt(segIdx, segFrac, lookAhead);
  }

  // distanceTraveled は位置から導出する (= 保持 state ではない、 getter の core).
  function _distance() {
    return terrain.distanceAt(segIdx, segFrac);
  }

  function _atGoal() {
    return totalDistance > 0 && _distance() >= totalDistance;
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
    /** distanceTraveled は位置から導出する (= 保持しない、 位置の別名). */
    get distanceTraveled() { return _distance(); },
    get speed() { return speed; },
    get paused() { return paused; },
    get active() { return active; },
    get atGoal() { return _atGoal(); },
    get cadence() { return cadence; },
    get power() { return power; },
    get hr() { return hr; },
    get spinAngle() { return spinAngle; },
    /** 位置のセグメント番号 (= 一次 state の一部). */
    get segmentIdx() { return segIdx; },
    /** 位置のセグメント内進捗 0..1 (= 一次 state の一部). */
    get fracInSegment() { return segFrac; },
    /** Terrain への query 結果 (= lat/lon/elevation/slope/heading/segmentIdx/distance). */
    get position() { return _position(); },

    // === 配置 / 進行制御 ===

    /**
     * course 点 idx に瞬間移動 (= 観るモードで section click).
     * idx は course 点 index (0..lastIdx). 末尾点はセグメント末端 (= segFrac=1).
     * paused / active flag は変えない.
     */
    placeAtIdx(idx) {
      if (segmentCount === 0) { segIdx = 0; segFrac = 0; return; }
      let i = Math.floor(Number(idx));
      if (!Number.isFinite(i) || i < 0) i = 0;
      if (i >= segmentCount) {
        // 末尾点 (= course[segmentCount]) はセグメント (segmentCount-1) の末端.
        segIdx = segmentCount - 1;
        segFrac = 1;
      } else {
        segIdx = i;
        segFrac = 0;
      }
    },

    /**
     * 距離 d (m) に瞬間移動. terrain.locate で位置へ一発変換 (= 仕様 6、 ジャンプは可).
     */
    placeAtDistance(d) {
      if (segmentCount === 0) { segIdx = 0; segFrac = 0; return; }
      const loc = terrain.locate(d);
      segIdx = loc.segmentIdx;
      segFrac = loc.fracInSegment;
    },

    /**
     * 速度を外部入力としてセット (= mps). fake state push / BLE / ws / 観るモード即時
     * セットすべて本 API を経由させて 1 経路に統一.
     */
    setSpeed(mps) {
      const v = Number(mps);
      if (!Number.isFinite(v) || v < 0) return;
      speed = v;
    },

    /**
     * sensor 値 (= cadence / power / hr) をまとめてセット. undefined は変更しない.
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
     * ride 開始. start からの開始は位置を起点 (segIdx=0, segFrac=0) にリセット.
     */
    start() {
      segIdx = 0;
      segFrac = 0;
      paused = false;
      active = true;
      trkpts = [];
    },

    /**
     * 観るモード用 ── 既存位置を保ったまま active に遷移 (= placeAtIdx → resume の合成).
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

    /** 位置を起点に、 paused/active は変えない. trkpts / spinAngle もクリア. */
    reset() {
      segIdx = 0;
      segFrac = 0;
      trkpts = [];
      spinAngle = 0;
    },

    // === tick (= 60Hz hot path) ===

    /**
     * 1 step 進める. dt は秒、 speed は内部値 (setSpeed で外部から入る).
     *
     * 移動は「センターラインに沿って 速度×speedMult×dt の実メートルぶん前進」.
     * セグメント長を消費しながらポリラインを歩く ── 距離からの逆算は一切しない.
     *
     * options:
     *   - speedMultiplier (= viewer の speedMult、 user slider 経由), default 1
     *   - appendTrkpt (= true なら現位置を trkpt に push、 default false)
     *   - trkptExtras: { t, power, cad, hr } を override 可
     */
    tick(dt, options = {}) {
      if (paused) return;
      if (segmentCount === 0) return;
      if (!(dt > 0)) return;
      const mult = Number.isFinite(options.speedMultiplier) ? options.speedMultiplier : 1;
      const effectiveSpeed = speed * mult;
      if (effectiveSpeed > 0) {
        // 移動量 (実メートル) をセグメント長から消費しながらポリラインを歩く.
        let remaining = effectiveSpeed * dt;
        while (remaining > 0) {
          const sl = terrain.segmentLength(segIdx);
          if (sl <= 0) {
            // 退化セグメント (= 同一点): 進めず次へ. 末尾なら末端で停止.
            if (segIdx >= segmentCount - 1) { segFrac = 1; break; }
            segIdx++;
            segFrac = 0;
            continue;
          }
          const distToSegEnd = sl * (1 - segFrac);
          if (remaining < distToSegEnd) {
            // 現セグメント内で止まる.
            segFrac += remaining / sl;
            remaining = 0;
          } else if (segIdx >= segmentCount - 1) {
            // 末尾セグメント末端で停止 (= ゴール).
            segFrac = 1;
            remaining = 0;
          } else {
            // セグメントをまたぐ: 残量を次セグメントへ繰り越す.
            remaining -= distToSegEnd;
            segIdx++;
            segFrac = 0;
          }
        }
      }
      // cadence rpm → rad/s = rpm * 2π / 60. cadence=0 ならスピナー停止.
      spinAngle += cadence * (2 * Math.PI / 60) * dt;
      if (options.appendTrkpt) {
        const extras = options.trkptExtras || { power, cad: cadence, hr };
        _appendTrkptInternal(extras);
      }
    },

    /**
     * 区間ジャンプ用のスムーズ移動 (= 旧 ride_state.seekToward). targetDist へ向けて
     * 1 step では速度×dt 分だけ近づく. これは「ジャンプ」 系 API なので距離→位置の
     * 一発変換 (terrain.locate) を使ってよい (= per-tick の ride 移動ではない).
     * paused / dt<=0 / speedMps<=0 は no-op で false を返す.
     *
     * @returns {boolean} 到達したら true.
     */
    seekToward(targetDist, dt, speedMps) {
      if (paused) return false;
      if (segmentCount === 0) return false;
      if (!(dt > 0) || !(speedMps > 0)) return false;
      const cur = _distance();
      // targetDist を [0, totalDistance] にクランプして「到達」判定の基準にする.
      let target = Number(targetDist);
      if (!Number.isFinite(target) || target < 0) target = 0;
      if (target > totalDistance) target = totalDistance;
      const diff = target - cur;
      const step = speedMps * dt;
      let nextDist;
      let reached;
      if (Math.abs(diff) <= step) {
        nextDist = target;
        reached = true;
      } else {
        nextDist = cur + Math.sign(diff) * step;
        reached = false;
      }
      const loc = terrain.locate(nextDist);
      segIdx = loc.segmentIdx;
      segFrac = loc.fracInSegment;
      return reached;
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
        distance: _distance(),
        speed,
        paused,
        active,
        atGoal: _atGoal(),
        cadence,
        power,
        hr,
        spinAngle,
        trkptCount: trkpts.length,
        // 「今ここ」 (= Terrain への query 結果).
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
