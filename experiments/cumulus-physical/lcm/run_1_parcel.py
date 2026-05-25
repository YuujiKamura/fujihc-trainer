"""ボトムアップ最初の 1 歩: Air object 1 個を地表で 2K 暖めて上昇させ、 凝結まで進める。

検証観点:
- 上昇するか (= w > 0 がしばらく続く、 浮力 feedback 確認)
- 上昇すると T 下がるか (= 断熱膨張)
- 飽和高度 (= LCL) で q_l が急上昇するか (= phase transition + 潜熱解放)
- 凝結後の T 反発で更に上昇加速するか (= 積雲対流 feedback の核)

結果は output/lcm_1parcel.json と output/lcm_1parcel.png に。
"""
from __future__ import annotations
import json
from pathlib import Path

from air import Air
from atmosphere import Atmosphere
import config


def main():
    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)

    # preset 駆動 = scale 可変、 default は parcel_legacy (= 単独 Air parcel)
    cfg = config.get("parcel_legacy")
    print(cfg.summary())
    print()

    atm = Atmosphere.from_config(cfg)

    # 地表で「周囲より +anomaly K 暖かい」 Air object 1 個。 環境 T0 と parcel 摂動を分離。
    air = Air(
        x=0.0, y=0.0, z=0.0,
        u=0.0, v=0.0, w=0.0,
        V=1.0, m_dry=1.225,
        q_v=cfg.initial.q_v0,
        q_l=0.0, q_i=0.0,
        N_aero=cfg.microphysics.n_aero_per_m3,
        T=cfg.initial.T0 + cfg.initial.parcel_T_anomaly_K,
        p=cfg.initial.p0,
    )

    dt = cfg.time.dt
    n_step = int(cfg.time.sim_time / dt)

    records = []
    print(f"=== Air object 1 個から積雲対流の最小単位を観察 ===")
    print(f"初期: T={air.T:.2f}K (環境 {atm.T_env(0):.2f}K)、 q_v={air.q_v*1e3:.1f}g/kg")
    print()

    lcl_step = None
    for step in range(n_step):
        air.step(dt, atm)
        records.append({
            "step": step,
            "z": air.z,
            "w": air.w,
            "T": air.T,
            "T_env": atm.T_env(air.z),
            "q_v": air.q_v,
            "q_l": air.q_l,
            "p": air.p,
        })
        if lcl_step is None and air.q_l > 1e-7:
            lcl_step = step
            print(f"凝結開始 (LCL): step={step}s  z={air.z:.1f}m  T={air.T:.2f}K  q_v={air.q_v*1e3:.3f}g/kg")
        if step % 120 == 0:
            print(f"step {step:5d}s  z={air.z:7.1f}m  w={air.w:+.2f}m/s  T={air.T:.2f}K  "
                  f"T_env={atm.T_env(air.z):.2f}K  q_l={air.q_l*1e3:.4f}g/kg")
        # 上昇終了 + 雲なし → 早期停止
        if step > 300 and air.w < -0.5 and air.q_l < 1e-7:
            print(f"step {step}: 下降に転じて雲なし、 停止")
            break

    out = {
        "config": {"T0": atm.T0, "p0": atm.p0, "dt": dt, "n_step_max": n_step,
                   "lcl_step": lcl_step},
        "records": records,
    }
    out_path = out_dir / "lcm_1parcel.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\n=== 完了 ===")
    print(f"出力: {out_path}  ({out_path.stat().st_size/1024:.1f} KB)")
    if lcl_step is not None:
        print(f"凝結開始: step {lcl_step}s / 高度 {records[lcl_step]['z']:.0f}m")
    print(f"最終: z={air.z:.1f}m  w={air.w:+.2f}m/s  q_l={air.q_l*1e3:.4f}g/kg")


if __name__ == "__main__":
    main()
