const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== 設定 ==========
const STATE_PATH = process.env.NOTE_POST_MCP_STATE_PATH || path.join(os.homedir(), '.note-state.json');
const LOG_FILE = './membership_benefit_log.txt';
const PROGRESS_FILE = './membership_progress.json';

// 記事データソース
const ARTICLES_JSON = path.resolve(__dirname, '../allforceshp/note-article-classified.json');

// プラン名マッピング（note.com UI上の表示テキスト）
// 2026-02-11 確認済みのUI表示:
//   メンバー全員に公開
//   ライトプラン｜AI活用 読み放題プラン
//   AI論文プラン
//   スタンダードプラン｜AI活用＋限定特典
//   プレミアムプラン｜個別相談＋全特典
const PLAN_PATTERNS = {
  'light': 'ライトプラン',
  'paper': 'AI論文プラン',
  'standard': 'スタンダードプラン',
  'premium': 'プレミアムプラン',
  'all': 'メンバー全員に公開'
};

// ========== CLI引数 ==========
// Usage:
//   node add-membership-benefit.cjs --plan light,paper,standard,premium [--dry-run] [--limit N] [--resume]
//   node add-membership-benefit.cjs --plan light --after 2026-01-18
//   node add-membership-benefit.cjs --debug-first
//
// --plan: カンマ区切りで複数プラン指定可。1回の訪問でまとめて追加。
// --after/--before: 日付フィルタ
// --resume: 前回の続きから（completed URLをスキップ）
// --debug-first: 1記事だけ処理してスクリーンショット確認
// --headless: ヘッドレスモード

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const PLAN_ARG = getArg('plan');
const AFTER_DATE = getArg('after');
const BEFORE_DATE = getArg('before');
const DRY_RUN = hasFlag('dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : 0;
const RESUME = hasFlag('resume');
const DEBUG_FIRST = hasFlag('debug-first');
const HEADLESS = hasFlag('headless');
const INCLUDE_FREE = hasFlag('include-free');

// ========== ログ ==========
function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ========== 日付パース ==========
function parseArticleDate(dateStr) {
  const m = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

function parseISODate(str) {
  const parts = str.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

// ========== 進捗管理 ==========
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { completed: [], failed: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ========== ブラウザ管理 ==========
let browser = null;
let context = null;
let page = null;

async function launchBrowser() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  browser = await chromium.launch({ headless: HEADLESS, slowMo: 50 });
  context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  return page;
}

async function restartBrowser() {
  log('ブラウザを再起動中...');
  try { await browser.close(); } catch {}
  await new Promise(r => setTimeout(r, 2000));
  await launchBrowser();
  // ログイン確認
  await page.goto('https://note.com/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  if (page.url().includes('login')) {
    throw new Error('再起動後もログインが必要です');
  }
  log('ブラウザ再起動完了');
}

// ========== メイン ==========
async function main() {
  // プラン解析（カンマ区切り対応）
  if (!PLAN_ARG && !DEBUG_FIRST) {
    console.error('エラー: --plan が必要です');
    console.error('Usage: node add-membership-benefit.cjs --plan light,paper,standard,premium');
    process.exit(1);
  }

  const planNames = (PLAN_ARG || 'light').split(',').map(s => s.trim());
  const planEntries = [];
  for (const name of planNames) {
    const pattern = PLAN_PATTERNS[name];
    if (!pattern) {
      console.error(`エラー: 不明なプラン "${name}". 有効: ${Object.keys(PLAN_PATTERNS).join(', ')}`);
      process.exit(1);
    }
    planEntries.push({ name, pattern });
  }

  // 記事データ読み込み
  if (!fs.existsSync(ARTICLES_JSON)) {
    log(`エラー: 記事データが見つかりません: ${ARTICLES_JSON}`);
    process.exit(1);
  }
  const allArticles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));

  // フィルタリング
  let filtered = allArticles.filter(a => {
    if (!INCLUDE_FREE && (a.price === '無料' || a.price === '¥0')) return false;
    const dt = parseArticleDate(a.date || '');
    if (!dt) return false;
    if (AFTER_DATE && dt < parseISODate(AFTER_DATE)) return false;
    if (BEFORE_DATE && dt >= parseISODate(BEFORE_DATE)) return false;
    return true;
  });

  // レジューム
  const progress = RESUME ? loadProgress() : { completed: [], failed: [] };
  const completedSet = new Set(progress.completed);
  if (RESUME) {
    const before = filtered.length;
    filtered = filtered.filter(a => !completedSet.has(a.url));
    log(`レジューム: ${before - filtered.length}件の処理済みをスキップ`);
  }

  if (LIMIT > 0) filtered = filtered.slice(0, LIMIT);
  if (DEBUG_FIRST) filtered = filtered.slice(0, 1);

  log('============================================================');
  log('メンバーシップ特典追加スクリプト v3 (複数プラン一括対応)');
  log(`プラン: ${planEntries.map(p => `${p.name}(${p.pattern})`).join(', ')}`);
  log(`日付フィルタ: ${AFTER_DATE ? 'after ' + AFTER_DATE : ''} ${BEFORE_DATE ? 'before ' + BEFORE_DATE : ''} ${!AFTER_DATE && !BEFORE_DATE ? 'なし' : ''}`);
  log(`対象記事: ${filtered.length}件`);
  log(`ドライラン: ${DRY_RUN}`);
  log(`レジューム: ${RESUME} (処理済み: ${completedSet.size}件)`);
  log('============================================================');

  if (filtered.length === 0) {
    log('対象記事がありません。終了します。');
    process.exit(0);
  }

  if (!fs.existsSync(STATE_PATH)) {
    log(`エラー: 認証状態ファイルが見つかりません: ${STATE_PATH}`);
    process.exit(1);
  }

  await launchBrowser();

  // ログイン確認
  log('ログイン確認中...');
  await page.goto('https://note.com/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  if (page.url().includes('login')) {
    log('エラー: ログインが必要です');
    await browser.close();
    process.exit(1);
  }
  log('ログイン確認OK');

  let processed = 0;
  let totalAdded = 0;
  let totalAlready = 0;
  let errors = 0;
  let consecutiveErrors = 0;

  for (let i = 0; i < filtered.length; i++) {
    const article = filtered[i];
    processed++;
    const title = article.title.substring(0, 50);
    const articleUrl = `https://note.com${article.url}`;

    log(`\n[${processed}/${filtered.length}] ${title}...`);

    try {
      // 記事ページに移動
      await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // 「...」メニューボタンを探す
      const moreButton = await findMoreButton(page);
      if (!moreButton) {
        log('  警告: メニューボタンが見つかりません');
        progress.failed.push(article.url);
        saveProgress(progress);
        errors++;
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          log('  連続エラー5件 → ブラウザ再起動');
          await restartBrowser();
          consecutiveErrors = 0;
        }
        continue;
      }

      // メニューを開く
      await moreButton.click();
      await page.waitForTimeout(1000);

      // 「メンバーシップ特典追加・解除」を探す
      const membershipMenuItem = await findMembershipMenuItem(page);
      if (!membershipMenuItem) {
        log('  警告: メンバーシップメニューが見つかりません');
        await page.keyboard.press('Escape');
        progress.failed.push(article.url);
        saveProgress(progress);
        errors++;
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          log('  連続エラー5件 → ブラウザ再起動');
          await restartBrowser();
          consecutiveErrors = 0;
        }
        continue;
      }

      await membershipMenuItem.click();
      await page.waitForTimeout(2000);

      // デバッグ
      if (DEBUG_FIRST || processed <= 2) {
        await page.screenshot({ path: `/tmp/note-membership-modal-${processed}.png` });
        log(`  デバッグ: /tmp/note-membership-modal-${processed}.png`);
      }

      // 各プランを処理
      let articleAdded = 0;
      let articleAlready = 0;
      for (const plan of planEntries) {
        const result = await findPlanAddButton(page, plan.pattern, plan.name);

        if (result === 'already_added') {
          articleAlready++;
          continue;
        }

        if (!result) {
          log(`  警告: ${plan.name}プランのボタンが見つかりません`);
          continue;
        }

        if (DRY_RUN) {
          log(`  [dry] ${plan.name}: 追加可能`);
          articleAdded++;
          continue;
        }

        await result.click();
        await page.waitForTimeout(1500);
        articleAdded++;
        log(`  ${plan.name}: 追加`);
      }

      totalAdded += articleAdded;
      totalAlready += articleAlready;

      if (articleAdded > 0 || articleAlready > 0) {
        const summary = [];
        if (articleAdded > 0) summary.push(`追加${articleAdded}`);
        if (articleAlready > 0) summary.push(`済${articleAlready}`);
        log(`  → ${summary.join(', ')} / ${planEntries.length}プラン`);
      }

      await closeModal(page);
      progress.completed.push(article.url);
      saveProgress(progress);
      consecutiveErrors = 0;

      // レート制限
      await page.waitForTimeout(500);

    } catch (err) {
      log(`  エラー: ${err.message}`);
      errors++;
      progress.failed.push(article.url);
      saveProgress(progress);
      consecutiveErrors++;

      // ブラウザクラッシュ検出 → 再起動
      if (err.message.includes('closed') || err.message.includes('crashed') || err.message.includes('Target')) {
        log('ブラウザクラッシュ検出 → 再起動');
        try {
          await restartBrowser();
          consecutiveErrors = 0;
        } catch (restartErr) {
          log(`ブラウザ再起動失敗: ${restartErr.message}`);
          break;
        }
      } else if (consecutiveErrors >= 5) {
        log('連続エラー5件 → ブラウザ再起動');
        try {
          await restartBrowser();
          consecutiveErrors = 0;
        } catch (restartErr) {
          log(`ブラウザ再起動失敗: ${restartErr.message}`);
          break;
        }
      } else {
        try { await page.keyboard.press('Escape'); } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 100件ごとにレポート
    if (processed % 100 === 0) {
      log(`\n--- 中間レポート (${processed}/${filtered.length}) ---`);
      log(`  追加: ${totalAdded} | 追加済: ${totalAlready} | エラー: ${errors}`);
    }
  }

  // 最終レポート
  log('\n============================================================');
  log('処理完了');
  log(`  処理記事数: ${processed}`);
  log(`  プラン追加: ${totalAdded}`);
  log(`  追加済スキップ: ${totalAlready}`);
  log(`  エラー: ${errors}`);
  log(`  完了URL数: ${progress.completed.length}`);
  log('============================================================');

  try { await browser.close(); } catch {}
}

// ========== ヘルパー関数 ==========

async function findMoreButton(page) {
  const byLabel = page.locator('button[aria-label*="メニュー"], button[aria-label*="more"], button[aria-label*="その他"]').first();
  if (await byLabel.isVisible().catch(() => false)) return byLabel;

  const dotsButtons = page.locator('button:has(svg)');
  const count = await dotsButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = dotsButtons.nth(i);
    const text = await btn.textContent().catch(() => '');
    if (text.trim() === '' && await btn.isVisible().catch(() => false)) {
      const box = await btn.boundingBox().catch(() => null);
      if (box && box.y < 500) return btn;
    }
  }

  const ellipsis = page.locator('button:has-text("…"), button:has-text("⋯")').first();
  if (await ellipsis.isVisible().catch(() => false)) return ellipsis;

  const byClass = page.locator('[class*="more-button"], [class*="moreButton"], [class*="menu-trigger"]').first();
  if (await byClass.isVisible().catch(() => false)) return byClass;

  return null;
}

