"""run_1_parcel.py の出力 (= JSON 軌跡) を matplotlib で可視化。

4 段プロット: z(t) / w(t) / T(t) と T_env(t) / q_v + q_l (t)
LCL を赤破線で marker、 雲水 q_l の発生 + 消滅 (= 蒸発で q_l が減るか) を見せる。
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    here = Path(__file__).parent
    in_path = here / "output" / "lcm_1parcel.json"
    with open(in_path, encoding="utf-8") as f:
        data = json.load(f)

    recs = data["records"]
    t = [r["step"] for r in recs]
    z = [r["z"] for r in recs]
    w = [r["w"] for r in recs]
    T = [r["T"] for r in recs]
    T_env = [r["T_env"] for r in recs]
    q_v = [r["q_v"] * 1e3 for r in recs]
    q_l = [r["q_l"] * 1e3 for r in recs]
    lcl_step = data["config"].get("lcl_step")

    fig, axes = plt.subplots(4, 1, figsize=(9, 9), sharex=True)

    axes[0].plot(t, z, color="tab:blue")
    axes[0].set_ylabel("altitude z [m]")
    axes[0].set_title("Bottom-up: single Air object (q_v=15g/kg, +2K warmer than env)")
    axes[0].grid(alpha=0.3)

    axes[1].plot(t, w, color="tab:orange")
    axes[1].axhline(0, color="black", linewidth=0.5)
    axes[1].set_ylabel("vertical speed w [m/s]")
    axes[1].grid(alpha=0.3)

    axes[2].plot(t, T, color="tab:red", label="T (parcel)")
    axes[2].plot(t, T_env, color="tab:gray", linestyle="--", label="T_env (atmosphere)")
    axes[2].set_ylabel("temperature [K]")
    axes[2].legend(loc="best", fontsize=9)
    axes[2].grid(alpha=0.3)

    axes[3].plot(t, q_v, color="tab:green", label="q_v (water vapor)")
    axes[3].plot(t, q_l, color="tab:purple", label="q_l (cloud water)")
    axes[3].set_ylabel("mixing ratio [g/kg]")
    axes[3].set_xlabel("time t [s]")
    axes[3].legend(loc="best", fontsize=9)
    axes[3].grid(alpha=0.3)

    if lcl_step is not None:
        for ax in axes:
            ax.axvline(lcl_step, color="red", linestyle=":", alpha=0.6,
                       label=f"LCL t={lcl_step}s" if ax is axes[0] else None)
        axes[0].legend(loc="upper right", fontsize=9)

    fig.tight_layout()
    out_png = here / "output" / "lcm_1parcel.png"
    fig.savefig(out_png, dpi=110, bbox_inches="tight")
    print(f"出力: {out_png}")


if __name__ == "__main__":
    main()
