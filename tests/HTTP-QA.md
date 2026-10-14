# HTTP モードの確認

追加パッケージなしで HTTP 配信を必要とする ZIP を用意します。

```sh
node scripts/make-http-fixture.mjs
npm run dev
```

1. `http://localhost:43186` を開きます。
2. **ファイルを選んで開く**から `tests/artifacts/http-bundle.zip` を選び、表示枠の **HTTP** を押します。自作fixtureであることを確認し、**信頼するファイルでHTTPモードを使う** で続行します。
3. `PASS: 13 / 13 checks` が表示され、13 項目がすべて PASS になることを確認します。読み込み後 8 秒を超えて RUN が残る場合や、FAIL がある場合は不合格です。
4. **セーブを増やす**を押し、Viewer の再読み込み後も Saved が増えたままであることを確認します。
5. **次のページ**で `PASS: HTTP page navigation` が表示され、Saved が引き継がれることを確認します。**チェックに戻る**で 13 項目が再び PASS になります。
6. Viewer のページを再読み込みして履歴から同じ ZIP を開き、13 項目が PASS になることを確認します。
7. ブラウザーの開発者ツールで Service Worker を停止してからプレビューを再読み込みし、保存済みマウントを読み出して 13 項目が PASS になることを確認します。Service Worker の登録を削除する操作とは区別してください。
8. **ホームへ戻る**で HTTP モードをオフにし、従来の `tests/artifacts/bundle.zip` とサンプルゲームの動作も確認します。

この ZIP は `dist/` を外側のフォルダーとして含みます。実行ページの階層を仮想 HTTP 配信のルートとして扱い、Vite の通常ビルドにある `/assets/...` が解決できることを確認します。HTML の `<base href="/dist/">` が仮想配信先の `dist/` に正しく対応し、ページ移動が動くことも確認します。含まれるチェックは HTTP URL、ルート指定の静的 ES Modules、計算した相対パスの動的 import、ルート CSS・画像、JSON fetch と query、`import.meta.url` に基づく相対 fetch、XHR、正しい MIME による WASM streaming、classic Worker の相対 `importScripts` と fetch、`/dist/assets/...` からの絶対パス Worker、module Worker の静的・動的 import と fetch、IndexedDB の書き込みと読み出し、存在しないファイルの 404 です。

Module Worker や WASM streaming はブラウザーの対応が必要です。旧 Safari での失敗を Viewer の動作確認済みとして扱わず、対象ブラウザーとバージョンを記録してください。390×844 の画面確認は iPhone 実機確認の代わりになりません。

HTTP モードはブラウザー内の静的配信です。ビルド前の Vite 開発サーバー、PHP・Node.js のバックエンド、WebSocket、SharedArrayBuffer を必要とするゲームの確認用ではありません。テストファイルは自作で外部サービスを利用しません。

## 記録

この手順は再現用です。ブラウザーでの実行結果は別途記録し、未実施の項目を通過済みと表記しないでください。

2026-10-14、WindowsのCodex In-app Browser（Chromium）で13 / 13項目、保存、履歴からの再開、ページ移動後のViewer再読み込み、通常の隔離表示への切り替えを確認済みです。320×740の表示では横方向のはみ出しがありませんでした。Service Workerの強制停止・再起動とiPhone実機は未確認です。配信はメモリー内のMapではなく、各リクエストでIndexedDBから読み出す構成です。
