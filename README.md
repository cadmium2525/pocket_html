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

**この端末に保存**がオンの場合、最近開いた 5 件をブラウザー内に保存します。履歴からファイルを選べば、もう一度「ファイル」アプリから選び直さずに開けます。履歴の削除ボタンで保存したファイルを取り除けます。保存をオフにしても、選んだファイルはその場で開けます。

ゲームの `localStorage` と `sessionStorage` は、Viewer 側の互換機能で扱います。`localStorage` の内容は選択したファイル群の内容とパスをもとに分けて保存し、`sessionStorage` はタブ内で保持します。同じ ZIP 内のページは保存領域を共有します。IndexedDB や Cookie の互換機能はありません。ブラウザーのデータ削除、プライベートブラウズ、保存容量の制限などにより、履歴やセーブデータが消える場合があります。

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

プレビューは JavaScript の実行を許可した iframe のサンドボックスで動きます。Viewer 自体と選択したページを分離するため、通常の Web サイトとすべて同じ条件にはなりません。

- タッチ、Canvas、WebGL、タイマー、一般的な JavaScript、操作後の Web Audio を使うゲームを想定しています。
- 外部サイトの埋め込みや API 呼び出しは、配信元の CSP・CORS などに従います。
- IndexedDB、Cookie、Service Worker、SharedArrayBuffer を前提とするアプリは対象外です。
- ZIP 内の JavaScript は通常の `script`、ローカル ES Modules、文字列を指定した動的 `import()`、ローカル import map に対応します。モジュールには import map 対応ブラウザーが必要です（Safari / iOS 16.4 以降を推奨）。計算されたパスでの `import()`、Worker 内の相対パス、ビルド前のソースコードは動作しない場合があります。ビルド済みファイルや 1 ファイル版を使ってください。
- PHP、Node.js などサーバー処理が必要なアプリは実行できません。
- iPhone ではページ内の表示領域を広げる方式を使います。PC は利用可能ならネイティブ全画面 API を使います。どちらも Viewer の操作はゲームに重ねず、上部の細いバーに置きます。画面の向き固定や Pointer Lock などの対応はブラウザーによって異なります。iPhone の Safari のアドレスバーなどは残る場合があります。
- 大きい ZIP や高負荷のゲームは、iPhone のメモリーや WebGL の上限に達する場合があります。

Viewer は選んだファイルをサーバーにアップロードしません。ただし、開いた HTML 自体の JavaScript が外部へ通信することはできます。信頼できるファイルを開いてください。

実機 iPhone での動作確認は未実施です。公開後は、利用する iPhone の Safari で、ファイル選択・ゲーム操作・音声・画面の回転を確認してください。

デスクトップブラウザーでは、実際のファイル選択、保存後の再読み込み、ZIP の CSS・画像・JavaScript・モジュール・JSON、WebGL テクスチャ、ページ切替、390×844 / 844×390 の表示を確認しました。自動テストは7件通過しています。検証の再現方法は [tests/QA.md](tests/QA.md) に記載しています。

## 構成

- `index.html`: Viewer の画面
- `js/`: HTML の実行、ZIP の読み込みなど
- `examples/orbit-catch.html`: 外部依存のないタッチゲーム
- `.github/workflows/pages.yml`: GitHub Pages への公開用ワークフロー
- `THIRD_PARTY_LICENSES.txt`: 同梱ライブラリーのライセンス
