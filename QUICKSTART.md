# クイックスタートガイド

[![GitHub](https://img.shields.io/badge/GitHub-Go--555%2Fnote--post--mcp-blue?logo=github)](https://github.com/Go-555/note-post-mcp)

note.com への記事投稿を自動化する MCP サーバーのセットアップ方法を説明します。

## 5ステップでスタート

### 1. インストール

```bash
git clone https://github.com/Go-555/note-post-mcp.git
cd note-post-mcp
npm install
npm run build
```

### 2. Playwrightブラウザをインストール

```bash
npm run install-browser
```

### 3. note.comにログイン

```bash
npm run login
```

ブラウザが開くので、note.comにログインして、ターミナルでEnterキーを押してください。
これで `~/.note-state.json` ファイルが作成されます。

### 4. MCPクライアントを設定

**Cursor の場合：**

`.cursor/mcp.json` を作成：

```json
{
  "mcpServers": {
    "note-post-mcp": {
      "command": "npx",
      "args": ["@gonuts555/note-post-mcp@latest"],
      "env": {
        "NOTE_POST_MCP_STATE_PATH": "/Users/yourusername/.note-state.json"
      },
      "autoStart": true
    }
  }
}
```

**Claude Desktop の場合：**

`~/Library/Application Support/Claude/claude_desktop_config.json` を編集：

```json
{
  "mcpServers": {
    "note-post-mcp": {
      "command": "npx",
      "args": ["@gonuts555/note-post-mcp@latest"],
      "env": {
        "NOTE_POST_MCP_STATE_PATH": "/Users/yourusername/.note-state.json"
      }
    }
  }
}
```

### 5. 記事を投稿

Markdownファイルを作成：
example.mdをベースに執筆作業を行うことをおすすめします。

```markdown
---
title: 初めての投稿
tags:
  - テスト
---

これは MCP を使った初めての投稿です！
```

MCP クライアントで：

```
example.md を note に下書き投稿をしてください。sample-thumbnail.pngはサムネイルでお願いします。
```

## よくある質問

### Q: 投稿方法は？

A: 投稿方法は2つあります。

1. `save_draft` ツールを使って記事を下書き保存する方法。
2. `publish_note` ツールを使って記事を公開する方法。

### Q: 認証エラーが出る

A: セッションが期限切れの可能性があります。再度ログインしてください：

```bash
npm run login
```

### Q: どんなMarkdown形式に対応していますか？

A: 以下の形式に対応しています：

**Front Matter形式（推奨）：**

```markdown
---
title: タイトル
tags:
  - tag1
  - tag2
---

本文

### Q: 本文処理で注意すべき点はありますか？

A: 以下の点に注意してください：

**Front Matter形式の場合：**
- Front Matterの `---` 終了後のすべての行が本文として扱われます
- 本文の末尾の空白行は自動的に削除されます

**見出し形式の場合：**
- `## ` や `### ` は本文の見出しとして扱われます

**コードブロック：**
- 必ず閉じタグ（```）が必要です
- 閉じ忘れると、残りの全行がコードブロックとして扱われます
- 言語指定も保持されます

**画像の挿入：**
- 画像パスはMarkdownファイルからの相対パスで指定してください
- 例: `![画像説明](./images/sample.png)`
- PNG、JPEG、GIF形式に対応しています
- ローカル画像ファイルは自動的にアップロードされます

**リストと引用：**
- リスト（`-` や `1.`）は2行目以降、マークダウン記号が自動的に処理されます
- 引用（`>`）も同様に自動処理されます
- noteの自動継続機能を活用しています

**水平線：**
- 本文中の `---` は水平線として正しく処理されます
- 水平線の直後の空行は自動的にスキップされます

**URL単独行：**
- URL単独行はnoteのリンクカードとして自動展開されます
- YouTube等の埋め込みも自動処理されます

### その他の確認事項

問題が発生した場合は、以下を確認してください：

1. Node.js のバージョン（18以上）
2. Playwright ブラウザのインストール状況
3. note-state.json の存在と有効性
4. ネットワーク接続

## セキュリティに関する注意

- `note-state.json` ファイルには認証情報が含まれています
- このファイルを他人と共有しないでください
- `.gitignore` に `note-state.json` を追加してください（既に含まれています）

## 参考資料

- 英語ドキュメント: [README.md](README.md)
- サンプル記事: [example.md](example.md)

