const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== 設定 ==========
const STATE_PATH = process.env.NOTE_POST_MCP_STATE_PATH || path.join(os.homedir(), '.note-state.json');
const LOG_FILE = './add_to_magazine_log.txt';

// マガジン定義
const MAGAZINES = {
  'AI論文読み放題': {
    patterns: ['論文', '翻訳', 'Paper', 'Research', 'GPT-SoVITS', '音声合成', 'パラメーター', '潜在空間']
  },
  '副業×AI': {
    patterns: ['副業', 'ニュース×AI', '株', '経済', '投資', 'DMM', '楽天']
  }
};

// コマンドライン引数
// Usage: node add-to-magazine.cjs [year] [month] [--dry-run] [--limit N] [--magazine "マガジン名"]
// 例: node add-to-magazine.cjs 2026 1
// 例: node add-to-magazine.cjs 2026 1 --dry-run
// 例: node add-to-magazine.cjs 2026 1 --limit 10
// 例: node add-to-magazine.cjs 2026 1 --magazine "副業×AI"
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const LIMIT = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : 0;

const magazineIndex = args.indexOf('--magazine');
const FILTER_MAGAZINE = magazineIndex !== -1 ? args[magazineIndex + 1] : null;

// --force-all: パターン検出をスキップし全記事を指定マガジンに登録
const FORCE_ALL = args.includes('--force-all');

// --all: 期間フィルターをスキップし全記事を処理
const PROCESS_ALL_PERIODS = args.includes('--all');

// 数値引数を抽出
const numArgs = args.filter(a => !a.startsWith('--') && !isNaN(parseInt(a, 10)));
const YEAR = numArgs[0] ? parseInt(numArgs[0], 10) : new Date().getFullYear();
const MONTH = numArgs[1] ? parseInt(numArgs[1], 10) : new Date().getMonth() + 1;

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

/**
 * 記事タイトルから適切なマガジンを判定
 * @param {string} title - 記事タイトル
 * @returns {string|null} - マガジン名 or null
 */
function determineTargetMagazine(title) {
  // AI論文読み放題（論文翻訳記事）を先にチェック
  const paperMag = MAGAZINES['AI論文読み放題'];
  for (const pattern of paperMag.patterns) {
    if (title.includes(pattern)) {
      return 'AI論文読み放題';
    }
  }

  // 副業×AI（ニュース×AI、副業×AI記事）
  const sidejobMag = MAGAZINES['副業×AI'];
  for (const pattern of sidejobMag.patterns) {
    if (title.includes(pattern)) {
      return '副業×AI';
    }
  }

  return null;
}

