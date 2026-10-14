# 動作確認

2026-10-14、Windows の Codex In-app Browser（Chromium）で確認。
390×844 と 844×390 はビューポートサイズの検証であり、iPhone 実機や Safari の検証ではありません。

## 自動チェック

```sh
npm run check
npm test
```

7件のテストでZIP展開、パス、サイズ・CRC・暗号化の拒否、モジュールのURL変換、文字コードを確認します。

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

`tests/artifacts/` は生成ファイルでGitの管理・Pagesの配信には含めません。
