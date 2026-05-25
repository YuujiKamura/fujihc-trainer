"""scale-agnostic 設定: grid 解像度 / domain / dt / SD 数 を一箇所に集約。

user 指示 (2026-05-25): 「単位自体を可変にしておけば、 環境によって精細化できる」。
ローカル PC 制約から将来 GPU / スパコン まで、 同じコードベースで scale を変えるだけで
動く設計にする。 各 preset は「**何を解像したいか**」 で選ぶ:

- test_1d_1m  : 1D 鉛直 column を 1m 解像、 検証用、 cell 数 15k、 ローカルで秒〜分
- field_1d_50m: 1D 鉛直 column 50m、 境界層解像、 cell 数 300、 ローカルで分単位
- fuji_2d_100m: 2D 富士山鉛直断面 100m、 100×150=15k cell、 ローカル PC 数十分
- fuji_3d_200m: 3D 富士山 200m、 50×50×75=187k cell、 ローカル PC 上限、 数時間
- fuji_3d_100m_gpu: 3D 富士山 100m + 25 SD/cell、 1.5M cell、 GPU 必要、 将来用

選定方針 (= 8 担当者チーム合意):
- anelastic 近似、 potential temperature θ で解く、 PySDM SDM を per-cell microphysics
- Deardorff TKE-1.5 sub-grid mixing、 σ 座標 地形、 開放境界 + 風上 nudging
- 観測初期条件は MSM + Tateno + ERA5 + アメダス + レーダー + ひまわり の fixture-first
"""
from dataclasses import dataclass


@dataclass
class Domain:
    """シミュ領域の物理寸法 [m]"""
    lx: float  # 水平 x [m]
    ly: float  # 水平 y [m]
    lz: float  # 鉛直 [m]


@dataclass
class Grid:
    """grid 解像度 [m]、 cell 数は domain との比で派生"""
    dx: float
    dy: float
    dz: float

    def cell_counts(self, domain: Domain) -> tuple[int, int, int]:
        return (
            max(1, int(round(domain.lx / self.dx))),
            max(1, int(round(domain.ly / self.dy))),
            max(1, int(round(domain.lz / self.dz))),
        )


@dataclass
class TimeStep:
    """時間刻み + 総 sim 時間 [s] + 出力間隔"""
    dt: float
    sim_time: float
    output_interval: float = 60.0


@dataclass
class Microphysics:
    """雲粒側 (= 微物理) の解像度"""
    sd_per_cell: int        # PySDM super-droplet 数 / cell
    n_aero_per_m3: float    # エアロゾル個数密度 [1/m^3]
    cond_tau_s: float = 30.0    # 凝結時定数 [s]
    evap_tau_s: float = 200.0   # 蒸発時定数 [s]


@dataclass
class Initial:
    """初期環境プロファイル (= 観測から fed する場合は label='obs:fixture_path')"""
    T0: float       # 環境 地表温度 [K]
    p0: float       # 環境 地表圧力 [Pa]
    q_v0: float     # 環境 地表水蒸気混合比 [kg/kg]
    lapse_rate: float  # 環境温度減率 [K/m]
    parcel_T_anomaly_K: float = 0.0  # parcel 初期 加熱 (= 単独 parcel test 用)
    perturbation_K: float = 0.1  # 場 random perturbation 振幅 [K] (= field test 用)
    source: str = "ISA_standard"  # "ISA_standard" / "obs:fixture_path"


@dataclass
class SGS:
    """sub-grid scale 乱流"""
    scheme: str = "deardorff_tke"  # 'none' / 'smagorinsky' / 'deardorff_tke'
    C_k: float = 0.10
    Pr_t: float = 0.7


@dataclass
class Config:
    label: str
    domain: Domain
    grid: Grid
    time: TimeStep
    microphysics: Microphysics
    initial: Initial
    sgs: SGS = None

    def __post_init__(self):
        if self.sgs is None:
            self.sgs = SGS()

    def cell_counts(self) -> tuple[int, int, int]:
        return self.grid.cell_counts(self.domain)

    def total_cells(self) -> int:
        nx, ny, nz = self.cell_counts()
        return nx * ny * nz

    def total_super_droplets(self) -> int:
        return self.total_cells() * self.microphysics.sd_per_cell

    def summary(self) -> str:
        nx, ny, nz = self.cell_counts()
        return (
            f"=== {self.label} ===\n"
            f"  domain: {self.domain.lx}×{self.domain.ly}×{self.domain.lz} m\n"
            f"  grid  : {self.grid.dx}×{self.grid.dy}×{self.grid.dz} m  ({nx}×{ny}×{nz} = {self.total_cells():,} cells)\n"
            f"  time  : dt={self.time.dt}s, sim_time={self.time.sim_time}s ({self.time.sim_time/60:.0f} min)\n"
            f"  micro : {self.microphysics.sd_per_cell} SD/cell  (= {self.total_super_droplets():,} total SD)\n"
            f"  initial: T0={self.initial.T0}K p0={self.initial.p0}Pa q_v0={self.initial.q_v0*1e3}g/kg ({self.initial.source})\n"
            f"  sgs   : {self.sgs.scheme}"
        )


