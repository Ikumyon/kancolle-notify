## ツールの概要

**KCO Relay** は、KCO title fetcher などの補助ツールから送られてくる再生中タイトル情報を、ローカル環境で受け取り、中継するためのデスクトップ常駐ツールです。
Kancolle Stream Overlay と組み合わせることで、配信画面にBGM名などをリアルタイム表示できます。

## 主な機能

ブラウザ拡張などから送られたタイトル情報をローカルで受信し、Kancolle Stream Overlay 側のBGM表示へ橋渡しします。
Windows / Linux のデスクトップ上で動作する軽量な常駐アプリで、ビルド済みファイルは GitHub Releases から入手できます。

## ダウンロード

最新版は GitHub Releases のAssetとして配布されています。

- Windows: `kco-relay-windows-x86_64.zip` を展開し、`kco-relay.exe` を起動します。
- Linux: `kco-relay-linux-x86_64.tar.gz` を展開し、`./kco-relay` を起動します。

Linux版はUbuntu 22.04のx86_64環境でビルドされています。GUI環境、D-Bus、Fontconfig、XKBなどの共有ライブラリが必要です。

## 関連ツール

- **KCO title fetcher**: YouTube / ニコニコ動画の再生タイトルを取得して送信します。
- **Kancolle Stream Overlay**: 受け取ったBGM名を配信画面上に表示します。
