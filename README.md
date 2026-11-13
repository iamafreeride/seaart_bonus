# seaart_bonus

用 **Cookie + User-Agent** 登入 [SeaArt AI](https://www.seaart.ai/)，容器啟動後自動完成
**每日簽到** 與 **每日禮盒**，完成即結束容器。

本專案參考 [simao-silva/noip-renewer](https://github.com/simao-silva/noip-renewer) 的
「一次性容器 + 環境變數帶入憑證 + 跑完即退」模式，把作用網站從 No-IP 換成 SeaArt AI：

| 原本（noip-renewer） | 現在（seaart_bonus） |
| --- | --- |
| 目標網站：No-IP | 目標網站：`https://www.seaart.ai/zhTW/battlePass`、`https://www.seaart.ai/zhTW/mall?dotFrom=svip_banner`（禮盒入口在 `/zhTW/decorations`） |
| 憑證：`NO_IP_USERNAME` / `NO_IP_PASSWORD` | 憑證：`SEAART_COOKIE` / `SEAART_USER_AGENT` |
| 動作：續約所有 No-IP host | 動作：領取每日簽到、打開每日禮盒 |
| 技術：Selenium + Firefox 點擊 DOM | 技術：直接呼叫網站自己的 JSON API（免瀏覽器、映像檔小、可重複執行） |

> 為什麼不用瀏覽器自動化？SeaArt 是 SPA，按鈕文案與 DOM class 會隨版本改動，用點擊的方式
> 很容易因為彈窗、A/B 測試或語系而失敗。這裡改用網站前端自己使用的介面（已用實際帳號驗證），
> 結果穩定且可在幾秒內完成。

---

## 一、只做兩件事

| 動作 | 頁面 | 實際呼叫 | 行為 |
| --- | --- | --- | --- |
| **每日簽到** | `/zhTW/battlePass` → 賽季任務「每日」 | `POST /api/v1/activity/checkin` | 領取當日簽到獎勵（體力）。已領取過就跳過。 |
| **每日禮盒** | `/zhTW/decorations`（飾品商城 → 幸運禮盒 → **每日禮盒**） | `POST /api/v1/ornament-shop/box-list` 找出 `name_key=daily_box` 且 `free_times > 0` 的禮盒，再 `POST /api/v1/ornament-shop/open-box` | 用「每日免費」次數打開今天的禮盒，取得獎勵後結束。 |

流程：啟動 → 驗證登入 → 領每日簽到 → 開每日禮盒 → 輸出 JSON 摘要 → 程序結束（容器停止）。

---

## 二、明確不做

| 動作 | 會不會做 |
| --- | --- |
| 領取「等級獎勵」的獎勵物品 | ❌ 永遠不呼叫 |
| 「一鍵全領」戰令獎勵 / 賽季任務獎勵 | ❌ 永遠不呼叫 |
| 開啟「我的背包」內的驚喜盲盒 | ❌ 永遠不呼叫 |
| 領取 `activity/blind-box/checkin`（會把簽到禮盒送進背包） | ❌ 永遠不呼叫 |
| 任何購買 / 訂閱 / 充值 / 兌換池 / 排行榜 | ❌ 永遠不呼叫 |

### 三層防線（不是靠「小心一點」）

1. **端點白名單**：所有請求都經過 `SeaArtClient.post()`，只允許 4 個端點
   （`checkin/info`、`checkin`、`box-list`、`open-box`）。其他路徑在送出前就丟出
   `SeaArtError`，連線都不會建立。
2. **只開免費每日禮盒**：`choose_daily_box()` 只回傳 `name_key=daily_box` 且
   `free_times > 0` 的禮盒；`free_times == 0` 就直接跳過，不會誤開付費禮盒。
3. **不碰背包訂單**：`/api/v1/ornament-shop/box-order-*`（我的背包 → 驚喜盲盒）
   完全不在白名單內。

單元測試會驗證這三條規則（`tests/test_core.py`）。

---

## 三、快速開始

### 1. 取得 Cookie 與 User-Agent

1. 用瀏覽器登入 SeaArt，打開 DevTools → **Network**。
2. 重新載入 `https://www.seaart.ai/zhTW/battlePass`。
3. 點任一 `www.seaart.ai` 請求 → **Request Headers**：
   - `cookie`：整行複製（很長是正常的，包含 `T=` 那一段）
   - `user-agent`：同一個瀏覽器的 UA
4. 兩者必須來自**同一個瀏覽器、同一個 session**，否則會話對不上。

> Cookie 等同帳號完整存取權。只放在本機 `.env`，不要貼到 issue、不要 commit。

### 2. 建立 `.env`

```bash
cp .env.example .env
# 編輯 .env，填入 SEAART_COOKIE 與 SEAART_USER_AGENT
```

### 3. 執行（一次，跑完即退）

```bash
docker build -t seaart_bonus .

docker run --rm --init --read-only --tmpfs /tmp:size=8m \
  --env-file .env \
  seaart_bonus
```

或用 compose（已內建唯讀檔案系統）：

```bash
docker compose run --rm seaart-bonus
```

容器流程：啟動 → 領取 → 輸出 JSON → 結束。`--rm` 讓容器結束後自動移除，
符合「領取成功並且打開獎勵後關閉容器」。

### 4. 多帳號

```bash
docker run --rm --env-file .env \
  -e SEAART_COOKIE_2='...' -e SEAART_USER_AGENT_2='...' \
  seaart_bonus
```

`SEAART_COOKIE_2` … `SEAART_COOKIE_20` 會依序處理；`SEAART_USER_AGENT_N` 省略時
沿用 `SEAART_USER_AGENT`。

### 5. 每天自動執行（選用）

主機 cron（每天 09:05）：

```cron
5 9 * * * cd /opt/seaart_bonus && docker compose run --rm seaart-bonus >> run.log 2>&1
```

---

## 四、環境變數

| 變數 | 必填 | 預設 | 說明 |
| --- | --- | --- | --- |
| `SEAART_COOKIE` | ✅ | — | 完整 cookie 請求標頭 |
| `SEAART_USER_AGENT` | ✅ | — | 對應瀏覽器 UA |
| `SEAART_COOKIE_2`…`_20` | | — | 其他帳號的 cookie |
| `SEAART_USER_AGENT_2`…`_20` | | 繼承 | 其他帳號的 UA |
| `SEAART_LOCALE` | | `zhTW` | 語系前綴（`zhTW`/`zhCN`/`en`/`ja`/`ko`） |
| `SEAART_TIMEOUT` | | `30` | 單次請求逾時秒數 |
| `SEAART_DRY_RUN` | | `false` | 只查狀態、不領取/不開盒 |
| `SEAART_VERBOSE` | | `false` | 印出每個 HTTP 狀態碼 |

CLI 旗標：`--dry-run`、`--verbose`。

---

## 五、輸出與退出碼

成功時會印出 JSON 摘要（`ensure_ascii=False`，可直接看中文）：

```json
{
  "tool": "seaart-bonus",
  "version": "1.0.0",
  "elapsed_seconds": 2.31,
  "dry_run": false,
  "accounts": [
    {
      "account": 1,
      "ok": true,
      "checkin": { "status": "claimed", "code": 10000, "reward": 25 },
      "gift": {
        "status": "opened",
        "code": 10000,
        "box": "每日免费礼盒",
        "rewards": [{ "type": 3, "number": 20, "level": 1, "ornament_shop_id": "..." }]
      }
    }
  ]
}
```

| 退出碼 | 意義 |
| --- | --- |
| `0` | 全部帳號處理完成（含「今天已領取」） |
| `1` | 至少一個帳號失敗（cookie 過期、網路錯誤、API 回非 10000） |
| `2` | 環境變數設定錯誤 |

`checkin.status` 可能是 `claimed` / `already` / `would-claim` / `failed`；
`gift.status` 可能是 `opened` / `no-free-box` / `would-open` / `failed`。
「今天已領取」是正常結果，不算失敗。

---

## 六、憑證安全

- Cookie 只從環境變數讀取，**不寫入任何檔案**、不進 Docker image、不進 log。
- 日誌只會印出 cookie 的長度與欄位名稱（`mask_cookie()`），不會印出值。
- 建議容器以 `--read-only` + `--tmpfs /tmp` 執行（compose 已內建），
  這樣即使程式想寫檔也沒有可寫路徑。
- `.gitignore` / `.dockerignore` 已排除 `.env`。
- 測試或截圖後請撤銷/更新 cookie：SeaArt 重新登入即可讓舊 token 失效。

---

## 七、API 對照表

| 用途 | Method | Path | 備註 |
| --- | --- | --- | --- |
| 簽到狀態 | POST | `/api/v1/activity/checkin/info` | `week_item_list[].is_finish` 判斷今天是否已簽 |
| 每日簽到 | POST | `/api/v1/activity/checkin` | 成功 `status.code=10000`；重複簽到 `70068` |
| 禮盒清單 | POST | `/api/v1/ornament-shop/box-list` | 每日免費禮盒：`name_key=daily_box`、`free_times>0` |
| 開每日禮盒 | POST | `/api/v1/ornament-shop/open-box` | body `{"box_id": "...", "number": 1}` |

請求標頭：`cookie`、`user-agent`、`origin: https://www.seaart.ai`、
`referer: .../zhTW/battlePass`、`content-type: application/json`、`x-eyes: true`、
`app-id: web_global_seaart`。

---

## 八、常見問題

**Q：出現 `cookie rejected (HTTP 401)` 或 `code != 10000`？**
Cookie 過期或與 UA 不匹配。重新從瀏覽器複製整行 cookie 與同一個 UA。

**Q：`gift.status = no-free-box`？**
今天已經開過每日禮盒，或該帳號今天沒有免費次數。明天再跑即可。

**Q：`checkin.status = already`？**
今天已經簽到過了，正常。程式是冪等的，一天可重複執行。

**Q：會不會開到「我的背包」的盲盒？**
不會。背包相關端點不在白名單，程式只開 `box-list` 中 `free_times>0` 的每日禮盒。

**Q：會不會領等級獎勵？**
不會。`paymenthub/battle-pass-*` 與任務獎勵端點都不在白名單。

---

## 九、開發與測試

```bash
python3 -m unittest discover -s tests -v
python3 seaart_bonus.py --dry-run    # 需要先 export SEAART_COOKIE / SEAART_USER_AGENT
```

專案結構：

```
seaart_bonus.py        # 主程式（單檔、無瀏覽器）
tests/test_core.py     # 純函式與白名單測試（不需網路）
Dockerfile             # python:3.12-alpine，非 root，映像檔 < 100 MB
docker-compose.yml     # 唯讀檔案系統 + tmpfs
.env.example           # 設定範例（不含真實憑證）
.github/workflows/     # 建置並推送 Docker image
```

## 授權

MIT，詳見 [LICENSE](LICENSE)。本專案與 SeaArt AI 無官方關聯；請自行確認使用條款，
並自負帳號風險。
