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
import { runAction, dumpPage, listLabels } from './tasks.js';
import { BLOCK_WORDS } from './guard.js';

const TASKS = [
  {
    kind: 'checkin',
    label: '每日簽到',
    urlKeys: ['checkin', 'home'],
    entryKeywords: ['簽到', '签到'],
    entryKey: 'checkinEntry',
    claimKey: 'checkinClaim'
  },
  {
    kind: 'gift',
    label: '每日禮盒',
    urlKeys: ['gift', 'home'],
    entryKeywords: ['每日禮盒', '禮盒', '礼盒'],
    entryKey: 'giftEntry',
    claimKey: 'giftClaim'
  }
];

const RELEVANT = /簽|签|禮|礼|盒|每日|獎|奖|領|领|福|紅包|红包/;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(msg) {
  process.stdout.write(`[${ts()}] ${msg}\n`);
}

function printLabels(labels, indent = '    ') {
  labels.forEach((l, i) => {
    const flag = l.disabled ? ' [disabled]' : '';
    log(`${indent}${String(i).padStart(2, '0')} <${l.tag}> "${l.text}"${flag}  .${l.cls}`);
  });
}

async function discover(session, config) {
  const seen = new Set();
  const urls = [config.urls.checkin, config.urls.gift, config.urls.home].filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  for (const url of urls) {
    log(`--- discover: ${url}`);
    await gotoAndSettle(session.page, url, config.settleMs);
    const labels = await listLabels(session.page, 120);
    printLabels(labels);
    log(`    (${labels.length} visible clickable labels)`);
  }
  log('discover finished — none of the above elements were clicked');
}

async function main() {
  const { config, missing } = loadConfig(process.env, process.argv.slice(2));

  if (missing.length > 0) {
    log(`missing required environment: ${missing.join(', ')}`);
    log('see .env.example — SEAART_COOKIE and SEAART_USER_AGENT are mandatory');
    process.exitCode = 64;
    return;
  }

  log(`starting: headless=${config.headless} dryRun=${config.dryRun} dump=${config.dump} discover=${config.discover}`);
  log(`guard: ${BLOCK_WORDS.length} blocked words active (level rewards / blind boxes / purchases)`);

  const session = await openSession(config);
  const results = [];

  try {
    if (config.discover) {
      await discover(session, config);
      return;
    }

    let loginChecked = false;
    for (const task of TASKS) {
      const started = Date.now();
      let res = null;
      const tried = [];

      for (const urlKey of task.urlKeys) {
        const url = config.urls[urlKey];
        tried.push(url);
        log(`${task.label}: ${url}`);
        try {
          await gotoAndSettle(session.page, url, config.settleMs);

          if (!loginChecked) {
            const probe = await probeLogin(session.page);
            loginChecked = true;
            log(
              probe.loggedIn
                ? 'session: logged in'
                : 'warning: page still looks logged out — the cookie is probably expired'
            );
          }

          if (config.dump) {
            const n = await dumpPage(session.page, config.dumpDir, task.kind, fs, path);
            log(`${task.label}: dumped ${n} buttons to ${config.dumpDir}`);
          }

          res = await runAction(session.page, task.kind, config, {
            entryKeywords: task.entryKeywords,
            blockWords: BLOCK_WORDS,
            entrySelector: config.selectors[task.entryKey],
            claimSelector: config.selectors[task.claimKey]
          });
        } catch (err) {
          res = {
            kind: task.kind,
            status: 'error',
            detail: err && err.message ? err.message : String(err)
          };
        }

        log(`${task.label}: ${res.status} — ${res.detail}`);
        if (res.status !== 'not_found') break;
      }

      res.ms = Date.now() - started;
      res.tried = tried;
      results.push(res);

      // When we could not find the entry, show what the page actually offers.
      if (res.status === 'not_found') {
        const labels = (await listLabels(session.page, 200)).filter((l) =>
          RELEVANT.test(l.text)
        );
        if (labels.length > 0) {
          log(`${task.label}: related clickable labels on the last page:`);
          printLabels(labels.slice(0, 40));
        } else {
          log(`${task.label}: no related label either — run with --discover for the full list`);
        }
      }

      if (config.dump) break;
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
    log('hint: run `docker run --rm --env-file .env seaart-bonus --discover` and send the output');
  }
}

main().catch((err) => {
  log(`fatal: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
