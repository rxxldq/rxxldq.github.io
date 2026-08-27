const MAX_BODY_BYTES = 12000;

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bounded(value, max) {
  return text(value).slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim());
  return allowed.includes(origin) ? origin : "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

async function bodyJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("body-too-large");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error("body-too-large");
  return JSON.parse(raw || "{}");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD;
  } catch (_) {
    return false;
  }
}

function authRequired() {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Private reading dashboard", charset="UTF-8"' }
  });
}

async function handleTrack(request, env, origin) {
  let input;
  try { input = await bodyJson(request); } catch (_) {
    return json({ ok: false, error: "invalid-request" }, 400, corsHeaders(origin));
  }
  const eventType = text(input.type);
  const viewId = bounded(input.viewId, 100);
  const slug = bounded(input.slug, 160);
  const title = bounded(input.title, 240);
  const language = bounded(input.lang, 12);
  const path = bounded(input.path, 260);
  if (!['view', 'complete'].includes(eventType) || !viewId || !slug || !title || !path) {
    return json({ ok: false, error: "invalid-event" }, 400, corsHeaders(origin));
  }
  await env.DB.prepare(`
    INSERT OR IGNORE INTO reading_events
      (view_id, article_slug, article_title, language, path, event_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(viewId, slug, title, language || "unknown", path, eventType).run();
  return json({ ok: true }, 202, corsHeaders(origin));
}

async function handleMessage(request, env, origin) {
  let input;
  try { input = await bodyJson(request); } catch (_) {
    return json({ ok: false, error: "invalid-request" }, 400, corsHeaders(origin));
  }
  if (text(input.website)) return json({ ok: true }, 202, corsHeaders(origin));

  const slug = bounded(input.slug, 160);
  const title = bounded(input.title, 240);
  const language = bounded(input.lang, 12) || "unknown";
  const path = bounded(input.path, 260);
  const name = bounded(input.name, 80);
  const email = bounded(input.email, 180);
  const message = bounded(input.message, 3000);
  if (!slug || !title || !path || message.length < 2) {
    return json({ ok: false, error: "invalid-message" }, 400, corsHeaders(origin));
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid-email" }, 400, corsHeaders(origin));
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const senderHash = await sha256(`${env.RATE_SALT}:${ip}`);
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE sender_hash = ? AND created_at >= datetime('now', '-1 hour')
  `).bind(senderHash).first();
  if (Number(recent?.count || 0) >= 5) {
    return json({ ok: false, error: "rate-limited" }, 429, corsHeaders(origin));
  }

  await env.DB.prepare(`
    INSERT INTO messages
      (article_slug, article_title, language, path, sender_name, sender_email, message, sender_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(slug, title, language, path, name || null, email || null, message, senderHash).run();
  return json({ ok: true }, 201, corsHeaders(origin));
}

function dashboardHtml(rows, messages) {
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views || 0), 0);
  const totalCompletions = rows.reduce((sum, row) => sum + Number(row.completions || 0), 0);
  const overallRate = totalViews ? Math.min(100, Math.round(totalCompletions / totalViews * 100)) : 0;
  const unread = messages.filter((message) => message.status === "unread").length;

  const statsRows = rows.map((row) => {
    const views = Number(row.views || 0);
    const completions = Number(row.completions || 0);
    const rate = views ? Math.min(100, Math.round(completions / views * 100)) : 0;
    return `<tr><td><strong>${escapeHtml(row.article_title)}</strong><small>${escapeHtml(row.language)}</small></td><td>${views}</td><td>${completions}</td><td><span class="rate"><i style="width:${rate}%"></i></span>${rate}%</td></tr>`;
  }).join("") || '<tr><td colspan="4" class="empty">No reading data yet.</td></tr>';

  const messageCards = messages.map((item) => {
    const contact = item.sender_email ? `<a href="mailto:${escapeHtml(item.sender_email)}">${escapeHtml(item.sender_email)}</a>` : "No reply address";
    return `<article class="message ${item.status === "unread" ? "unread" : ""}">
      <header><div><strong>${escapeHtml(item.article_title)}</strong><small>${escapeHtml(item.sender_name || "Anonymous")} · ${contact}</small></div><time>${escapeHtml(item.created_at)} UTC</time></header>
      <p>${escapeHtml(item.message).replace(/\n/g, "<br>")}</p>
      ${item.status === "unread" ? `<form method="post" action="/admin/mark-read"><input type="hidden" name="id" value="${Number(item.id)}"><button>Mark as read</button></form>` : '<span class="read-label">Read</span>'}
    </article>`;
  }).join("") || '<p class="empty">No private messages yet.</p>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private reading dashboard</title><style>
  :root{color-scheme:light;--ink:#1d1d1b;--quiet:#77746e;--rule:#d9d6cf;--paper:#fbfaf7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,sans-serif}main{width:min(100% - 32px,1040px);margin:0 auto;padding:64px 0 100px}h1{margin:0 0 8px;font:400 clamp(26px,4vw,42px)/1.15 Georgia,serif}.intro{margin:0 0 48px;color:var(--quiet)}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-bottom:52px;background:var(--rule);border:1px solid var(--rule)}.summary div{padding:22px;background:var(--paper)}.summary strong{display:block;font:400 30px/1 Georgia,serif}.summary span{display:block;margin-top:8px;color:var(--quiet);font-size:12px}h2{margin:52px 0 18px;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase}table{width:100%;border-collapse:collapse}th,td{padding:14px 10px;border-bottom:1px solid var(--rule);text-align:left}th{color:var(--quiet);font-size:11px;font-weight:500}td:nth-child(n+2){width:105px;font-variant-numeric:tabular-nums}td strong,td small{display:block}td small{color:var(--quiet);font-size:11px}.rate{display:inline-block;width:52px;height:2px;margin-right:8px;background:var(--rule);vertical-align:middle}.rate i{display:block;height:100%;background:var(--ink)}.message{margin:0 0 12px;padding:20px;border:1px solid var(--rule)}.message.unread{border-left:3px solid var(--ink)}.message header{display:flex;justify-content:space-between;gap:24px}.message header small{display:block;color:var(--quiet)}.message time{color:var(--quiet);font-size:11px;white-space:nowrap}.message p{margin:20px 0;white-space:normal}.message button{padding:7px 10px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);font:inherit;font-size:11px;cursor:pointer}.read-label,.empty{color:var(--quiet);font-size:11px}@media(max-width:640px){main{padding-top:36px}.summary{grid-template-columns:1fr}table{font-size:12px}th,td{padding:11px 5px}td:nth-child(n+2){width:auto}.rate{display:none}.message header{display:block}.message time{display:block;margin-top:5px}}
  </style></head><body><main><h1>Private reading dashboard</h1><p class="intro">Only you can see these reading figures and messages. No raw IP addresses are stored.</p>
  <section class="summary"><div><strong>${totalViews}</strong><span>Article views</span></div><div><strong>${overallRate}%</strong><span>Overall completion rate</span></div><div><strong>${unread}</strong><span>Unread private messages</span></div></section>
  <h2>By article and language</h2><table><thead><tr><th>Article</th><th>Views</th><th>Completed</th><th>Rate</th></tr></thead><tbody>${statsRows}</tbody></table>
  <h2>Private messages</h2>${messageCards}</main></body></html>`;
}

async function handleAdmin(request, env) {
  if (!authorized(request, env)) return authRequired();
  const [stats, messageRows] = await env.DB.batch([
    env.DB.prepare(`
      SELECT article_slug, article_title, language,
        SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN event_type = 'complete' THEN 1 ELSE 0 END) AS completions
      FROM reading_events
      GROUP BY article_slug, article_title, language
      ORDER BY views DESC, article_title ASC
    `),
    env.DB.prepare(`
      SELECT id, article_slug, article_title, language, path, sender_name,
             sender_email, message, status, created_at
      FROM messages ORDER BY CASE status WHEN 'unread' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 200
    `)
  ]);
  return new Response(dashboardHtml(stats.results || [], messageRows.results || []), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function handleMarkRead(request, env) {
  if (!authorized(request, env)) return authRequired();
  const data = await request.formData();
  const id = Number(data.get("id"));
  if (Number.isInteger(id) && id > 0) {
    await env.DB.prepare("UPDATE messages SET status = 'read' WHERE id = ?").bind(id).run();
  }
  return Response.redirect(new URL("/admin", request.url), 303);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/admin" && request.method === "GET") return handleAdmin(request, env);
    if (url.pathname === "/admin/mark-read" && request.method === "POST") return handleMarkRead(request, env);

    if (url.pathname.startsWith("/api/")) {
      const origin = allowedOrigin(request, env);
      if (!origin) return json({ ok: false, error: "origin-not-allowed" }, 403);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
      if (url.pathname === "/api/track" && request.method === "POST") return handleTrack(request, env, origin);
      if (url.pathname === "/api/message" && request.method === "POST") return handleMessage(request, env, origin);
    }

    if (url.pathname === "/health") return json({ ok: true });
    return new Response("Not found", { status: 404 });
  }
};
