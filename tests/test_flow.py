import time
import unittest
from unittest import mock

import seaart_bonus as sb

TODAY = time.strftime("%Y%m%d", time.gmtime())


def _ok(data):
    return {"data": data, "status": {"code": 10000, "msg": "success"}}


class FakeApi:
    """Records every path and replays canned responses for the four endpoints."""

    def __init__(self, *, checked_today=False, free_times=1, checkin_code=10000, open_code=10000):
        self.calls = []
        self.checked_today = checked_today
        self.free_times = free_times
        self.checkin_code = checkin_code
        self.open_code = open_code

    def __call__(self, path, payload=None):
        self.calls.append((path, payload))
        if path == sb.CHECKIN_INFO_PATH:
            week = [
                {"date": TODAY, "is_finish": 1 if self.checked_today else 0, "reward_value": 25},
            ]
            return _ok(
                {
                    "week_item_list": week,
                    "checkin_total_times": 10,
                    "checkin_continuous_times": 3,
                }
            )
        if path == sb.CHECKIN_PATH:
            if self.checkin_code == sb.SUCCESS_CODE:
                return _ok({"checkin_reward_value": 25, "checkin_reward_type": 4})
            return {"data": {"checkin_reward_value": 0}, "status": {"code": self.checkin_code, "msg": "already checked in"}}
        if path == sb.BOX_LIST_PATH:
            return _ok(
                {
                    "total": 1,
                    "items": [
                        {
                            "id": "daily-box-id",
                            "title": "每日免费礼盒",
                            "title_key": "daily_box",
                            "free_times": self.free_times,
                        }
                    ],
                }
            )
        if path == sb.OPEN_BOX_PATH:
            if self.open_code != sb.SUCCESS_CODE:
                return {"data": None, "status": {"code": self.open_code, "msg": "no free times"}}
            return _ok({"items": [{"type": 3, "number": 6, "level": 1, "ornament_shop_id": "3:x"}]})
        raise AssertionError(f"unexpected path {path}")


class FlowTest(unittest.TestCase):
    def _run(self, api, dry_run=False):
        account = sb.Account(1, "T=fake", "UA")
        options = sb.Options(accounts=[account], dry_run=dry_run)
        with mock.patch.object(sb.SeaArtClient, "post", autospec=True, side_effect=lambda self, path, payload=None: api(path, payload)):
            return sb.run_account(account, options)

    def test_fresh_day_claims_and_opens(self):
        api = FakeApi(checked_today=False, free_times=1)
        summary = self._run(api)

        self.assertTrue(summary["ok"])
        self.assertEqual(summary["checkin"], {"status": "claimed", "code": 10000, "reward": 25})
        self.assertEqual(summary["gift"]["status"], "opened")
        self.assertEqual(summary["gift"]["box"], "每日免费礼盒")
        self.assertEqual(summary["gift"]["rewards"][0]["number"], 6)

        paths = [path for path, _ in api.calls]
        self.assertEqual(
            paths,
            [
                sb.CHECKIN_INFO_PATH,
                sb.CHECKIN_PATH,
                sb.BOX_LIST_PATH,
                sb.OPEN_BOX_PATH,
                sb.CHECKIN_INFO_PATH,
            ],
        )
        self.assertTrue(set(paths) <= sb.ALLOWED_PATHS)
        self.assertEqual(api.calls[3][1], {"box_id": "daily-box-id", "number": 1})

    def test_second_run_is_idempotent(self):
        api = FakeApi(checked_today=True, free_times=0)
        summary = self._run(api)

        self.assertTrue(summary["ok"])
        self.assertEqual(summary["checkin"]["status"], "already")
        self.assertEqual(summary["gift"]["status"], "no-free-box")
        paths = [path for path, _ in api.calls]
        self.assertNotIn(sb.CHECKIN_PATH, paths)
        self.assertNotIn(sb.OPEN_BOX_PATH, paths)

    def test_server_reports_already_checked(self):
        api = FakeApi(checked_today=False, free_times=1, checkin_code=sb.ALREADY_CHECKED_CODE)
        summary = self._run(api)
        self.assertEqual(summary["checkin"]["status"], "already")
        self.assertTrue(summary["ok"])

    def test_open_failure_marks_account_failed(self):
        api = FakeApi(checked_today=True, free_times=1, open_code=40001)
        summary = self._run(api)
        self.assertFalse(summary["ok"])
        self.assertEqual(summary["gift"]["status"], "failed")

    def test_dry_run_makes_no_state_changing_calls(self):
        api = FakeApi(checked_today=False, free_times=1)
        summary = self._run(api, dry_run=True)
        paths = [path for path, _ in api.calls]
        self.assertNotIn(sb.CHECKIN_PATH, paths)
        self.assertNotIn(sb.OPEN_BOX_PATH, paths)
        self.assertEqual(summary["checkin"]["status"], "would-claim")
        self.assertEqual(summary["gift"]["status"], "would-open")


if __name__ == "__main__":
    unittest.main()