async function main() {
  log('============================================================');
  log('マガジン一括追加スクリプト開始');
  log(`対象期間: ${YEAR}年${MONTH}月`);
  log(`ドライラン: ${DRY_RUN}`);
  log(`処理上限: ${LIMIT || '無制限'}`);
  if (FILTER_MAGAZINE) {
    log(`対象マガジン: ${FILTER_MAGAZINE}`);
  }
  if (PROCESS_ALL_PERIODS) {
    log('全期間モード: 期間フィルターをスキップ');
  }
  if (FORCE_ALL) {
    log(`強制モード: 全記事を「${FILTER_MAGAZINE || 'AI論文読み放題'}」に登録`);
  } else {
    log('============================================================');
    log('マガジン判定ルール:');
    log('  - 論文/翻訳/Paper/Research を含む → AI論文読み放題');
    log('  - 副業/ニュース×AI/株/経済/投資/DMM/楽天 を含む → 副業×AI');
  }
  log('============================================================');

  // 認証状態を読み込み
  if (!fs.existsSync(STATE_PATH)) {
    log(`エラー: 認証状態ファイルが見つかりません: ${STATE_PATH}`);
    log('先にnote-post MCPでログインしてください');
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

  const browser = await chromium.launch({
    headless: true,
    slowMo: 50
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
    // 期間フィルター処理（--all オプションの場合はスキップ）
    if (!PROCESS_ALL_PERIODS) {
      log('期間フィルターを探索中...');

      const periodButton = await page.$('button:has-text("期間")') ||
                           await page.$('[data-testid*="period"]') ||
                           await page.$('.filter-period') ||
                           await page.$('text=期間');

      if (periodButton) {
        log('期間フィルターボタンを発見、クリック...');
        await periodButton.click();
        await page.waitForTimeout(1000);
      } else {
        log('期間フィルターボタンが見つかりません');
      }

      // Step 2: 年月を選択
      log(`${YEAR}年${MONTH}月を選択中...`);

      const yearSelector = await page.$(`text=${YEAR}年`) ||
                           await page.$(`option:has-text("${YEAR}")`) ||
                           await page.$(`[value="${YEAR}"]`);
      if (yearSelector) {
        await yearSelector.click();
        await page.waitForTimeout(500);
      }

      const monthSelector = await page.$(`text=${MONTH}月`) ||
                            await page.$(`option:has-text("${MONTH}月")`) ||
                            await page.$(`[value="${MONTH}"]`);
      if (monthSelector) {
        await monthSelector.click();
        await page.waitForTimeout(500);
      }

      await page.waitForTimeout(2000);
    } else {
      log('期間フィルターをスキップ（全期間モード）');
    }

    // Step 3: 記事リストを取得
    log('記事リストを取得中...');

    let articles = await page.$$('.o-articleList__item');

    log(`記事数: ${articles.length}`);

    if (articles.length === 0) {
      log('記事が見つかりません。ページ構造を調査します...');
      await page.screenshot({ path: '/tmp/note-magazine-page.png', fullPage: true });
      log('スクリーンショット保存: /tmp/note-magazine-page.png');
      await browser.close();
      process.exit(1);
    }

    // デバッグ: 最初の記事の構造を確認
    if (articles.length > 0) {
      const firstArticle = articles[0];
      const html = await firstArticle.innerHTML();
      fs.writeFileSync('/tmp/note-article-structure.html', html);
      log('デバッグ: 記事HTML構造を /tmp/note-article-structure.html に保存');
    }

    // Step 4: 各記事に対してマガジン追加
    let processed = 0;
    let added = 0;
    let skipped = 0;
    let errors = 0;
    let noMagazine = 0;

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
        // note.comの記事リストは .o-articleList__heading クラスにタイトルがある
        const titleEl = await article.$('.o-articleList__heading');
        const title = titleEl ? (await titleEl.textContent())?.trim() : '(タイトル不明)';
        log(`  タイトル: ${title.substring(0, 60)}...`);

        // タイトルから適切なマガジンを判定
        // FORCE_ALLモードの場合はパターン検出をスキップ
        const targetMagazine = FORCE_ALL
          ? (FILTER_MAGAZINE || 'AI論文読み放題')
          : determineTargetMagazine(title);

        if (!targetMagazine) {
          log('  → マガジン対象外（パターン不一致）');
          noMagazine++;
          continue;
        }

        // 特定のマガジンのみを処理する場合のフィルタ（FORCE_ALLでない場合のみ）
        if (!FORCE_ALL && FILTER_MAGAZINE && targetMagazine !== FILTER_MAGAZINE) {
          log(`  → スキップ（対象マガジン: ${FILTER_MAGAZINE}、この記事: ${targetMagazine}）`);
          skipped++;
          continue;
        }

        log(`  → 対象マガジン: ${targetMagazine}`);

        // 三点リーダー（メニュー）を探す
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
          await page.keyboard.press('Escape');
          skipped++;
          continue;
        }

        await membershipOption.click();
        await page.waitForTimeout(1500);

        // モーダルが表示されるのを待つ
        log('  メンバーシップ特典モーダル表示を待機中...');

        // デバッグ用：最初の数件でスクリーンショットを取る
        if (processed <= 3) {
          await page.screenshot({ path: `/tmp/note-magazine-modal-${processed}.png` });
          log(`  デバッグ: スクリーンショット保存 /tmp/note-magazine-modal-${processed}.png`);
        }

        // モーダル内でターゲットプランを探す
        // プランマッピング: AI論文読み放題 → 「論文」を含む, 副業×AI → 「副業」を含む
        let addButton = null;
        let alreadyAdded = false;

        // 検索キーワード設定
        // プランマッピング:
        //   副業×AI → ＡＩｘ副業 読み放題プラン（キーワード: 副業）
        //   AI論文読み放題 → 応援プラン（キーワード: 応援）
        const searchKeyword = targetMagazine === 'AI論文読み放題' ? '応援' : '副業';
        // ボタンインデックス（1番目=ＡＩｘ副業, 2番目=応援プラン）
        const targetButtonIndex = targetMagazine === 'AI論文読み放題' ? 2 : 1;

        try {
          // 方法1: モーダル内のli要素からプランを検索
          log(`  方法1: モーダル内のプラン一覧を検索（キーワード: ${searchKeyword}）...`);

          const modalBody = await page.$('.m-basicModalContent__body');
          if (modalBody) {
            const planItems = await modalBody.$$('li');
            log(`  プラン項目数: ${planItems.length}`);

            for (const item of planItems) {
              const itemText = await item.textContent();

              if (itemText && itemText.includes(searchKeyword)) {
                log(`  プラン「${searchKeyword}」を含む項目を発見: "${itemText?.substring(0, 50)}..."`);

                // この項目内のボタンを探す
                const btn = await item.$('button.a-button') || await item.$('button');
                if (btn) {
                  const btnText = await btn.textContent();
                  log(`  ボタンテキスト: "${btnText?.trim()}"`);

                  if (btnText && btnText.includes('追加') && !btnText.includes('追加済')) {
                    addButton = btn;
                    log('  「追加」ボタンを発見（方法1）');
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

        // 方法2: ボタンインデックスで検索
        if (!addButton && !alreadyAdded) {
          log(`  方法2: ボタンインデックスで検索（${targetButtonIndex}番目の追加ボタン）...`);

          try {
            const allModalButtons = await page.$$('.modal-content-wrapper button.a-button');
            log(`  モーダル内ボタン数: ${allModalButtons.length}`);

            let addButtonCount = 0;
            for (let btnIdx = 0; btnIdx < allModalButtons.length; btnIdx++) {
              const btn = allModalButtons[btnIdx];
              const btnText = await btn.textContent();
              const trimmedText = btnText?.trim();
              log(`  ボタン[${btnIdx}]: "${trimmedText}"`);

              if (trimmedText === '追加') {
                addButtonCount++;
                if (addButtonCount === targetButtonIndex) {
                  addButton = btn;
                  log(`  ${targetButtonIndex}番目の「追加」ボタンを発見（インデックス: ${btnIdx}）`);
                  break;
                }
              } else if (trimmedText === '追加済' && addButtonCount + 1 === targetButtonIndex) {
                // 次のボタンがターゲットなのに追加済みの場合
                alreadyAdded = true;
                log('  スキップ: すでにメンバーシップ特典に追加済み');
                break;
              }
            }
          } catch (e) {
            log(`  方法2エラー: ${e.message}`);
          }
        }

        // すでに追加済みの場合はスキップ
        if (alreadyAdded) {
          const closeBtn = await page.$('button:has-text("閉じる")') ||
                           await page.$('button:has-text("キャンセル")');
          if (closeBtn) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(500);
          skipped++;
          continue;
        }

        if (!addButton) {
          log('  警告: 追加ボタンが見つかりません');

          // デバッグ: ボタン一覧を出力
          const buttons = await page.$$eval('button', btns =>
            btns.filter(b => b.offsetParent !== null)
                .map(b => ({
                  text: b.textContent?.trim().substring(0, 40)
                }))
          );
          log(`  可視ボタン: ${JSON.stringify(buttons.slice(0, 10))}`);

          const closeBtn = await page.$('button:has-text("閉じる")') ||
                           await page.$('button:has-text("キャンセル")');
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
          log(`  [ドライラン] メンバーシップ「${targetMagazine}」への追加をスキップ`);
          // モーダルを閉じる
          const closeBtn = await page.$('button:has-text("閉じる")');
          if (closeBtn) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(1000);
          added++;
          continue;
        }

        // 追加ボタンをクリック
        log(`  メンバーシップ「${targetMagazine}」に追加中...`);
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

        log(`  成功: メンバーシップ「${targetMagazine}」に追加しました`);
        added++;

        // モーダルを閉じる
        await page.waitForTimeout(1000);
        const closeButton = await page.$('button:has-text("閉じる")');
        if (closeButton) {
          const isVisible = await closeButton.isVisible();
          if (isVisible) {
            await closeButton.click();
            await page.waitForTimeout(500);
          }
        } else {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }

      } catch (err) {
        log(`  エラー: ${err.message}`);
        errors++;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }

    // 結果サマリー
    log('\n============================================================');
    log('処理完了');
    log(`  処理記事数: ${processed}`);
    log(`  メンバーシップ追加: ${added}`);
    log(`  スキップ: ${skipped}`);
    log(`  マガジン対象外: ${noMagazine}`);
    log(`  エラー: ${errors}`);
    log('============================================================');

  } catch (err) {
    log(`致命的エラー: ${err.message}`);
    await page.screenshot({ path: '/tmp/note-magazine-error.png' });
    log('エラースクリーンショット: /tmp/note-magazine-error.png');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  log(`未処理エラー: ${err.message}`);
  process.exit(1);
});
