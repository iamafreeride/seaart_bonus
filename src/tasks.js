import { BLOCK_CONTAINER_HINTS } from './guard.js';

const CLICKABLE_CLASS = /btn|button|tab|item|entry|link/i;
const DONE_TEXT = /已領取|已领取|已簽到|已签到|領取成功|领取成功|明天再來|明日再來|明天再来|已领取/;
const OK_TEXT = /成功|已獲得|已获得|恭喜/;

/**
 * Scan the live DOM for candidate elements by keyword.
 * Candidates are tagged with data-sb-cand="<id>" so they can be clicked back
 * through a normal Playwright locator.
 */
export async function scanCandidates(page, { keywords, clickableOnly = true, limit = 40 }) {
  return page.evaluate(
    ({ keywords, clickableOnly, limit, clickableClassSource, blockHints }) => {
      const clickableClass = new RegExp(clickableClassSource, 'i');
      const flat = (s) => String(s || '').replace(/\s+/gu, '');
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      };
      const isClickable = (el) => {
        const tag = el.tagName;
        const role = el.getAttribute('role');
        const cls = el.className && el.className.baseVal === undefined ? el.className : '';
        return (
          tag === 'A' ||
          tag === 'BUTTON' ||
          role === 'button' ||
          clickableClass.test(String(cls))
        );
      };
      const chainInfo = (el) => {
        const parts = [];
        let p = el;
        let depth = 0;
        while (p && depth < 8) {
          const cls = typeof p.className === 'string' ? p.className : '';
          if (cls || p.id) parts.push(`${cls} ${p.id}`.trim());
          p = p.parentElement;
          depth += 1;
        }
        return parts.join(' | ');
      };
      // A label can live in text, aria-label, title, or an icon's alt text.
      const labelOf = (el) => {
        const own = flat(el.innerText);
        if (own) return own.slice(0, 60);
        const aria = flat(el.getAttribute('aria-label'));
        if (aria) return aria.slice(0, 60);
        const title = flat(el.getAttribute('title'));
        if (title) return title.slice(0, 60);
        const img = el.querySelector('img');
        return img ? flat(img.getAttribute('alt')).slice(0, 60) : '';
      };
      // Icon-only entries are often wrapped in a plain div; climb to the
      // nearest clickable ancestor so the click still lands properly.
      const clickTarget = (el) => {
        let p = el;
        for (let i = 0; i < 4 && p; i += 1) {
          if (isClickable(p)) return p;
          p = p.parentElement;
        }
        return null;
      };

      const nodes = Array.from(
        document.querySelectorAll(
          'a,button,[role="button"],div,span,li,label,img,svg,i'
        )
      ).filter((el) => {
        const label = labelOf(el);
        if (!label || label.length > 60) return false;
        if (!keywords.some((kw) => label.includes(kw))) return false;
        if (!isVisible(el)) return false;
        return true;
      });

      // Keep the deepest matches only (drop ancestors of another match).
      const matched = nodes.filter(
        (el) => !nodes.some((other) => other !== el && el.contains(other))
      );

      const out = [];
      const used = new Set();
      for (const el of matched) {
        if (out.length >= limit) break;
        const target = clickTarget(el);
        if (!target) continue;
        if (used.has(target)) continue;
        used.add(target);
        const id = out.length;
        target.setAttribute('data-sb-cand', String(id));
        const chain = chainInfo(target);
        const cls = typeof target.className === 'string' ? target.className : '';
        const disabled =
          target.hasAttribute('disabled') ||
          target.getAttribute('aria-disabled') === 'true' ||
          /is-disabled|disabled/.test(cls);
        out.push({
          id,
          text: labelOf(el) || cls.slice(0, 40),
          clickable: true,
          disabled,
          blockedByHint: blockHints.some((h) => chain.toLowerCase().includes(h)),
          chain: chain.slice(0, 200)
        });
      }
      return out;
    },
    {
      keywords,
      clickableOnly,
      limit,
      clickableClassSource: CLICKABLE_CLASS.source,
      blockHints: BLOCK_CONTAINER_HINTS
    }
  );
}

async function clickCandidate(page, id) {
  const locator = page.locator(`[data-sb-cand="${id}"]`).first();
  await locator.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
  await locator.click({ timeout: 5_000 });
}

async function findEnabledClaim(page, blockWords) {
  const candidates = await scanCandidates(page, {
    keywords: ['領取', '领取', '開啟', '开启'],
    clickableOnly: true
  });
  for (const c of candidates) {
    if (c.disabled) continue;
    if (c.blockedByHint) continue;
    if (blockWords.some((w) => c.text.includes(w))) continue;
    return c;
  }
  return null;
}

