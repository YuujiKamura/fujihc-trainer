"""大気環境関数 = 高度に対する標準大気プロファイル + 飽和水蒸気圧。

Air object が動くとき周囲の T_env / p_env / ρ_env を引きに来る。 標準大気 (ISA)
+ Tetens の飽和水蒸気圧式、 解析的に与える (= 数値積分なし、 軽い)。
"""
import math


class Atmosphere:
    def __init__(self,
                 T0: float = 300.0,        # 地表温度 [K]
                 p0: float = 101325.0,     # 地表圧力 [Pa]
                 lapse_rate: float = 0.0065,  # 環境温度減率 [K/m]、 ISA 標準
                 ):
        self.T0 = T0
        self.p0 = p0
        self.lapse_rate = lapse_rate

    @classmethod
    def from_config(cls, cfg):
        """config.Config から構築 (= scale-agnostic)"""
        ini = cfg.initial
        return cls(T0=ini.T0, p0=ini.p0, lapse_rate=ini.lapse_rate)

    def T_env(self, z: float) -> float:
        """環境温度 [K]、 一次関数で高度減少"""
        return self.T0 - self.lapse_rate * z

    def p_env(self, z: float) -> float:
        """環境圧力 [Pa]、 静水圧 + 温度減率を解析積分"""
        if z <= 0.0:
            return self.p0
        g = 9.80665
        M = 0.02896      # 乾燥空気モル質量 [kg/mol]
        R = 8.314462
        base = max(1.0 - self.lapse_rate * z / self.T0, 1e-6)
        exponent = g * M / (R * self.lapse_rate)
        return self.p0 * base ** exponent

    def rho_env(self, z: float) -> float:
        """環境乾燥密度 [kg/m^3]"""
        R_d = 287.0
        return self.p_env(z) / (R_d * self.T_env(z))

    def q_v_sat(self, T: float, p: float) -> float:
        """飽和水蒸気混合比 [kg/kg]。 Tetens の式 + 混合比換算。

        Tetens: e_sat(T) [Pa] = 611.2 × exp(17.67 × T_C / (T_C + 243.5))、 T_C は摂氏
        混合比: q_v_sat = ε × e_sat / (p - e_sat)、 ε = 0.622
        """
        T_C = T - 273.15
        e_sat = 611.2 * math.exp(17.67 * T_C / (T_C + 243.5))
        eps = 0.622
        return eps * e_sat / max(p - e_sat, 1.0)
