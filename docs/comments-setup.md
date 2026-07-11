# Public Comments Setup

公開留言功能使用 Vercel Postgres / Neon。資料庫與 `ADMIN_TOKEN` 已由 Grant 於 2026-07-11 在 Vercel 專案中設定完成，Production 與 Preview 都可讀取環境變數。

## 環境變數

程式碼會讀取：

- `DATABASE_URL`：Neon pooled connection，一般查詢使用。
- `ADMIN_TOKEN`：`/admin/comments` 管理頁與 `api/comments-admin.ts` 使用。
- `RESEND_API_KEY`：新留言通知信使用。
- `CONTACT_TO_EMAIL`：新留言通知信收件信箱。

`DATABASE_URL_UNPOOLED` 目前不需要使用。

## 初始化資料表

正式使用留言功能前，執行一次：

```bash
pnpm run db:setup-comments
```

這會建立 `comments` 資料表與 `idx_comments_post_slug` index。API 也會在收到請求時執行 `CREATE TABLE IF NOT EXISTS`，但上線前仍建議手動跑一次初始化，確認 `DATABASE_URL` 連線正常。

## 上線後測試

1. 到任一文章頁送出不含連結的留言，應立即顯示。
2. 送出包含 2 個以上 `http://` 或 `https://` 的留言，應顯示待審提示，不會立刻公開。
3. 到 `/admin/comments` 輸入 `ADMIN_TOKEN`，確認可以看到全部留言、核准 pending 留言、拒絕或刪除留言。
