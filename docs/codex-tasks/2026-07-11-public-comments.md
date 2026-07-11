# Task: 文章公開留言區（即時顯示 + Email 通知審核）

## 背景

延續 `docs/codex-tasks/2026-07-11-contact-and-site-trust-fixes.md` 已完成的聯絡表單。
Grant 這次要加「文章下方公開留言區」，目的是累積讀者互動、記錄人氣。已與 Grant 確認兩個關鍵決策：

1. **留言送出後立即公開顯示**（不用等審核）——低摩擦優先
2. **有新留言時 email 通知 Grant**，方便他事後審視、必要時手動刪除不當內容

**唯一例外**：留言內容若包含 **2 個以上網址（`http://` 或 `https://`）**，判定為疑似垃圾留言，**不立即公開**，進入待審佇列，只有 Grant 在 `/admin/comments` 手動核准才會顯示。這是業界常見的留言垃圾防護手法（連結灌水是最大宗的留言垃圾類型），其餘正常留言不受影響。

**沿用既有基礎設施：**
- 沿用聯絡表單已設定好的 Resend + `grantkuo.1@gmail.com` 部落格身分寄送通知信（環境變數 `RESEND_API_KEY`、寄件邏輯可參考 `api/contact.ts` 的寫法）
- **資料庫已建立完成**：Vercel Postgres（Neon 整合），已連接到本專案（Production + Preview）。連線字串環境變數已確認可用，**使用 `process.env.DATABASE_URL`**（pooled connection，Neon 推薦用於一般查詢）。另有 `DATABASE_URL_UNPOOLED` 可用於需要不經 pgbouncer 的場景，本功能用不到，不用理會。`ADMIN_TOKEN` 環境變數也已設定完成（Production + Preview）。這兩者都不用你再處理，直接在程式碼裡用 `process.env.DATABASE_URL` 和 `process.env.ADMIN_TOKEN` 讀取即可。

**建議套件**：`@neondatabase/serverless`（Neon 官方 quickstart 推薦，已確認相容 Vercel Functions），`npm install @neondatabase/serverless` 後：
```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`SELECT * FROM comments WHERE post_slug = ${slug} AND status = 'published' ORDER BY created_at ASC`;
```
用標籤模板字串（tagged template）語法會自動做參數化查詢、防 SQL injection，**不要用字串拼接組 SQL**。

---

## Task 1：資料庫 Schema

用 Vercel 提供的 Postgres client（`@vercel/postgres` 或標準 `pg`/`postgres` npm 套件，選一個跟現有專案依賴衝突最小的）。

建一張表（可用一支 migration/setup script，或在 `api/` 底下寫一個一次性初始化邏輯，並在文件裡註明 Grant 只需執行一次）：

```sql
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  post_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,               -- 選填，僅供 Grant 內部參考，絕不公開顯示
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',  -- 'published' | 'pending' | 'rejected'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post_slug ON comments(post_slug);
```

---

## Task 2：留言 API（`api/comments.ts`）

**GET `/api/comments?slug=<post_slug>`**
- 回傳該篇文章 `status = 'published'` 的留言列表，依 `created_at` 由舊到新排序
- 回傳欄位只給 `name`、`message`、`created_at`（**絕不回傳 email**）

**POST `/api/comments`**
- Body：`{ post_slug, name, email?, message, website }`（`website` 是 honeypot，比照 `api/contact.ts` 的做法）
- 驗證：
  - `post_slug`、`name`、`message` 必填，`message` 長度上限 **1000 字元**、`name` 上限 **50 字元**
  - `website`（honeypot）有填 → 靜默回 200 但不寫入資料庫
  - 同 IP **30 秒內限送 1 則留言**（比照 contact.ts 的 rate limit pattern，可以共用邏輯）
  - 寫入資料庫前，`name` 與 `message` 都要 escape（沿用 `api/contact.ts` 的 `escapeHtml` 概念，防止留言內容被當成 HTML 注入頁面——即使前端渲染時也做跳脫，這裡是雙重保險）
- **連結偵測**：計算 `message` 中 `http://` 或 `https://` 出現次數，**≥ 2 次 → status 存成 `pending`**，否則存 `published`
- 寫入成功後：
  - 呼叫 Resend，寄一封通知信到 `CONTACT_TO_EMAIL`（沿用已設定好的環境變數與寄件識別），內容包含：文章 slug、留言者 name、留言內容、狀態（published 還是 pending 待審）、`/admin/comments` 連結
  - 回傳 `{ ok: true, status: "published" | "pending" }` 給前端，讓頁面知道要不要立刻把這則留言插進畫面（pending 的不要顯示在前端，即使是留言者本人也看不到，避免造成「我送出了但頁面沒反應」的困惑，前端可顯示一句提示：「留言含較多連結，將由站方確認後顯示」）

