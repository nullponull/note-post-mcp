#!/usr/bin/env node
// note.comログインスクリプト

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const STATE_PATH = process.env.NOTE_POST_MCP_STATE_PATH || path.join(os.homedir(), '.note-state.json');

async function login() {
  console.log('note.comログインスクリプトを開始します...');
  console.log('認証状態保存先:', STATE_PATH);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://note.com/login', { waitUntil: 'networkidle' });
    console.log('\nブラウザでnote.comにログインしてください。');
    console.log('ログイン完了後、マイページに移動してください。');
    console.log('準備ができたら、このターミナルでEnterキーを押してください...\n');

    // ユーザーがログインするまで待機（最大5分）
    await page.waitForURL(/note\.com\/(?!login)/, { timeout: 300000 });

    console.log('ログイン検出しました。');

    // エディタページにもアクセスして、editor.note.comドメインのcookieも取得
    console.log('エディタページにアクセスしてcookieを取得中...');
    await page.goto('https://editor.note.com/new', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    console.log('認証状態を保存しています...');

    // 認証状態を保存
    await context.storageState({ path: STATE_PATH });

    console.log('認証状態を保存しました:', STATE_PATH);
    console.log('\nブラウザを閉じます...');

    await browser.close();
    console.log('完了しました。');
  } catch (error) {
    console.error('エラーが発生しました:', error);
    await browser.close();
    process.exit(1);
  }
}

login();
