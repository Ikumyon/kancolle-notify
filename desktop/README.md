# 艦これ 超軽量デスクトップ常駐通知システム
（MS-DOS ＋ Windows 3.1 モデル / Windows & Linux マルチプラットフォーム対応）

ブラウザを閉じても遠征・入渠・建造・疲労回復の完了をデスクトップ通知（Windowsトースト / Linux D-Bus）で受け取れるシステムです。

- **Rust製常駐デーモン（MS-DOS担当）**: バックグラウンドで不可視プロセスとして常駐。常駐メモリわずか **約1〜2MB**、CPU使用率 **0%**。
- **Python / PySide6 GUI（Win3.1担当）**: 駅の電光掲示板・発車標風デザインの時刻表ダッシュボード。必要な時だけ開き、閉じればプロセス完全終了でメモリ全解放。

---

## マルチプラットフォーム（土台層）設計

OS依存部分を「土台（Platform Layer）」として完全に分離しており、上位のUI・通信・タイマーロジックは100%共通コードで動作します。

| 項目 | Windows 🪟 | Linux 🐧 |
| :--- | :--- | :--- |
| **通知エンジン** | WinRT ネイティブトースト通知 (アクションセンター) | D-Bus / Desktop Notifications (`notify-rust`) |
| **プロセス管理** | `tasklist` / `taskkill` | POSIXシグナル (`kill -0` / `kill -15`) |
| **バックグラウンド化** | `CREATE_NO_WINDOW` / `DETACHED_PROCESS` | 標準入出力デタッチ (`Stdio::null()`) |
| **GUI起動スクリプト** | `start-gui.bat` | `start-gui.sh` |

---

## ディレクトリ構成

```
desktop/
├── daemon/                     # Rust常駐CLIプロジェクト
│   ├── src/
│   │   ├── platform/           # 【土台レイヤー】OS別アダプタ
│   │   │   ├── mod.rs          # 共通インターフェース
│   │   │   ├── windows.rs      # Windows用土台
│   │   │   └── linux.rs        # Linux用土台
│   │   ├── client.rs           # Workers通信
│   │   ├── timer.rs            # タイマー・判定ロジック
│   │   ├── state.rs            # JSON状態管理
│   │   └── main.rs             # CLIコマンド処理
│   └── target/release/
│       └── kancolle-daemon.exe # 最適化バイナリ (2.5MB)
├── gui/                        # PySide6 GUI
│   ├── main.py                 # 時刻表風ダッシュボード
│   └── controller.py           # デーモン制御モジュール (OS自動判別)
├── config.json                 # 設定ファイル (URL, Token, 通知設定)
├── state.json                  # 監視状態キャッシュ (スロット情報)
├── start-gui.bat / .sh         # 時刻表GUIを起動
├── start-daemon.bat / .sh      # 常駐デーモンを起動
└── stop-daemon.bat / .sh       # 常駐デーモンを停止
```

---

## 使い方

### 1. 時刻表GUIを開く（推奨）
- **Windows**: `desktop/start-gui.bat` をダブルクリック
- **Linux**: `./desktop/start-gui.sh` を実行

- **画面機能**:
  - **遠征・入渠のリアルタイム時刻表**: カウントダウン表示、種別ごとの色分けバッジ（遠征・入渠・建造・疲労回復）。
  - **「▶ 運行開始」ボタン**: バックグラウンドで常駐デーモンを起動。
  - **「■ 運行停止」ボタン**: 常駐デーモンを安全に停止。
  - **「🔔 通知テスト」ボタン**: デスクトップ通知のテスト。
  - **「⚙ 設定」ボタン**: WorkersサーバーURL、認証Token、通知タイミング（0秒前 / 60秒前など）を変更可能。
- **ポイント**:
  - **GUIウィンドウを閉じても、裏で起動した常駐デーモンはそのまま動き続けます**。
  - 再度GUIを開くと、いつでも現在の運行状況を確認できます。

### 2. コマンドライン（CLI）から直接操作する場合
OSを問わず同じコマンド体系で動作します：

```bash
# バックグラウンド常駐を開始
./kancolle-daemon start    # Windows: .\kancolle-daemon.exe start

# 稼働状態・スロット一覧をJSONで表示
./kancolle-daemon status

# 常駐を停止
./kancolle-daemon stop

# デスクトップ通知の動作テスト
./kancolle-daemon test

# フォアグラウンド実行（コンソールにログを出して確認したい場合）
./kancolle-daemon run
```

---

## メモリ効率
- **常駐デーモン (Rust)**: 約 1 〜 2 MB
- **GUI表示中 (PySide6)**: 約 40 〜 60 MB（※ウィンドウを閉じれば即座にメモリ返却）