async function confirmDialog(page) {
  for (const name of [/^確定$/, /^确认$/, /^確認$/, /^知道了$/, /^好的$/]) {
    const btn = page.getByRole('button', { name }).first();
    if (await btn.count().catch(() => 0)) {
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2_000 }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function readFeedback(page) {
  return page.evaluate(
    ({ doneSource, okSource }) => {
      const done = new RegExp(doneSource);
      const ok = new RegExp(okSource);
      const text = (document.body.innerText || '').replace(/\s+/gu, '');
      return { done: done.test(text), ok: ok.test(text), tail: text.slice(-200) };
    },
    { doneSource: DONE_TEXT.source, okSource: OK_TEXT.source }
  );
}

/**
 * Perform one allowed action.
 *
 * @param {import('playwright').Page} page
 * @param {'checkin'|'gift'} kind
 * @param {object} config
 * @param {{entryKeywords:string[], blockWords:string[], overrideSelector?:string}} spec
 */
export async function runAction(page, kind, config, spec) {
  const result = { kind, status: 'not_found', detail: '', clicks: [] };

  // 1) If the site already opened the relevant panel, claim right away.
  let entry = null;
  if (spec.overrideSelector) {
    const custom = page.locator(spec.overrideSelector).first();
    if (await custom.count().catch(() => 0)) {
      entry = { id: null };
      await custom.click({ timeout: 5_000 });
      result.clicks.push({ step: 'entry', selector: spec.overrideSelector });
      await page.waitForTimeout(config.settleMs);
    }
  }

  if (!entry) {
    const entries = await scanCandidates(page, {
      keywords: spec.entryKeywords,
      clickableOnly: true
    });
    const usable = entries.filter(
      (c) => !c.disabled && !c.blockedByHint && !spec.blockWords.some((w) => c.text.includes(w))
    );
    if (usable.length > 0) {
      const chosen = usable[0];
      if (!config.dryRun) {
        await clickCandidate(page, chosen.id).catch((err) => {
          result.detail += `entry click failed: ${err.message}; `;
        });
      }
      result.clicks.push({ step: 'entry', text: chosen.text });
      await page.waitForTimeout(config.settleMs);
    } else {
      result.detail = 'no entry element matched';
    }
  }

  // 2) Claim inside whatever surface is now visible.
  let claim = null;
  if (spec.claimSelector) {
    const custom = page.locator(spec.claimSelector).first();
    if (await custom.count().catch(() => 0)) {
      claim = { id: null, text: `custom selector ${spec.claimSelector}`, custom: true };
    }
  }
  if (!claim) claim = await findEnabledClaim(page, spec.blockWords);
  if (!claim) {
    const feedback = await readFeedback(page);
    result.status = feedback.done ? 'already' : 'not_found';
    if (!result.detail) {
      result.detail = feedback.done
        ? 'already claimed (done marker present)'
        : 'no enabled claim button found';
    }
    return result;
  }

  if (config.dryRun) {
    result.status = 'would_claim';
    result.detail = `dry-run: would click "${claim.text}"`;
    return result;
  }

  if (claim.custom) {
    await page.locator(spec.claimSelector).first().click({ timeout: 5_000 });
  } else {
    await clickCandidate(page, claim.id);
  }
  result.clicks.push({ step: 'claim', text: claim.text });
  await page.waitForTimeout(1_500);
  await confirmDialog(page);
  await page.waitForTimeout(1_200);

  const feedback = await readFeedback(page);
  result.status = feedback.done || feedback.ok ? 'claimed' : 'clicked_unverified';
  result.detail = feedback.done
    ? 'claimed (done marker present)'
    : feedback.ok
      ? 'claimed (success toast seen)'
      : 'clicked, but success could not be confirmed';
  return result;
}

/** All visible clickable labels — used by --discover and failure diagnostics. */
export async function listLabels(page, limit = 150) {
  return page.evaluate((max) => {
    const flat = (s) => String(s || '').replace(/\s+/gu, '');
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      const st = getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    };
    const nodes = Array.from(
      document.querySelectorAll(
        'button,a,[role="button"],[class*="btn"],[class*="entry"],[class*="item"],[class*="icon"]'
      )
    );
    const seen = new Set();
    const out = [];
    for (const el of nodes) {
      if (out.length >= max) break;
      if (!isVisible(el)) continue;
      const img = el.querySelector('img');
      const label =
        flat(el.innerText) ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (img ? flat(img.getAttribute('alt')) : '');
      if (!label || label.length > 30) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      const key = `${label}#${cls.slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName,
        text: label,
        cls: cls.slice(0, 60),
        disabled:
          el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
      });
    }
    return out;
  }, limit);
}

/** Dump page state + labelled candidates for selector calibration. */
export async function dumpPage(page, dir, name, fs, path) {
  await fs.promises.mkdir(dir, { recursive: true });
  const html = await page.content();
  await fs.promises.writeFile(path.join(dir, `${name}.html`), html, 'utf8');
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => {});
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .map((el) => ({
        tag: el.tagName,
        text: (el.innerText || '').trim().slice(0, 40),
        cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
      }))
      .filter((x) => x.text)
      .slice(0, 200)
  );
  await fs.promises.writeFile(
    path.join(dir, `${name}.buttons.json`),
    JSON.stringify(labels, null, 2),
    'utf8'
  );
  return labels.length;
}
