---
title: AIからnote.comに記事を自動投稿できるMCPサーバーを作った
tags:
  - AI
  - 自動化
  - MCP
  - Claude
  - note
twitter: false
---

# AIからnote.comに記事を自動投稿できるMCPサーバーを作った

Claude CodeやClaude Desktopから直接note.comに記事を投稿できるMCPサーバー「note-post-mcp」を開発しました。

## MCPとは？

MCP（Model Context Protocol）は、AIアシスタントが外部ツールやサービスと連携するための標準プロトコルです。これにより、AIが単なる会話だけでなく、実際のタスクを実行できるようになります。

## note-post-mcpでできること

このツールを使うと、以下のことが可能になります：

- **Markdownファイルから直接投稿**: Front Matterでタイトル、タグ、価格を指定
- **有料記事の作成**: 価格設定と有料ラインの位置指定に対応
- **画像の自動挿入**: サムネイルと本文中の画像を自動アップロード
- **バッチ投稿**: 複数の記事を連続して自動投稿

## 使い方の例

記事ファイルはこんな形式で書きます：

```markdown
---
title: 記事タイトル
price: 300
tags: [AI, 自動化]
---

ここに本文を書きます。

<!-- paid -->

ここから有料部分です。
```

Claude Desktopに設定すれば、「この記事をnoteに投稿して」と頼むだけで投稿が完了します。

## 技術的な仕組み

内部ではPlaywrightを使ってブラウザを自動操作しています。note.comのAPIが公開されていないため、実際のブラウザ操作をシミュレートする方式を採用しました。

画像の挿入にはClipboard APIを活用し、base64エンコードした画像をクリップボード経由でエディタに貼り付けています。

## インストール方法

```bash
# Playwrightブラウザをインストール
npx playwright install chromium

# ログインして認証状態を取得
npx note-post-mcp-login
```

詳しい設定方法はGitHubリポジトリをご覧ください。

## まとめ

AIとの対話だけで記事投稿まで完結できるのは、思った以上に便利です。特に複数の記事を一括で投稿したい場合に重宝します。

興味のある方はぜひ試してみてください！

**GitHub**: https://github.com/nullponull/note-post-mcp
