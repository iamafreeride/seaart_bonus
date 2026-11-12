# seaart_bonus

**English** | [繁體中文](README.zh-TW.md)

A one-shot container job that logs into [SeaArt AI](https://www.seaart.ai/) with a **Cookie + User-Agent**, claims the **daily check-in** and the **daily gift box**, prints a JSON summary, and exits. Modeled on [simao-silva/noip-renewer](https://github.com/simao-silva/noip-renewer): one-shot container, credentials via environment variables, exit when done.

- Check-in page: `https://www.seaart.ai/zhTW/battlePass`
- Gift box page: `https://www.seaart.ai/zhTW/mall?dotFrom=svip_banner`

## Scope

It does exactly two things: claim the daily check-in reward and open/claim the daily gift box.

It **never** clicks: battle-pass level rewards, "claim all", mystery blind boxes in "My Backpack", or anything related to purchase / subscription / top-up / exchange pool / leaderboard.

This is enforced by a hard blocklist and container class signatures in `src/guard.js`. Before every click, the element text plus the class/id of up to 8 ancestors are checked against it, and unit tests verify the behaviour.

## Quick start

### 1. Get the Cookie and User-Agent

1. Log in to SeaArt in your browser and open DevTools → **Network**.
2. Reload `https://www.seaart.ai/zhTW/battlePass`.
3. Click any `www.seaart.ai` request → **Request Headers**: copy the whole `cookie` line (it is long) and the `user-agent`.
4. Both must come from the **same browser and session**.

> The cookie is full access to your account. Keep it only in a local `.env`; never paste it into issues or commit it.

### 2. Create `.env`

```bash
cp .env.example .env
# fill in SEAART_COOKIE and SEAART_USER_AGENT
```

### 3. Run (once, exits when done)

```bash
docker build -t seaart-bonus .

docker run --rm --init --shm-size=1g \
  --env-file .env \
  seaart-bonus
```

Or with compose:

```bash
docker compose run --rm seaart-bonus
```

### 4. Daily schedule (optional)

```cron
5 9 * * * cd /opt/seaart_bonus && docker compose run --rm seaart-bonus >> run.log 2>&1
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SEAART_COOKIE` | ✅ | — | Full cookie request header |
| `SEAART_USER_AGENT` | ✅ | — | UA of the same browser |
| `SEAART_LOCALE` | | `zhTW` | Locale prefix |
| `SEAART_HEADLESS` | | `true` | Run headless |
| `SEAART_SETTLE_MS` | | `2500` | Wait after each click |
| `SEAART_TIMEOUT_MS` | | `45000` | Navigation / element timeout |
| `SEAART_SLOW_MO` | | `0` | Slow each step (debugging) |
| `SEAART_CHECKIN_URL` | | battlePass | Check-in page |
| `SEAART_GIFT_URL` | | mall?dotFrom=svip_banner | Gift box page |
| `SEAART_CHECKIN_ENTRY` | | auto | Check-in entry CSS selector |
| `SEAART_GIFT_ENTRY` | | auto | Gift box entry CSS selector |
| `SEAART_CLAIM_BUTTON` | | auto | Claim button CSS selector |
| `SEAART_DUMP_DIR` | | `./dump` | Calibration output directory |

CLI flags: `--headed` (show the browser), `--dry-run` (find but don't click), `--dump` (export page and button list).

## How it works

```
inject cookie → context (UA / zh-TW / Asia/Taipei / 1440x1000)
  → battlePass: detect login → check-in entry → click → claim → verify
  → mall page:  gift box entry → click → open/claim → verify
  → print JSON summary → close browser → exit
```

Elements are located by text keywords + clickability + visibility, not hashed class names, so minor site changes usually still work. Success is detected by completion text (`已領取` / `已簽到` / `領取成功` / `明天再來`) or a success toast.

## Calibrating selectors

If a site change causes `not_found`, dump the page:

```bash
docker run --rm --env-file .env -v "$PWD/dump:/tmp/seaart-dump" \
  -e SEAART_DUMP=1 seaart-bonus
```

This produces `dump/checkin.png`, `dump/checkin.html` and `dump/checkin.buttons.json`. Pick the right selectors and set them in `.env`:

```env
SEAART_CHECKIN_ENTRY=div.daily-sign-entry
SEAART_GIFT_ENTRY=div.daily-gift-entry
SEAART_CLAIM_BUTTON=button.claim-btn
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Both succeeded (or already claimed today) |
| `1` | Runtime error (navigation failed, browser crashed, …) |
| `2` | Partial / entry not found (selectors need calibration) |
| `64` | Required environment variable missing |

The summary is a single JSON line, convenient for cron / CI:

```json
{"ranAt":"2026-11-12T01:05:00.000Z","results":[{"kind":"checkin","status":"claimed"},{"kind":"gift","status":"claimed"}],"exit":0}
```

## Security and disclaimer

- **The cookie is your account.** Keep it only in a local `.env` (already in `.gitignore`).
- The container runs as non-root (`node`), without `--privileged`, and mounts no host directory (except the debug dump).
- The tool changes no site data beyond the two claims and blocks purchase-type buttons.
- **Use at your own risk.** Automated access may violate SeaArt's terms of service and may get the account flagged or restricted. Use it only on your own account. No warranty.

## Known limitations

1. **Not verified against the logged-in DOM.** Development could only observe the logged-out page and SSR structure, so the real check-in / gift box wording and classes may differ. On the first run, use `--dump` or `--dry-run`.
2. The site is a Nuxt SPA and some components render late after login. Raise `SEAART_SETTLE_MS` on slow networks.
3. Cookies expire; re-capture them periodically.
4. With 2FA / device verification enabled, a bare cookie may be asked to re-verify.
5. Entries inside an iframe or canvas are not handled (reported as `not_found`).

## Project structure

```
src/index.js       entry: flow, summary, exit codes
src/config.js      environment variables and CLI flags
src/guard.js       cookie parsing, blocklist, label matching (pure functions)
src/browser.js     Chromium / context / cookie injection / login detection
src/tasks.js       candidate scan, click, success detection, dump
test/guard.test.js
Dockerfile
docker-compose.yml
.github/workflows/ci.yml
```

## Development

```bash
npm install
npm run check   # syntax check
npm test        # unit tests (no browser needed)
```
