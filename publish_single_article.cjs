const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATE_PATH = '/home/sol/.note-state.json';
const ARTICLE_PATH = process.argv[2];
const THUMBNAIL_PATH = process.argv[3] || null;

if (!ARTICLE_PATH) {
  console.error('Usage: node publish_single_article.cjs <article.md> [thumbnail.png]');
  process.exit(1);
}

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

function parseMarkdown(content) {
  const lines = content.split('\n');
  let title = '';
  let body = '';
  const tags = [];
  let price;
  let inFrontMatter = false;
  let frontMatterEnded = false;
  let inTagsArray = false;
  let paidLineParagraphIndex = -1;  // 有料ラインの段落インデックス
  let currentParagraphIndex = 0;    // 現在の段落インデックス
  let lastLineWasEmpty = true;      // 段落をカウントするため
  let lastParagraphText = '';       // <!-- paid -->の直前の段落テキスト
  let currentParagraphText = '';    // 現在の段落テキスト

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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
      if (line.startsWith('title:')) {
        title = line.substring(6).trim().replace(/^["']|["']$/g, '');
        inTagsArray = false;
      } else if (line.startsWith('price:')) {
        const p = parseInt(line.substring(6).trim(), 10);
        if (!isNaN(p) && p >= 100) price = p;
        inTagsArray = false;
      } else if (line.startsWith('tags:')) {
        const tagsStr = line.substring(5).trim();
        if (tagsStr.startsWith('[') && tagsStr.endsWith(']')) {
          tags.push(...tagsStr.slice(1, -1).split(',').map(t => t.trim().replace(/^["']|["']$/g, '')));
          inTagsArray = false;
        } else if (tagsStr === '') {
          inTagsArray = true;
        }
      } else if (inTagsArray && line.trim().startsWith('-')) {
        const tag = line.trim().substring(1).trim().replace(/^["']|["']$/g, '');
        if (tag) tags.push(tag);
      } else if (line.match(/^\w+:/)) {
        inTagsArray = false;
      }
      continue;
    }
    if (!title && line.startsWith('# ')) {
      title = line.substring(2).trim();
      continue;
    }

    // 有料ラインの検出 - 段落インデックスと直前の段落テキストを記録
    if (line.trim() === '<!-- paid -->') {
      paidLineParagraphIndex = currentParagraphIndex;
      lastParagraphText = currentParagraphText.trim();
      continue;  // <!-- paid -->は本文に追加しない
    }

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
    hasPaidLine: paidLineParagraphIndex > 0,
    paidLineParagraphIndex,
    paidLineSearchText: lastParagraphText.substring(0, 30)  // 検索用に最初の30文字
  };
}

async function publishArticle(page, filePath, thumbnailPath) {
  const mdContent = fs.readFileSync(filePath, 'utf-8');
  const { title, body, tags, price, hasPaidLine, paidLineParagraphIndex, paidLineSearchText } = parseMarkdown(mdContent);
  const articleDir = path.dirname(filePath);

  log(`タイトル: ${title}`);
  log(`価格: ${price}円`);
  log(`タグ: ${tags.join(', ')}`);
  log(`有料ライン: ${hasPaidLine ? 'あり' : 'なし'}`);

  // 新規記事ページに移動
  await page.goto('https://editor.note.com/new', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('textarea[placeholder*="タイトル"]', { timeout: 60000 });

  // タイトル入力
  await page.fill('textarea[placeholder*="タイトル"]', title);

  // サムネイル画像の設定（エディター画面で設定）
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    log(`サムネイル設定中: ${thumbnailPath}`);

    // 「画像を追加」ボタン（ヘッダー画像用）を探す
    const imgAddBtn = page.locator('button[aria-label="画像を追加"]').first();
    if (await imgAddBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await imgAddBtn.click({ force: true });
      await page.waitForTimeout(300);

      // 「画像をアップロード」ボタンをクリック
      const uploadBtn = page.locator('button:has-text("画像をアップロード")').first();
      if (await uploadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        // ファイル選択ダイアログを待機
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
          uploadBtn.click({ force: true }),
        ]);

        if (fileChooser) {
          await fileChooser.setFiles(thumbnailPath);
          log(`  サムネイルファイルをアップロード`);
        } else {
          // フォールバック: 直接input[type="file"]に設定
          const fileInput = page.locator('input[type="file"]').first();
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(thumbnailPath);
            log(`  サムネイルファイルを設定（フォールバック）`);
          }
        }

        // トリミングダイアログの「保存」ボタンを待機してクリック
        await page.waitForTimeout(1000);
        const dialog = page.locator('div[role="dialog"]');
        if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
          const saveBtn = dialog.locator('button:has-text("保存")').first();
          if (await saveBtn.isVisible().catch(() => false)) {
            await saveBtn.click({ force: true });
            log(`  サムネイルを保存`);
            await page.waitForTimeout(1500);
          }
        }
      }
    } else {
      log(`  警告: 画像追加ボタンが見つかりません`);
    }
  }

  // 本文から画像参照を検出
  const imagePattern = /!\[.*?\]\(\.\/(images\/[\w-]+\.(png|jpg|jpeg|gif|webp))\)/gi;
  let match;
  const imagesToInsert = [];

  while ((match = imagePattern.exec(body)) !== null) {
    const relativePath = match[1];
    const absolutePath = path.join(articleDir, relativePath);
    if (fs.existsSync(absolutePath)) {
      imagesToInsert.push({
        placeholder: match[0],
        absolutePath: absolutePath
      });
      log(`  画像検出: ${relativePath}`);
    } else {
      log(`  警告: 画像が見つかりません: ${absolutePath}`);
    }
  }

  // 本文入力（画像がある場合は分割挿入）
  const bodyBox = page.locator('div[contenteditable="true"][role="textbox"]').first();
  await bodyBox.waitFor({ state: 'visible' });
  await bodyBox.click();

  if (imagesToInsert.length > 0) {
    log(`  画像付き本文を挿入中... (${imagesToInsert.length}枚)`);

    let remainingBody = body;
    for (const imageInfo of imagesToInsert) {
      const parts = remainingBody.split(imageInfo.placeholder);
      if (parts.length >= 2) {
        // 画像の前のテキストを挿入
        const textBefore = parts[0];
        if (textBefore.trim()) {
          await page.evaluate((text) => navigator.clipboard.writeText(text), textBefore);
          await page.waitForTimeout(50);
          await page.keyboard.press('Control+v');
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
          await page.keyboard.press('Control+v');
          await page.waitForTimeout(1500); // 画像アップロード待ち
          log(`  画像挿入完了: ${path.basename(imageInfo.absolutePath)}`);
        } catch (imgErr) {
          log(`  警告: 画像挿入失敗: ${imageInfo.absolutePath} - ${imgErr.message}`);
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
      await page.keyboard.press('Control+v');
      await page.waitForTimeout(200);
    }
  } else {
    // 画像なしの場合は一括ペースト
    log(`  テキストのみの本文を挿入中...`);
    await page.evaluate((text) => navigator.clipboard.writeText(text), body);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(500);
  }

  // 公開に進む
  const proceedBtn = page.locator('button:has-text("公開に進む")').first();
  await proceedBtn.waitFor({ state: 'visible', timeout: 30000 });
  for (let i = 0; i < 10; i++) {
    if (await proceedBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(100);
  }
  await proceedBtn.click({ force: true });

  // 公開設定画面を待機
  await Promise.race([
    page.waitForURL(/\/publish/i, { timeout: 30000 }),
    page.locator('button:has-text("投稿する")').first().waitFor({ state: 'visible', timeout: 30000 }),
  ]).catch(() => {});

  await page.waitForTimeout(1500);

  // タグ入力
  if (tags.length > 0) {
    log(`タグを入力中...`);
    let tagInput = page.locator('input[placeholder*="ハッシュタグ"]').first();
    if (!(await tagInput.isVisible().catch(() => false))) {
      tagInput = page.locator('input[role="combobox"]').first();
    }
    if (await tagInput.isVisible().catch(() => false)) {
      for (const tag of tags) {
        await tagInput.click();
        await tagInput.fill(tag);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
      }
    }
  }

  // 有料設定
  let isPaidArticle = false;
  if (price && price >= 100) {
    const paidLabel = page.locator('label:has-text("有料")').first();
    if (await paidLabel.isVisible().catch(() => false)) {
      await paidLabel.click();
      isPaidArticle = true;
      await page.waitForTimeout(500);

      // 価格入力
      const priceInput = page.locator('input[type="text"][placeholder="300"]').first();
      if (await priceInput.isVisible().catch(() => false)) {
        await priceInput.fill('');
        await priceInput.fill(String(price));
        log(`価格設定完了: ${price}円`);
      } else {
        const textInputs = page.locator('input[type="text"]');
        const count = await textInputs.count();
        for (let i = 0; i < count; i++) {
          const inp = textInputs.nth(i);
          const val = await inp.inputValue().catch(() => '');
          if (/^\d+$/.test(val)) {
            await inp.fill('');
            await inp.fill(String(price));
            log(`価格設定完了: ${price}円`);
            break;
          }
        }
      }
      await page.waitForTimeout(300);
    }
  }

  // 有料記事の場合: 「有料エリア設定」→「投稿する」の2段階
  const paidAreaBtn = page.locator('button:has-text("有料エリア設定")').first();
  let publishBtn = page.locator('button:has-text("投稿する")').first();

  await page.waitForTimeout(500);
  if (await paidAreaBtn.isVisible().catch(() => false)) {
    log(`有料エリア設定をクリック`);
    await paidAreaBtn.click({ force: true });

    // 有料エリア設定画面を待機
    await page.waitForTimeout(2000);

    // 有料ラインの設定
    // note.comの有料エリア設定画面では、各段落の横に「ラインをこの場所に変更」ボタンがある
    // paidLineSearchTextを使って段落を検索し、その直後のボタンをクリックする
    if (hasPaidLine && paidLineParagraphIndex > 0) {
      log(`  有料ライン位置を設定中...`);
      log(`  検索テキスト: "${paidLineSearchText}"`);

      // デバッグ: 有料エリア設定画面のスクリーンショットを保存
      await page.screenshot({ path: '/tmp/note-paid-area-settings.png', fullPage: true }).catch(() => {});

      // 段落要素をすべて取得
      const paragraphs = page.locator('p');
      const pCount = await paragraphs.count().catch(() => 0);
      log(`  段落数: ${pCount}`);

      // paidLineSearchTextを含む段落を検索
      let targetParagraphIndex = -1;
      if (paidLineSearchText && paidLineSearchText.length > 5) {
        for (let i = 0; i < pCount; i++) {
          try {
            const text = await paragraphs.nth(i).textContent().catch(() => '');
            if (text && text.includes(paidLineSearchText)) {
              targetParagraphIndex = i;
              log(`  検索テキストを含む段落を発見: p[${i}]`);
              break;
            }
          } catch (e) {
            // 無視
          }
        }
      }

      // 「ラインをこの場所に変更」ボタンをすべて取得
      const changeLineButtons = page.locator('button:has-text("ラインをこの場所に変更")');
      const btnCount = await changeLineButtons.count().catch(() => 0);
      log(`  「ラインをこの場所に変更」ボタン: ${btnCount}個`);

      // 検索で見つかった段落の直後のボタンをクリック
      // 見つからない場合はpaidLineParagraphIndexを使用
      let buttonIndex = targetParagraphIndex >= 0 ? targetParagraphIndex : (paidLineParagraphIndex - 1);

      if (buttonIndex >= 0 && buttonIndex < btnCount) {
        await changeLineButtons.nth(buttonIndex).click({ force: true });
        log(`  有料ラインを設定: ボタン[${buttonIndex}]`);
        await page.waitForTimeout(1000);
      } else {
        log(`  警告: 対応するボタンが見つかりません (target: ${buttonIndex}, buttons: ${btnCount})`);
      }
    } else if (hasPaidLine && paidLineParagraphIndex === 0) {
      log(`  有料ラインが最初の位置のため、デフォルト設定を使用`);
    }

    publishBtn = page.locator('button:has-text("投稿する")').first();
    await publishBtn.waitFor({ state: 'visible', timeout: 30000 });
  } else if (isPaidArticle) {
    log(`警告: 有料記事だが有料エリア設定ボタンが見つかりません`);
    await publishBtn.waitFor({ state: 'visible', timeout: 30000 });
  } else {
    await publishBtn.waitFor({ state: 'visible', timeout: 30000 });
  }

  // ボタンが有効になるまで待機
  for (let i = 0; i < 30; i++) {
    if (await publishBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await publishBtn.click({ force: true });
  log(`投稿ボタンをクリック`);

  // 確認モーダルの「OK」ボタンをクリック
  const okSelectors = [
    '[role="dialog"] button:first-of-type',
    'button:has-text("OK")',
    'button:has-text("ok")',
    'button:has-text("確認")',
    'button:has-text("はい")',
    '.modal button:first-of-type',
  ];
  let modalClicked = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(500);
    for (const selector of okSelectors) {
      const okBtn = page.locator(selector).first();
      if (await okBtn.isVisible().catch(() => false)) {
        await okBtn.click({ force: true });
        log(`確認モーダルをクリック (${selector})`);
        modalClicked = true;
        break;
      }
    }
    if (modalClicked) break;
  }
  if (!modalClicked) {
    log(`警告: 確認モーダルが見つかりませんでした`);
  }

  // 完了待機
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
    log(`警告: 投稿完了を確認できませんでした`);
  }

  const finalUrl = page.url();
  log(`投稿完了: ${finalUrl}`);
  return finalUrl;
}

async function main() {
  log(`=== 記事投稿開始 ===`);
  log(`記事: ${ARTICLE_PATH}`);
  if (THUMBNAIL_PATH) {
    log(`サムネイル: ${THUMBNAIL_PATH}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--lang=ja-JP'],
  });

  const context = await browser.newContext({
    storageState: STATE_PATH,
    locale: 'ja-JP',
    permissions: ['clipboard-read', 'clipboard-write'],
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://editor.note.com' });

  const page = await context.newPage();
  page.setDefaultTimeout(180000);

  try {
    const url = await publishArticle(page, ARTICLE_PATH, THUMBNAIL_PATH);
    log(`=== 投稿成功 ===`);
    log(`URL: ${url}`);
  } catch (e) {
    log(`エラー: ${e.message}`);
    await page.screenshot({ path: '/tmp/note-publish-error.png', fullPage: true }).catch(() => {});
    log(`スクリーンショット保存: /tmp/note-publish-error.png`);
  }

  await browser.close();
}

main().catch(e => {
  log(`致命的エラー: ${e.message}`);
  process.exit(1);
});
