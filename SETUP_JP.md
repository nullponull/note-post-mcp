# セットアップガイド（日本語）

[![GitHub](https://img.shields.io/badge/GitHub-Go--555%2Fnote--post--mcp-blue?logo=github)](https://github.com/Go-555/note-post-mcp)

note.com 自動投稿 MCP サーバーのセットアップ方法を説明します。

## 前提条件

- Node.js 18 以上
- note.com のアカウント
- Playwright（自動インストールされます）

## インストール手順

### 1. リポジトリのクローンとビルド

```bash
git clone https://github.com/Go-555/note-post-mcp.git
cd note-post-mcp
npm install
npm run build
```

### 2. Playwright ブラウザのインストール

```bash
npx playwright install chromium
```

### 3. note.com 認証状態ファイルの作成

note.com にログインした状態を保存する `note-state.json` ファイルが必要です。

以下のスクリプトを作成して実行してください：

```javascript
// login-note.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'ja-JP' });
  const page = await context.newPage();

  console.log('note.com のログインページを開きます...');
  await page.goto('https://note.com/login');

  console.log('手動でログインしてください。ログイン完了後、Enterキーを押してください...');
  
  // ユーザーがログインするまで待機
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  // 認証状態を保存
  const statePath = path.join(process.env.HOME, '.note-state.json');
  await context.storageState({ path: statePath });

  console.log(`認証状態を保存しました: ${statePath}`);
  
  await browser.close();
})();
```

実行方法：

```bash
node login-note.js
# ブラウザが開くので、note.com にログインしてください
# ログイン完了後、ターミナルで Enter キーを押してください
```

これで `~/.note-state.json` ファイルが作成されます。

### 4. 環境変数の設定（オプション）

デフォルトでは `~/.note-state.json` が使用されますが、別の場所に保存した場合は環境変数で指定できます：

```bash
export NOTE_POST_MCP_STATE_PATH="/path/to/your/note-state.json"
```

## MCP クライアントの設定

### Claude Desktop の場合

`~/Library/Application Support/Claude/claude_desktop_config.json` を編集：

```json
{
  "mcpServers": {
    "note-post-mcp": {
      "command": "npx",
      "args": ["note-post-mcp"],
      "env": {
        "NOTE_POST_MCP_STATE_PATH": "/Users/yourusername/.note-state.json"
      }
    }
  }
}
```

### Cursor の場合

プロジェクトルートまたはホームディレクトリに `.cursor/mcp.json` を作成：

```json
{
  "mcpServers": {
    "note-post-mcp": {
      "command": "npx",
      "args": ["note-post-mcp"],
      "env": {
        "NOTE_POST_MCP_STATE_PATH": "/Users/yourusername/.note-state.json"
      },
      "autoStart": true
    }
  }
}
```

## 使い方

### 1. Markdownファイルを準備

```markdown
---
title: 記事のタイトル
tags:
  - タグ1
  - タグ2
---

記事の本文をここに書きます。

## 見出し

内容...
```

### 2. MCP クライアントからツールを呼び出す

**記事を公開する場合：**

```
publish_note ツールを使って example.md を note.com に公開してください
```

**下書きとして保存する場合：**

```
save_draft ツールを使って example.md を note.com に下書き保存してください
```

## トラブルシューティング

### ブラウザが見つからない

```bash
npx playwright install chromium
```

### 認証エラーが出る

`note-state.json` ファイルが古くなっている可能性があります。再度ログインスクリプトを実行してください。

### タイムアウトエラー

ネットワークが遅い場合は、タイムアウトを増やしてください：

```bash
export NOTE_POST_MCP_TIMEOUT=300000  # 5分
```

### 画像がアップロードされない

- 画像ファイルのパスが正しいか確認
- 画像ファイルが存在するか確認
- 画像形式が対応しているか確認（PNG, JPEG, GIF など）

## 高度な使い方

### カスタムスクリーンショットディレクトリ

```json
{
  "name": "publish_note",
  "arguments": {
    "markdown_path": "/path/to/article.md",
    "screenshot_dir": "/path/to/screenshots"
  }
}
```

### サムネイル画像付きで投稿

```json
{
  "name": "publish_note",
  "arguments": {
    "markdown_path": "/path/to/article.md",
    "thumbnail_path": "/path/to/thumbnail.png"
  }
}
```

## セキュリティに関する注意

- `note-state.json` ファイルには認証情報が含まれています
- このファイルを他人と共有しないでください
- `.gitignore` に `note-state.json` を追加してください（既に含まれています）

