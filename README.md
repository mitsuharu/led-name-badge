# led-name-badge

LEDネームバッジ 書き換えツール (WebHID)

11×44ドットのUSB LEDネームバッジ（USB ID `0416:5020`, "LS32 Custm HID" 等）を、
Windowsアプリを使わず **ブラウザから** 書き換えるWebアプリです。

秋葉原シゲゾーンさんで販売されている「LEDネームバッジ」（Type-C版）などを想定しています。

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
