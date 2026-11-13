#!/usr/bin/env python3
"""SeaArt AI daily bonus collector.

Runs once inside a container, claims the daily check-in (每日簽到) on the
battle-pass page and opens today's free gift box (每日禮盒) in the decorations
shop, then exits so the container stops.

Design rules (see README):
  * Only the endpoints in ALLOWED_PATHS are ever called.
  * The daily gift box is opened ONLY through the shop's free-open endpoint
    (``/api/v1/ornament-shop/open-box``) for the box whose ``free_times > 0``.
  * Blind boxes stored in "我的背包" (``/api/v1/ornament-shop/box-order-*``) and
    battle-pass level rewards (``/api/v1/paymenthub/battle-pass-*``) are never
    touched.
  * The cookie is read from the environment and never written to disk or logged.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

try:
    import requests
except ImportError:  # pragma: no cover - only hit when dependencies are missing
    sys.stderr.write("missing dependency: requests\n")
    raise

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_URL = "https://www.seaart.ai"

# --- Endpoint allow-list ---------------------------------------------------
# Every network call goes through SeaArtClient.post(), which refuses any path
# that is not listed here.  This is the structural guarantee behind the
# "do not claim level rewards / do not open backpack blind boxes" rules.
CHECKIN_INFO_PATH = "/api/v1/activity/checkin/info"
CHECKIN_PATH = "/api/v1/activity/checkin"
BOX_LIST_PATH = "/api/v1/ornament-shop/box-list"
OPEN_BOX_PATH = "/api/v1/ornament-shop/open-box"

ALLOWED_PATHS = frozenset(
    {
        CHECKIN_INFO_PATH,
        CHECKIN_PATH,
        BOX_LIST_PATH,
        OPEN_BOX_PATH,
    }
)

# Deliberately never called (kept as living documentation).
FORBIDDEN_PATHS = (
    "/api/v1/activity/blind-box/checkin",  # creates an unopened box in 我的背包
    "/api/v1/paymenthub/battle-pass-level-reward",  # 等級獎勵
    "/api/v1/paymenthub/battle-pass-levels",
    "/api/v1/payment-hub/battle-pass/claim-tasks",
    "/api/v1/ornament-shop/box-order-open",  # 我的背包 -> 驚喜盲盒
    "/api/v1/ornament-shop/box-order-list",
    "/api/v1/ornament-shop/open-box",  # only allowed for the free daily box
)

SUCCESS_CODE = 10000
ALREADY_CHECKED_CODE = 70068

DEFAULT_LOCALE = "zhTW"
DEFAULT_TIMEOUT = 30
MAX_ATTEMPTS = 3
RETRY_BACKOFF = 2.0
MAX_ACCOUNTS = 20


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
@dataclass
class Account:
    index: int
    cookie: str
    user_agent: str


@dataclass
class Options:
    accounts: List[Account] = field(default_factory=list)
    locale: str = DEFAULT_LOCALE
    timeout: int = DEFAULT_TIMEOUT
    dry_run: bool = False
    verbose: bool = False


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return ""


def mask_cookie(cookie: str) -> str:
    """Return a short, non-reversible descriptor for logging."""
    if not cookie:
        return "<empty>"
    names = []
    for part in cookie.split(";"):
        key = part.strip().split("=", 1)[0].strip()
        if key and re.fullmatch(r"[A-Za-z0-9_\-.]+", key):
            names.append(key)
    return f"<cookie: {len(cookie)} chars, {len(names)} pairs: {', '.join(names[:4])}{"..." if len(names) > 4 else ''}>"


def load_options(environ: Optional[Dict[str, str]] = None) -> Options:
    env = os.environ if environ is None else environ
    options = Options(
        locale=(env.get("SEAART_LOCALE") or DEFAULT_LOCALE).strip() or DEFAULT_LOCALE,
        timeout=int(env.get("SEAART_TIMEOUT") or DEFAULT_TIMEOUT),
        dry_run=_as_bool(env.get("SEAART_DRY_RUN")),
        verbose=_as_bool(env.get("SEAART_VERBOSE")),
    )

    default_ua = (env.get("SEAART_USER_AGENT") or "").strip()
    first_cookie = (env.get("SEAART_COOKIE") or "").strip()
    if first_cookie:
        options.accounts.append(Account(1, first_cookie, default_ua))

    for index in range(2, MAX_ACCOUNTS + 1):
        cookie = (env.get(f"SEAART_COOKIE_{index}") or "").strip()
        if not cookie:
            continue
        ua = (env.get(f"SEAART_USER_AGENT_{index}") or "").strip() or default_ua
        options.accounts.append(Account(index, cookie, ua))

    if not options.accounts:
        raise ValueError(
            "SEAART_COOKIE is not set. Provide SEAART_COOKIE and SEAART_USER_AGENT "
            "(optionally SEAART_COOKIE_2 / SEAART_USER_AGENT_2 for a second account)."
        )
    for account in options.accounts:
        if not account.user_agent:
            raise ValueError(
                f"SEAART_USER_AGENT is not set for account {account.index}. "
                "The user agent must match the browser that produced the cookie."
            )
    if options.locale not in {"zhTW", "zhCN", "en", "ja", "ko"}:
        options.locale = DEFAULT_LOCALE
    return options


# --------------------------------------------------------------------------
# HTTP client
# --------------------------------------------------------------------------
class SeaArtError(RuntimeError):
    pass


class SeaArtClient:
    def __init__(self, account: Account, options: Options):
        self.account = account
        self.options = options
        self.session = requests.Session()
        self.session.headers.update(
            {
                "accept": "application/json, text/plain, */*",
                "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
                "content-type": "application/json",
                "origin": BASE_URL,
                "referer": f"{BASE_URL}/{options.locale}/battlePass",
                "user-agent": account.user_agent,
                "cookie": account.cookie,
                "x-eyes": "true",
                "app-id": "web_global_seaart",
            }
        )

    # -- low level ---------------------------------------------------------
    def post(self, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if path not in ALLOWED_PATHS:
            raise SeaArtError(f"refusing to call non-allow-listed endpoint: {path}")

        body = payload if payload is not None else {}
        last_error: Optional[Exception] = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = self.session.post(
                    BASE_URL + path,
                    data=json.dumps(body),
                    timeout=self.options.timeout,
                )
                if self.options.verbose:
                    log(f"    HTTP {response.status_code} {path}")
                if response.status_code == 401:
                    raise SeaArtError("cookie rejected (HTTP 401) — re-export it from a logged-in browser")
                if response.status_code >= 500:
                    raise SeaArtError(f"server error HTTP {response.status_code}")
                try:
                    data = response.json()
                except ValueError:
                    raise SeaArtError(f"non-JSON response (HTTP {response.status_code}): {response.text[:120]}")
                return data
            except SeaArtError:
                raise
            except requests.RequestException as exc:
                last_error = exc
                if attempt < MAX_ATTEMPTS:
                    time.sleep(RETRY_BACKOFF * attempt)
        raise SeaArtError(f"network error after {MAX_ATTEMPTS} attempts: {last_error}")

    # -- helpers -----------------------------------------------------------
    @staticmethod
    def status_of(payload: Dict[str, Any]) -> tuple[int, str]:
        status = payload.get("status") or {}
        return int(status.get("code") or 0), str(status.get("msg") or "")

    def checkin_state(self) -> Dict[str, Any]:
        return self.post(CHECKIN_INFO_PATH)

    def claim_checkin(self) -> Dict[str, Any]:
        return self.post(CHECKIN_PATH)

    def list_gift_boxes(self) -> List[Dict[str, Any]]:
        payload = self.post(BOX_LIST_PATH)
        data = payload.get("data")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("items", "list", "boxes"):
                value = data.get(key)
                if isinstance(value, list):
                    return value
        return []

    def open_gift_box(self, box_id: str) -> Dict[str, Any]:
        return self.post(OPEN_BOX_PATH, {"box_id": box_id, "number": 1})


# --------------------------------------------------------------------------
# Pure helpers (unit-tested)
# --------------------------------------------------------------------------
def is_daily_gift_box(box: Dict[str, Any]) -> bool:
    """True for the shop's free daily gift box (每日免費禮盒 / 每日禮盒)."""
    name_key = str(box.get("name_key") or box.get("title_key") or "").lower()
    name = str(box.get("name") or box.get("title") or "")
    if name_key in {"daily_box", "daily_gift", "daily_gift_box", "daily_free_box"}:
        return True
    if "每日" in name and "禮盒" in name:
        return True
    if "每日" in name and "礼盒" in name:
        return True
    return False


