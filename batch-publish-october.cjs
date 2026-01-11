const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATE_PATH = '/home/sol/.note-state.json';
const ARTICLES_DIR = '/home/sol/allforceshp/october_2025_articles/october_2025_articles';
const LOG_FILE = '/home/sol/allforceshp/october_2025_publish_log.txt';

// 開始番号と終了番号（コマンドライン引数で指定可能）
const START_NUM = parseInt(process.argv[2] || '0', 10);
const END_NUM = parseInt(process.argv[3] || '59', 10);
const DEFAULT_PRICE = parseInt(process.argv[4] || '300', 10);

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
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

  // <!-- paid --> コメントの位置を検出
  let paidLineParagraphIndex = -1;
  let currentParagraphIndex = 0;
  let lastLineWasEmpty = true;
  let lastParagraphText = '';
  let currentParagraphText = '';

  for (const line of lines) {
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

    // <!-- paid --> コメントの検出 - 段落インデックスと直前の段落テキストを記録
    if (line.trim() === '<!-- paid -->') {
      paidLineParagraphIndex = currentParagraphIndex;
      lastParagraphText = currentParagraphText.trim();
      continue; // <!-- paid --> は本文から除外
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
    paidLineSearchText: lastParagraphText.substring(0, 30)
  };
}

