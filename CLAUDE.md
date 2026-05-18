# fujihc-trainer — AI エージェント向けルール

## 地図タイル配布元への配慮 (最重要、変更禁止)

このリポは国土地理院 (GSI) と OpenStreetMap (OSM) のタイルを使う。
配布元へ迷惑をかけないことを設計の軸に据えている。以下のルールは AI が勝手に変更・回避してはならない。

### GSI 地理院タイル

- **取得は 1 回だけ**: ページを開いた 1 回、コース外接矩形を覆う数十枚のみ。自動再取得・ループ取得は禁止。
- **同時接続 6 本以下**: `GSI_FETCH_LIMIT = 6` を減らす方向にのみ変更可、増やし禁止。
- **タイル数上限 200**: `MAX_TILES = 200` を超えたら地形を組まずエラー。増やし禁止。
- **seamlessphoto 固定**: `std` / `relief` / `hybrid` はサーバ負荷が倍増するため封印。追加禁止。
- **Python スクリプト**: `GSI_RATE_LIMIT_SEC = 1.0` (1 req/s)。速くするな。
- **IndexedDB キャッシュ必須**: `openTileCache()` を外さない。TTL 内は GSI に再アクセスしない設計を壊さない。
- **出典クレジット必須**: `© 国土地理院タイル` + `https://maps.gsi.go.jp/development/ichiran.html` を画面に常時表示する `#attrib` 要素を消さない。

### OSM タイル

- **`tile.openstreetmap.org` を直接叩くな**: OSMF Tile Usage Policy 違反。Protomaps PMTiles 経由のみ。
- **`bridge.py` は `127.0.0.1` bind 固定**: LAN 内に ODbL タイルを再配布する事故を物理的に防いでいる。`0.0.0.0` への変更禁止。

### DB / バイナリ

- `data/*.sqlite` / PMTiles 元ファイルは `.gitignore` 済、git に含めるな。
- 数百 MB 以上の binary を commit するな。

## テスト

```sh
python -m pytest          # Python (pytest)
npm test                  # JS (vitest) — web/tests/
```

変更後は触ったモジュールのテストを両方走らせてから次の action に移れ。

## scratch / draft の置き場

調査メモ・レポート・brief は `~/.agents/scratch/fujihc-trainer-project/` に書け。
リポ内 (`/c/Users/yuuji/fujihc-trainer/`) に置くのは commit する意図があるファイルだけ。

## push 禁止

`git push` は user の明示指示があるまで禁止。ローカル commit まで。
