"""Air = 「空気」 という data class、 内部モデルのボトムアップ最小単位。

user 概念モデル (= 2026-05-25):
「まず最初に空気というデータクラスがあって、 水分量とか、 単位ボリュームとか、
エアロゾルとかを含んでいて、 そいつが座標空間内で動いて、 雲という凝結状態になる」

設計言語としての class:
- 位置 (x, y, z) と速度 (u, v, w) を持つ Lagrangian air parcel
- 内包水分 (q_v 水蒸気 / q_l 雲水 / q_i 氷晶)
- エアロゾル N_aero (= 凝結核個数)
- 熱力学状態 (T, p)
- step() で 1 時間刻み進める: 移流 + 浮力 + 断熱膨張 + 飽和判定 + 凝結 + 潜熱解放

ボトムアップ:
- まず 1 個から動かす (= run_1_parcel.py)
- 次に N 個並走 (= 相互作用無し、 level 2)
- 最後に Air object 間の質量 + 圧力相互作用 (= 真の積雲対流、 level 3)
"""
from dataclasses import dataclass


@dataclass
class Air:
    # 位置 [m]
    x: float
    y: float
    z: float
    # 速度 [m/s]
    u: float
    v: float
    w: float
    # 単位体積 [m^3]
    V: float
    # 乾燥空気質量 [kg]
    m_dry: float
    # 水蒸気混合比 [kg/kg] (= 水蒸気質量 / 乾燥空気質量)
    q_v: float
    # 雲水混合比 [kg/kg]
    q_l: float
    # 氷晶混合比 [kg/kg]
    q_i: float
    # エアロゾル個数密度 [1/m^3]
    N_aero: float
    # 温度 [K]
    T: float
    # 圧力 [Pa]
    p: float

    def density_dry(self) -> float:
        """乾燥空気密度 ρ_d [kg/m^3] = p / (R_d * T)"""
        R_d = 287.0  # 乾燥空気の比気体定数 [J/kg/K]
        return self.p / (R_d * self.T)

    def density_total(self) -> float:
        """全密度 (= 乾燥 + 水蒸気 + 雲水 + 氷)、 浮力計算用"""
        return self.density_dry() * (1.0 + self.q_v + self.q_l + self.q_i)

    def virtual_temperature(self) -> float:
        """仮温度 T_v = T × (1 + 0.61 × q_v - q_l - q_i)、 浮力計算で実温度の代わりに使う"""
        return self.T * (1.0 + 0.61 * self.q_v - self.q_l - self.q_i)

    def step(self, dt: float, atmosphere) -> None:
        """1 時間ステップ進める。 atmosphere は環境プロファイル提供 object。"""
        # ----- 1. 移動 (= advection) -----
        self.x += self.u * dt
        self.y += self.v * dt
        self.z += self.w * dt
        if self.z < 0.0:
            self.z = 0.0
            self.w = 0.0  # 地面反射 (= 簡易)

        # ----- 2. 速度更新 (= 浮力 + 重力) -----
        g = 9.80665
        T_env = atmosphere.T_env(self.z)
        # 仮温度差で浮力を取る (= 水蒸気多いほど軽い、 雲水多いほど重い)
        Tv_self = self.virtual_temperature()
        Tv_env = T_env  # 環境は乾燥扱い (= 簡略化、 真っ当には q_v_env も持つ)
        buoyancy = (Tv_self - Tv_env) / Tv_env * g
        self.w += buoyancy * dt
        # 圧力均衡 (= 簡略、 即環境圧力に追従)
        self.p = atmosphere.p_env(self.z)

        # ----- 3. 断熱膨張で T 下がる -----
        # 乾燥断熱率: dT/dz = -g / c_p = -9.8 K/km、 これを w × dt で積分
        c_p = 1004.0  # 定圧比熱 [J/kg/K]
        dry_lapse = g / c_p
        self.T -= dry_lapse * self.w * dt

        # ----- 4. 飽和判定 + 凝結 / 蒸発 (= 双方向 phase transition) -----
        q_v_sat = atmosphere.q_v_sat(self.T, self.p)
        L_v = 2.5e6  # 蒸発の潜熱 [J/kg]
        if self.q_v > q_v_sat:
            # 過飽和: 超過分 Δq を q_l へ転移 (= 凝結、 潜熱解放で T 上がる)
            dq = self.q_v - q_v_sat
            self.q_v -= dq
            self.q_l += dq
            self.T += L_v * dq / c_p
        elif self.q_v < q_v_sat and self.q_l > 0.0:
            # 不飽和 + 雲水あり: 蒸発 (= 逆 phase transition、 吸熱で T 下がる)
            # 1 step で「飽和まで戻す or 雲水尽きる」 のうち少ない方
            dq_demand = (q_v_sat - self.q_v)
            dq = min(self.q_l, dq_demand)
            self.q_l -= dq
            self.q_v += dq
            self.T -= L_v * dq / c_p

        # ----- 5. 空気抵抗 (= 鉛直速度の減衰、 周囲との摩擦近似) -----
        # 真の Navier-Stokes 抜きの簡易、 単独 Air object が無限振動するのを止める
        drag_coeff = 0.05  # 1/s、 経験値
        self.w -= drag_coeff * self.w * dt
        self.u -= drag_coeff * self.u * dt
        self.v -= drag_coeff * self.v * dt

    def is_cloudy(self, threshold: float = 1e-5) -> bool:
        """このパーセルが「雲」 状態か (= q_l が閾値以上)"""
        return self.q_l > threshold

    def __repr__(self) -> str:
        return (f"Air(z={self.z:.1f}m, w={self.w:+.2f}m/s, T={self.T:.2f}K, "
                f"q_v={self.q_v*1e3:.3f}g/kg, q_l={self.q_l*1e3:.4f}g/kg)")
