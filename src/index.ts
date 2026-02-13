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
  paidLineSearchText?: string; // 有料ラインの直前段落のテキスト（検索用）
  magazine?: string;        // 追加するマガジン名
  membership?: string;      // 追加するメンバーシッププラン（light, support, standard, premium, all）
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
  let paidLineSearchText: string | undefined;
  let magazine: string | undefined;
  let membership: string | undefined;
  let postToTwitter: boolean | undefined;
  let inFrontMatter = false;
  let frontMatterEnded = false;
  let inTagsArray = false;

  // 有料ライン位置計算用（batch-publish.cjsと同じロジック）
  let currentParagraphIndex = 0;
  let lastLineWasEmpty = true;
  let currentParagraphText = '';

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
      // メンバーシッププランをfront matterから抽出
      else if (line.startsWith('membership:')) {
        membership = line.substring(11).trim().replace(/^["']|["']$/g, '').toLowerCase();
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
    // 検出時に、直前の段落テキストを記録
    if (line.trim().match(/^<!--\s*(paid|有料)\s*-->$/i)) {
      paidLineIndex = currentParagraphIndex;
      paidLineSearchText = currentParagraphText.trim().substring(0, 30);
      continue; // マーカー行自体は本文に含めない
    }

    // 本文を追加
    if (frontMatterEnded || !line.trim().startsWith('---')) {
      body += line + '\n';

      // 段落をカウント（空行から内容のある行に変わった時に新しい段落）
      if (line.trim() !== '' && lastLineWasEmpty) {
        currentParagraphIndex++;
        currentParagraphText = line;
      } else if (line.trim() !== '') {
        currentParagraphText += ' ' + line;
      }
      lastLineWasEmpty = line.trim() === '';
    }
  }

  return {
    title: title || 'Untitled',
    body: body.trim(),
    tags: tags.filter(Boolean),
    price,
    paidLineIndex,
    paidLineSearchText,
    magazine,
    membership,
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
  // メンバーシップ追加設定
  membership?: string;
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
  const paidLineSearchText = parsed.paidLineSearchText;
  const isPaid = price !== undefined && price >= 100;
  const hasPaidLine = paidLineIndex !== undefined && paidLineIndex > 0;

  // マガジン設定: パラメーターが優先、なければFront Matterから取得
  const magazine = params.magazine ?? parsed.magazine;

  // メンバーシップ設定: パラメーターが優先、なければFront Matterから取得
  const membership = params.membership ?? parsed.membership;

  // Twitter投稿設定: パラメーターが優先、なければFront Matterから取得
  const postToTwitter = params.postToTwitter ?? parsed.postToTwitter ?? false;

  // 本文中の画像を抽出
  const baseDir = path.dirname(markdownPath);
  const images = extractImages(body, baseDir);

  log('Parsed markdown', { title, bodyLength: body.length, tags, imageCount: images.length, isPaid, price, paidLineIndex, paidLineSearchText, hasPaidLine, magazine, membership, postToTwitter });

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

    // 本文設定
    const bodyBox = page.locator('div[contenteditable="true"][role="textbox"]').first();
    await bodyBox.waitFor({ state: 'visible' });
    await bodyBox.click();

    const isMac = process.platform === 'darwin';
    const pasteKey = isMac ? 'Meta+v' : 'Control+v';

    // 画像がある場合は分割して挿入、なければ一括ペースト
    if (images.length > 0) {
      log('Inserting body with images', { imageCount: images.length });

      // 本文を画像プレースホルダーで分割
      let remainingBody = body;
      for (const imageInfo of images) {
        const parts = remainingBody.split(imageInfo.placeholder);
        if (parts.length >= 2) {
          // 画像の前のテキストを挿入
          const textBefore = parts[0];
          if (textBefore.trim()) {
            await page.evaluate((text) => navigator.clipboard.writeText(text), textBefore);
            await page.waitForTimeout(50);
            await page.keyboard.press(pasteKey);
            await page.waitForTimeout(200);
          }

          // 改行を入れる
          await page.keyboard.press('Enter');
          await page.waitForTimeout(100);

          // 画像をクリップボードにコピーして挿入
          try {
            const imageBuffer = fs.readFileSync(imageInfo.absolutePath);
            const base64Image = imageBuffer.toString('base64');
            const ext = path.extname(imageInfo.absolutePath).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' :
                            ext === '.gif' ? 'image/gif' :
                            ext === '.webp' ? 'image/webp' : 'image/jpeg';

            await page.evaluate(async ({ base64, mime }) => {
              const response = await fetch(`data:${mime};base64,${base64}`);
              const blob = await response.blob();
              const item = new ClipboardItem({ [mime]: blob });
              await navigator.clipboard.write([item]);
            }, { base64: base64Image, mime: mimeType });

            await page.waitForTimeout(100);
            await page.keyboard.press(pasteKey);
            await page.waitForTimeout(500); // 画像アップロード待ち
            log('Image inserted', { path: imageInfo.localPath });
          } catch (imgErr) {
            log('Warning: Failed to insert image', { path: imageInfo.localPath, error: String(imgErr) });
          }

          // 改行を入れる
          await page.keyboard.press('Enter');
          await page.waitForTimeout(100);

          // 残りの本文を更新
          remainingBody = parts.slice(1).join(imageInfo.placeholder);
        }
      }

      // 残りのテキストを挿入
      if (remainingBody.trim()) {
        await page.evaluate((text) => navigator.clipboard.writeText(text), remainingBody);
        await page.waitForTimeout(50);
        await page.keyboard.press(pasteKey);
        await page.waitForTimeout(200);
      }
    } else {
      // 画像なしの場合は一括ペースト（高速）
      log('Using fast clipboard paste (no images)');
      await page.evaluate((text) => navigator.clipboard.writeText(text), body);
      await page.waitForTimeout(50);
      await page.keyboard.press(pasteKey);
      await page.waitForTimeout(300);
    }

    log('Body set', { withImages: images.length > 0 });

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

    // 公開に進む（長い記事の場合レンダリングに時間がかかる）
    const proceedBtn = page.locator('button:has-text("公開に進む")').first();
    await proceedBtn.waitFor({ state: 'visible', timeout: 60000 });
    for (let i = 0; i < 30; i++) {
      if (await proceedBtn.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(200);
    }
    await proceedBtn.click({ force: true });
    log('Clicked proceed to publish button');

    // 公開設定画面を待機（長い記事の場合時間がかかる）
    await Promise.race([
      page.waitForURL(/\/publish/i, { timeout: 60000 }),
      page.locator('button:has-text("投稿する")').first().waitFor({ state: 'visible', timeout: 60000 }),
    ]).catch(() => {});

    // 公開設定画面が完全に読み込まれるまで待機（長い記事用に延長）
    await page.waitForTimeout(3000);
    log('Navigated to publish settings page');

    // タグ入力（タグがある場合のみ）
    if (tags.length > 0) {
      log('Adding tags', { tags });
      let tagInput = page.locator('input[placeholder*="ハッシュタグ"]').first();
      if (!(await tagInput.isVisible().catch(() => false))) {
        tagInput = page.locator('input[role="combobox"]').first();
      }
      if (await tagInput.isVisible().catch(() => false)) {
        for (const tag of tags) {
          await tagInput.click();
          await tagInput.fill(tag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(50);
        }
      }
    }

    // 有料設定（バッチ処理と同じパターン）
    if (isPaid && price) {
      log('Setting paid article', { price });

      try {
        // 「有料」ラベルをクリック
        const paidLabel = page.locator('label:has-text("有料")').first();
        if (await paidLabel.isVisible().catch(() => false)) {
          await paidLabel.click();
          await page.waitForTimeout(1500); // 有料設定が反映されるまで待機（長い記事用に延長）

          // 価格入力欄を探す（type="text"でplaceholder="300"のもの）
          const priceInput = page.locator('input[type="text"][placeholder="300"]').first();
          if (await priceInput.isVisible().catch(() => false)) {
            await priceInput.fill('');
            await priceInput.fill(String(price));
            log('Paid settings applied', { price });
          } else {
            // フォールバック: 数字の値が入っているinput[type="text"]を探す
            const textInputs = page.locator('input[type="text"]');
            const count = await textInputs.count();
            for (let i = 0; i < count; i++) {
              const inp = textInputs.nth(i);
              const val = await inp.inputValue().catch(() => '');
              if (/^\d+$/.test(val)) {
                await inp.fill('');
                await inp.fill(String(price));
                log('Paid settings applied via fallback', { price });
                break;
              }
            }
          }
          await page.waitForTimeout(300); // 価格設定が反映されるまで待機
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

    // メンバーシップに追加する設定
    if (membership) {
      // "true" が来た場合は "all"（メンバー全員に公開）にマップ
      const resolvedMembership = (membership === 'true' || membership === true as any) ? 'all' : membership;
      log('Adding to membership', { membership, resolvedMembership });
      try {
        // 「記事の追加」セクション内のメンバーシップチェックボックスをクリック
        // UI構造: checkbox "メンバーシップ" がチェックボックスとして存在
        const membershipCheckbox = page.getByRole('checkbox', { name: 'メンバーシップ' });

        // チェックボックスが表示されるまで待機
        await membershipCheckbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

        if (await membershipCheckbox.isVisible().catch(() => false)) {
          // チェックされていなければクリック
          const isChecked = await membershipCheckbox.isChecked().catch(() => false);
          if (!isChecked) {
            await membershipCheckbox.click();
            log('Clicked membership checkbox');
            await page.waitForTimeout(1000);
          }

          // プラン名のマッピング（UIに表示される実際のテキストに合わせる）
          // 2026-02-11 確認済みのUI表示:
          //   メンバー全員に公開
          //   ライトプラン｜AI活用 読み放題プラン
          //   AI論文プラン
          //   スタンダードプラン｜AI活用＋限定特典
          //   プレミアムプラン｜個別相談＋全特典
          const planPatterns: Record<string, string> = {
            'light': 'ライトプラン',              // ライトプラン｜AI活用 読み放題プラン
            'paper': 'AI論文プラン',              // AI論文プラン
            'standard': 'スタンダードプラン',      // スタンダードプラン｜AI活用＋限定特典
            'premium': 'プレミアムプラン',         // プレミアムプラン｜個別相談＋全特典
            'all': 'メンバー全員に公開'            // 全メンバー向け
          };

          const pattern = planPatterns[resolvedMembership] || resolvedMembership;
          log('Looking for plan', { pattern, resolvedMembership });

          // プラン名を含む要素を探し、その隣の「追加」ボタンをクリック
          // 各プランは「プラン名」と「追加」ボタンが同じ親要素内にある
          const planContainer = page.locator(`div:has(> div:has-text("${pattern}"))`).first();

          if (await planContainer.isVisible().catch(() => false)) {
            const addBtn = planContainer.getByRole('button', { name: '追加' });
            if (await addBtn.isVisible().catch(() => false)) {
              await addBtn.click();
              log('Added to membership', { resolvedMembership, pattern });
              await page.waitForTimeout(1000);
            } else {
              // フォールバック: プラン名のテキストを含む行から追加ボタンを探す
              const altAddBtn = page.locator(`div:has-text("${pattern}") >> button:has-text("追加")`).first();
              if (await altAddBtn.isVisible().catch(() => false)) {
                await altAddBtn.click();
                log('Added to membership via fallback', { resolvedMembership, pattern });
                await page.waitForTimeout(1000);
              } else {
                log('Warning: Could not find add button for membership', { resolvedMembership, pattern });
              }
            }
          } else {
            // フォールバック: getByTextを使用
            const planText = page.getByText(pattern, { exact: false }).first();
            if (await planText.isVisible().catch(() => false)) {
              const parent = planText.locator('..').first();
              const addBtn = parent.getByRole('button', { name: '追加' });
              if (await addBtn.isVisible().catch(() => false)) {
                await addBtn.click();
                log('Added to membership via text search', { resolvedMembership, pattern });
                await page.waitForTimeout(1000);
              }
            } else {
              log('Warning: Could not find membership plan', { resolvedMembership, pattern });
            }
          }
        } else {
          log('Warning: Could not find membership checkbox');
        }
      } catch (e) {
        log('Warning: Could not add to membership', { error: String(e), membership });
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

    // 有料記事の場合: 「有料エリア設定」→有料ライン位置設定→「投稿する」の流れ
    // 無料記事の場合: 「投稿する」のみ
    const paidAreaBtn = page.locator('button:has-text("有料エリア設定")').first();
    let publishBtn = page.locator('button:has-text("投稿する")').first();

    // 有料エリア設定ボタンが表示されているか確認（有料を選択した場合に表示される）
    // 有料記事の場合は確実に表示されるまで待機
    let paidAreaBtnVisible = false;
    if (isPaid) {
      log('Waiting for paid area settings button...');
      for (let i = 0; i < 20; i++) {
        if (await paidAreaBtn.isVisible().catch(() => false)) {
          paidAreaBtnVisible = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      log('Paid area button visibility', { paidAreaBtnVisible });
    }

    if (paidAreaBtnVisible) {
      log('Clicking paid area settings button');
      await paidAreaBtn.click({ force: true });

      // 有料エリア設定画面を待機（長い記事の場合レンダリングに時間がかかる）
      await page.waitForTimeout(5000);

      // 有料ラインの位置を設定
      // <!-- paid --> マーカーの直前の段落を検索し、「ラインをこの場所に変更」ボタンをクリック
      if (hasPaidLine && paidLineIndex !== undefined && paidLineIndex > 0) {
        log('Setting paid line position...', { paidLineIndex, paidLineSearchText });

        // 段落要素をすべて取得（batch-publish.cjsと同じロジック）
        const paragraphs = page.locator('p');
        const pCount = await paragraphs.count().catch(() => 0);
        log('Paragraph count', { pCount });

        // デバッグ: 最初の20段落のテキストを出力
        for (let i = 0; i < Math.min(pCount, 20); i++) {
          try {
            const text = await paragraphs.nth(i).textContent().catch(() => '');
            log(`  p[${i}]: ${text?.substring(0, 60) || '(empty)'}`);
          } catch {
            // 無視
          }
        }

        // paidLineSearchTextを含む段落を検索
        let targetParagraphIndex = -1;
        if (paidLineSearchText && paidLineSearchText.length > 5) {
          log(`Searching for text: "${paidLineSearchText}"`);
          for (let i = 0; i < pCount; i++) {
            try {
              const text = await paragraphs.nth(i).textContent().catch(() => '');
              if (text && text.includes(paidLineSearchText)) {
                targetParagraphIndex = i;
                log('Found paragraph containing search text', { index: i, text: text.substring(0, 80) });
                break;
              }
            } catch {
              // 無視
            }
          }
          if (targetParagraphIndex === -1) {
            log('WARNING: Search text not found in any paragraph');
          }
        }

        // 「ラインをこの場所に変更」ボタンをすべて取得
        const changeLineButtons = page.locator('button:has-text("ラインをこの場所に変更")');
        const btnCount = await changeLineButtons.count().catch(() => 0);
        log('Change line buttons count', { btnCount });

        // 検索で見つかった段落の直後のボタンをクリック
        // 見つからない場合はpaidLineIndexを使用
        const buttonIndex = targetParagraphIndex >= 0 ? targetParagraphIndex : (paidLineIndex - 1);
        log('Button index to click', { buttonIndex, targetParagraphIndex, paidLineIndex });

        if (buttonIndex >= 0 && buttonIndex < btnCount) {
          log(`Clicking button at index ${buttonIndex}...`);
          await changeLineButtons.nth(buttonIndex).click({ force: true });
          log('Paid line set at button index', { buttonIndex });
          await page.waitForTimeout(1000);
        } else {
          log('Warning: Could not find matching button', { targetIndex: buttonIndex, btnCount });
          // フォールバック: 「このラインより先を有料にする」ボタンをクリック
          const setPaidLineBtn = page.locator('button:has-text("このラインより先を有料にする")').first();
          if (await setPaidLineBtn.isVisible().catch(() => false)) {
            await setPaidLineBtn.click({ force: true });
            log('Fallback: Used default paid line button');
            await page.waitForTimeout(2000);
          }
        }
      } else {
        // 有料ラインマーカーがない場合は、デフォルトの「このラインより先を有料にする」を使用
        const setPaidLineBtn = page.locator('button:has-text("このラインより先を有料にする")').first();
        if (await setPaidLineBtn.isVisible().catch(() => false)) {
          await setPaidLineBtn.click({ force: true });
          log('Paid line set (default position)');
          await page.waitForTimeout(2000);
        } else {
          log('Warning: Could not find paid line setting button');
        }
      }

      // 投稿ボタンを再取得
      publishBtn = page.locator('button:has-text("投稿する")').first();
      await publishBtn.waitFor({ state: 'visible', timeout: 60000 });
    } else if (isPaid) {
      // 有料を選択したがボタンが見つからない場合
      log('Warning: Paid article but paid area settings button not found');
      await publishBtn.waitFor({ state: 'visible', timeout: 60000 });
    } else {
      // 無料記事の場合は「投稿する」ボタンを待機
      await publishBtn.waitFor({ state: 'visible', timeout: 60000 });
    }

    // 投稿する - ボタンが有効になるまで待機（長い記事用に延長）
    for (let i = 0; i < 60; i++) {
      if (await publishBtn.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(300);
    }
    await publishBtn.click({ force: true });
    log('Publish button clicked');

    // 確認モーダルの「OK」ボタンをクリック（表示される場合）
    const okSelectors = [
      '[role="dialog"] button:first-of-type',
      'button:has-text("OK")',
      'button:has-text("ok")',
      'button:has-text("確認")',
      'button:has-text("はい")',
      '.modal button:first-of-type',
    ];
    let modalClicked = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(1000);
      for (const selector of okSelectors) {
        const okBtn = page.locator(selector).first();
        if (await okBtn.isVisible().catch(() => false)) {
          await okBtn.click({ force: true });
          log('Confirmation modal clicked', { selector });
          modalClicked = true;
          break;
        }
      }
      if (modalClicked) break;
    }

    // 投稿完了待ち
    let published = false;
    for (let i = 0; i < 60; i++) {
      const currentUrl = page.url();
      if (!/\/publish/i.test(currentUrl)) {
        published = true;
        break;
      }
      const successText = await page.locator('text=投稿しました').first().isVisible().catch(() => false);
      if (successText) {
        published = true;
        await page.waitForTimeout(2000);
        break;
      }
      await page.waitForTimeout(500);
    }

    if (!published) {
      log('Warning: Could not confirm publish completion');
    }

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
  // メンバーシップ追加設定（Front Matterでも指定可能）
  membership: z.string().optional().describe('追加するメンバーシッププラン（light, support, standard, premium, all）。Front Matterのmembershipでも指定可能'),
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
        membership: {
          type: 'string',
          description: '追加するメンバーシッププラン（light, support, standard, premium, all）。Front Matterのmembershipより優先',
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
        membership: params.membership,
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

