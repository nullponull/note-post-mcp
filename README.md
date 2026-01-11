# Note Post MCP

[![GitHub](https://img.shields.io/badge/GitHub-nullponull%2Fnote--post--mcp-blue?logo=github)](https://github.com/nullponull/note-post-mcp)

note.comへの記事投稿を自動化するMCPサーバーです。Markdownファイルからタイトル、本文、タグ、価格設定を読み取り、Playwrightを使用してnote.comに投稿します。

> **⚠️ 免責事項**: 本ツールは自己責任でご利用ください。note.comの利用規約やサービス変更により、予告なく動作しなくなる可能性があります。詳細は「[利用規約に関する注意事項](#利用規約に関する注意事項)」をご確認ください。

## 主な機能

- **MCP経由での単体投稿** - Claude等のAIアシスタントから直接記事を投稿
- **バッチ投稿スクリプト** - 複数の記事を連続して自動投稿
- **有料記事対応** - 価格設定と有料ラインの位置指定（`<!-- paid -->`）
- **画像対応** - サムネイル画像と本文中の画像挿入
- **下書き保存** - 公開せずに下書きとして保存
- **タグ設定** - Front Matterで指定したタグを自動入力

## クイックスタート

```bash
# 1. Playwrightブラウザをインストール
npx playwright install chromium

# 2. ログインして認証状態を取得
npx note-post-mcp-login

# 3. Claude Desktopの設定ファイルに追加（後述）
```

## インストール

### 必要要件
- Node.js 18+
- note.comアカウント
- 認証状態ファイル `note-state.json`（後述の手順で取得）

### npmからインストール（推奨）

```bash
npm install -g @gonuts555/note-post-mcp
```

### GitHubからインストール

```bash
git clone https://github.com/nullponull/note-post-mcp.git
cd note-post-mcp
npm install
npm run build
```

### Playwrightブラウザのインストール

**重要**: Playwrightはブラウザを別途インストールする必要があります。

```bash
# GitHubからクローンした場合
npm run install-browser

# または直接実行
npx playwright install chromium
```

> **注意**: `npx note-post-mcp` でMCPサーバーとして使用する場合も、事前に上記コマンドでChromiumをインストールしてください。Playwrightのブラウザはシステムグローバルにインストールされるため、一度インストールすれば再インストールは不要です。

### 認証状態ファイルの取得

note.comの認証状態を取得するには、ログインスクリプトを実行します。

#### GitHubからクローンした場合

```bash
npm run login
```

#### npmでグローバルインストールした場合

```bash
# ログインスクリプトを実行
npx note-post-mcp-login
```

> **注意**: 事前に `npx playwright install chromium` でブラウザをインストールしてください。

#### 保存場所

ブラウザが開くので、note.comにログインしてからターミナルでEnterを押してください。認証状態は以下に保存されます：

| OS | パス |
|----|------|
| macOS/Linux | `~/.note-state.json` |
| Windows | `%USERPROFILE%\.note-state.json` |

環境変数 `NOTE_POST_MCP_STATE_PATH` で保存先を変更できます。

## MCPサーバーとして使用

### Claude Code (CLI)

```bash
claude mcp add note-post-mcp -s user -e NOTE_POST_MCP_STATE_PATH="/path/to/note-state.json" -- npx note-post-mcp
```

### Cursor

`.cursor/mcp.json`を作成：

```json
{
  "mcpServers": {
    "note-post-mcp": {
      "command": "npx",
      "args": ["note-post-mcp"],
      "env": {
        "NOTE_POST_MCP_STATE_PATH": "/path/to/note-state.json"
      },
      "autoStart": true
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json`に追加：

```json
{
  "mcpServers": {
    "note-post-mcp": {
      "command": "npx",
      "args": ["note-post-mcp"],
      "env": {
        "NOTE_POST_MCP_STATE_PATH": "/path/to/note-state.json"
      }
    }
  }
}
```

## MCPツール

### publish_note

Markdownファイルからnote.comに記事を公開します。

**パラメータ:**
- `markdown_path` (string, 必須): Markdownファイルのパス
- `thumbnail_path` (string, 任意): サムネイル画像のパス
- `state_path` (string, 任意): 認証状態ファイルのパス
- `price` (number, 任意): 有料記事の価格（100〜50000円）
- `post_to_twitter` (boolean, 任意): Twitter(X)に投稿するか
- `magazine` (string, 任意): 追加するマガジン名
- `timeout` (number, 任意): タイムアウト（ミリ秒）

### save_draft

Markdownファイルから下書きを保存します。

**パラメータ:**
- `markdown_path` (string, 必須): Markdownファイルのパス
- `thumbnail_path` (string, 任意): サムネイル画像のパス
- `state_path` (string, 任意): 認証状態ファイルのパス
- `timeout` (number, 任意): タイムアウト（ミリ秒）

## Markdownファイル形式

テンプレートファイルは [`templates/`](./templates/) ディレクトリにあります。

### 基本形式（無料記事）

```markdown
---
title: 記事タイトル
tags:
  - タグ1
  - タグ2
---

本文をここに書きます。

![画像の説明](./images/sample.png)

画像も挿入できます。
```

### 有料記事

```markdown
---
title: 有料記事タイトル
price: 300
tags: [AI, 機械学習, 論文解説]
---

ここは無料部分です。

![無料部分の画像](./images/preview.png)

<!-- paid -->

ここから有料部分です。

![有料部分の画像](./images/main.png)
```

### 画像の挿入

本文中に画像を挿入するには、Markdown形式で記述します：

```markdown
![代替テキスト](./相対パス/画像.png)
```

**対応フォーマット:** PNG, JPEG, GIF, WebP

**注意事項:**
- 画像パスはMarkdownファイルからの**相対パス**で指定
- URLの画像（`http://`、`https://`）はそのまま表示されます
- ローカル画像は自動的にnote.comにアップロードされます

### ディレクトリ構成例

```
my-article/
├── article.md          # 記事ファイル
├── images/
│   ├── thumbnail.png   # サムネイル画像
│   ├── image1.png      # 本文中の画像
│   └── image2.jpg
```

### Front Matterオプション

| オプション | 型 | 説明 |
|-----------|-----|------|
| `title` | string | 記事タイトル |
| `price` | number | 価格（100〜50000円）。設定すると有料記事 |
| `tags` | array | タグ（`- tag` 形式または `[tag1, tag2]` 形式） |
| `twitter` | boolean | Twitter(X)に投稿するか |
| `magazine` | string | 追加するマガジン名 |
| `membership` | boolean | メンバーシップ限定にするか |

## バッチ投稿スクリプト

複数の記事を連続して投稿するためのスクリプトです。

### 使い方

```bash
# 環境変数で設定
export NOTE_POST_MCP_STATE_PATH="~/.note-state.json"
export NOTE_ARTICLES_DIR="/path/to/articles"
export NOTE_LOG_FILE="./publish_log.txt"

node batch-publish.cjs [開始番号] [終了番号] [デフォルト価格]
```

**例:**
```bash
# 記事0〜10を300円で投稿
node batch-publish.cjs 0 10 300

# 記事20〜30を500円で投稿
node batch-publish.cjs 20 30 500
```

### バッチスクリプトの環境変数

| 環境変数 | 説明 | デフォルト |
|----------|------|-----------|
| `NOTE_POST_MCP_STATE_PATH` | 認証状態ファイルのパス | `~/.note-state.json` |
| `NOTE_ARTICLES_DIR` | 記事ディレクトリ | `./articles` |
| `NOTE_LOG_FILE` | ログファイル | `./publish_log.txt` |

### 記事ファイルの命名規則

バッチスクリプトは以下の形式のファイル名を想定しています：

```
0_ファイル名.md
1_ファイル名.md
2_ファイル名.md
...
```

ファイル名の先頭の数字でソート・処理されます。

### 記事ディレクトリ構成

バッチスクリプトは以下のディレクトリ構成に対応しています：

```
articles/
├── 01_記事タイトル/
│   ├── article.md          # 記事ファイル
│   └── images/
│       ├── thumbnail.png   # サムネイル画像（自動検出）
│       ├── 01.png          # 本文中の画像（番号順に挿入）
│       └── 02.png
├── 02_別の記事/
│   ├── article.md
│   └── images/
│       └── thumbnail.jpg
└── ...
```

**フラット構成**も対応：
```
articles/
├── 01_記事.md
├── 02_記事.md
└── ...
```

### 画像の自動アップロード

バッチスクリプトは画像を自動的に検出・アップロードします：

| 画像タイプ | ファイル名 | 処理 |
|-----------|-----------|------|
| サムネイル | `thumbnail.png/jpg/gif/webp` | 公開設定画面でアップロード |
| 本文画像 | `01.png`, `02.png`等 | エディタで番号順に挿入 |

**画像検出パス**（優先順）：
1. `{markdownファイルのディレクトリ}/images/`
2. `{記事ディレクトリ}/images/`
3. `{親ディレクトリ}/note/{記事名}/images/`

### バッチ投稿の流れ

1. タイトルと本文を入力
2. **本文中の画像をアップロード**（images/内の番号付き画像）
3. 「公開に進む」をクリック
4. タグを入力
5. **サムネイル画像をアップロード**（thumbnail.*）
6. 「有料」ラベルをクリック
7. 価格を入力
8. 「有料エリア設定」をクリック
9. **「このラインより先を有料にする」をクリック**（有料ラインの設定）
10. 「投稿する」をクリック
11. 確認モーダルのOKをクリック

## 有料ラインの位置指定

### 概要

`<!-- paid -->` コメントを本文中に挿入することで、有料部分の開始位置を**正確に**指定できます。

### 使い方

```markdown
---
title: 有料記事のサンプル
price: 300
tags: [AI, 機械学習]
---

# 記事タイトル

この部分は無料で読めます。

導入部分や概要をここに書きます。

<!-- paid -->

ここから有料部分です。

詳細な解説や本編をここに書きます。
```

### 動作の仕組み（検索テキスト方式）

1. `<!-- paid -->` コメントの**直前の段落テキスト**を検索キーとして記録
2. 「有料エリア設定」画面で、note.com上の段落から検索テキストを含む段落を特定
3. 対応する「ラインをこの場所に変更」ボタンをクリックして正確な位置に設定

この方式により、画像や特殊要素があっても正確な位置に有料ラインを設定できます。

### 注意事項

- `<!-- paid -->` がない場合は、記事の**先頭**に有料ラインが設定されます（記事全体が有料）
- `<!-- paid -->` の直前には**5文字以上のテキスト**を含む段落を置くことを推奨
- `<!-- paid -->` マーカー自体は本文に含まれません（自動的に除去されます）
- 検索テキストが見つからない場合は、段落インデックスにフォールバックします

### 実装で使用するセレクター

| 機能 | セレクター |
|------|-----------|
| 有料ライン移動 | `button:has-text("ラインをこの場所に変更")` |

## 既知の制限事項

### 有料ラインの設定について

有料記事を投稿する際、note.comの「有料エリア設定」画面で有料ライン（境界線）を設定する必要があります。

- 「このラインより先を有料にする」ボタンをクリックして境界を設定
- これをスキップすると「投稿する」ボタンが機能しません

### 確認モーダル

「投稿する」ボタンをクリックした後、確認モーダルが表示されます。

- モーダルは`[role="dialog"]`要素として表示される
- 「OK」ボタンをクリックして投稿を完了
- モーダルが表示されるまで最大5秒待機

### レート制限

連続投稿時にnote.comのレート制限に引っかかる可能性があります。

#### 実測データ（2026-01）

| 項目 | 値 |
|------|-----|
| 安全な連続投稿数 | **30記事以下** |
| 推奨待機時間 | 記事間30秒 |
| 1記事あたり所要時間 | 約43秒（待機含む） |
| 30記事の所要時間 | 約22分 |

#### 症状

31記事目以降で以下の症状が発生：
- 「確認モーダルが見つかりませんでした」警告
- URLが `/publish/` のままで `landing` ページに遷移しない
- 記事が下書き状態になる

#### 推奨設定

```javascript
// 記事間の待機時間（30秒推奨）
await page.waitForTimeout(30000);

// 確認モーダルの待機（最大15秒）
for (let attempt = 0; attempt < 30; attempt++) { // 30 × 500ms
  await page.waitForTimeout(500);
  // モーダル検出処理
}
```

#### 対策

1. **バッチサイズ**: 30記事以下で一旦停止
2. **バッチ間休憩**: 5〜10分の休憩を挟む
3. **記事間待機**: 30秒以上（現在のスクリプトは対応済み）

#### note.com公式の制限情報（参考）

note.comは投稿数制限を**非公開**としています。以下は他のアクションの制限：

| アクション | 1日の上限 | 1時間の上限 |
|-----------|----------|------------|
| スキ | 200回 | 49回 |
| フォロー | 100人 | 15人 |
| コメント | 不明 | 短時間で一定数以上でロック |

**注意**: note.comは[自動投稿を推奨していません](https://note.com/akawibaku137/n/nc154955d0220)。サーバーに負荷をかけないよう節度ある利用を心がけてください。

### 下書きになってしまう場合

投稿が下書きになる主な原因：

1. **確認モーダルをクリックできていない** - モーダルの表示待機時間を増やす
2. **有料ラインが設定されていない** - 「このラインより先を有料にする」をクリック
3. **セッション切れ** - `npm run login`で再認証

## 環境変数

- `NOTE_POST_MCP_STATE_PATH`: 認証状態ファイルのパス（デフォルト: `~/.note-state.json`）
- `NOTE_POST_MCP_TIMEOUT`: タイムアウト（ミリ秒、デフォルト: `180000`）

## ディレクトリ構造

```
note-post-mcp/
├── src/
│   └── index.ts           # MCPサーバーのメインコード
├── build/                 # ビルド出力（gitignore）
├── scripts/
│   └── login.mjs          # ログインスクリプト
├── templates/
│   ├── article-template.md      # 有料記事テンプレート
│   ├── free-article-template.md # 無料記事テンプレート
│   └── batch-article-template.md # バッチ投稿用テンプレート
├── batch-publish.cjs      # バッチ投稿スクリプト
├── package.json
├── tsconfig.json
└── README.md
```

## トラブルシューティング

### 認証エラー

```bash
npm run login
```
で認証状態ファイルを再生成してください。

### ブラウザが起動しない / Playwrightブラウザがインストールされていない

Playwrightはブラウザを別途ダウンロードする必要があります。

```bash
# Chromiumをインストール
npx playwright install chromium

# システム依存関係もインストールする場合（Linux）
npx playwright install-deps chromium
```

**エラー例:**
```
Executable doesn't exist at /home/user/.cache/ms-playwright/chromium-xxx/chrome-linux/chrome
```

**解決方法:**
1. 上記コマンドでChromiumをインストール
2. Claude Desktopを再起動

> **macOS/Windows**: 通常は `npx playwright install chromium` だけで動作します。
> **Linux**: システムライブラリが不足している場合は `npx playwright install-deps chromium` も実行してください。

### タイムアウトエラー

`NOTE_POST_MCP_TIMEOUT`を増やすか、`timeout`パラメータを指定してください。

### 投稿が下書きになる

1. ログを確認して「確認モーダルをクリック」が出ているか確認
2. 有料記事の場合、「有料ラインを設定」が出ているか確認
3. セッションが切れていないか確認

### ページ読み込みエラー（2026-01以降）

note.comのUI変更により、ページ読み込みが遅くなる場合があります。

**症状:**
- `textarea[placeholder*="タイトル"]`が見つからない
- 「投稿する」ボタンが見つからない

**対処法:**
`batch-publish.cjs`は以下の対策済みです：
- `waitUntil: 'networkidle'` → `'domcontentloaded'` に変更
- ページ遷移後に5秒の追加待機
- セレクターを汎用的なもの（`textarea`）に変更

## 開発

### ビルド

```bash
npm run build
```

### ローカルテスト

```bash
npx note-post-mcp
```

## 利用規約に関する注意事項

### 免責事項

本ツールは**自己責任**でご利用ください。以下の点にご注意ください：

- note.comは公式の投稿APIを提供しておらず、本ツールはブラウザ自動化による非公式な方法を使用しています
- note.comの利用規約やUI変更により、予告なく動作しなくなる可能性があります
- 本ツールの使用によって生じたいかなる損害（アカウント停止等を含む）についても、開発者は責任を負いません

### note.comの利用規約について

2026年1月時点の調査結果：

| 項目 | 状況 |
|------|------|
| 公式API | 未提供（将来の公開予定も未定） |
| 自動投稿の明示的禁止 | 利用規約に直接的な禁止条項なし |
| スクレイピングの禁止 | 明確な記載なし（robots.txtでは記事ページへの制限なし） |
| スパム行為 | **明確に禁止**（自動スキ、自動フォロー、自動コメント等） |

### 禁止されている行為

以下の行為は**明確に禁止**されています：

- 自動スキ、自動フォロー、自動コメント（スパム行為）
- 短時間での大量リクエスト（サーバー負荷）
- 他者への迷惑行為

### 推奨される使い方

- **自分の記事の投稿補助**として使用する
- 適切な間隔を空けて投稿する（記事間30秒以上推奨）
- 1日の投稿数は節度ある範囲に抑える
- スパム目的や大量投稿には使用しない

### 参考リンク

- [note ご利用規約](https://terms.help-note.com/hc/ja/articles/44943817565465-note-ご利用規約)
- [「noteへの自動アップロード」は可能か？](https://note.com/kawayasblog/n/n2fa8bfee9e3d)

## ライセンス

MIT

## 謝辞

- [MCP SDK](https://modelcontextprotocol.io/) - Model Context Protocol
- [Playwright](https://playwright.dev/) - ブラウザ自動化
