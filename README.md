# seaart_bonus

用 **Cookie + User-Agent** 登入 [SeaArt AI](https://www.seaart.ai/)，在容器啟動後自動完成
**每日簽到** 與 **每日禮盒** 兩件事，完成即結束容器。

本專案參考 [simao-silva/noip-renewer](https://github.com/simao-silva/noip-renewer)
的「一次性容器 + 環境變數帶入憑證 + 跑完即退」模式，把作用網站從 No-IP 換成 SeaArt AI。

- 每日簽到頁：`https://www.seaart.ai/zhTW/battlePass`
- 每日禮盒頁：`https://www.seaart.ai/zhTW/mall?dotFrom=svip_banner`

---

## 一、只做兩件事

| 動作 | 會做 |
|---|---|
| 每日簽到 | ✅ 開啟簽到面板並領取當日獎勵 |
| 每日禮盒 | ✅ 開啟當日禮盒並領取 |

## 二、明確不做

| 動作 | 會不會做 |
|---|---|
| 領取「等級獎勵」的獎勵物品 | ❌ 永遠不點 |
| 「一鍵全領」戰令獎勵 | ❌ 永遠不點 |
| 開啟「我的背包」內的驚喜盲盒 | ❌ 永遠不點 |
| 任何購買 / 訂閱 / 充值 / 兌換池 / 排行榜 | ❌ 永遠不點 |

這些限制不是靠「小心一點」，而是寫死在 `src/guard.js` 的封鎖字表與容器 class 特徵裡，
並且在點擊前對「元素文字 + 最多 8 層祖先的 class/id」做雙重比對。單元測試會驗證它。

---

## 三、快速開始

### 1. 取得 Cookie 與 User-Agent

1. 用瀏覽器登入 SeaArt，打開 DevTools → **Network**。
2. 重新載入 `https://www.seaart.ai/zhTW/battlePass`。
3. 點任一 `www.seaart.ai` 請求 → **Request Headers**：
   - `cookie`：整行複製（長度很長是正常的）
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
docker build -t seaart-bonus .

docker run --rm --init --shm-size=1g \
  --env-file .env \
  seaart-bonus
```

或用 compose：

```bash
docker compose run --rm seaart-bonus
```

容器內流程：啟動 → 注入 cookie → 開簽到頁 → 領取 → 開禮盒頁 → 領取 → 輸出 JSON 摘要 → 結束。
`--rm` 讓容器結束後自動移除，符合「領取成功後關閉容器」。

### 4. 每日自動執行（選用）

主機 cron（每天 09:05）：

```cron
5 9 * * * cd /opt/seaart_bonus && docker compose run --rm seaart-bonus >> run.log 2>&1
```

---

## 四、環境變數

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `SEAART_COOKIE` | ✅ | — | 完整 cookie 請求標頭 |
| `SEAART_USER_AGENT` | ✅ | — | 對應瀏覽器 UA |
| `SEAART_LOCALE` | | `zhTW` | 語系前綴 |
| `SEAART_HEADLESS` | | `true` | 是否無頭 |
| `SEAART_SETTLE_MS` | | `2500` | 每次點擊後等待 |
| `SEAART_TIMEOUT_MS` | | `45000` | 導覽/元素逾時 |
| `SEAART_SLOW_MO` | | `0` | 每步減速（除錯用） |
| `SEAART_CHECKIN_URL` | | battlePass | 簽到頁 |
| `SEAART_GIFT_URL` | | mall?dotFrom=svip_banner | 禮盒頁 |
| `SEAART_HOME_URL` | | `/zhTW` | 找不到入口時的回退頁 |
| `SEAART_CHECKIN_ENTRY` | | 自動 | 簽到入口 CSS |
| `SEAART_GIFT_ENTRY` | | 自動 | 禮盒入口 CSS |
| `SEAART_CLAIM_BUTTON` | | 自動 | 領取按鈕 CSS |
| `SEAART_DISCOVER` | | `false` | 等同 `--discover` |
| `SEAART_LOCAL_STORAGE` | | `{}` | 選用：localStorage JSON，補足 cookie 不足的登入態 |
| `SEAART_DUMP_DIR` | | `./dump` | 校正輸出目錄 |

CLI 旗標：`--headed`（顯示瀏覽器）、`--dry-run`（只找不點）、`--dump`（匯出頁面與按鈕清單）、
`--discover`（只列出可點元素，完全不點擊）。

---

## 五、運作原理

```
docker run
   │
   ├─ 解析 SEAART_COOKIE → Playwright cookie（domain .seaart.ai）
   ├─ 建立 context（UA / zh-TW / Asia/Taipei / 1440x1000）
   │
   ├─ goto battlePass  → 偵測登入狀態
   │     └─ 找「簽到」入口 → 點擊 → 面板內找「領取」→ 點擊 → 驗證
   │
   ├─ goto mall?dotFrom=svip_banner
   │     └─ 找「禮盒」入口 → 點擊 → 面板內找「開啟/領取」→ 點擊 → 驗證
   │
   └─ 輸出 JSON 摘要 → 關閉瀏覽器 → 進程結束（容器停止）
```

定位方式為「文字關鍵字 + 可點擊性 + 可見性」，不依賴固定的 hash class，
因此站方小改版通常仍可運作；大改版可用 `--dump` 重新校正。

成功判定：頁面出現 `已領取 / 已簽到 / 領取成功 / 明天再來` 等完成字樣，或出現成功 toast。

---

## 六、校正選擇器

站方改版導致 `not_found` 時。

**先看診斷（不改任何設定、不點擊任何東西）：**

```bash
docker run --rm --env-file .env seaart-bonus --discover
```

它會走訪 battlePass → mall → 首頁，列出每個頁面上所有可見可點元素（含 class），
把輸出貼回來就能定位真正的「簽到 / 禮盒」入口。

**再看快照：**

```bash
docker run --rm --env-file .env -v "$PWD/dump:/tmp/seaart-dump" \
  -e SEAART_DUMP=1 seaart-bonus
```

會得到 `dump/checkin.png`、`dump/checkin.html`、`dump/checkin.buttons.json`。
從中挑出正確元素的 CSS，寫進 `.env`：

```env
SEAART_CHECKIN_ENTRY=div.daily-sign-entry
SEAART_GIFT_ENTRY=div.daily-gift-entry
SEAART_CLAIM_BUTTON=button.claim-btn
```

### 已發生的實例（2026-11-12）

日誌顯示 `session: logged in`，但 battlePass 與 mall 都 `not_found` ——
表示**這兩個頁面在登入狀態下並沒有「簽到／禮盒」元素**（站方的每日獎勵是浮動元件，
可能只在首頁或創作頁掛載）。因此 v1.1 起會自動回退到首頁，並在失敗時直接印出頁面上
含「簽/禮/盒/每日/獎/領/福」的可點元素。若仍找不到，用 `--discover` 的完整清單定位。

---

## 七、退出碼

| 代碼 | 意義 |
|---|---|
| `0` | 兩項都成功（或今日已領取過） |
| `1` | 執行錯誤（導覽失敗、瀏覽器崩潰等） |
| `2` | 部分完成／找不到入口（需校正選擇器） |
| `64` | 缺少必填環境變數 |

摘要以單行 JSON 輸出，便於 cron / CI 收集：

```json
{"ranAt":"2026-11-12T01:05:00.000Z","results":[{"kind":"checkin","status":"claimed"},{"kind":"gift","status":"claimed"}],"exit":0}
```

---

## 八、安全性與合規

- **Cookie 就是帳號**：外洩等於被完全登入。請只放在本機 `.env`（已在 `.gitignore`）。
- 容器以非 root（`node`）執行；不使用 `--privileged`；不掛載主機目錄（除除錯用 dump）。
- 本工具不修改任何網站資料，只做兩個「領取」動作，且封鎖購買類按鈕。
- **風險自負**：自動化存取可能違反 SeaArt 的服務條款，帳號可能被風控或限制。
  請只用於自己的帳號，並自行評估風險。本專案不提供任何保證。

---

## 九、已知限制

1. **未在登入狀態下驗證過實際 DOM**：開發時只能觀察未登入頁面與 SSR 結構，
   「簽到 / 禮盒」的實際文案與容器 class 可能與假設不同 → 首次執行請先用 `--dump` 或 `--dry-run`。
2. 站方是 Nuxt SPA，登入後才渲染的元件可能延遲載入；已用 `SEAART_SETTLE_MS` 等待，
   網路慢時請調高。
3. Cookie 會過期，需定期重新抓取。
4. 若帳號開啟 2FA／裝置驗證，純 cookie 可能被要求重新驗證。
5. 站方若把入口放進 iframe 或 canvas，本工具不會處理（會回報 `not_found`）。

---

## 十、專案結構

```
seaart_bonus/
├── src/
│   ├── index.js     # 入口：流程、摘要、退出碼
│   ├── config.js    # 環境變數與 CLI 旗標
│   ├── guard.js     # cookie 解析、封鎖字表、標籤比對（純函式）
│   ├── browser.js   # Chromium / context / cookie 注入 / 登入偵測
│   └── tasks.js     # 候選元素掃描、點擊、成功判定、dump
├── test/guard.test.js
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## 十一、開發

```bash
npm install
npm run check   # 語法檢查
npm test        # 單元測試（不需瀏覽器）
```

---

### English summary

`seaart_bonus` is a one-shot container job that logs into SeaArt AI with a raw
cookie header plus user agent, claims the **daily check-in** and the **daily gift
box**, prints a JSON summary and exits. A hard blocklist prevents it from ever
claiming battle-pass level rewards, pressing "claim all", opening mystery blind
boxes in the backpack, or touching any purchase flow.
