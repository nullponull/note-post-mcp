#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// デフォルトの保存先
const DEFAULT_STATE_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.note-state.json');

/**
 * note.com にログインして認証状態を保存するスクリプト
 */
async function loginToNote() {
  const statePath = process.env.NOTE_STATE_PATH || DEFAULT_STATE_PATH;
  
  console.log('='.repeat(60));
  console.log('note.com ログインスクリプト');
  console.log('='.repeat(60));
  console.log();
  console.log(`認証状態の保存先: ${statePath}`);
  console.log();

  // 既存のファイルがある場合は確認
  if (fs.existsSync(statePath)) {
    console.log('⚠️  既存の認証ファイルが見つかりました。');
    console.log('新しい認証情報で上書きしますか？ (y/N): ');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise((resolve) => {
      rl.question('', (ans) => {
        rl.close();
        resolve(ans);
      });
    });

    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('キャンセルしました。');
      process.exit(0);
    }
  }

  console.log();
  console.log('ブラウザを起動します...');
  
  const browser = await chromium.launch({
    headless: false,
    args: ['--lang=ja-JP']
  });

  try {
    const context = await browser.newContext({
      locale: 'ja-JP',
      viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();

    console.log();
    console.log('note.com のログインページを開きます...');
    await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });

    console.log();
    console.log('━'.repeat(60));
    console.log('📝 ブラウザでログインしてください');
    console.log('━'.repeat(60));
    console.log();
    console.log('1. メールアドレス/パスワードまたは外部サービスでログイン');
    console.log('2. ログイン完了後、ホーム画面が表示されることを確認');
    console.log('3. このターミナルに戻って Enter キーを押してください');
    console.log();

    // ユーザーがログインするまで待機
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise((resolve) => {
      rl.question('Enter キーを押してください...', () => {
        rl.close();
        resolve();
      });
    });

    console.log();
    console.log('認証状態を保存しています...');

    // ディレクトリが存在しない場合は作成
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 認証状態を保存
    await context.storageState({ path: statePath });

    // パーミッションを制限（セキュリティのため）
    if (process.platform !== 'win32') {
      fs.chmodSync(statePath, 0o600);
    }

    console.log();
    console.log('✅ 認証状態を保存しました！');
    console.log();
    console.log(`保存先: ${statePath}`);
    console.log();
    console.log('━'.repeat(60));
    console.log('次のステップ:');
    console.log('━'.repeat(60));
    console.log();
    console.log('1. MCP クライアントの設定ファイルを編集');
    console.log('   - NOTE_POST_MCP_STATE_PATH 環境変数を設定');
    console.log(`   - 値: ${statePath}`);
    console.log();
    console.log('2. MCP サーバーを起動');
    console.log('   - npx note-post-mcp');
    console.log();
    console.log('詳細は SETUP_JP.md を参照してください。');
    console.log();

  } catch (error) {
    console.error();
    console.error('❌ エラーが発生しました:', error.message);
    console.error();
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// スクリプト実行
loginToNote().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

