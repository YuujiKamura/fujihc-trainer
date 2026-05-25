# b99 CP: chrome を背景タブでも requestAnimationFrame が動く flag 付きで起動する helper.
#
# 通常 chrome は不可視 / 背景 tab で rAF を抑制する (= 数 Hz に節約)、 viewer の ride loop が
# 止まり chart buffer も更新されない. 開発時に viewer 画面を背景に置いたまま chart 動作を
# bridge 経由で観測したい時 (= /api/debug/chart-state を curl する flow) はこの起動を使う.
#
# flag の意味:
#   --disable-background-timer-throttling      setTimeout / setInterval の背景抑制を切る
#   --disable-renderer-backgrounding           renderer 背景化時の優先度低下を切る
#   --disable-backgrounding-occluded-windows   ウィンドウが隠れた時の suspend を切る
#   --new-window                                既存 chrome session に新 window で開く (= focus 衝突軽減)
#
# 使い方:
#   pwsh scripts/start-bg-viewer.ps1                                  # default = ?test=1
#   pwsh scripts/start-bg-viewer.ps1 -Url 'http://localhost:8000/?map=1'
#
# 注意: production 用ではない. user の常用 chrome に直接 background-throttling を切る flag を
# 付けるとバッテリ消費が増える. 本 script は開発時 verify 用、 起動した window を閉じれば終了.

param(
    [string]$Url = 'http://localhost:8000/?test=1'
)

$chromeFlags = @(
    '--new-window',
    '--window-size=1400,900',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    $Url
)

Write-Host "Starting chrome with bg-rAF flags: $Url"
Start-Process chrome -ArgumentList $chromeFlags

Write-Host "Once viewer is loaded, you can poll chart state without foregrounding the window:"
Write-Host "  curl -s http://127.0.0.1:8000/api/debug/chart-state | python -m json.tool"
