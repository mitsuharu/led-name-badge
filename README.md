# led-name-badge

[Shigezone（シゲゾーン）](https://www.shigezone.com/)で販売している [LEDネームバッジ](https://www.shigezone.com/p/p916/) を、ブラウザから書き換える Web アプリです。

**▶ https://mitsuharu.github.io/led-name-badge/**

## 対象の機種

秋葉原・東京ラジオデパート 1 階の Shigezone で販売している、電光掲示板風のピンバッジです。好きな文字列を LED でスクロール表示でき、イベントの名札や告知に使えます。

| 項目 | 内容 |
| --- | --- |
| 商品名 | [LEDネームバッジ](https://www.shigezone.com/p/p916/)（商品コード p916） |
| 表示 | 縦 11 × 横 44 ドットの LED（漢字は 1 画面に最大 4 文字。英数字・カタカナ・記号も表示可） |
| 色 | 赤・青・黄・緑・白・橙・ピンク |
| 端子・電源 | USB Type-C（Type-C〜Type-C ケーブルでも充電・データ転送可）、充電式で約 6〜8 時間 |
| 固定 | 背面の安全ピン |
| USB ID | `0416:5020`（"LS32 Custm HID" などと表示される USB HID デバイス） |

公式の書き換え手段は Windows 10/11 用のアプリだけです（[ショップの案内](https://www.shigezone.com/p/p916/)）。

同じ USB ID の 11×44 ドットのバッジは同じ方式で書き換えられることが多いため、ほかの店で売られている同型のバッジでも動く可能性があります（未確認）。

## この Web アプリについて

Windows アプリの代わりに、ブラウザの [WebHID](https://developer.mozilla.org/ja/docs/Web/API/WebHID_API) でバッジへ直接書き込みます。

- **インストール不要**: URL を開くだけで使えます。Mac や Chromebook からも書き換えられます。
- **外部に送信しない**: 入力した文字や設定はブラウザ（localStorage）にだけ保存し、サーバーには送りません。
- **非公式**: Shigezone やバッジのメーカーとは関係のない個人のツールです。

## 使い方

1. パソコン版の **Chrome** または **Edge** で https://mitsuharu.github.io/led-name-badge/ を開く
2. バッジをUSBケーブル（データ通信対応のもの）で接続
3. 文字列・表示モード・速度などを設定（ドット編集で1ドット単位の修正も可）
4. 「バッジに書き込む」→ ダイアログでデバイスを選んで「接続」

設定はブラウザ（localStorage）に保存されます。

### バッジ本体の操作

> - **電源ボタン**: 長押しでオンオフ。USB給電時にはオンまたはバッテリ残量表示になる。短く押すことで明度4段階切替
> - **選択ボタン**: 8種類までのメッセージ＆エフェクトを入力でき、このボタンでどれを表示するか選択できる
>
> — [Shigezone の note](https://note.com/shigezoneakiba/n/n8fb7db7d0728) より引用

### 機能

- 最大8メッセージ、表示モード9種（左/右/上/下スクロール、固定、アニメ、降ってくる、カーテン、レーザー）
- 速度1〜8、点滅、枠アニメ、明るさ4段階
- PCのフォントで日本語を11ドットに変換＋ドット編集
- 簡易プレビュー（実機の表示と完全には一致しません）

## 対応環境

| 環境 | 対応 |
| --- | --- |
| Windows / macOS / ChromeOS の Chrome・Edge | ○ |
| Linux の Chrome | ○（下記 udev 設定が必要） |
| Firefox / Safari / iPhone / Android | × （WebHID 非対応） |

### Linux の udev ルール

```
# /etc/udev/rules.d/99-led-badge.rules
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0416", ATTRS{idProduct}=="5020", MODE="0666"
```

`sudo udevadm control --reload-rules` 後にバッジを挿し直してください。

## プロトコル

[jnweiger/led-name-badge-ls32](https://github.com/jnweiger/led-name-badge-ls32) の解析結果に基づきます。

- 64バイトヘッダ: `"wang"` + 明るさ(byte5) + 点滅ビット(byte6) + 枠ビット(byte7)
  + `16*(速度-1)+モード` ×8 (byte8-15) + 各メッセージの列数（ビッグエンディアン2バイト×8, byte16-31）+ 日時(byte38-43)
- 続いてビットマップ: 8ドット幅の列ごとに11バイト（上→下、MSBが左）
- 全体を64バイト境界までゼロ埋めし、64バイトずつHID出力レポートとして送信（最大8192バイト）

## 開発

依存ライブラリもビルド工程もありません。ルールは [AGENTS.md](AGENTS.md) を参照してください。

```sh
node --test                 # プロトコルのテスト
python3 -m http.server 8000 # http://localhost:8000/ で開く（ES Modules のため file:// では動かない）
```

## 注意

非公式ツールです。お使いのバッジの個体・ファームウェアによっては動作しない可能性があります。自己責任でご利用ください。

## License

MIT
