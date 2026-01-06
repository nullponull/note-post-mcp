#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import 'dotenv/config';

// 名称一貫性
const SERVER_NAME = process.env.MCP_NAME ?? 'note-post-mcp';
const SERVER_VERSION = '1.0.0';

// 環境変数デフォルト
const DEFAULT_STATE_PATH = process.env.NOTE_POST_MCP_STATE_PATH ?? 
  path.join(os.homedir(), '.note-state.json');
const DEFAULT_TIMEOUT = parseInt(process.env.NOTE_POST_MCP_TIMEOUT ?? '180000', 10);

// ログ用ユーティリティ
function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [${SERVER_NAME}] ${message}`, data ?? '');
}

// 現在時刻のフォーマット
function nowStr(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

// 画像情報の型定義
interface ImageInfo {
  alt: string;
  localPath: string;
  absolutePath: string;
  placeholder: string;
}

// Markdownから画像パスを抽出する関数
function extractImages(markdown: string, baseDir: string): ImageInfo[] {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: ImageInfo[] = [];
  let match;

  while ((match = imageRegex.exec(markdown)) !== null) {
    const alt = match[1] || 'image';
    const imagePath = match[2];
    
    // URLではなくローカルパスの場合のみ処理
    if (!imagePath.startsWith('http://') && !imagePath.startsWith('https://')) {
      const absolutePath = path.resolve(baseDir, imagePath);
      if (fs.existsSync(absolutePath)) {
        images.push({
          alt,
          localPath: imagePath,
          absolutePath,
          placeholder: match[0], // 元のマークダウン記法全体
        });
      } else {
        log(`Warning: Image file not found: ${absolutePath}`);
      }
    }
  }

  return images;
}

// パース結果の型定義
interface ParsedMarkdown {
  title: string;
  body: string;
  tags: string[];
  price?: number;           // 有料価格（100-50000円）
  paidLineIndex?: number;   // 有料ラインの段落番号（0始まり）
  magazine?: string;        // 追加するマガジン名
  postToTwitter?: boolean;  // Twitter(X)に投稿するかどうか
}

// Markdownファイルをパースする関数
function parseMarkdown(content: string): ParsedMarkdown {
  const lines = content.split('\n');
  let title = '';
  let body = '';
  const tags: string[] = [];
  let price: number | undefined;
  let paidLineIndex: number | undefined;
  let magazine: string | undefined;
  let postToTwitter: boolean | undefined;
  let inFrontMatter = false;
  let frontMatterEnded = false;
  let inTagsArray = false;
  let paragraphCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Front matter の処理（YAML形式）
    if (line.trim() === '---') {
      if (!frontMatterEnded) {
        inFrontMatter = !inFrontMatter;
        if (!inFrontMatter) {
          frontMatterEnded = true;
          inTagsArray = false;
        }
        continue;
      }
    }

    if (inFrontMatter) {
      // タイトルをfront matterから抽出
      if (line.startsWith('title:')) {
        title = line.substring(6).trim().replace(/^["']|["']$/g, '');
        inTagsArray = false;
      }
      // 価格をfront matterから抽出
      else if (line.startsWith('price:')) {
        const priceStr = line.substring(6).trim();
        const parsedPrice = parseInt(priceStr, 10);
        if (!isNaN(parsedPrice) && parsedPrice >= 100 && parsedPrice <= 50000) {
          price = parsedPrice;
        }
        inTagsArray = false;
      }
      // マガジン名をfront matterから抽出
      else if (line.startsWith('magazine:')) {
        magazine = line.substring(9).trim().replace(/^["']|["']$/g, '');
        inTagsArray = false;
      }
      // Twitter投稿フラグをfront matterから抽出
      else if (line.startsWith('twitter:') || line.startsWith('x:') || line.startsWith('post_to_twitter:')) {
        const twitterVal = line.split(':')[1].trim().toLowerCase();
        postToTwitter = twitterVal === 'true' || twitterVal === 'yes' || twitterVal === '1';
        inTagsArray = false;
      }
      // タグをfront matterから抽出
      else if (line.startsWith('tags:')) {
        const tagsStr = line.substring(5).trim();
        if (tagsStr.startsWith('[') && tagsStr.endsWith(']')) {
          // 配列形式: tags: [tag1, tag2]
          tags.push(...tagsStr.slice(1, -1).split(',').map(t => t.trim().replace(/^["']|["']$/g, '')));
          inTagsArray = false;
        } else if (tagsStr === '') {
          // 次の行からYAML配列形式
          inTagsArray = true;
        } else {
          // インライン値
          tags.push(tagsStr.replace(/^["']|["']$/g, ''));
          inTagsArray = false;
        }
      }
      // YAML配列形式のタグ: - tag1
      else if (inTagsArray && line.trim().startsWith('-')) {
        const tag = line.trim().substring(1).trim().replace(/^["']|["']$/g, '');
        if (tag) tags.push(tag);
      }
      // 他のキーが来たら配列終了
      else if (line.match(/^\w+:/)) {
        inTagsArray = false;
      }
      continue;
    }

    // タイトルを # から抽出（front matterがない場合）
    if (!title && line.startsWith('# ')) {
      title = line.substring(2).trim();
      continue;
    }

    // 有料ラインマーカーを検出: <!-- paid --> または <!-- 有料 -->
    if (line.trim().match(/^<!--\s*(paid|有料)\s*-->$/i)) {
      paidLineIndex = paragraphCount;
      continue; // マーカー行自体は本文に含めない
    }

    // 本文を追加
    if (frontMatterEnded || !line.trim().startsWith('---')) {
      body += line + '\n';
      // 空行で段落をカウント（有料ライン位置の計算用）
      if (line.trim() === '' && body.trim() !== '') {
        paragraphCount++;
      }
    }
  }

  return {
    title: title || 'Untitled',
    body: body.trim(),
    tags: tags.filter(Boolean),
    price,
    paidLineIndex,
    magazine,
    postToTwitter,
  };
}

// note.com投稿関数
async function postToNote(params: {
  markdownPath: string;
  thumbnailPath?: string;
  statePath?: string;
  isPublic: boolean;
  screenshotDir?: string;
  timeout?: number;
  // 有料設定（Front Matterでも指定可能、パラメーターが優先）
  price?: number;
  paidLineIndex?: number;
  // マガジン追加設定
  magazine?: string;
  // Twitter投稿設定
  postToTwitter?: boolean;
}): Promise<{
  success: boolean;
  url: string;
  screenshot?: string;
  message: string;
  isPaid?: boolean;
  price?: number;
  magazine?: string;
  postedToTwitter?: boolean;
}> {
  const {
    markdownPath,
    thumbnailPath,
    statePath = DEFAULT_STATE_PATH,
    isPublic,
    screenshotDir = path.join(os.tmpdir(), 'note-screenshots'),
    timeout = DEFAULT_TIMEOUT,
  } = params;

  // Markdownファイルを読み込み
  if (!fs.existsSync(markdownPath)) {
    throw new Error(`Markdown file not found: ${markdownPath}`);
  }
  const mdContent = fs.readFileSync(markdownPath, 'utf-8');
  const parsed = parseMarkdown(mdContent);
  const { title, body, tags } = parsed;

  // 有料設定: パラメーターが優先、なければFront Matterから取得
  const price = params.price ?? parsed.price;
  const paidLineIndex = params.paidLineIndex ?? parsed.paidLineIndex;
  const isPaid = price !== undefined && price >= 100;

  // マガジン設定: パラメーターが優先、なければFront Matterから取得
  const magazine = params.magazine ?? parsed.magazine;

  // Twitter投稿設定: パラメーターが優先、なければFront Matterから取得
  const postToTwitter = params.postToTwitter ?? parsed.postToTwitter ?? false;

  // 本文中の画像を抽出
  const baseDir = path.dirname(markdownPath);
  const images = extractImages(body, baseDir);

  log('Parsed markdown', { title, bodyLength: body.length, tags, imageCount: images.length, isPaid, price, paidLineIndex, magazine, postToTwitter });

  // 認証状態ファイルを確認
  if (!fs.existsSync(statePath)) {
    throw new Error(`State file not found: ${statePath}. Please login first.`);
  }

  // スクリーンショットディレクトリを作成
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `note-post-${nowStr()}.png`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--lang=ja-JP'],
  });

  try {
    const context = await browser.newContext({
      storageState: statePath,
      locale: 'ja-JP',
      permissions: ['clipboard-read', 'clipboard-write'],
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    
    // クリップボード権限を明示的に付与
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://editor.note.com' });

    // 新規記事作成ページに移動
    const startUrl = 'https://editor.note.com/new';
    await page.goto(startUrl, { waitUntil: 'networkidle', timeout });
    await page.waitForSelector('textarea[placeholder*="タイトル"]', { timeout });

    // サムネイル画像の設定
    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
      log('Uploading thumbnail image');
      const candidates = page.locator('button[aria-label="画像を追加"]');
      await candidates.first().waitFor({ state: 'visible', timeout });

      let target = candidates.first();
      const cnt = await candidates.count();
      if (cnt > 1) {
        let minY = Infinity;
        let idx = 0;
        for (let i = 0; i < cnt; i++) {
          const box = await candidates.nth(i).boundingBox();
          if (box && box.y < minY) {
            minY = box.y;
            idx = i;
          }
        }
        target = candidates.nth(idx);
      }

      await target.scrollIntoViewIfNeeded();
      await target.click({ force: true });

      const uploadBtn = page.locator('button:has-text("画像をアップロード")').first();
      await uploadBtn.waitFor({ state: 'visible', timeout });

      let chooser = null;
      try {
        [chooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }),
          uploadBtn.click({ force: true }),
        ]);
      } catch (_) {
        // フォールバック
      }

      if (chooser) {
        await chooser.setFiles(thumbnailPath);
      } else {
        await uploadBtn.click({ force: true }).catch(() => {});
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: 'attached', timeout });
        await fileInput.setInputFiles(thumbnailPath);
      }

      // トリミングダイアログ内「保存」を押す
      const dialog = page.locator('div[role="dialog"]');
      await dialog.waitFor({ state: 'visible', timeout });

      const saveThumbBtn = dialog.locator('button:has-text("保存")').first();
      const cropper = dialog.locator('[data-testid="cropper"]').first();

      const cropperEl = await cropper.elementHandle();
      const saveEl = await saveThumbBtn.elementHandle();

      if (cropperEl && saveEl) {
        await Promise.race([
          page.waitForFunction(
            (el) => getComputedStyle(el as Element).pointerEvents === 'none',
            cropperEl,
            { timeout }
          ),
          page.waitForFunction(
            (el) => !(el as HTMLButtonElement).disabled,
            saveEl,
            { timeout }
          ),
        ]);
      }

      await saveThumbBtn.click();
      await dialog.waitFor({ state: 'hidden', timeout }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout }).catch(() => {});

      // 反映確認
      const changedBtn = page.locator('button[aria-label="画像を変更"]');
      const addBtn = page.locator('button[aria-label="画像を追加"]');

      let applied = false;
      try {
        await changedBtn.waitFor({ state: 'visible', timeout: 5000 });
        applied = true;
      } catch {}
      if (!applied) {
        try {
          await addBtn.waitFor({ state: 'hidden', timeout: 5000 });
          applied = true;
        } catch {}
      }
      if (!applied) {
        log('Thumbnail reflection uncertain, continuing');
      }
    }

    // タイトル設定
    await page.fill('textarea[placeholder*="タイトル"]', title);
    log('Title set');

    // 本文設定（常に一括ペーストで高速化）
    const bodyBox = page.locator('div[contenteditable="true"][role="textbox"]').first();
    await bodyBox.waitFor({ state: 'visible' });
    await bodyBox.click();

    log('Using fast clipboard paste');
    await page.evaluate((text) => {
      return navigator.clipboard.writeText(text);
    }, body);
    await page.waitForTimeout(50);

    const isMac = process.platform === 'darwin';
    if (isMac) {
      await page.keyboard.press('Meta+v');
    } else {
      await page.keyboard.press('Control+v');
    }
    await page.waitForTimeout(300);

    log('Body set');

    // 下書き保存の場合
    if (!isPublic) {
      const saveBtn = page.locator('button:has-text("下書き保存"), [aria-label*="下書き保存"]').first();
      await saveBtn.waitFor({ state: 'visible', timeout });
      if (await saveBtn.isEnabled()) {
        await saveBtn.click();
        await page.locator('text=保存しました').waitFor({ timeout: 4000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      const finalUrl = page.url();
      log('Draft saved', { url: finalUrl });

      await context.close();
      await browser.close();

      return {
        success: true,
        url: finalUrl,
        screenshot: screenshotPath,
        message: '下書きを保存しました',
      };
    }

    // 公開に進む
    const proceedBtn = page.locator('button:has-text("公開に進む")').first();
    await proceedBtn.waitFor({ state: 'visible', timeout });
    for (let i = 0; i < 10; i++) {
      if (await proceedBtn.isEnabled()) break;
      await page.waitForTimeout(50);
    }
    await proceedBtn.click({ force: true });

    // 公開ページへ遷移
    await Promise.race([
      page.waitForURL(/\/publish/i, { timeout }).catch(() => {}),
      page.locator('button:has-text("投稿する")').first().waitFor({ state: 'visible', timeout }).catch(() => {}),
    ]);

    // タグ入力
    if (tags.length > 0) {
      log('Adding tags', { tags });
      let tagInput = page.locator('input[placeholder*="ハッシュタグ"]');
      if (!(await tagInput.count())) {
        tagInput = page.locator('input[role="combobox"]').first();
      }
      await tagInput.waitFor({ state: 'visible', timeout });
      for (const tag of tags) {
        await tagInput.click();
        await tagInput.fill(tag);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(50);
      }
    }

    // 有料設定
    if (isPaid && price) {
      log('Setting paid article', { price });

      try {
        // note.comの公開設定画面では「無料」「有料」のラベルがある
        // まず「有料」ラベルをクリックして有料モードに切り替え
        const paidLabel = page.locator('label:has-text("有料")').first();
        await paidLabel.waitFor({ state: 'visible', timeout: 5000 });
        await paidLabel.click();
        await page.waitForTimeout(200);

        // 価格入力フィールドを探す（有料を選択すると表示される）
        // note.comの価格入力は「価格」ラベルの近くにあるinput要素
        // セレクター: 「価格」テキストを含む要素の近くのinput、または記事タイプセクション内のinput
        await page.waitForTimeout(150);

        // 「価格」ラベルの近くにあるinputを探す
        const priceSection = page.locator('text=価格').first();
        let priceInput = priceSection.locator('xpath=following-sibling::input | ../input | ../../input').first();

        // 上記で見つからない場合、有料ラベルの後にあるinputを探す
        if (!(await priceInput.count())) {
          priceInput = page.locator('label:has-text("有料")').locator('xpath=following::input').first();
        }

        // さらに見つからない場合、記事タイプセクション内の全inputを探す
        if (!(await priceInput.count())) {
          priceInput = page.locator('input[type="text"], input[type="number"], input:not([type="checkbox"]):not([type="radio"])').nth(1);
        }

        try {
          await priceInput.waitFor({ state: 'visible', timeout: 3000 });
          await priceInput.fill('');
          await priceInput.fill(String(price));
          await page.waitForTimeout(100);
          log('Paid settings applied', { price });
        } catch {
          log('Price input not found with standard selectors, trying alternative approach');
          // フォールバック: 全ての表示されているinputを取得して、価格入力らしきものを探す
          const allInputs = await page.locator('input:visible').all();
          for (const inp of allInputs) {
            const type = await inp.getAttribute('type').catch(() => '');
            const value = await inp.inputValue().catch(() => '');
            // 数字が入っているか、空のtext/number inputを探す
            if ((type === 'text' || type === 'number' || type === null) && /^\d*$/.test(value)) {
              await inp.fill('');
              await inp.fill(String(price));
              log('Paid settings applied via fallback', { price });
              break;
            }
          }
        }
      } catch (e) {
        log('Warning: Could not set paid settings, continuing as free article', { error: String(e) });
      }
    }

    // マガジンに追加
    let magazineAdded = false;
    if (magazine) {
      log('Adding to magazine', { magazine });

      try {
        // マガジンタブをクリック
        const magazineTab = page.locator('button:has-text("マガジン")').first();
        await magazineTab.waitFor({ state: 'visible', timeout: 5000 });
        await magazineTab.click();
        await page.waitForTimeout(150);

        // note.comのボタンはspan要素内にテキストがある: <button><span>追加</span></button>
        // button:has(span:has-text("追加")) セレクターを使用
        const allAddBtns = await page.locator('button:has(span:has-text("追加"))').all();

        for (const btn of allAddBtns) {
          const isVisible = await btn.isVisible().catch(() => false);
          if (isVisible) {
            // ボタンの近くにマガジン名があるか確認
            const nearbyText = await btn.locator('xpath=ancestor::*[position()<=4]').first().textContent().catch(() => '') ?? '';
            if (nearbyText.includes(magazine)) {
              await btn.click();
              await page.waitForTimeout(150);
              magazineAdded = true;
              log('Magazine added', { magazine });
              break;
            }
          }
        }

        // 見つからない場合、最後の手段として最後の追加ボタンをクリック
        if (!magazineAdded) {
          log('Trying last resort for magazine add');
          const lastResortBtn = page.locator('button:has(span:has-text("追加"))').last();
          if (await lastResortBtn.isVisible().catch(() => false)) {
            await lastResortBtn.click();
            await page.waitForTimeout(150);
            magazineAdded = true;
            log('Magazine added via last resort');
          }
        }

        if (!magazineAdded) {
          log('Warning: Could not find magazine', { magazine });
        }
      } catch (e) {
        log('Warning: Could not add to magazine', { error: String(e), magazine });
      }
    }

    // Twitter(X)に投稿する設定（SNSプロモーション機能）
    let twitterEnabled = false;
    if (postToTwitter) {
      log('Enabling SNS promotion');

      try {
        // note.comの公開設定画面では「SNSプロモーション機能」のラジオボタンがある
        // テキストをクリックすることでラジオボタンを選択できる
        const snsOption = page.locator('text=SNSプロモーション機能').first();
        try {
          await snsOption.waitFor({ state: 'visible', timeout: 3000 });
          await snsOption.click();
          await page.waitForTimeout(100);
          twitterEnabled = true;
          log('SNS promotion enabled');
        } catch {
          // フォールバック: ラジオボタンを直接探す
          const snsRadio = page.locator('input[type="radio"]').nth(1);
          try {
            await snsRadio.waitFor({ state: 'visible', timeout: 2000 });
            await snsRadio.click();
            await page.waitForTimeout(100);
            twitterEnabled = true;
            log('SNS promotion enabled via radio button');
          } catch {
            log('Warning: Could not find SNS promotion option');
          }
        }
      } catch (e) {
        log('Warning: Could not enable SNS promotion', { error: String(e) });
      }
    }

    // 有料エリア設定は本文入力時にスラッシュコマンドで挿入済み
    // 公開設定画面でのドラッグ操作は不要

    // 投稿する
    const publishBtn = page.locator('button:has-text("投稿する")').first();
    await publishBtn.waitFor({ state: 'visible', timeout });
    for (let i = 0; i < 30; i++) {
      if (await publishBtn.isEnabled()) break;
      await page.waitForTimeout(200);
    }
    await publishBtn.click({ force: true });

    // 投稿完了待ち
    await Promise.race([
      page.waitForURL((url) => !/\/publish/i.test(url.toString()), { timeout: 20000 }).catch(() => {}),
      page.locator('text=投稿しました').first().waitFor({ timeout: 8000 }).catch(() => {}),
      page.waitForTimeout(5000),
    ]);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const finalUrl = page.url();
    log('Published', { url: finalUrl, isPaid, price, magazineAdded, twitterEnabled });

    await context.close();
    await browser.close();

    // メッセージを構築
    let message = isPaid ? `有料記事（${price}円）を公開しました` : '記事を公開しました';
    if (magazineAdded) {
      message += `（マガジン「${magazine}」に追加）`;
    }
    if (twitterEnabled) {
      message += '（Twitter連携あり）';
    }

    return {
      success: true,
      url: finalUrl,
      screenshot: screenshotPath,
      message,
      isPaid,
      price: isPaid ? price : undefined,
      magazine: magazineAdded ? magazine : undefined,
      postedToTwitter: twitterEnabled,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Zodスキーマ定義
const PublishNoteSchema = z.object({
  markdown_path: z.string().describe('Markdownファイルのパス（タイトル、本文、タグを含む）'),
  thumbnail_path: z.string().optional().describe('サムネイル画像のパス（オプション）'),
  state_path: z.string().optional().describe(`note.comの認証状態ファイルのパス（デフォルト: ${DEFAULT_STATE_PATH}）`),
  screenshot_dir: z.string().optional().describe('スクリーンショット保存ディレクトリ（オプション）'),
  timeout: z.number().optional().describe(`タイムアウト（ミリ秒、デフォルト: ${DEFAULT_TIMEOUT}）`),
  // 有料設定（Front Matterでも指定可能）
  price: z.number().min(100).max(50000).optional().describe('有料記事の価格（100〜50000円）。Front Matterのpriceでも指定可能'),
  // マガジン追加設定（Front Matterでも指定可能）
  magazine: z.string().optional().describe('追加するマガジン名。Front Matterのmagazineでも指定可能'),
  // Twitter投稿設定（Front Matterでも指定可能）
  post_to_twitter: z.boolean().optional().describe('Twitter(X)に投稿するかどうか。Front Matterのtwitter: trueでも指定可能'),
});

const SaveDraftSchema = z.object({
  markdown_path: z.string().describe('Markdownファイルのパス（タイトル、本文、タグを含む）'),
  thumbnail_path: z.string().optional().describe('サムネイル画像のパス（オプション）'),
  state_path: z.string().optional().describe(`note.comの認証状態ファイルのパス（デフォルト: ${DEFAULT_STATE_PATH}）`),
  screenshot_dir: z.string().optional().describe('スクリーンショット保存ディレクトリ（オプション）'),
  timeout: z.number().optional().describe(`タイムアウト（ミリ秒、デフォルト: ${DEFAULT_TIMEOUT}）`),
});

// ツール定義
const TOOLS: Tool[] = [
  {
    name: 'publish_note',
    description: 'note.comに記事を公開します。Markdownファイルからタイトル、本文、タグ、価格設定を読み取り、自動的に投稿します。有料記事はFront Matterのpriceで価格指定、または本文中の<!-- paid -->で有料ラインを設定できます。',
    inputSchema: {
      type: 'object',
      properties: {
        markdown_path: {
          type: 'string',
          description: 'Markdownファイルのパス（タイトル、本文、タグ、価格設定を含む）',
        },
        thumbnail_path: {
          type: 'string',
          description: 'サムネイル画像のパス（オプション）',
        },
        state_path: {
          type: 'string',
          description: `note.comの認証状態ファイルのパス（デフォルト: ${DEFAULT_STATE_PATH}）`,
        },
        screenshot_dir: {
          type: 'string',
          description: 'スクリーンショット保存ディレクトリ（オプション）',
        },
        timeout: {
          type: 'number',
          description: `タイムアウト（ミリ秒、デフォルト: ${DEFAULT_TIMEOUT}）`,
        },
        price: {
          type: 'number',
          description: '有料記事の価格（100〜50000円）。Front Matterのpriceより優先',
        },
        magazine: {
          type: 'string',
          description: '追加するマガジン名。Front Matterのmagazineより優先',
        },
        post_to_twitter: {
          type: 'boolean',
          description: 'Twitter(X)に投稿するかどうか。Front Matterのtwitterより優先',
        },
      },
      required: ['markdown_path'],
    },
  },
  {
    name: 'save_draft',
    description: 'note.comに下書きを保存します。Markdownファイルからタイトル、本文、タグを読み取り、下書きとして保存します。',
    inputSchema: {
      type: 'object',
      properties: {
        markdown_path: {
          type: 'string',
          description: 'Markdownファイルのパス（タイトル、本文、タグを含む）',
        },
        thumbnail_path: {
          type: 'string',
          description: 'サムネイル画像のパス（オプション）',
        },
        state_path: {
          type: 'string',
          description: `note.comの認証状態ファイルのパス（デフォルト: ${DEFAULT_STATE_PATH}）`,
        },
        screenshot_dir: {
          type: 'string',
          description: 'スクリーンショット保存ディレクトリ（オプション）',
        },
        timeout: {
          type: 'number',
          description: `タイムアウト（ミリ秒、デフォルト: ${DEFAULT_TIMEOUT}）`,
        },
      },
      required: ['markdown_path'],
    },
  },
];

// MCPサーバーの初期化
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ツール一覧ハンドラ
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// ツール呼び出しハンドラ
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'publish_note') {
      const params = PublishNoteSchema.parse(args);
      const result = await postToNote({
        markdownPath: params.markdown_path,
        thumbnailPath: params.thumbnail_path,
        statePath: params.state_path,
        screenshotDir: params.screenshot_dir,
        timeout: params.timeout,
        isPublic: true,
        price: params.price,
        magazine: params.magazine,
        postToTwitter: params.post_to_twitter,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'save_draft') {
      const params = SaveDraftSchema.parse(args);
      const result = await postToNote({
        markdownPath: params.markdown_path,
        thumbnailPath: params.thumbnail_path,
        statePath: params.state_path,
        screenshotDir: params.screenshot_dir,
        timeout: params.timeout,
        isPublic: false,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Tool execution error', { name, error: errorMessage });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: errorMessage,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// サーバー起動
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Server started', { name: SERVER_NAME, version: SERVER_VERSION });
}

main().catch((error) => {
  log('Fatal error', error);
  process.exit(1);
});

