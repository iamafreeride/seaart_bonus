import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import seaart_bonus as sb  # noqa: E402


class MaskCookieTest(unittest.TestCase):
    def test_never_leaks_values(self):
        cookie = "T=super-secret-token; lang=zhTW; __cf_bm=abc123"
        masked = sb.mask_cookie(cookie)
        self.assertIn("3 pairs", masked)
        self.assertNotIn("super-secret-token", masked)
        self.assertNotIn("abc123", masked)

    def test_empty(self):
        self.assertEqual(sb.mask_cookie(""), "<empty>")


class DailyBoxTest(unittest.TestCase):
    def test_name_key(self):
        self.assertTrue(sb.is_daily_gift_box({"name": "每日免费礼盒", "name_key": "daily_box"}))

    def test_traditional_name(self):
        self.assertTrue(sb.is_daily_gift_box({"name": "每日禮盒"}))

    def test_other_box_is_not_daily(self):
        self.assertFalse(sb.is_daily_gift_box({"name": "S級積分盲盒", "name_key": "rank_box_s"}))

    def test_choose_only_when_free(self):
        boxes = [
            {"id": "x", "name": "每日免费礼盒", "name_key": "daily_box", "free_times": 1},
            {"id": "y", "name": "幸運禮盒", "free_times": 0},
        ]
        self.assertEqual(sb.choose_daily_box(boxes)["id"], "x")

    def test_choose_none_when_used(self):
        boxes = [{"id": "x", "name": "每日免费礼盒", "name_key": "daily_box", "free_times": 0}]
        self.assertIsNone(sb.choose_daily_box(boxes))

    def test_choose_none_when_absent(self):
        self.assertIsNone(sb.choose_daily_box([{"id": "y", "name": "幸運禮盒", "free_times": 5}]))


class RewardSummaryTest(unittest.TestCase):
    def test_summarizes_items(self):
        result = {"data": {"items": [{"type": 3, "number": 20, "level": 1, "ornament_shop_id": "a"}]}}
        self.assertEqual(
            sb.summarize_rewards(result),
            [{"type": 3, "number": 20, "level": 1, "ornament_shop_id": "a"}],
        )

    def test_empty_payload(self):
        self.assertEqual(sb.summarize_rewards({}), [])


class ConfigTest(unittest.TestCase):
    def test_requires_cookie(self):
        with self.assertRaises(ValueError):
            sb.load_options({})

    def test_requires_user_agent(self):
        with self.assertRaises(ValueError):
            sb.load_options({"SEAART_COOKIE": "T=1"})

    def test_two_accounts(self):
        options = sb.load_options(
            {
                "SEAART_COOKIE": "T=1",
                "SEAART_USER_AGENT": "UA-1",
                "SEAART_COOKIE_2": "T=2",
                "SEAART_USER_AGENT_2": "UA-2",
            }
        )
        self.assertEqual([a.index for a in options.accounts], [1, 2])
        self.assertEqual(options.accounts[1].user_agent, "UA-2")

    def test_second_account_inherits_user_agent(self):
        options = sb.load_options(
            {"SEAART_COOKIE": "T=1", "SEAART_USER_AGENT": "UA", "SEAART_COOKIE_2": "T=2"}
        )
        self.assertEqual(options.accounts[1].user_agent, "UA")


class AllowListTest(unittest.TestCase):
    def _client(self):
        account = sb.Account(1, "T=1", "UA")
        return sb.SeaArtClient(account, sb.Options(accounts=[account]))

    def test_forbidden_backpack_box_is_refused_without_network(self):
        with self.assertRaises(sb.SeaArtError):
            self._client().post("/api/v1/ornament-shop/box-order-open", {"id": "x", "open_num": 1})

    def test_forbidden_level_reward_is_refused_without_network(self):
        with self.assertRaises(sb.SeaArtError):
            self._client().post("/api/v1/paymenthub/battle-pass-level-reward", {})

    def test_forbidden_blind_box_checkin_is_refused(self):
        with self.assertRaises(sb.SeaArtError):
            self._client().post("/api/v1/activity/blind-box/checkin", {})

    def test_allowed_paths_are_exactly_the_four(self):
        self.assertEqual(
            sb.ALLOWED_PATHS,
            {
                "/api/v1/activity/checkin/info",
                "/api/v1/activity/checkin",
                "/api/v1/ornament-shop/box-list",
                "/api/v1/ornament-shop/open-box",
            },
        )


if __name__ == "__main__":
    unittest.main()
