# GPUつきPCでの作業準備

r05以降の作業（重ね描きによる高精細な描画、人物の作り直し、動画）は、GPUつきのPCで行う。クラウドの作業環境はGPUがなく、静止画1枚に40〜60秒かかる。重ね描きや動画は現実的な時間に収まらない。

想定するPCはNVIDIA GeForce RTX 4070を積んだWindows機である。Linux・Macでの違いは各手順に書いた。

## 1. 入れるもの

| 道具 | 版 | 用途 |
| --- | --- | --- |
| Git（Git LFSを含む） | 最新版 | リポジトリの取得。LFSは`.gitattributes`のバイナリ形式に使う |
| Node.js | 22系 | ビューアと描画スクリプト（`npm ci`でthree.js 0.170.0とPlaywright 1.63.0を入れる） |
| Python | 3.11以降 | 比較シートと公開スクリプト。`pip install -r requirements-render.txt` |
| Google Chrome | 最新版 | GPUで描くときのブラウザ（`--channel chrome`） |
| Claude Code | 最新版 | Claude Desktopアプリ、またはターミナルの`claude` |
| Blender | 4.5 LTS | r05で人物を作るとき（MakeHuman/MPFB。ユーザーの承認後） |

## 2. フォント

看板の文字は端末に入れたフォントで描く。フォントのファイルはリポジトリに入れず、配布もしない。入っていないフォントは別の書体に置き換わって看板の見え方が変わる。描画記録の`fontWarnings`と、ログの`WARNING fonts not installed`で、置き換わっていないことを必ず確認する。

| ビューアが使う名前 | フォント | 利用条件 |
| --- | --- | --- |
| IPAGothic / IPAPGothic | IPAゴシック | IPAフォントライセンスv1.0 |
| IPAMincho / IPAPMincho | IPA明朝 | IPAフォントライセンスv1.0 |
| MotoyaLMaru | モトヤLマルベリ3等幅 | Apache-2.0 |
| MotoyaLCedar | モトヤLシーダ3等幅 | Apache-2.0 |
| WenQuanYi Zen Hei | 文泉驛正黑（英数字の代替だけ） | GPL-2.0（フォント埋め込みの例外つき） |

**Windows**
1. IPAフォント：情報処理推進機構の配布ページ（moji.or.jp）から`IPAfont00303.zip`を取得し、中の`ipag.ttf`・`ipagp.ttf`・`ipam.ttf`・`ipamp.ttf`を右クリックして「すべてのユーザーに対してインストール」する。
2. モトヤLの2書体：Debianのパッケージ`fonts-motoya-l-maruberi`と`fonts-motoya-l-cedar`（版1.01）の`.deb`を取得する。7-Zipで`data.tar.xz`→`usr/share/fonts/truetype/...`の順に開き、`MTLmr3m.ttf`と`MTLc3m.ttf`を取り出して同様にインストールする。
3. WenQuanYi Zen Hei（任意）：Debianの`fonts-wqy-zenhei`から`wqy-zenhei.ttc`を同様に取り出す。

**Linux（Ubuntu/Debian）**
```sh
sudo apt-get install fonts-ipafont-gothic fonts-ipafont-mincho fonts-motoya-l-maruberi fonts-motoya-l-cedar fonts-wqy-zenhei
```

**Mac**：IPAフォントは配布ページから入れる。モトヤLの2書体は、Windowsと同じ方法で`.deb`から取り出してFont Bookで入れる。

**フォントをOSに入れられない場合**（r05で追加）

同じファイルを、リポジトリ直下の`local-fonts/`に置く。このフォルダはGitの対象外で、コミットも配布もしない。ビューア（`viewer/src/core/fonts.js`）は、OSに入っていない書体だけをここから読む。OSに入っている書体は、従来どおりOSのものを使う。

| ファイル名 | 書体 |
| --- | --- |
| `ipag.ttf`・`ipagp.ttf` | IPAゴシック・IPA Pゴシック |
| `ipam.ttf`・`ipamp.ttf` | IPA明朝・IPA P明朝 |
| `MTLmr3m.ttf` | モトヤLマルベリ3等幅 |
| `MTLc3m.ttf` | モトヤLシーダ3等幅 |
| `wqy-zenhei.ttf` | WenQuanYi Zen Hei |

- WenQuanYiは、Debianの`.ttc`のままではChromeが読めない（OTSの検査で`FFTM: misaligned table`）。fontToolsで最初の書体を`.ttf`に書き出す。
  ```sh
  pip install fonttools
  py -3 -c "from fontTools.ttLib import TTCollection as C; f=C('local-fonts/wqy-zenhei.ttc').fonts[0]; f.__delitem__('FFTM'); f.save('local-fonts/wqy-zenhei.ttf')"
  ```
