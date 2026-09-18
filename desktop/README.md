# 艦これ通知システム - デスクトップ版

「艦これ通知システム」のデスクトップクライアントです。  
手元で遠征や入渠などの進捗をリアルタイムに把握できる**運行管理ダッシュボード（GUI）**と、タイマー完了時にOSネイティブの通知を届ける**常駐デーモン（Rust製）**で構成されています。

---

## 🖥️ 主な機能

### 1. 運行管理ダッシュボード (GUI)
艦隊の運行状況や各タイマーの進捗をリアルタイムに一覧表示します。

* **遠征状況**: 艦隊ごとの遠征先、帰投予定時刻、残り時間のカウントダウン
* **入渠ドック**: 修復中の艦娘、完了予定時刻、残り時間
* **工廠建造**: 建造枠の進捗と完了時間
* **疲労度回復**: 疲労（cond値）の回復完了までの目安時間
* **泊地修理（明石タイマー）**: 20分サイクルの進行状況
* **デーモン管理**: 通知デーモンの稼働状態（PID）表示、ワンクリックでの起動・停止

### 2. バックグラウンド通知デーモン
超軽量・省電力設計のバックグラウンド常駐プロセスです。

* **ネイティブ通知**: Windows トースト通知 / Linux D-Bus 通知による確実なポップアップ
* **ゼロ・トラフィック連携**: サーバーからのプッシュ（SSE）連携で、ゲームに余計な負荷をかけない設計
* **OS自動起動**: PC起動時にバックグラウンドで自動常駐させる設定に対応

---

## 🚀 基本的な使い方

### 1. GUIの起動と初期設定
1. **GUIを起動**:
   * **Windows**: `kancolle-gui.exe` を実行（デスクトップまたはスタートメニューのショートカット）
   * **Linux**: `./kancolle-gui` を実行
2. **初期設定（歯車アイコンまたは設定ボタン）**:
   * **サーバーURL / トークン**: オンラインインストーラーで導入した場合は自動入力されています。
   * **自動起動**: PC起動時にデーモンを自動で常駐させたい場合はチェックを入れます。
   * **サウンド**: 通知時に音を鳴らすかどうかを切り替えます。
3. **デーモンの開始**:
   * デーモンが停止している場合は、画面上の **「デーモン起動」** ボタンを押して開始します。

### 2. コマンドライン操作（デーモン直接操作）
ターミナルやコマンドプロンプトからデーモンを直接制御することができます。実装されている全コマンドおよび引数は以下の通りです。

| コマンド | サブコマンド / 引数 | 動作内容・詳細 |
| :--- | :--- | :--- |
| **`start`** | なし | バックグラウンドで常駐開始（コンソールウィンドウを出さずにバックグラウンド起動） |
| **`stop`** | なし | バックグラウンドで動作中のデーモンプロセス（PID）を検出して安全に終了 |
| **`status`** | なし | 現在の稼働状態（稼働中/停止中、PID、監視中の全タイマー情報）をJSON出力 |
| **`run`** | なし | フォアグラウンドで常駐実行（標準出力・標準エラー出力に動作ログをリアルタイム出力。動作確認・デバッグ用。Ctrl+C で停止） |
| **`test`** | `[KIND]` | デスクトップ通知の動作テスト。<br>指定可能な種別: `expedition`（遠征帰投）, `repair`（入渠完了）, `build`（建造完了）, `fatigue`（疲労回復）, `akashi`（泊地修理）, `manual`（手動タイマー）。<br>※省略時は基本通知（`default`）をテスト |
| **`config`** | `list` / `get` | 現在の設定内容（サーバーURL、トークン、サウンド、自動起動、アプリ名登録状況）を一覧表示 |
| | `set <KEY> <VALUE>` | 設定値を変更して保存。<br>変更可能なキー: `server_url`（URL文字列）, `token`（トークン文字列）, `play_sound`（`true` または `false`） |
| | `--json` | 現在の設定内容をJSON形式で標準出力に出力（プログラム連携用） |
| **`offset`** | `[SEC]` | 中央通知サーバーの通知オフセット（秒数）を表示または変更。<br>引数なしで現在の秒数を取得。数値を指定すると設定を更新（負数=事前通知、正数=事後通知。例: `offset -60` で1分前通知） |
| **`autostart`** | `status` | OS起動時の自動起動（常駐）が有効か無効かを確認（`--json` でJSON出力可能） |
| | `enable` | OS起動時の自動起動（Windows: レジストリRunキー / Linux: autostartデスクトップエントリ）を有効化 |
| | `disable` | OS起動時の自動起動登録を解除 |
| **`appid`** | `status` | Windows通知アプリ名「艦これ通知」の登録状態を確認（Windows専用、`--json` 対応） |
| | `enable` | Windows通知ヘッダーに「艦これ通知」とアイコンを表示するAUMIDをレジストリに登録 |
| | `disable` | AUMID登録を解除（PowerShell標準通知に戻す） |
| **`help`** | なし | コマンド一覧と使用法のヘルプメッセージを表示（`--help`, `-h` にも対応） |

