# kancolle-notify 艦これ通知システム

[通知・オーバーレイ・関連ツールの配布・導入ガイド](docs/index.html)

<p align="center">
  <strong>ゼロ・トラフィック設計の受動監視拡張機能 × Cloudflare Workers × デスクトップ常駐通知</strong><br>
  PCを閉じても、遠征帰投・入渠修復・泊地修理・疲労回復を確実に通知します。
</p>

<p align="center">
  <a href="https://github.com/Ikumyon/kancolle-notify/releases/latest"><img src="https://img.shields.io/badge/version-0.9.1--beta-blue.svg" alt="Version"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-brightgreen" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
</p>

---

## 📖 概要

**kancolle-notify** は、ブラウザでプレイ中の「艦隊これくしょん -艦これ-」のゲーム通信を受動的に読み取り、タイマーを高精度に算出・管理する通知システムです。

中央サーバーに **Cloudflare Workers (D1 & Durable Objects)** を採用しており、**PCをシャットダウンしたりブラウザを閉じても、クラウド側が指定時刻に Discord や Telegram へ確実にプッシュ通知** をお届けします。

さらに、PC稼働中は **Rust 製の超軽量常駐デーモン** による Windows トースト通知 / Linux D-Bus 通知や、**Qt (PySide6) 製のダッシュボードGUI** で残り時間を手元でもリアルタイムに把握できます。

---

## ✨ 主な特徴

- 🛡️ **ゼロ・トラフィック原則（BANリスク極限低減）**
  - 艦これ運営サーバーへの自発的なAPI通信や独自リクエストは一切行いません。ブラウザが通常受信しているゲームパケットを受動的に読み取るだけのため安全です。
- 🖥️ **Windows & Linux デスクトップ通知対応**
  - **常駐デーモン（Rust製）**: サーバーからの SSE（Server-Sent Events）プッシュ通知を受信し、OSネイティブのトースト/D-Bus通知を発行。定期的な重いポーリングを行わない超軽量・省電力設計。
  - **通知管理GUI（PySide6製）**: 全艦隊の遠征状況や入渠ドックの進捗、残り時間をひと目で確認できるモダンダッシュボード。
- ☁️ **Cloudflare Workers 連携（24時間完全自動）**
  - 個人利用であれば **無料枠（Freeプラン）** で十分に運用可能。PCがオフラインでもクラウドが時間を刻み続けます。
- 📱 **マルチ末端通知**
  - Windows トースト通知、Linux D-Bus 通知、Discord Webhook、Telegram Bot に対応。
- ⏱️ **充実のタイマー・ステータス管理**
  - 遠征完了タイマー、入渠ドック修復完了、工廠建造終了
  - 泊地修理（明石）の 20分サイクル確定判定
  - 疲労度（cond値）の 3分周期自然回復（上限49）の高精度計算

---

## 🚀 導入手順（クイックスタート）

超軽量オンラインインストーラーを実行するだけで、GitHubから最新プログラムの取得、Cloudflare Workers の自動構築、初期設定ファイルの生成まで全自動で行われます。

### 1. インストーラーの実行

#### 【Windows の場合】
1. [GitHub Releases](https://github.com/Ikumyon/kancolle-notify/releases/latest) から `kancolle-notify-setup.exe` をダウンロードして実行します。
2. 画面のウィザードに従い、Cloudflare API トークンと通知先（Discord Webhook 等）を入力するだけで自動セットアップが完了します。

#### 【Linux の場合】
端末（ターミナル）を開き、以下のコマンドを実行します：
```bash
curl -fsSL https://raw.githubusercontent.com/Ikumyon/kancolle-notify/main/installer/install.sh | bash
```
対話プロンプトに従って Cloudflare API トークンを入力するだけで、バイナリのダウンロード・配置、Cloudflare デプロイ、アプリアイコン登録まで完了します。

> 📁 **インストール先について**:  
> デフォルトでは、**インストーラーを実行した場所の直下に `kancolle-notify` フォルダが作成され、その中に展開されます**（ウィザード画面等で別の場所を自由に指定することも可能です）。
>
> ```text
> 実行した場所/（例: ダウンロード フォルダ）
> ├── kancolle-notify-setup.exe
> └── kancolle-notify/
>     ├── desktop/    # 常駐デーモン & 通知管理GUI
>     └── extension/  # ブラウザ拡張機能（これを読み込むだけ！）
> ```

---

### 2. ブラウザ拡張機能の読み込み

1. Google Chrome または Microsoft Edge で `chrome://extensions` を開きます。
2. 右上の **「デベロッパーモード」** を ON にします。
3. **「パッケージ化されていない拡張機能を読み込む」** をクリックし、インストーラーが配置した `kancolle-notify/extension` フォルダを選択します：
   - **デフォルト**: インストーラーを実行した場所にある `kancolle-notify/extension` フォルダ（インストール時に任意の場所へ変更可能）

※接続先サーバーURLや認証設定はインストーラーにより自動構成されているため、初期設定の手間はありません。

---

### 3. 利用開始

- スタートメニュー（またはアプリメニュー）から **「艦これ 通知管理」** を開いて、遠征や入渠の進捗を確認できます。
- バックグラウンドの常駐デーモンが指定時刻にトースト通知や Discord へ通知をお届けします。

---

## 🏗️ アーキテクチャ概要

```
[ ブラウザ拡張機能 (Edge) ]
    │  受動的にパケット観測 ＆ 確定時刻・フェーズを算出
    ▼
[ 中央サーバー (Cloudflare Workers) ]
    │  ・D1 データベース（タイマー・設定の永続化）
    │  ・Durable Objects（高精度アラーム・スケジュール管理）
    │  ・SSE イベントストリーム（リアルタイムプッシュ配信）
    ├───> [ Discord Webhook / Telegram Bot ]
    ▼
[ デスクトップ常駐デーモン (Rust) ]
    │  SSE 受取専用ストリーム待機
    ├───> OS ネイティブ通知（Windows トースト / Linux D-Bus）
    ▼
[ 通知管理ダッシュボード (PySide6) ]
```

---

## 🛠️ 開発者向け情報

### ディレクトリ構成
- `extension/`: Chromium 向けブラウザ拡張機能（Manifest V3）
- `server/`: Cloudflare Workers バックエンドコード
- `desktop/`: デスクトップ向けプログラム
  - `daemon/`: Rust 製常駐通知レシーバー
  - `gui/`: Python / PySide6 製通知管理ダッシュボード
- `installer/`: Windows用 (Inno Setup) および Linux用 (`install.sh`) オンラインインストーラー
- `docs/`: 公式ドキュメント・紹介ページ（GitHub Pages）

### 手動ビルド
```bash
# サーバーのデプロイ
cd server && npm install && npx wrangler deploy

# Rust デーモンのビルド
cd desktop/daemon && cargo build --release

# GUI の実行
python -m pip install -r requirements.txt
python desktop/gui/main.py
```

---

## 📄 ライセンス & 免責事項

- 本ソフトウェアは [MIT License](LICENSE) の下で公開されています。
- 本ツールは非公式のファンメイドツールであり、DMM GAMES様および「艦これ」運営鎮守府様とは一切関係ありません。
