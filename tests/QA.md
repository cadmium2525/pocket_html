# 動作確認

2026-10-14、Windows の Codex In-app Browser（Chromium）で確認。
390×844 と 844×390 はビューポートサイズの検証であり、iPhone 実機や Safari の検証ではありません。

## 自動チェック

```sh
npm run check
npm test
```

19件のテストでZIP展開、通常／大容量の上限、パス、CRC・暗号化の拒否、モジュールのURL変換、文字コード、HTTP配信のパス・Rangeを確認します。

## ブラウザー確認の再現

```sh
node scripts/make-test-fixture.mjs
npm run dev
```

1. `http://localhost:43186` で `tests/fixtures/standalone.html` を選択します。Isolation / Canvas が PASS になることを確認します。
2. 「セーブを増やす」後、Viewerの再読み込みで Saved / Session が保持されることを確認します。
3. 「実行エラーを発生」から Viewer の表示情報にエラーが出ることを確認します。
4. ホームへ戻り、ブラウザーを再読み込みしても履歴が残ることを確認します。
5. `tests/artifacts/bundle.zip` を選択します。Classic script / Static module / Directory import alias / Dynamic module / fetch JSON / Relative fetch / XHR JSON / Dynamic image / WebGL texture の9項目が PASS になることを確認します。
6. 「次のページ」と「ZIP内のHTMLを選ぶ」の両方でページを切り替えます。
7. サンプルゲームを開き、開始・終了画面でも音声ボタンが切り替わることを確認します。
8. 縦・横の表示サイズ、Canvas描画、画面いっぱい表示と復帰、ゲームにViewerのボタンが重ならないことを確認します。

上記の手動確認は通過済みです。OSのファイル選択画面、Safariの音声出力、iPhoneのノッチとホーム画面起動は実機で確認してください。

## 大容量モード

```sh
node scripts/make-large-fixture.mjs
```

33 MiBの素材を含む `large-compressed.zip`（約35KB）と `large-stored.zip`（約33MB）を生成します。

1. 通常設定で `large-compressed.zip` を開くと、展開後32MB超過と大容量モードの案内を表示します。
2. 大容量モードをオンにし `large-stored.zip` を開きます。プレイヤー上部に「大容量」が表示されます。
3. 「タップしてスコアを増やす」で SCORE が増え、Canvasの四角が伸びます。「33 MiBファイルを確認」で `PAYLOAD PASS: 33 MiB` を確認します。
4. 「次のページ」を開き、`PAGE TWO PASS` と「大容量」の表示を確認します。
5. ホームへ戻り、33.0MBの履歴があることを確認します。大容量モードをオフにしてブラウザーを再読み込みし、その履歴を開きます。大容量設定と最後のページを引き継いで開けます。
6. 同じファイルをHTTPモードへ切り替え、素材確認・ページ移動・Viewerの再読み込みを行います。「大容量 · HTTP」の表示と素材読み取りが維持されます。
7. 通常表示へ戻しても大容量設定が維持されます。320px／390px幅でホームの容量設定とプレイヤー操作を確認します。

2026-10-14、上記の読み込み・保存・素材確認・HTTP切り替えをChromiumで確認。128MB上限と600ファイル制限は自動テストで確認しています。128MB近くの実ゲームをiPhone実機で動かす試験は未実施です。

`tests/artifacts/` は生成ファイルでGitの管理・Pagesの配信には含めません。