async function findMembershipMenuItem(page) {
  const byText = page.locator('text=メンバーシップ特典').first();
  if (await byText.isVisible().catch(() => false)) return byText;

  const byPartial = page.locator('text=メンバーシップ').first();
  if (await byPartial.isVisible().catch(() => false)) return byPartial;

  const menuItems = page.locator('[role="menuitem"], [class*="dropdown"] a, [class*="menu"] a, [class*="popup"] a, [class*="menu"] li');
  const count = await menuItems.count();
  for (let i = 0; i < count; i++) {
    const item = menuItems.nth(i);
    const text = await item.textContent().catch(() => '');
    if (text.includes('メンバーシップ') || text.includes('特典')) return item;
  }

  return null;
}

async function findPlanAddButton(page, planPattern, planName) {
  try {
    const listItems = page.locator('[class*="modal"] li, [role="dialog"] li, [class*="Modal"] li');
    const count = await listItems.count();
    for (let i = 0; i < count; i++) {
      const item = listItems.nth(i);
      const text = await item.textContent().catch(() => '');
      if (text.includes(planPattern)) {
        if (text.includes('追加済') || text.includes('解除')) return 'already_added';
        const addBtn = item.locator('button:has-text("追加")').first();
        if (await addBtn.isVisible().catch(() => false)) {
          const btnText = await addBtn.textContent().catch(() => '');
          return btnText.includes('追加済') ? 'already_added' : addBtn;
        }
      }
    }
  } catch {}

  try {
    const planText = page.getByText(planPattern, { exact: false }).first();
    if (await planText.isVisible().catch(() => false)) {
      for (const ancestor of ['..', '../..', '../../..']) {
        const parent = planText.locator(ancestor).first();
        const fullText = await parent.textContent().catch(() => '');
        if (fullText.includes('追加済') || fullText.includes('解除')) return 'already_added';
        const addBtn = parent.locator('button:has-text("追加")').first();
        if (await addBtn.isVisible().catch(() => false)) {
          const btnText = await addBtn.textContent().catch(() => '');
          if (!btnText.includes('追加済')) return addBtn;
        }
      }
    }
  } catch {}

  return null;
}

async function closeModal(page) {
  try {
    const closeBtn = page.locator('button:has-text("閉じる")').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch {
    try { await page.keyboard.press('Escape'); } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(err => {
  log(`未処理エラー: ${err.message}`);
  process.exit(1);
});
