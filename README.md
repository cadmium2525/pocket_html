# Pocket HTML

iPhone の「ファイル」に保存した HTML を選び、Safari 上で表示・実行する作業用 Viewer です。GitHub Pages に置ける静的サイトで、ビルドやサーバーは必要ありません。JavaScript が動くプレビューで、Canvas や WebGL を使うブラウザゲームも開けます。

[Pocket HTML を開く](https://cadmium2525.github.io/pocket_html/) · [GitHub リポジトリ](https://github.com/cadmium2525/pocket_html)

## iPhone での使い方

1. HTML ファイルを「ファイル」アプリに保存します。「この iPhone 内」「iCloud Drive」「ダウンロード」から選べます。
2. 公開した Pocket HTML を Safari で開き、**ファイルを選んで開く**をタップします。
3. HTML または ZIP を選びます。読み込み後、プレビュー内でゲームの「スタート」などをタップしてください。音声はゲーム内の操作で開始します。
4. プレイするときは、右上の**画面いっぱいに表示**を使うと、ゲームに使える領域が増えます。**戻る**で通常表示に戻ります。

**まずは、遊んでみる。**から、同梱の **ORBIT CATCH** を遊べます。指を左右に動かして光のかけらを集め、赤い隕石を避ける 35 秒のミニゲームです。矢印キーでも操作でき、音声の切り替えと一時停止があります。デモそのものは [examples/orbit-catch.html](examples/orbit-catch.html) の 1 ファイルで完結しています。使い方のダイアログから HTML をダウンロードして、実際のファイル選択も試せます。

プレビュー上部には**再読み込み**、**ZIP内のHTMLを選ぶ**（複数 HTML がある場合）、**表示情報**、**ホームへ戻る**があります。表示情報には実行エラーや互換性の注意点を表示します。

## ファイルとセーブデータの保存

HTTP配信が必要なゲームには、後述のHTTPモードを使えます。通常表示とHTTPモードでは保存領域が異なります。

**この端末に保存**がオンの場合、最近開いた 5 件をブラウザー内に保存します。履歴からファイルを選べば、もう一度「ファイル」アプリから選び直さずに開けます。履歴の削除ボタンで保存したファイルを取り除けます。保存をオフにしても、選んだファイルはその場で開けます。

通常の隔離表示では、ゲームの `localStorage` と `sessionStorage` はViewer側の互換機能で扱います。`localStorage` の内容は選択したファイル群の内容とパスをもとに分けて保存し、`sessionStorage` はタブ内で保持します。同じ ZIP 内のページは保存領域を共有します。この表示方法ではIndexedDBやCookieの互換機能はありません。HTTPモードではブラウザーのネイティブ保存領域を利用します。ブラウザーのデータ削除、プライベートブラウズ、保存容量の制限などにより、履歴やセーブデータが消える場合があります。

## HTTP配信が必要なゲームを開く

`python -m http.server` などで配信して遊ぶゲームや、Viteでビルド済みのサイトには **HTTPモード** を使えます。配信するのはブラウザー内に読み込んだファイルだけで、サーバー契約やアップロードは必要ありません。

1. HTMLと必要な素材を、フォルダー構成を保ってZIPにします。Viteの場合は `npm run build` などで生成した `dist/` の中身を使います。ビルド前のソースや `node_modules` は入れません。
2. **ファイルを選んで開く**でZIPを開き、プレビュー上部の **HTTP** を押します。
3. 確認内容を読み、自作など内容を信頼するファイルで **信頼するファイルでHTTPモードを使う** を選びます。
4. 表示情報の `HTTP` が実行中の目印です。もう一度 **HTTP** を押すと通常の隔離表示に戻ります。

HTTPモードでは通常のHTTP URLと正しいContent-Typeでファイルを配信するため、ネイティブなES Modules、計算したパスの動的import、Worker、WebAssemblyのstreaming読み込み、IndexedDBなどを利用できます。`/assets/...` のようなルート指定は、開いたHTMLのディレクトリーを基準に解決します。HTTPモードにはHTTPSまたはlocalhost、Service Worker、ブラウザー内保存機能が必要です。ファイルはブラウザー内に一時保存され、通常は表示を閉じると削除します。

**HTTPモードは通常の隔離表示と実行条件が異なります。** ファイルのJavaScriptはViewerと同じサイトとして動作し、Viewerの履歴やセーブ領域にアクセスできます。信頼できるファイルだけで使ってください。HTTPモードのネイティブな保存領域は同じサイト内で共有されるため、ゲーム自身が保存キーやDB名を分ける必要があります。

HTTPモードは静的ファイルの配信です。Node.js・PHP・Pythonのサーバー処理、Viteの開発サーバー、WebSocketサーバーや外部APIを新しく起動する機能はありません。SharedArrayBufferを使う複数スレッドや、ゲーム自身のService Workerも別途実行条件が必要です。

HTTPモードは非圧縮のビルド済みファイルを想定しています。配信サーバー側のgzip / Brotli設定を前提にしたエクスポートは、非圧縮版にしてからZIPにしてください。スクリプトによる `location.href = '/別ページ'` やルートURLを使うSPAの再読み込みは、仮想配信の外に出る場合があります。通常の相対リンクは利用できます。

## 追加費用0円の構成

公開リポジトリのGitHub Pagesと標準GitHub-hosted runnerを使い、有料サーバー・有料API・有料プラン・独自ドメインを追加しません。HTTPモードも端末内の処理です。Pages公開用artifactの保持期間は1日に設定しています。

料金の条件は [GitHub Pagesの公式案内](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) と [GitHub Actionsの公式料金案内](https://docs.github.com/en/billing/concepts/product-billing/github-actions) に基づいています。課金枠の購入や無料枠を超えるための設定変更は行いません。

## 開けるファイル

| 形式 | 用途 |
| --- | --- |
| `.html` / `.htm` | CSS・JavaScript・画像などを埋め込んだ 1 ファイルのページやゲーム |
| `.zip` | HTML と、そのページが使う CSS・JavaScript・画像・音声などをまとめたもの |

HTML だけを選んだ場合、iPhone の別ファイルや隣のフォルダーを自動で読み込むことはできません。別のファイルを使うゲームは、フォルダー構造を保った ZIP にまとめてください。

```text
my-game.zip
└── my-game/
    ├── index.html
    ├── style.css
    ├── game.js
    └── assets/
        ├── player.png
        └── sound.mp3
```

HTML 側では `./style.css`、`./game.js`、`./assets/player.png` のような相対パスを使います。複数の HTML が入っている場合は、プレビューするページを選びます。

1 回の読み込みは合計 **32 MB / 600 ファイルまで**です。ZIP は圧縮ファイルと展開後の合計の両方をチェックします。パスワード付き ZIP、分割 ZIP、ZIP64 は対応していません。ZIP 内のファイル名は UTF-8 を推奨します。PC では複数の関連ファイルを一緒に選択する方法も使えます。

CDN など、HTTPS の公開 URL を使うページにはインターネット接続が必要です。配信元の CORS 設定、読み込み制限、認証などにより使えない URL もあります。

## GitHub Pages に公開する

このリポジトリでは、同梱の GitHub Actions を使って `main` の変更を GitHub Pages に公開します。公開URLは `https://cadmium2525.github.io/pocket_html/` です。自分のリポジトリに置く場合は、以下のどちらかの方法を選べます。

### ブランチから公開する

1. GitHub にリポジトリを作り、このフォルダーの内容を `main` ブランチのルートに置きます。`index.html` をサブフォルダーに入れないでください。
2. リポジトリの **Settings → Pages → Build and deployment** を開きます。
3. **Source** を **Deploy from a branch**、**Branch** を **main / (root)** にして保存します。
4. 公開処理が終わると、Pages 設定画面にサイトの URL が表示されます。iPhone の Safari で開きます。

この方法では同梱の `.github/workflows/pages.yml` は不要です。Actions タブでこのワークフローを無効化するか、ファイルを取り除いてください。`.nojekyll` はそのまま残します。[GitHub の公開元設定ガイド](https://docs.github.com/ja/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)に沿った設定です。

### 同梱の GitHub Actions で公開する

1. ファイルを `main` ブランチに置きます。
2. **Settings → Pages → Source** を **GitHub Actions** にします。
3. `main` に push するか、**Actions → Deploy Pocket HTML to Pages → Run workflow** を実行します。

[.github/workflows/pages.yml](.github/workflows/pages.yml) は構文チェックとテストの後、公開用のファイルだけを `dist/` にコピーして配信します。`main` 以外のブランチを使う場合は、ワークフロー内の `branches` を変更してください。構成は [GitHub のカスタムワークフローガイド](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に、`deploy-pages@v5` は [GitHub 公式の静的サイト用テンプレート](https://github.com/actions/starter-workflows/blob/main/pages/static.yml)に沿っています。

## ローカルで確認する

Node.js 20 以上があれば、追加パッケージをインストールせずに起動できます。このフォルダーで実行してください。

```sh
npm run dev
```

ブラウザーで `http://localhost:43186` を開きます。

PowerShell の実行ポリシーで `npm` が実行できない場合は `npm.cmd run dev` を使ってください。追加パッケージのインストールは不要です。

構文チェックと自動テストも実行できます。

```sh
npm run check
npm test
```

`npm run build` は公開に必要なファイルだけを `dist/` にコピーします。サイトの動作にビルド処理は必要なく、ブランチ公開ではルートのファイルをそのまま使えます。

Python など、他の静的 Web サーバーでも配信できます。

```sh
python -m http.server 8080
```

Python の例では `http://localhost:8080` にアクセスしてください。`file://` で直接開くと、デモの読み込みなどがブラウザーの制限で失敗する場合があります。

## 実行環境の制限

通常の隔離表示はJavaScriptの実行を許可したiframeのサンドボックスで動きます。Viewer自体と選択したページを分離するため、通常のWebサイトとすべて同じ条件にはなりません。信頼するファイルで選択するHTTPモードは、通常のWebサイトに近い実行条件を使います。

- タッチ、Canvas、WebGL、タイマー、一般的な JavaScript、操作後の Web Audio を使うゲームを想定しています。
- 外部サイトの埋め込みや API 呼び出しは、配信元の CSP・CORS などに従います。
- 通常表示ではIndexedDBやCookieは利用できません。HTTPモードではネイティブな保存領域を利用できます。ゲーム自身のService WorkerやSharedArrayBufferを前提とするアプリは別途実行条件が必要です。
- 通常表示では通常の `script`、ローカルES Modules、文字列を指定した動的 `import()`、ローカルimport mapに対応します。モジュールにはimport map対応ブラウザーが必要です（Safari / iOS 16.4 以降を推奨）。計算されたパスのimportやWorkerが必要な場合はHTTPモードを使ってください。ビルド前のソースコードは対象外です。
- PHP、Node.js などサーバー処理が必要なアプリは実行できません。
- iPhone ではページ内の表示領域を広げる方式を使います。PC は利用可能ならネイティブ全画面 API を使います。どちらも Viewer の操作はゲームに重ねず、上部の細いバーに置きます。画面の向き固定や Pointer Lock などの対応はブラウザーによって異なります。iPhone の Safari のアドレスバーなどは残る場合があります。
- 大きい ZIP や高負荷のゲームは、iPhone のメモリーや WebGL の上限に達する場合があります。

Viewer は選んだファイルをサーバーにアップロードしません。ただし、開いた HTML 自体の JavaScript が外部へ通信することはできます。信頼できるファイルを開いてください。

実機 iPhone での動作確認は未実施です。公開後は、利用する iPhone の Safari で、ファイル選択・ゲーム操作・音声・画面の回転を確認してください。

デスクトップブラウザーでは、実際のファイル選択、保存後の再読み込み、ZIP の CSS・画像・JavaScript・モジュール・JSON、WebGL テクスチャ、ページ切替、390×844 / 844×390 の表示を確認しました。HTTPモードでは13項目のブラウザー確認、320px幅の操作、ページ移動後の再読み込み、セーブ保持も確認しています。自動テストは14件通過しています。再現方法は [tests/QA.md](tests/QA.md) と [tests/HTTP-QA.md](tests/HTTP-QA.md) に記載しています。

## 構成

- `index.html`: Viewer の画面
- `js/`: HTML の実行、ZIP の読み込みなど
- `http-sw.js`: 端末内のHTTP配信用Service Worker（Viewer本体の外のserve/だけを制御）
- `examples/orbit-catch.html`: 外部依存のないタッチゲーム
- `.github/workflows/pages.yml`: GitHub Pages への公開用ワークフロー
- `THIRD_PARTY_LICENSES.txt`: 同梱ライブラリーのライセンス
