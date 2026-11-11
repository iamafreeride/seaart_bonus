#!/usr/bin/env node
/**
 * seaart_bonus — one-shot container job.
 *
 * Logs in with SEAART_COOKIE + SEAART_USER_AGENT, then performs exactly two
 * actions: the daily check-in and the daily gift box. It never touches the
 * battle-pass level rewards and never opens a mystery blind box.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openSession, probeLogin, gotoAndSettle } from './browser.js';
import { runAction, dumpPage } from './tasks.js';
import { BLOCK_WORDS } from './guard.js';

const TASKS = [
  {
    kind: 'checkin',
    label: '每日簽到',
    urlKey: 'checkin',
    entryKeywords: ['簽到', '签到'],
    overrideKey: 'checkinEntry'
  },
  {
    kind: 'gift',
    label: '每日禮盒',
    urlKey: 'gift',
    entryKeywords: ['每日禮盒', '禮盒', '礼盒'],
    overrideKey: 'giftEntry'
  }
];

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(msg) {
  process.stdout.write(`[${ts()}] ${msg}\n`);
}

async function main() {
  const { config, missing } = loadConfig(process.env, process.argv.slice(2));

  if (missing.length > 0) {
    log(`missing required environment: ${missing.join(', ')}`);
    log('see .env.example — SEAART_COOKIE and SEAART_USER_AGENT are mandatory');
    process.exitCode = 64;
    return;
  }

  log(`starting: headless=${config.headless} dryRun=${config.dryRun} dump=${config.dump}`);
  log(`guard: ${BLOCK_WORDS.length} blocked words active (level rewards / blind boxes / purchases)`);

  const session = await openSession(config);
  const results = [];

  try {
    let loginChecked = false;
    for (const task of TASKS) {
      const url = config.urls[task.urlKey];
      log(`${task.label}: ${url}`);
      const started = Date.now();
      try {
        await gotoAndSettle(session.page, url, config.settleMs);

        if (!loginChecked) {
          const probe = await probeLogin(session.page);
          loginChecked = true;
          if (!probe.loggedIn) {
            log('warning: page still looks logged out — the cookie is probably expired');
          } else {
            log('session: logged in');
          }
        }

        if (config.dump) {
          const n = await dumpPage(session.page, config.dumpDir, task.kind, fs, path);
          log(`${task.label}: dumped ${n} buttons to ${config.dumpDir}`);
        }

        const res = await runAction(session.page, task.kind, config, {
          entryKeywords: task.entryKeywords,
          blockWords: BLOCK_WORDS,
          overrideSelector: config.selectors[task.overrideKey],
          claimSelector: config.selectors.claimButton
        });
        res.ms = Date.now() - started;
        results.push(res);
        log(`${task.label}: ${res.status} — ${res.detail}`);
      } catch (err) {
        results.push({
          kind: task.kind,
          status: 'error',
          detail: err && err.message ? err.message : String(err),
          ms: Date.now() - started
        });
        log(`${task.label}: error — ${err && err.message}`);
      }

      if (config.dump) break; // dump mode is for calibration only
    }
  } finally {
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
  }

  const summary = {
    ranAt: new Date().toISOString(),
    results,
    exit: 0
  };
  const hardFailure = results.some((r) => r.status === 'error');
  const allGood = results.every((r) =>
    ['claimed', 'already', 'would_claim'].includes(r.status)
  );
  summary.exit = hardFailure ? 1 : allGood ? 0 : 2;
  process.exitCode = summary.exit;

  log(`summary: ${JSON.stringify(summary)}`);
  if (summary.exit === 2) {
    log('hint: run with --dump (SEAART_DUMP=1) and set SEAART_CHECKIN_ENTRY / SEAART_GIFT_ENTRY if the labels moved');
  }
}

main().catch((err) => {
  log(`fatal: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
