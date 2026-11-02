# r04 引き継ぎメモ (2026-11-02)

r04 = three.js + headless Chromium による手続き的な高精細化ラウンド（Cook Loop 方式）。
ルールは `docs/rounds/shinjuku-kabukicho-1976-r04-rules.md`。正となる世界は #7 の r03 adopted world。

## 1. 現状

- ブランチ `claude/busy-cori-4mshbo`、ドラフト PR #9（CI なし）。main は #8 (`66ab492`) まで。
- ユーザー決定（2026-11-02）
  - レンダラは three.js 0.170 + SwiftShader（"1番"）。Blender は環境に無い。
  - ゲートは湾曲電球ゲート（`data/decisions/kabukicho-gate-1976.json`）。
  - 不明点は推測で埋めてよい。ただし `adopted-inferred` / `period-plausible-generic` / `placeholder` のラベルを付け、verified に格上げしない。
- `python3 -m unittest discover -s tests`：36 tests OK。

### モジュール（`viewer/src/world/`、`index.js` の順に読み込み）

| モジュール | 状態 | 規模 / 備考 |
|---|---|---|
| terrain | 完了 | 舗装種別（adopted ルールと 100% 一致）、近景 5–6 cm の汚れベイク、側溝蓋、縁石、横断歩道 |
| buildings | 完了 | 419 棟を 4 段 LOD（<40 / 40–88 / 88–140 / >140 m）、店内、窓リビール、雨だれ、屋上の水槽とアンテナ。約 0.82M tris |
| signage | 完了 | 1,100 枚。adopted text node 35 件は位置誤差 0、字高 ±2%。縦書き組版、袖看板、屋上ビルボード、ネオン（夜のみ発光） |
| people | 完了 | 581 人。15 の服装タイプ、安定 id（動きは未実装）。約 1.83M tris |
| landmarks | 作業中のまま止まっている可能性あり | ゲート、コマ劇場、東宝会館、噴水、街灯。下記 §3 参照 |
| streetprops | 作業中のまま止まっている可能性あり | 電柱と架線、標識、信号、自転車、自販機、車など。下記 §3 参照 |

- 各モジュールのログは `ctx.tag()` で `provenance` に出る。
- 他モジュールに公開しているデータ
  - `ctx.signage.volumes`
  - `ctx.buildingsInfo`（`roofY` Map と rooftop 設備）
  - terrain の `userData.layout`（側溝と蓋の位置）

### 基盤側で直したこと

- `render_stills.mjs`：canvas を toDataURL で保存する（スクリーンショットの 30 s タイムアウト対策）。
- `main.js`
  - `castShadow` は各モジュールが明示的に設定する（three.js の既定は false）。
  - `envMapIntensity` を指定したマテリアルには `scene.environment` を明示的にバインドする。three.js は envMap を持たないマテリアルの値を無視するため。

## 2. 実行方法

```bash
npm ci
node scripts/render_stills.mjs --out renders/r04 --w 1920 --h 1080          # 6 stations
node scripts/render_stills.mjs --out renders/r04-walk --walk 0,20,90,150,200,250 --w 1920 --h 1080
python3 scripts/make_comparison.py renders/r04                               # 参照画像との並置と contact sheet
npm run serve   # → http://127.0.0.1:<port>/?station=under-gate （対話モード：WASD、1–6 で station 移動）
```

- URL パラメータ：`station`、`still=1`、`w`、`h`、`look=clear-afternoon|neon-night`、`only=terrain,buildings`、`walk=<秒>`
- 4 CPU / GPU なし環境の実測（他エージェント並走中で高負荷）：全モジュールで 960×540 が 40–55 s/station。予算は 1080p で ≤120 s。負荷なしの計測は未実施。
- `renders/` は gitignore 済み。公開する画像は `docs/previews/r04/` に置き、`*.asset.json` sidecar を付ける。

## 3. 次にやること（優先順）

1. **landmarks / streetprops の仕上げ確認**
   - 未コミット差分を確認し、全モジュール 1080p でエラーが無いことを確かめる（`render-report.json` の `moduleErrors`）。
   - signage の屋上ビルボードは `b.topY`（パラペット上端）基準。屋根スラブ（`ctx.buildingsInfo.roofY`）と合っているか確認する。
2. **ゲートが station 画面に映らない問題**
   - `entrance-approach` カメラ (-90.47, 2.50, 80.98) は水平視で、ゲート楕円（地上約 6.5–8.3 m、約 10 m 先）が画角の上に外れている。walk の t=0 は pitch 24° で見上げるのでゲートが映る。
   - 対策は次のどちらか。共通ルートと世界ジオメトリは変えないこと。
     - (a) station カメラに pitch を付ける。
     - (b) ゲート全景用の診断 station を追加する（例：横断歩道上の 20–25 m 手前）。
3. **1080p で 6 station と walk フレームを本番レンダし、`make_comparison.py` で R01–R09 と並べて自分で検分する。**
4. **fresh-context 批評**（`docs/templates/CRITIC_BRIEF.md`）
   - (i) 歴史・地理の証拠と (ii) 見た目と動きの品質を、別コンテキストで独立に実施する。
   - 6 軸を各 10 点で採点し、目標は全軸 8 以上。slop 禁止リストは r04 rules を参照。
5. **批評を受けた修正ラウンド**
   - 既知の弱点
     - 全体が白っぽく霞む（look.js の skyFill、fog、bloom、AgX の調整）。
     - 人物の顔と手がマネキン的。季節の服装が混在。
     - 遠景ビルのテクスチャ反復。
     - ネオン管が平面描画。
     - 夜景で地面が暗すぎる（発光が地面を照らさない）。
     - 歩道が段差なし（フラットな縁石）。
     - 人物は他モジュールのジオメトリを走査して配置しているので、他モジュールを変えると人が消える場合がある（id は安定）。
   - 性能
     - signage と neon-night の build は高負荷時に 15 s 予算を超えた。
     - 大きな 2D canvas が多いと Chromium が遅くなる。canvas を 1 枚使い回し、`renderer.initTexture` でアップロードする方式が速い。
6. **ラウンドの記録と公開**
   - `docs/rounds/shinjuku-kabukicho-1976-r04.md` を `docs/templates/ROUND_REPORT.md` に沿って書く。未実施のチェックと証拠の欠落は明記する。
   - 代表画像を `docs/previews/r04/*.png` に置き、`.asset.json` を付ける（r01/r03 の sidecar を踏襲し、PLATEAU/GSI 派生は CC-BY-4.0）。
   - tests を通してから PR #9 を更新する。
7. **ユーザー承認を得てから動画レンダ**
   - 静止画の承認が先。人物を動かすなら `group.userData.people` の id / stride / phase を使う。

## 4. ユーザーに未確認の事項

- 参照画像 R01–R09（`license: null`）の権利。リポジトリは public か private か。
- `docs/PRODUCTION_PLAN.md` 本体へのワークフロー定義修正（Blender 前提の解消、合格基準、slop リストなど）の反映可否。r04 rules 側では対応済み。

## 5. 守ること（AGENTS.md より）

- 実在のブランド、ロゴ、映画題名は出さない。架空店名は fictional として tag する。
- 推定値を verified と書かない。出典年と復元年は分けて書く。
- force push しない。push は指定ブランチ `claude/busy-cori-4mshbo` のみ。
- 現代の PLATEAU/OSM は参照用の下敷き。1976 年の証拠ではない。
