import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(path, "utf8");

const stripFrontmatter = markdown =>
  markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trimStart();

test("contact page and serverless function are wired without hardcoded secrets", () => {
  assert.equal(existsSync("src/pages/contact.astro"), true);
  assert.equal(existsSync("api/contact.ts"), true);

  const page = read("src/pages/contact.astro");
  assert.match(page, /action="\/api\/contact"/);
  assert.match(page, /name="nickname"/);
  assert.match(page, /name="email"[^>]*required/s);
  assert.match(page, /name="category"[^>]*required/s);
  assert.match(page, /name="message"[^>]*required/s);
  assert.match(page, /已收到你的訊息，我會視時間回覆/);
  assert.match(page, /完整卡號、ITIN、護照或銀行密碼/);

  const api = read("api/contact.ts");
  assert.match(api, /CONTACT_TO_EMAIL/);
  assert.match(api, /RESEND_API_KEY/);
  assert.match(api, /api\.resend\.com\/emails/);
  assert.match(api, /Map</);
  assert.doesNotMatch(api, /@gmail\.com|@icloud\.com|@outlook\.com/);
});

test("blog posts can optionally link to a Dcard discussion", () => {
  assert.match(read("src/content.config.ts"), /dcardUrl:\s*z\.string\(\)\.url\(\)\.optional\(\)/);

  const postDetails = read("src/layouts/PostDetails.astro");
  assert.match(postDetails, /dcardUrl/);
  assert.match(postDetails, /Dcard 討論串/);
  assert.match(postDetails, /有類似經驗或問題/);
});

test("known posts do not repeat the frontmatter title as a markdown h1", () => {
  for (const path of [
    "src/data/blog/chase-ihg-premier-pending-recon.md",
    "src/data/blog/hsbc-us-elite-application-from-taiwan.md",
  ]) {
    const body = stripFrontmatter(read(path));
    assert.equal(body.startsWith("# "), false, `${path} still starts with an h1`);
  }
});

test("about page and footer include trust and disclaimer copy", () => {
  const about = read("src/pages/about.md");
  assert.match(about, /關於 Grant 與這個網站/);
  assert.match(about, /內容更新/);
  assert.match(about, /\[聯絡我\]\(\/contact\)/);
  assert.match(about, /聯盟連結/);
  assert.match(about, /不構成財務、稅務或法律建議/);

  const footer = read("src/components/Footer.astro");
  assert.match(footer, /不構成財務、稅務或法律建議/);
  assert.match(footer, /信用卡優惠與福利可能隨時變更/);
  assert.match(footer, /部分文章可能包含信用卡推薦連結/);
});