async function publishArticle(page, filePath, defaultPrice) {
  const mdContent = fs.readFileSync(filePath, 'utf-8');
  const { title, body, tags, price: mdPrice, hasPaidLine, paidLineParagraphIndex, paidLineSearchText } = parseMarkdown(mdContent);
  const price = mdPrice || defaultPrice;

  log(`  タイトル: ${title}`);
  log(`  価格: ${price}円`);
  if (hasPaidLine) {
    log(`  有料ライン: あり (検索テキスト: "${paidLineSearchText}")`);
  }

  // 新規記事ページに移動
  await page.goto('https://editor.note.com/new', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('textarea[placeholder*="タイトル"]', { timeout: 60000 });

  // タイトル入力
  await page.fill('textarea[placeholder*="タイトル"]', title);

  // 本文入力
  const bodyBox = page.locator('div[contenteditable="true"][role="textbox"]').first();
  await bodyBox.waitFor({ state: 'visible' });
  await bodyBox.click();
  await page.evaluate((text) => navigator.clipboard.writeText(text), body);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(500);

  // 本文ペースト後、エディターが安定するまで待機（長い記事用）
  log(`  エディターの安定を待機中...`);
  await page.waitForTimeout(10000);

  // 公開に進む（長い記事の場合レンダリングに時間がかかる）
  const proceedBtn = page.locator('button:has-text("公開に進む")').first();
  await proceedBtn.waitFor({ state: 'visible', timeout: 60000 });

  // ボタンが有効になるまで待機
  for (let i = 0; i < 60; i++) {
    if (await proceedBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(500);
  }

  // クリック前のURLを記録
  const urlBeforeClick = page.url();
  log(`  現在のURL: ${urlBeforeClick}`);

  await proceedBtn.click({ force: true });
  log(`  公開設定画面に移動中...`);

  // ページ遷移を確認（URLが変わるまで待機）
  let navigated = false;
  for (let i = 0; i < 60; i++) {
    const currentUrl = page.url();
    if (currentUrl !== urlBeforeClick || currentUrl.includes('/publish')) {
      navigated = true;
      log(`  ページ遷移確認: ${currentUrl}`);
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!navigated) {
    log(`  警告: ページ遷移が確認できません。再クリックを試行...`);
    await proceedBtn.click({ force: true });
    await page.waitForTimeout(5000);
  }

  // 公開設定画面が完全に読み込まれるまで待機（長い記事用に延長）
  await page.waitForTimeout(5000);

  // タグ入力（タグがある場合のみ）
  if (tags.length > 0) {
    log(`  タグ: ${tags.join(', ')}`);
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

  // 有料設定
  let isPaidArticle = false;
  const paidLabel = page.locator('label:has-text("有料")').first();
  if (await paidLabel.isVisible().catch(() => false)) {
    await paidLabel.click();
    isPaidArticle = true;
    await page.waitForTimeout(1500); // 有料設定が反映されるまで待機（長い記事用に延長）

    // 価格入力欄を探す（type="text"でplaceholder="300"のもの）
    const priceInput = page.locator('input[type="text"][placeholder="300"]').first();
    if (await priceInput.isVisible().catch(() => false)) {
      await priceInput.fill('');
      await priceInput.fill(String(price));
      log(`  価格設定完了: ${price}円`);
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
          log(`  価格設定完了: ${price}円`);
          break;
        }
      }
    }
    await page.waitForTimeout(300); // 価格設定が反映されるまで待機
  }

  // 有料記事の場合: 「有料エリア設定」→「投稿する」の2段階
  // 無料記事の場合: 「投稿する」のみ
  const paidAreaBtn = page.locator('button:has-text("有料エリア設定")').first();
  let publishBtn = page.locator('button:has-text("投稿する")').first();

  // 有料エリア設定ボタンが表示されているか確認（有料を選択した場合に表示される）
  await page.waitForTimeout(500);
  if (await paidAreaBtn.isVisible().catch(() => false)) {
    log(`  有料エリア設定をクリック`);
    await paidAreaBtn.click({ force: true });

    // 有料エリア設定画面を待機（長い記事用に延長）
    await page.waitForTimeout(5000);

    // 有料ラインの設定
    // paidLineSearchTextを使って段落を検索し、その直後のボタンをクリックする
    if (hasPaidLine && paidLineParagraphIndex > 0) {
      log(`  有料ライン位置を設定中...`);

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
    // 有料を選択したがボタンが見つからない場合はエラー
    log(`  警告: 有料記事だが有料エリア設定ボタンが見つかりません`);
    await publishBtn.waitFor({ state: 'visible', timeout: 30000 });
  } else {
    // 無料記事の場合は「投稿する」ボタンを待機
    await publishBtn.waitFor({ state: 'visible', timeout: 30000 });
  }

  // ボタンが有効になるまで待機
  for (let i = 0; i < 30; i++) {
    if (await publishBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(200);
  }
  await publishBtn.click({ force: true });
  log(`  投稿ボタンをクリック`);

  // 確認モーダルの「OK」ボタンをクリック（モーダルが表示されるまでループで待機）
  const okSelectors = [
    '[role="dialog"] button:first-of-type',
    'button:has-text("OK")',
    'button:has-text("ok")',
    'button:has-text("確認")',
    'button:has-text("はい")',
    '.modal button:first-of-type',
  ];
  let modalClicked = false;
  for (let attempt = 0; attempt < 10; attempt++) { // 最大5秒待機
    await page.waitForTimeout(500);
    for (const selector of okSelectors) {
      const okBtn = page.locator(selector).first();
      if (await okBtn.isVisible().catch(() => false)) {
        await okBtn.click({ force: true });
        log(`  確認モーダルをクリック (${selector})`);
        modalClicked = true;
        break;
      }
    }
    if (modalClicked) break;
  }
  if (!modalClicked) {
    log(`  警告: 確認モーダルが見つかりませんでした`);
  }

  // 完了待機：URLが/publishから変わるまで、または完了メッセージが出るまで待機
  let published = false;
  for (let i = 0; i < 60; i++) { // 最大30秒待機
    const currentUrl = page.url();
    // /publish/ を含まなくなったら完了
    if (!/\/publish/i.test(currentUrl)) {
      published = true;
      break;
    }
    // 完了メッセージを確認
    const successText = await page.locator('text=投稿しました').first().isVisible().catch(() => false);
    if (successText) {
      published = true;
      await page.waitForTimeout(2000);
      break;
    }
    await page.waitForTimeout(500);
  }

  if (!published) {
    log(`  警告: 投稿完了を確認できませんでした`);
  }

  const finalUrl = page.url();
  log(`  投稿完了: ${finalUrl}`);
  return finalUrl;
}

async function main() {
  log(`=== October 2025 バッチ投稿開始 (${START_NUM}〜${END_NUM}) ===`);

  // ファイル一覧を取得してソート
  const allFiles = fs.readdirSync(ARTICLES_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort((a, b) => {
      const numA = parseInt(a.split('_')[0], 10);
      const numB = parseInt(b.split('_')[0], 10);
      return numA - numB;
    });

  log(`総ファイル数: ${allFiles.length}`);

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

  let successCount = 0;
  let failCount = 0;
  const processedNums = new Set();

  for (const file of allFiles) {
    const num = parseInt(file.split('_')[0], 10);

    // 範囲外はスキップ
    if (num < START_NUM || num > END_NUM) continue;

    // 同じ番号は1回だけ処理（重複ファイルがある場合）
    if (processedNums.has(num)) {
      log(`記事${num}: スキップ（既に処理済み）`);
      continue;
    }
    processedNums.add(num);

    const filePath = path.join(ARTICLES_DIR, file);
    log(`記事${num}: ${file}`);

    try {
      await publishArticle(page, filePath, DEFAULT_PRICE);
      successCount++;
      log(`記事${num}: 成功`);
    } catch (e) {
      failCount++;
      log(`記事${num}: 失敗 - ${e.message}`);
      await page.screenshot({ path: `/tmp/note-error-oct-${num}.png`, fullPage: true }).catch(() => {});
    }

    // 次の記事の前に待機（レート制限回避）
    await page.waitForTimeout(3000);
  }

  await browser.close();

  log(`=== バッチ投稿完了 ===`);
  log(`成功: ${successCount}, 失敗: ${failCount}`);
}

main().catch(e => {
  log(`致命的エラー: ${e.message}`);
  process.exit(1);
});