---

## Task 3：文章頁留言 UI

- 在文章 layout（`PostDetails.astro` 或對應檔案）文末新增留言區塊：
  - 上方：留言列表（元件掛載後 `fetch('/api/comments?slug=' + slug)` 拉取並渲染，顯示 `name` + 相對時間（例如「3 天前」）+ `message`，無留言時顯示「還沒有留言，來當第一個吧」）
  - 下方：留言表單（暱稱、Email 選填、留言內容 textarea、honeypot 隱藏欄位、送出按鈕）
  - 表單上方提示文字：「請勿留下卡號、ITIN、密碼等敏感資訊，留言會公開顯示」
  - 送出後：呼叫 POST API，成功且 `status: "published"` → 前端把新留言即時插入列表；`status: "pending"` → 顯示提示文字（見上），不插入列表；失敗 → 顯示簡短錯誤訊息
- 用 Astro island（`client:load` 或 `client:visible` 皆可，参考現有專案是否已有 React 元件慣例，`tsconfig.json` 已設定 `jsxImportSource: react`，可以寫 React 元件；若專案其餘互動元件都是 vanilla JS，則跟隨現有慣例，不要引入不必要的框架依賴）

---

## Task 4：Admin 審核頁（`/admin/comments`）

**目的：** 讓 Grant 能看到全部留言（含 pending）、核准 pending 留言、刪除任何不當留言（即使已經是 published 狀態）。**不做真正的登入系統**，用簡單的共用密鑰保護即可。

**做法：**
- 新增環境變數 `ADMIN_TOKEN`（Grant 自己在 Vercel 設一組隨機字串，不用告訴任何人）
- `src/pages/admin/comments.astro`：純前端頁面，第一次進入要求輸入 token（存進 `localStorage`），之後每次呼叫 admin API 都在 header 帶 `Authorization: Bearer <token>`
- `api/comments-admin.ts`：
  - 檢查 `Authorization` header 是否等於 `process.env.ADMIN_TOKEN`，不符回 401
  - **GET**：回傳所有留言（含 pending/rejected），依時間新到舊排序，這裡可以回傳 email 給 Grant 自己看
  - **PATCH `/api/comments-admin?id=<id>`**：body `{ status: "published" | "rejected" }`，更新該留言狀態
  - **DELETE `/api/comments-admin?id=<id>`**：直接刪除該筆留言
- 頁面上每則留言顯示：文章 slug、name、email、message、狀態、時間，並排 **核准／拒絕／刪除** 按鈕（pending 才顯示核准/拒絕，published 顯示刪除）

---

## 明確不做（避免 scope creep）

- ❌ 不做真正的使用者帳號/登入系統（留言者不用註冊、不用驗證 email）
- ❌ 不做留言的巢狀回覆（reply-to-comment）、按讚、表情符號反應
- ❌ 不做自動髒字過濾（連結偵測是唯一的自動防護規則，其餘交給 Grant 事後人工判斷）
- ❌ Admin 頁不做多人權限管理，全站只有一組 `ADMIN_TOKEN`，Grant 一人使用

---

## 驗收標準

1. `npx astro build` 無錯誤
2. 本機或 preview 環境測試：送出一則不含連結的留言 → API 回 `published` → 前端立即顯示 → Grant 信箱收到通知信
3. 送出一則含 2 個以上連結的留言 → API 回 `pending` → 前端**不**顯示該留言、顯示待審提示 → Grant 信箱仍收到通知信（註明待審）
4. `/admin/comments` 用錯誤 token 呼叫 API → 401；用正確 token → 能看到全部留言（含 pending）、核准後該留言才出現在文章頁的公開列表、刪除後該留言從兩邊都消失
5. Honeypot 與 rate limit 邏輯確實擋下測試請求（可比照 `tests/contact-and-trust-fixes.test.mjs` 的既有測試風格，為 comments API 補對應測試）
6. git commit（不要 push，等 Grant 本機看過再 push）

（資料庫與 `ADMIN_TOKEN` 已由 Grant 於 2026-07-11 設定完成並確認生效，不需再於 commit 中提醒。）
