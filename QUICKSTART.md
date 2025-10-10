# クイックスタートガイド

[![GitHub](https://img.shields.io/badge/GitHub-Go--555%2Fnote--post--mcp-blue?logo=github)](https://github.com/Go-555/note-post-mcp)

note.com 自動投稿 MCP サーバーを素早く始めるための手順です。

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

### 4. MCPクライアントを設定

**Cursor の場合：**

`.cursor/mcp.json` を作成：

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

**Claude Desktop の場合：**

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

### 5. 記事を投稿

Markdownファイルを作成：

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
publish_note ツールを使って article.md を note.com に公開してください
```

## よくある質問

### Q: 下書きとして保存したい

A: `save_draft` ツールを使用してください：

```
save_draft ツールを使って article.md を下書き保存してください
```

### Q: サムネイル画像を追加したい

A: `thumbnail_path` パラメータを指定してください：

```json
{
  "name": "publish_note",
  "arguments": {
    "markdown_path": "/path/to/article.md",
    "thumbnail_path": "/path/to/image.png"
  }
}
```

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
```

**見出し形式：**

```markdown
# タイトル

本文
```

## 次のステップ

- 詳細なセットアップ: [SETUP_JP.md](SETUP_JP.md)
- 英語ドキュメント: [README.md](README.md)
- サンプル記事: [example.md](example.md)

## トラブルシューティング

問題が発生した場合は、以下を確認してください：

1. Node.js のバージョン（18以上）
2. Playwright ブラウザのインストール状況
3. note-state.json の存在と有効性
4. ネットワーク接続

詳細は [SETUP_JP.md](SETUP_JP.md) のトラブルシューティングセクションを参照してください。