def box_label(box: Dict[str, Any]) -> str:
    """Human-readable name of a gift box (API uses title/title_key)."""
    return str(box.get("name") or box.get("title") or box.get("title_key") or box.get("name_key") or "")


def choose_daily_box(boxes: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Pick the free daily box; None when it was already opened today."""
    for box in boxes:
        if not is_daily_gift_box(box):
            continue
        try:
            free_times = int(box.get("free_times") or 0)
        except (TypeError, ValueError):
            free_times = 0
        if free_times > 0:
            return box
        return None
    return None


def summarize_rewards(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = result.get("data") or {}
    items = data.get("items") if isinstance(data, dict) else None
    rewards: List[Dict[str, Any]] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            rewards.append(
                {
                    "type": item.get("type"),
                    "number": item.get("number"),
                    "level": item.get("level"),
                    "ornament_shop_id": item.get("ornament_shop_id"),
                }
            )
    return rewards


# --------------------------------------------------------------------------
# Per-account workflow
# --------------------------------------------------------------------------
def run_account(account: Account, options: Options) -> Dict[str, Any]:
    label = f"account {account.index}"
    log(f"[{label}] {mask_cookie(account.cookie)}")
    log(f"[{label}] user-agent: {account.user_agent}")

    client = SeaArtClient(account, options)
    summary: Dict[str, Any] = {
        "account": account.index,
        "ok": False,
        "checkin": {"status": "unknown"},
        "gift": {"status": "unknown"},
    }

    # 1) Session sanity check -------------------------------------------------
    info = client.checkin_state()
    code, message = client.status_of(info)
    if code != SUCCESS_CODE:
        raise SeaArtError(f"check-in info failed: code={code} msg={message!r} (is the cookie fresh?)")

    week = (info.get("data") or {}).get("week_item_list") or []
    today_done = any(
        isinstance(item, dict) and str(item.get("date")) == time.strftime("%Y%m%d", time.gmtime()) and int(item.get("is_finish") or 0) == 1
        for item in week
    )
    log(f"[{label}] 每日簽到: today={'已領取' if today_done else '未領取'} "
        f"(total={((info.get('data') or {}).get('checkin_total_times'))}, "
        f"streak={((info.get('data') or {}).get('checkin_continuous_times'))})")

    # 2) Daily check-in -------------------------------------------------------
    if today_done:
        summary["checkin"] = {"status": "already", "code": SUCCESS_CODE}
        log(f"[{label}] 每日簽到: already claimed today, skipping")
    elif options.dry_run:
        summary["checkin"] = {"status": "would-claim"}
        log(f"[{label}] 每日簽到: dry-run, would claim")
    else:
        claim = client.claim_checkin()
        code, message = client.status_of(claim)
        if code == SUCCESS_CODE:
            reward = (claim.get("data") or {}).get("checkin_reward_value")
            summary["checkin"] = {"status": "claimed", "code": code, "reward": reward}
            log(f"[{label}] 每日簽到: claimed (reward={reward})")
        elif code == ALREADY_CHECKED_CODE:
            summary["checkin"] = {"status": "already", "code": code}
            log(f"[{label}] 每日簽到: server says already checked in")
        else:
            summary["checkin"] = {"status": "failed", "code": code, "message": message}
            log(f"[{label}] 每日簽到: FAILED code={code} msg={message!r}")

    # 3) Daily free gift box (每日禮盒) ---------------------------------------
    boxes = client.list_gift_boxes()
    daily = choose_daily_box(boxes)
    if daily is None:
        summary["gift"] = {"status": "no-free-box", "code": SUCCESS_CODE}
        log(f"[{label}] 每日禮盒: no free open left today, skipping")
    elif options.dry_run:
        summary["gift"] = {"status": "would-open", "box": box_label(daily)}
        log(f"[{label}] 每日禮盒: dry-run, would open {box_label(daily)!r}")
    else:
        box_id = str(daily.get("id") or "")
        result = client.open_gift_box(box_id)
        code, message = client.status_of(result)
        if code == SUCCESS_CODE:
            rewards = summarize_rewards(result)
            summary["gift"] = {
                "status": "opened",
                "code": code,
                "box": box_label(daily),
                "rewards": rewards,
            }
            log(f"[{label}] 每日禮盒: opened {box_label(daily)!r}, rewards={rewards}")
        else:
            summary["gift"] = {"status": "failed", "code": code, "message": message, "box": box_label(daily)}
            log(f"[{label}] 每日禮盒: FAILED code={code} msg={message!r}")

    # 4) Final state (read-only) ---------------------------------------------
    if not options.dry_run:
        try:
            after = client.checkin_state()
            data = after.get("data") or {}
            summary["final"] = {
                "checkin_total_times": data.get("checkin_total_times"),
                "checkin_continuous_times": data.get("checkin_continuous_times"),
            }
        except SeaArtError:
            pass

    summary["ok"] = summary["checkin"]["status"] in {"claimed", "already", "would-claim"} and summary["gift"][
        "status"
    ] in {"opened", "no-free-box", "would-open"}
    return summary


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
LOG_PREFIX = "[seaart-bonus]"


def log(message: str) -> None:
    print(f"{LOG_PREFIX} {message}", flush=True)


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    dry_run = "--dry-run" in argv
    verbose = "--verbose" in argv or "-v" in argv

    try:
        options = load_options()
    except ValueError as exc:
        log(f"configuration error: {exc}")
        return 2

    if dry_run:
        options.dry_run = True
    if verbose:
        options.verbose = True

    started = time.time()
    log(f"starting: {len(options.accounts)} account(s), locale={options.locale}, dry_run={options.dry_run}")

    summaries: List[Dict[str, Any]] = []
    for account in options.accounts:
        try:
            summary = run_account(account, options)
        except SeaArtError as exc:
            summary = {
                "account": account.index,
                "ok": False,
                "error": str(exc),
                "checkin": {"status": "error"},
                "gift": {"status": "error"},
            }
            log(f"[account {account.index}] ERROR: {exc}")
        except Exception as exc:  # noqa: BLE001 - surface unexpected failures cleanly
            summary = {
                "account": account.index,
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "checkin": {"status": "error"},
                "gift": {"status": "error"},
            }
            log(f"[account {account.index}] ERROR: {type(exc).__name__}: {exc}")
        summaries.append(summary)

    failures = sum(1 for item in summaries if not item.get("ok"))
    elapsed = round(time.time() - started, 2)
    report = {
        "tool": "seaart-bonus",
        "version": "1.0.0",
        "elapsed_seconds": elapsed,
        "dry_run": options.dry_run,
        "accounts": summaries,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)

    if failures:
        log(f"finished with {failures} failure(s) in {elapsed}s")
        return 1
    log(f"finished successfully in {elapsed}s; container can stop")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