- 描画記録の`stations[].fontSources`に、書体ごとの読み込み元（`system`・`local-fonts/<ファイル名>`・`missing`）が残る。

## 3. リポジトリの準備

```sh
git clone https://github.com/yourbright-jp/showa-tokyo-3d.git
cd showa-tokyo-3d
git lfs install
git checkout claude/stoic-ramanujan-2ngpfv
npm ci
pip install -r requirements-render.txt
python3 -m unittest discover -s tests
```

- PR #10が`main`へ合流した後は、`main`から作業する。
- Windowsでは`python3`の代わりに`py -3`を使う。
- Windowsで分かったこと（r05、2026-11-03）
  - Gitの既定（`core.autocrlf=true`）では、テキストが改行CRLFで取り出され、公開ファイルのハッシュ検査が一致しなかった。`.gitattributes`を`* text=auto eol=lf`にし、どの設定でもLFで取り出すようにした。古い取り出しが残っている場合は、`git rm -rq --cached . && git reset -q --hard`で取り出し直す。
  - Pythonの既定の文字コード（cp1252）では、日本語を含むJSONを読めず27件がエラーになった。テストとスクリプトのファイルの読み書きを、UTF-8・改行LFに固定した。

## 4. GPUで描けることの確認

```sh
node scripts/render_stills.mjs --gpu --channel chrome --out renders/gpu-check --w 1920 --h 1080 --stations under-gate
```

`renders/gpu-check/render-report.json`で次を確認する。

- `environment.mode`が`gpu`である。
- `environment.webgl_renderer`がNVIDIAのGPU名を含む（例：`ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 ... Direct3D11 ...)`）。SwiftShaderなら、GPUで描けていない。このとき`--gpu`は失敗として終わる。
- `stations[].fontWarnings`が空である。
- `stations[].moduleErrors`が空である。
- `stations[].ms`を記録する。クラウドのCPU描画では、同じ地点が約60秒だった。

うまくいかないときは、次を順に試す。

1. `--angle d3d11`（Windowsの既定）
2. `--angle gl`（Linuxの既定）
3. `--angle vulkan`
4. `--channel chromium`

どの組み合わせで動いたかを記録する。

**確認済みの組み合わせ（2026-11-03）**：Windows 11、RTX 4070（ドライバ610.88）、Google Chrome 156.0.8078.80、Node 24.15.0、Python 3.13。`--channel chrome`と既定の`--angle d3d11`で、1回目から`ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)`で描けた。

**GPUとCPUで同じ絵にするための注意**：シェーダーの中で`fract(sin(x) * 43758.5)`型の乱数を使わない。大きな引数の`sin`の精度は実装ごとに違い、r04の窓の室内（カーテン・ブラインド・壁の色）がGPUとSwiftShaderで入れ替わっていた。r05で整数ハッシュ（`buildings/materials.js`の`uhash`）に替えた。

**重ね描きとまとめ描き（r05）**：静止画は、1ページで世界を1回だけ作り、全カメラを続けて描く。1ページ1地点では世界の作成（CPU、約13秒）が毎回かかり、GPUはほとんど使われない。

```sh
node scripts/render_stills.mjs --gpu --channel chrome --batch --spp 64 --out renders/r05 --stations entrance-approach,under-gate,ichibangai-middle,towards-koma-corner,plaza-reveal,koma-front --views r04-gate-establishing,r04-gate-rear,r04-milano-front --walk 0,10,60,120,184,230,257
```

- `--spp N`：1コマをN回ずらして描いて平均する（ぎざぎざの除去・柔らかい影）。このPCでは64回で1枚0.5秒以内。
- 任意：`--sunr <度>`（太陽の半径。既定0.27）、`--fstop <F値> --focus <m>`（被写界深度）、`--shutter <秒>`（歩行の動きのぶれ）、`--shadow <画素>`（影の解像度。既定4096）。
- `--batch`なしでは、従来どおり1ページ1地点で描く（`--spp`なしならr04と同じ1回描き）。
- 測定の結果は[r05ラウンド記録](rounds/shinjuku-kabukicho-1976-r05.md)。

## 5. 歩いて見る

```sh
npm run serve
```

表示されたURLをChromeで開く。WASDで歩き、マウスのドラッグで見回し、1〜6のキーで固定地点へ移る。GPUがあれば、なめらかに動く。

## 6. 注意

- GPUで描いた画像は、CPU描画（SwiftShader）の画像と画素単位では一致しない。比較では、描画記録の`mode`と`webgl_renderer`を必ず確認する。
- 認証情報、非公開のリンク、アカウントの識別子をリポジトリに置かない（`AGENTS.md`）。
- `renders/`はGitの対象外。公開する画像は`scripts/publish_r04_previews.py`の方式で、出典記録とともに`docs/previews/`へ置く。
