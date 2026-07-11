# Task: 聯絡表單 + 導流 Dcard 留言 + H1 修復 + 信任度文案

## 背景

AstroPaper v5.5.1 + Astro 5 部落格，6 篇文章，個人信用卡 DP 部落格（台灣受眾）。
GPT 建議做完整 Supabase 留言+會員系統，經評估認為現階段過度工程（無流量訊號、副攻專案、無維運人力）。
本任務是精簡版 MVP：只做「讀者能傳訊息給作者」+「導流到既有 Dcard 留言區」+ 修 bug + 補信任文案。
**不要**加任何資料庫、認證系統、留言 UI、Email 訂閱後端。

---

## Task 1：聯絡我表單（無登入、無資料庫）

**目標：** 讀者能直接送訊息給 Grant，不需要暴露他的私人 email、不需要註冊。

**做法：**
- 新增 `src/pages/contact.astro`，nav 加「聯絡我」連結（`src/components/Header.astro`）
- 表單欄位：暱稱（選填）、Email（必填）、分類 select（美國信用卡申請／ITIN・銀行開戶／旅遊點數／租車險理賠／內容更正／其他）、訊息內容（必填，textarea）
- **後端**：用 Vercel Serverless Function（`api/contact.ts`，Node runtime）接收表單 POST，透過 [Resend](https://resend.com) 免費方案（100 封/天）寄信到 Grant 的 email（環境變數 `CONTACT_TO_EMAIL` 存收件信箱，`RESEND_API_KEY` 存金鑰，兩者由 Grant 之後在 Vercel 專案設定手動填入，程式碼只讀 `process.env`，不要寫死任何 email）
- 送出後前端顯示：「已收到你的訊息，我會視時間回覆。請勿傳送完整卡號、ITIN、護照或銀行密碼等敏感資訊。」
- 基本防濫用：honeypot 隱藏欄位（bot 會填、真人不會）+ 簡單 rate limit（同 IP 60 秒內限 1 次，用記憶體 Map 即可，不需要 Redis／DB）
- 不需要：驗證碼、登入、資料庫儲存訊息紀錄（信寄出去就好，Grant 的 email 收件匣就是紀錄）

---

## Task 2：文章結尾導流 Dcard 留言

**目標：** 把互動需求導去已存在、已有讀者的地方（Dcard 貼文留言區），不重造輪子。

**做法：**
- 在 `src/content.config.ts` 的 blog schema 加一個選填欄位：`dcardUrl: z.string().url().optional()`
- 在文章 layout（找 `src/layouts/` 下渲染單篇文章的檔案，通常是 `PostDetails.astro` 或類似）文末、分享按鈕附近，若該篇 frontmatter 有 `dcardUrl`，顯示一段：
  > 「有類似經驗或問題？歡迎到 [Dcard 討論串](連結) 留言，我會盡量回覆。」
- 之後 Grant 會自己在有 Dcard 版本的文章 frontmatter 補上 `dcardUrl: "https://www.dcard.tw/f/creditcard/p/xxxxx"`（不用你幫忙填數值，只要 schema + 顯示邏輯做好）

---

## Task 3：修復重複 H1（真的 bug，非文案問題）

**背景：** AstroPaper 用 frontmatter 的 `title` 自動渲染頁面主標題（H1）。部分文章正文開頭又手動寫了一個 `# 標題`，造成同一標題渲染兩次。

**已確認需要修的檔案：**
- `src/data/blog/chase-ihg-premier-pending-recon.md`
- `src/data/blog/hsbc-us-elite-application-from-taiwan.md`

**做法：** 打開這兩個檔案，找到內文開頭那行 `# ...` 開頭的 markdown H1（跟 frontmatter 的 `title` 內容相同或幾乎相同），**只刪除那一行 H1**，其餘內容不動。刪除後確認上下文銜接自然（通常 H1 後面接的是開場段落，刪掉 H1 直接留段落即可，不需要加回任何東西）。

**驗證：** `npx astro build` 後，用 `grep -oE '<h1[^>]*>' dist/posts/<slug>/index.html | wc -l` 確認每篇文章頁面只有 1 個 `<h1>`（其餘 4 篇本來就沒問題，不用動）。

---

## Task 4：信任度文案（純文字，無功能開發）

**About 頁（`src/pages/about.md`）：**
- 中文化主標題（目前可能是英文 "About"，改成「關於 Grant 與這個網站」或類似）
- 內容補充：為什麼寫美卡、內容更新原則、如何聯絡（連到 Task 1 的 `/contact`）、免責聲明、聯盟連結政策

**聯盟連結揭露聲明**（放在有 referral 連結的文章適當位置，或全站 Footer 統一放一次）：
> 「部分文章可能包含信用卡推薦連結。透過推薦連結申請，作者可能獲得點數或其他獎勵，但不會增加讀者的申請成本。推薦不代表保證核卡，所有條款與優惠以發卡銀行公告為準。」

**Footer 財務免責聲明**（`src/components/Footer.astro` 或對應檔案）：
> 「本站內容為個人經驗與資訊分享，不構成財務、稅務或法律建議。信用卡優惠與福利可能隨時變更，申請前請以發卡機構最新條款為準。」

---

## 明確不做（避免 scope creep）

- ❌ 不加任何資料庫（Supabase、Postgres、Redis 都不要）
- ❌ 不加任何登入/認證機制（Magic Link、OAuth 都不要）
- ❌ 不做站內公開留言 UI
- ❌ 不做 Email 訂閱後端
- ❌ 不做會員系統、收藏、Data Point 投稿表單
- ❌ 不用 Giscus / Disqus（GPT 建議的兩個現成留言方案都不用——這階段連留言功能本身都不做）

---

## 驗收標準

1. `npx astro build` 無錯誤，35+ 頁正常產出
2. `/contact` 頁面可正常送出表單（本機測試可能因缺 Resend API Key 而寄信失敗屬正常，確認表單邏輯與錯誤處理即可，不要 hardcode 假金鑰）
3. 有 `dcardUrl` 的文章（測試用假的 URL 值即可）文末出現導流文字，沒有此欄位的文章不顯示該區塊也不出錯
4. `chase-ihg-premier-pending-recon` 與 `hsbc-us-elite-application-from-taiwan` 兩篇建置後只有 1 個 `<h1>`
5. About 頁與 Footer 文案已更新
6. git commit（不要 push，等 Grant 本機看過再 push）
