import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import test from "node:test";

import worker from "../src/worker.js";


if (typeof crypto.subtle.timingSafeEqual !== "function") {
  Object.defineProperty(crypto.subtle, "timingSafeEqual", {
    value(left, right) {
      const leftBytes = Buffer.from(left);
      const rightBytes = Buffer.from(right);
      return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
    }
  });
}

function environment() {
  const readingEvents = [{
    id: 1,
    view_id: "view-1",
    article_slug: "article",
    article_title: "Article",
    language: "en",
    path: "/article-en.html",
    event_type: "view",
    created_at: "2026-08-27 12:00:00"
  }];
  const messages = [{
    id: 2,
    article_slug: "article",
    article_title: "Article",
    language: "en",
    path: "/article-en.html",
    sender_name: "Reader",
    sender_email: "reader@example.test",
    message: "A private note",
    quote_text: "A quoted <passage>",
    paragraph_index: 4,
    sender_hash: "must-not-be-exported",
    status: "unread",
    created_at: "2026-08-27 12:05:00"
  }];
  return {
    ADMIN_USERNAME: "rxxldq",
    ADMIN_PASSWORD: "test-password",
    DB: {
      prepare(sql) { return { sql }; },
      async batch(statements) {
        if (/SUM\(CASE/.test(statements[0].sql)) {
          return [{ results: [] }, { results: messages }];
        }
        assert.match(statements[0].sql, /FROM reading_events/);
        assert.match(statements[1].sql, /FROM messages/);
        assert.doesNotMatch(statements[1].sql, /sender_hash/);
        return [{ results: readingEvents }, { results: messages }];
      }
    }
  };
}

function authorizedRequest(path = "/admin/backup.json") {
  const credentials = Buffer.from("rxxldq:test-password").toString("base64");
  return new Request(`https://example.test${path}`, {
    headers: { Authorization: `Basic ${credentials}` }
  });
}

test("private backup requires dashboard authentication", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/admin/backup.json"),
    environment()
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /Basic/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
});

test("private dashboard exposes a clear backup download", async () => {
  const response = await worker.fetch(authorizedRequest("/admin"), environment());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /href="\/admin\/backup\.json">Private backup<\/a>/);
  assert.match(html, /Quoted passage · paragraph 4/);
  assert.match(html, /A quoted &lt;passage&gt;/);
  assert.doesNotMatch(html, /A quoted <passage>/);
});

test("private backup downloads a portable archive without sender hashes", async () => {
  const response = await worker.fetch(authorizedRequest(), environment());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition"), /attachment; filename="rxxldq-private-insights-\d{4}-\d{2}-\d{2}\.json"/);

  const backup = await response.json();
  assert.equal(backup.format, "rxxldq-private-insights-backup");
  assert.equal(backup.version, 2);
  assert.equal(backup.privacy.raw_ip_addresses_included, false);
  assert.equal(backup.privacy.sender_hashes_included, false);
  assert.equal(backup.reading_events.length, 1);
  assert.equal(backup.private_messages.length, 1);
  assert.equal(backup.private_messages[0].sender_email, "reader@example.test");
  assert.equal(backup.private_messages[0].quote_text, "A quoted <passage>");
  assert.equal(backup.private_messages[0].paragraph_index, 4);
  assert.equal("sender_hash" in backup.private_messages[0], false);
  assert.equal(JSON.stringify(backup).includes("must-not-be-exported"), false);
});

test("private passage context is validated and stored with the message", async () => {
  const inserted = [];
  const env = {
    ALLOWED_ORIGINS: "https://rxxldq.github.io",
    RATE_SALT: "test-rate-salt",
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() { return { count: 0 }; },
              async run() { inserted.push({ sql, values }); return { success: true }; }
            };
          }
        };
      }
    }
  };
  const response = await worker.fetch(new Request("https://example.test/api/message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://rxxldq.github.io",
      "CF-Connecting-IP": "192.0.2.10"
    },
    body: JSON.stringify({
      slug: "article",
      title: "Article",
      lang: "en",
      path: "/article-en.html",
      message: "This turn matters.",
      quote: "The selected sentence.",
      paragraphIndex: "12"
    })
  }), env);

  assert.equal(response.status, 201);
  assert.equal(inserted.length, 1);
  assert.match(inserted[0].sql, /quote_text, paragraph_index/);
  assert.equal(inserted[0].values[7], "The selected sentence.");
  assert.equal(inserted[0].values[8], 12);
  assert.equal(inserted[0].values.length, 10);
});