#### 全コマンドの実行例
```bash
# デーモンの起動・停止・確認
./kancolle-daemon start               # バックグラウンド起動
./kancolle-daemon status              # 稼働状態・監視タイマー確認
./kancolle-daemon stop                # 停止
./kancolle-daemon run                 # ログを見ながらフォアグラウンド実行

# 各種通知のテスト実行
./kancolle-daemon test                # 基本通知テスト
./kancolle-daemon test expedition     # 遠征帰投テスト
./kancolle-daemon test repair         # 入渠完了テスト
./kancolle-daemon test build          # 建造完了テスト
./kancolle-daemon test fatigue        # 疲労回復テスト
./kancolle-daemon test akashi         # 泊地修理テスト
./kancolle-daemon test manual         # 手動タイマーテスト

# 設定の確認と変更
./kancolle-daemon config list                         # 設定一覧を表示
./kancolle-daemon config set server_url https://...   # サーバーURLを変更
./kancolle-daemon config set token YOUR_TOKEN         # トークンを変更
./kancolle-daemon config set play_sound false         # サウンドを無効化
./kancolle-daemon config set play_sound true          # サウンドを有効化

# 通知タイミング（オフセット）の調整
./kancolle-daemon offset              # 現在のオフセット秒数を表示
./kancolle-daemon offset -60          # 60秒前に通知（事前通知）
./kancolle-daemon offset 0            # ちょうど完了時刻に通知

# 自動起動（常駐）の管理
./kancolle-daemon autostart status    # 自動起動の状態確認
./kancolle-daemon autostart enable    # 自動起動を有効化
./kancolle-daemon autostart disable   # 自動起動を無効化

# Windows通知元ヘッダー（AUMID）の管理 (Windowsのみ)
./kancolle-daemon appid status        # 登録状態の確認
./kancolle-daemon appid enable        # 「艦これ通知」として登録
./kancolle-daemon appid disable       # 登録解除
```

---

## ⚙️ 各種設定項目（全項目）

設定画面（GUI）および `config.json` で管理される全設定項目の一覧です。

| 設定キー | 型 | 初期値 | 説明 |
| :--- | :--- | :--- | :--- |
| **`server_url`** | 文字列 | `http://127.0.0.1:8787` | 通知データを受信する Cloudflare Workers のエンドポイントURL |
| **`token`** | 文字列 | `""` | サーバーと安全に通信するための端末認証トークン（Token） |
| **`play_sound`** | 真偽値 | `true` | 通知時に音（カスタム音声またはOS標準通知音）を鳴らすかどうかの設定 |
| **自動起動** *(OS管理)* | 真偽値 | `false` | OS起動時にデーモンをバックグラウンド自動起動するかどうかの設定 |
| **通知アプリ名** *(Win)* | 真偽値 | `false` | Windows通知ヘッダーを「艦これ通知」として登録するかどうかの設定（AUMID） |
| **中央通知オフセット** | 整数(秒) | `0` | 通知タイミングの微調整（負数で事前通知、0でジャスト、正数で事後通知） |

---

## 🎨 通知のカスタマイズ（アイコン・通知音）

通知の見た目や音をお好みの画像・音声に差し替えることができます。

* 🖼️ **[通知アイコンのカスタマイズ詳細 (icons/README.md)](icons/README.md)**
  * `icons/` フォルダ内の画像を差し替えることで、遠征・入渠・建造などの通知アイコンをお好みの画像に変更できます。
* 🔊 **[カスタム通知音（音声ファイル）の設定詳細 (sounds/README.md)](sounds/README.md)**
  * `sounds/` フォルダに `.wav` ファイルを配置することで、遠征帰投時などに艦娘のボイスやオリジナル効果音を再生できます。
