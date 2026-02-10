const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== 設定 ==========
const STATE_PATH = process.env.NOTE_POST_MCP_STATE_PATH || path.join(os.homedir(), '.note-state.json');
const LOG_FILE = './membership_benefit_log.txt';

// コマンドライン引数
// Usage: node add-membership-benefit.cjs [year] [month] [--dry-run] [--limit N]
// 例: node add-membership-benefit.cjs 2026 1
// 例: node add-membership-benefit.cjs 2026 1 --dry-run
// 例: node add-membership-benefit.cjs 2026 1 --limit 10
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const LIMIT = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : 0; // 0 = no limit

// 数値引数を抽出
const numArgs = args.filter(a => !a.startsWith('--') && !isNaN(parseInt(a, 10)));
const YEAR = numArgs[0] ? parseInt(numArgs[0], 10) : new Date().getFullYear();
const MONTH = numArgs[1] ? parseInt(numArgs[1], 10) : new Date().getMonth() + 1;

// メンバーシップ名（部分一致で検索）
const MEMBERSHIP_NAME = 'AIｘ副業';

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function main() {
  log('============================================================');
  log('メンバーシップ特典追加スクリプト開始');
  log(`対象期間: ${YEAR}年${MONTH}月`);
  log(`ドライラン: ${DRY_RUN}`);
  log(`処理上限: ${LIMIT || '無制限'}`);
  log('============================================================');

  // 認証状態を読み込み
  if (!fs.existsSync(STATE_PATH)) {
    log(`エラー: 認証状態ファイルが見つかりません: ${STATE_PATH}`);
    log('先にnote-post MCPでログインしてください');
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

  const browser = await chromium.launch({
    headless: false,  // デバッグ用に表示
    slowMo: 100       // 操作を見やすく
  });

  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  try {
    // 記事一覧ページに移動
    log('記事一覧ページに移動中...');
    await page.goto('https://note.com/notes', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // ログイン確認
    const loginBtn = await page.$('a[href*="login"]');
    if (loginBtn) {
      log('エラー: ログインが必要です');
      await browser.close();
      process.exit(1);
    }
    log('ログイン確認OK');

    // Step 1: 「期間」フィルターをクリック
    log('期間フィルターを探索中...');

    // 期間フィルターボタンを探す
    const periodButton = await page.$('button:has-text("期間")') ||
                         await page.$('[data-testid*="period"]') ||
                         await page.$('.filter-period') ||
                         await page.$('text=期間');

    if (periodButton) {
      log('期間フィルターボタンを発見、クリック...');
      await periodButton.click();
      await page.waitForTimeout(1000);
    } else {
      log('期間フィルターボタンが見つかりません。ページ構造を調査します...');

      // ページ構造をデバッグ出力
      const buttons = await page.$$('button');
      log(`ボタン数: ${buttons.length}`);
      for (let i = 0; i < Math.min(buttons.length, 10); i++) {
        const text = await buttons[i].textContent();
        log(`  Button ${i}: "${text?.substring(0, 50)}"`);
      }

      // すべてのクリック可能な要素を探す
      const clickables = await page.$$('[role="button"], button, a');
      log(`クリック可能要素: ${clickables.length}`);
    }

    // Step 2: 年月を選択
    log(`${YEAR}年${MONTH}月を選択中...`);

    // 年の選択
    const yearSelector = await page.$(`text=${YEAR}年`) ||
                         await page.$(`option:has-text("${YEAR}")`) ||
                         await page.$(`[value="${YEAR}"]`);
    if (yearSelector) {
      await yearSelector.click();
      await page.waitForTimeout(500);
    }

    // 月の選択
    const monthSelector = await page.$(`text=${MONTH}月`) ||
                          await page.$(`option:has-text("${MONTH}月")`) ||
                          await page.$(`[value="${MONTH}"]`);
    if (monthSelector) {
      await monthSelector.click();
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(2000);

    // Step 3: 記事リストを取得
    log('記事リストを取得中...');

    // 記事のリストアイテムを探す
    // note.comの記事リストは .o-articleList__item クラスを持つ
    let articles = await page.$$('.o-articleList__item');

    log(`記事数: ${articles.length}`);

    if (articles.length === 0) {
      log('記事が見つかりません。ページ構造を調査します...');

      // スクリーンショットを保存
      await page.screenshot({ path: '/tmp/note-articles-page.png', fullPage: true });
      log('スクリーンショット保存: /tmp/note-articles-page.png');

      // HTML構造を出力
      const html = await page.content();
      fs.writeFileSync('/tmp/note-articles-page.html', html);
      log('HTML保存: /tmp/note-articles-page.html');

      await browser.close();
      process.exit(1);
    }

    // Step 4: 各記事に対してメンバーシップ特典を追加
    let processed = 0;
    let added = 0;
    let skipped = 0;
    let errors = 0;

    const maxItems = LIMIT > 0 ? Math.min(articles.length, LIMIT) : articles.length;

    for (let i = 0; i < maxItems; i++) {
      processed++;
      log(`\n[${processed}/${maxItems}] 記事を処理中...`);

      try {
        // 記事リストを再取得（DOMが変わる可能性があるため）
        articles = await page.$$('.o-articleList__item');

        if (i >= articles.length) {
          log('  記事がなくなりました');
          break;
        }

        const article = articles[i];

        // 記事タイトルを取得
        const titleEl = await article.$('h2, h3, [class*="title"]');
        const title = titleEl ? (await titleEl.textContent())?.trim().substring(0, 50) : '(タイトル不明)';
        log(`  タイトル: ${title}...`);

        // 三点リーダー（メニュー）を探す - o-articleList__more クラスを使用
        const menuButton = await article.$('.o-articleList__more') ||
                           await article.$('[class*="more"]') ||
                           await article.$('button:has(svg)');

        if (!menuButton) {
          log('  警告: メニューボタンが見つかりません、スキップ');
          skipped++;
          continue;
        }

        // メニューを開く
        await menuButton.click();
        await page.waitForTimeout(500);

        // 「メンバーシップ特典追加・解除」をクリック
        const membershipOption = await page.$('text=メンバーシップ特典追加') ||
                                 await page.$('[data-testid*="membership"]') ||
                                 await page.$('text=特典');

        if (!membershipOption) {
          log('  警告: メンバーシップオプションが見つかりません、スキップ');
          // メニューを閉じる
          await page.keyboard.press('Escape');
          skipped++;
          continue;
        }

        await membershipOption.click();
        await page.waitForTimeout(1500);

        // モーダルが表示されるのを待つ
        log('  モーダル表示を待機中...');

        // デバッグ用：最初の数件でスクリーンショットを取る
        if (processed <= 3) {
          await page.screenshot({ path: `/tmp/note-modal-${processed}.png` });
          log(`  デバッグ: スクリーンショット保存 /tmp/note-modal-${processed}.png`);
        }

        // モーダル内の「AIｘ副業 読み放題プラン」の行を探し、その行の「追加」ボタンをクリック
        // モーダル構造: 各プランは行として並び、右側に「追加」ボタンがある

        let addButton = null;
        let alreadyAdded = false;

        // デバッグ: モーダル内のテキストを確認
        if (processed <= 3) {
          // モーダル要素を特定
          const modalContent = await page.$$eval('[class*="modal"], [class*="Modal"], [role="dialog"]', modals =>
            modals.map(m => ({
              class: m.className,
              html: m.innerHTML?.substring(0, 2000)
            }))
          );
          log(`  デバッグ: モーダル要素数: ${modalContent.length}`);
          if (modalContent.length > 0) {
            // HTMLをファイルに保存
            const fs = require('fs');
            fs.writeFileSync(`/tmp/note-modal-html-${processed}.txt`, JSON.stringify(modalContent, null, 2));
            log(`  デバッグ: モーダルHTML保存: /tmp/note-modal-html-${processed}.txt`);
          }
        }

        // モーダル内のプラン一覧から「AIｘ副業」を探す
        // モーダル構造: modal-content-wrapper > ... > ul > li > div > p(プラン名) + button(追加/追加済)

        // 方法1: モーダル内のliを全て取得し、「AIｘ副業」または「AI x 副業」を含むものを探す
        try {
          log('  方法1: モーダル内のプラン一覧を検索...');

          // モーダル内のプラン一覧（li要素）を取得
          const modalBody = await page.$('.m-basicModalContent__body');
          if (modalBody) {
            const planItems = await modalBody.$$('li');
            log(`  プラン項目数: ${planItems.length}`);

            for (const item of planItems) {
              const itemText = await item.textContent();
              log(`  プラン項目テキスト: "${itemText?.substring(0, 50)}..."`);

              // 「副業」を含むプランを探す（AIｘ副業 読み放題プラン）
              if (itemText && (itemText.includes('副業') || itemText.includes('AI'))) {
                log('  「副業」を含むプランを発見');

                // この項目内のボタンを探す
                const btn = await item.$('button.a-button');
                if (btn) {
                  const btnText = await btn.textContent();
                  log(`  ボタンテキスト: "${btnText?.trim()}"`);

                  if (btnText && btnText.includes('追加') && !btnText.includes('追加済')) {
                    addButton = btn;
                    log('  「追加」ボタンを発見（モーダル内li検索）');
                    break;
                  } else if (btnText && btnText.includes('追加済')) {
                    alreadyAdded = true;
                    log('  スキップ: すでにメンバーシップ特典に追加済み');
                    break;
                  }
                }
              }
            }
          } else {
            log('  警告: モーダル本体が見つかりません');
          }
        } catch (e) {
          log(`  方法1エラー: ${e.message}`);
        }

        // すでに追加済みの場合はスキップ
        if (alreadyAdded) {
          // 「閉じる」ボタンでモーダルを閉じる
          const closeBtn = await page.$('button:has-text("閉じる")');
          if (closeBtn) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(500);
          skipped++;
          continue;
        }

        // 方法2: 直接ボタンを探索（プラン限定公開セクション内の「追加」ボタン、3番目が「AIｘ副業」）
        if (!addButton) {
          log('  方法2: プラン限定公開セクション内のボタンを検索...');

          try {
            // モーダル内のすべての a-button を取得
            const allModalButtons = await page.$$('.modal-content-wrapper button.a-button');
            log(`  モーダル内ボタン数: ${allModalButtons.length}`);

            // ボタンを順番にチェック
            // 構造: メンバー全員に公開(追加済) → AI論文(追加) → AIｘ副業(追加) → 応援プラン(追加)
            // 3番目の「追加」ボタンが「AIｘ副業」に対応するはず
            let addButtonIndex = 0;
            for (let btnIdx = 0; btnIdx < allModalButtons.length; btnIdx++) {
              const btn = allModalButtons[btnIdx];
              const btnText = await btn.textContent();
              const trimmedText = btnText?.trim();
              log(`  ボタン[${btnIdx}]: "${trimmedText}"`);

              // 「追加」ボタン（「追加済」ではない）をカウント
              if (trimmedText === '追加') {
                addButtonIndex++;
                // 2番目の「追加」ボタンが「AIｘ副業」に対応（スクリーンショットから確認）
                // メンバー全員に公開 -> AI論文 -> AIｘ副業(2番目) -> 応援プラン
                if (addButtonIndex === 2) {
                  addButton = btn;
                  log(`  「AIｘ副業」の「追加」ボタンを発見（インデックス: ${btnIdx}）`);
                  break;
                }
              }
            }
          } catch (e) {
            log(`  方法2エラー: ${e.message}`);
          }
        }

        if (!addButton) {
          log('  警告: 追加ボタンが見つかりません');

          // デバッグ: モーダル内のすべてのボタンを出力
          const buttons = await page.$$eval('button', btns =>
            btns.filter(b => b.offsetParent !== null)
                .map(b => ({
                  text: b.textContent?.trim().substring(0, 30),
                  y: b.getBoundingClientRect().y
                }))
          );
          log(`  可視ボタン: ${JSON.stringify(buttons)}`);

          // 「閉じる」ボタンで閉じる
          const closeBtn = await page.$('button:has-text("閉じる")');
          if (closeBtn) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(500);
          skipped++;
          continue;
        }

        if (DRY_RUN) {
          log('  [ドライラン] 追加をスキップ');
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          added++;
          continue;
        }

        // 追加ボタンをクリック
        log('  追加ボタンをクリック中...');
        await addButton.click();
        await page.waitForTimeout(1500);

        // 確認モーダルがあれば処理
        const confirmButton = await page.$('button:has-text("OK")') ||
                              await page.$('button:has-text("確定")') ||
                              await page.$('button:has-text("はい")');
        if (confirmButton) {
          const isVisible = await confirmButton.isVisible();
          if (isVisible) {
            log('  確認ボタンをクリック');
            await confirmButton.click();
            await page.waitForTimeout(1000);
          }
        }

        log('  成功: メンバーシップ特典に追加しました');
        added++;

        // モーダルが閉じるのを待つ
        await page.waitForTimeout(1000);

        // 「閉じる」ボタンでモーダルを閉じる
        const closeButton = await page.$('button:has-text("閉じる")');
        if (closeButton) {
          const isVisible = await closeButton.isVisible();
          if (isVisible) {
            log('  「閉じる」ボタンでモーダルを閉じます');
            await closeButton.click();
            await page.waitForTimeout(500);
          }
        } else {
          // Escapeで閉じる
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }

      } catch (err) {
        log(`  エラー: ${err.message}`);
        errors++;
        // エラー時はEscapeで状態をリセット
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }

    // 結果サマリー
    log('\n============================================================');
    log('処理完了');
    log(`  処理記事数: ${processed}`);
    log(`  追加成功: ${added}`);
    log(`  スキップ: ${skipped}`);
    log(`  エラー: ${errors}`);
    log('============================================================');

  } catch (err) {
    log(`致命的エラー: ${err.message}`);
    // スクリーンショット保存
    await page.screenshot({ path: '/tmp/note-membership-error.png' });
    log('エラースクリーンショット: /tmp/note-membership-error.png');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  log(`未処理エラー: ${err.message}`);
  process.exit(1);
});