PRESETS: dict[str, Config] = {
    "test_1d_1m": Config(
        label="1D column 1m super-fine (= 検証用、 cell 数 15k、 ローカル数秒-分)",
        domain=Domain(lx=1.0, ly=1.0, lz=15000.0),
        grid=Grid(dx=1.0, dy=1.0, dz=1.0),
        time=TimeStep(dt=0.1, sim_time=1800.0),
        microphysics=Microphysics(sd_per_cell=10, n_aero_per_m3=1e8),
        initial=Initial(T0=300.0, p0=101325.0, q_v0=0.015, lapse_rate=0.0065),
    ),
    "field_1d_50m": Config(
        label="1D column 50m (= 境界層解像、 cell 数 300、 ローカル分単位)",
        domain=Domain(lx=50.0, ly=50.0, lz=15000.0),
        grid=Grid(dx=50.0, dy=50.0, dz=50.0),
        time=TimeStep(dt=1.0, sim_time=3600.0),
        microphysics=Microphysics(sd_per_cell=25, n_aero_per_m3=1e8),
        initial=Initial(T0=300.0, p0=101325.0, q_v0=0.015, lapse_rate=0.0065),
    ),
    "fuji_2d_100m": Config(
        label="2D 富士山鉛直断面 100m (= 100×150=15k cell、 ローカル数十分)",
        domain=Domain(lx=10000.0, ly=100.0, lz=15000.0),
        grid=Grid(dx=100.0, dy=100.0, dz=100.0),
        time=TimeStep(dt=1.0, sim_time=1800.0),
        microphysics=Microphysics(sd_per_cell=25, n_aero_per_m3=1e8),
        initial=Initial(T0=300.0, p0=101325.0, q_v0=0.015, lapse_rate=0.0065),
    ),
    "fuji_3d_100m": Config(
        label="3D 富士山 100m + CPU 用 (= 50×50×50=125k cell、 ローカル PC 数十秒-分、 b107 multicell sim、 lz=5km で 富士山頂 3.75km + 雲頂 4km + 上層 shear カバー)",
        domain=Domain(lx=5000.0, ly=5000.0, lz=5000.0),
        grid=Grid(dx=100.0, dy=100.0, dz=100.0),
        time=TimeStep(dt=1.0, sim_time=1800.0),
        microphysics=Microphysics(sd_per_cell=10, n_aero_per_m3=1e8),
        initial=Initial(T0=288.15, p0=101325.0, q_v0=0.018, lapse_rate=0.0065),
    ),
    "fuji_3d_200m": Config(
        label="3D 富士山 200m (= 50×50×75=187k cell、 ローカル PC 上限、 数時間)",
        domain=Domain(lx=10000.0, ly=10000.0, lz=15000.0),
        grid=Grid(dx=200.0, dy=200.0, dz=200.0),
        time=TimeStep(dt=2.0, sim_time=1800.0),
        microphysics=Microphysics(sd_per_cell=10, n_aero_per_m3=1e8),
        initial=Initial(T0=300.0, p0=101325.0, q_v0=0.015, lapse_rate=0.0065),
    ),
    "fuji_3d_100m_gpu": Config(
        label="3D 富士山 100m × 25 SD (= 1.5M cell、 GPU 必要、 将来用)",
        domain=Domain(lx=10000.0, ly=10000.0, lz=15000.0),
        grid=Grid(dx=100.0, dy=100.0, dz=100.0),
        time=TimeStep(dt=1.0, sim_time=1800.0),
        microphysics=Microphysics(sd_per_cell=25, n_aero_per_m3=1e8),
        initial=Initial(T0=300.0, p0=101325.0, q_v0=0.015, lapse_rate=0.0065),
    ),
    "parcel_legacy": Config(
        label="既存 Lagrangian Air parcel 1 個 (= air.py の旧設計、 ボトムアップ最初の 1 歩)",
        domain=Domain(lx=1.0, ly=1.0, lz=15000.0),
        grid=Grid(dx=1.0, dy=1.0, dz=15000.0),  # cell 1 個 = 単独 parcel 相当
        time=TimeStep(dt=1.0, sim_time=1800.0),
        microphysics=Microphysics(sd_per_cell=1, n_aero_per_m3=1e8),
        initial=Initial(T0=300.0, p0=101325.0, q_v0=0.015, lapse_rate=0.0065,
                        parcel_T_anomaly_K=2.0),  # 環境 300K + parcel +2K で浮力 trigger
    ),
}


def get(name: str) -> Config:
    if name not in PRESETS:
        raise ValueError(f"unknown preset: '{name}', available: {sorted(PRESETS.keys())}")
    return PRESETS[name]


def list_presets() -> None:
    """preset 一覧を表示"""
    for name, cfg in PRESETS.items():
        print(cfg.summary())
        print()


if __name__ == "__main__":
    list_presets()
