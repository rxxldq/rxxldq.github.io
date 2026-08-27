const MAX_BODY_BYTES = 12000;
const STATS_PERIODS = Object.freeze([
  Object.freeze({ value: "7", days: 7, label: "Last 7 days", shortLabel: "7 days" }),
  Object.freeze({ value: "30", days: 30, label: "Last 30 days", shortLabel: "30 days" }),
  Object.freeze({ value: "all", days: 0, label: "All time", shortLabel: "All" })
]);

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

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left ?? ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right ?? "")))
  ]);
  return crypto.subtle.timingSafeEqual(leftDigest, rightDigest);
}

async function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    const [usernameMatches, passwordMatches] = await Promise.all([
      secureEqual(username, env.ADMIN_USERNAME),
      secureEqual(password, env.ADMIN_PASSWORD)
    ]);
    return usernameMatches && passwordMatches;
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

function statsPeriod(url) {
  const requested = url.searchParams.get("range") || "all";
  return STATS_PERIODS.find((period) => period.value === requested) || STATS_PERIODS[2];
}

function statsStatement(env, period) {
  const where = period.days ? "WHERE created_at >= datetime('now', ?)" : "";
  const statement = env.DB.prepare(`
    SELECT article_slug, article_title, language,
      SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN event_type = 'complete' THEN 1 ELSE 0 END) AS completions
    FROM reading_events
    ${where}
    GROUP BY article_slug, article_title, language
    ORDER BY views DESC, article_title ASC
  `);
  return period.days ? statement.bind(`-${period.days} days`) : statement;
}

function completionRate(row) {
  const views = Number(row.views || 0);
  const completions = Number(row.completions || 0);
  return views ? Math.min(100, Math.round(completions / views * 100)) : 0;
}

function csvCell(value) {
  let cell = String(value ?? "");
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function statsCsv(rows, period) {
  const header = ["Article", "Slug", "Language", "Views", "Completed", "Completion rate", "Period"];
  const body = rows.map((row) => [
    row.article_title,
    row.article_slug,
    row.language,
    Number(row.views || 0),
    Number(row.completions || 0),
    `${completionRate(row)}%`,
    period.label
  ]);
  return `\uFEFF${[header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function privateBackup(events, messages, exportedAt) {
  return {
    format: "rxxldq-private-insights-backup",
    version: 1,
    exported_at: exportedAt,
    privacy: {
      raw_ip_addresses_included: false,
      sender_hashes_included: false
    },
    reading_events: events.map((row) => ({
      id: Number(row.id),
      view_id: row.view_id,
      article_slug: row.article_slug,
      article_title: row.article_title,
      language: row.language,
      path: row.path,
      event_type: row.event_type,
      created_at: row.created_at
    })),
    private_messages: messages.map((row) => ({
      id: Number(row.id),
      article_slug: row.article_slug,
      article_title: row.article_title,
      language: row.language,
      path: row.path,
      sender_name: row.sender_name,
      sender_email: row.sender_email,
      message: row.message,
      status: row.status,
      created_at: row.created_at
    }))
  };
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

function dashboardHtml(rows, messages, period) {
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views || 0), 0);
  const totalCompletions = rows.reduce((sum, row) => sum + Number(row.completions || 0), 0);
  const overallRate = totalViews ? Math.min(100, Math.round(totalCompletions / totalViews * 100)) : 0;
  const unread = messages.filter((message) => message.status === "unread").length;

  const statsRows = rows.map((row) => {
    const views = Number(row.views || 0);
    const completions = Number(row.completions || 0);
    const rate = completionRate(row);
    return `<tr><td><strong>${escapeHtml(row.article_title)}</strong><small>${escapeHtml(row.language)}</small></td><td>${views}</td><td>${completions}</td><td><span class="rate"><i style="width:${rate}%"></i></span>${rate}%</td></tr>`;
  }).join("") || '<tr><td colspan="4" class="empty">No reading data yet.</td></tr>';

  const messageCards = messages.map((item) => {
    const contact = item.sender_email ? `<a href="mailto:${escapeHtml(item.sender_email)}">${escapeHtml(item.sender_email)}</a>` : "No reply address";
    return `<article class="message ${item.status === "unread" ? "unread" : ""}">
      <header><div><strong>${escapeHtml(item.article_title)}</strong><small>${escapeHtml(item.sender_name || "Anonymous")} · ${contact}</small></div><time>${escapeHtml(item.created_at)} UTC</time></header>
      <p>${escapeHtml(item.message).replace(/\n/g, "<br>")}</p>
      ${item.status === "unread" ? `<form method="post" action="/admin/mark-read?range=${period.value}"><input type="hidden" name="id" value="${Number(item.id)}"><button>Mark as read</button></form>` : '<span class="read-label">Read</span>'}
    </article>`;
  }).join("") || '<p class="empty">No private messages yet.</p>';

  const periodLinks = STATS_PERIODS.map((option) => `<a href="/admin?range=${option.value}"${option.value === period.value ? ' aria-current="page"' : ""}>${option.shortLabel}</a>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private reading dashboard</title><style>
  :root{color-scheme:light;--ink:#1d1d1b;--quiet:#77746e;--rule:#d9d6cf;--paper:#fbfaf7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,sans-serif}a{color:inherit}main{width:min(100% - 32px,1040px);margin:0 auto;padding:64px 0 100px}h1{margin:0 0 8px;font:400 clamp(26px,4vw,42px)/1.15 Georgia,serif}.intro{margin:0 0 28px;color:var(--quiet)}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:42px}.periods,.exports{display:flex;gap:4px;flex-wrap:wrap}.periods a,.export{padding:7px 10px;border:1px solid var(--rule);font-size:11px;text-decoration:none}.periods a[aria-current="page"]{border-color:var(--ink);background:var(--ink);color:var(--paper)}.export:hover,.export:focus-visible,.periods a:hover,.periods a:focus-visible{border-color:var(--ink);outline:none}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-bottom:52px;background:var(--rule);border:1px solid var(--rule)}.summary div{padding:22px;background:var(--paper)}.summary strong{display:block;font:400 30px/1 Georgia,serif}.summary span{display:block;margin-top:8px;color:var(--quiet);font-size:12px}h2{margin:52px 0 18px;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase}table{width:100%;border-collapse:collapse}th,td{padding:14px 10px;border-bottom:1px solid var(--rule);text-align:left}th{color:var(--quiet);font-size:11px;font-weight:500}td:nth-child(n+2){width:105px;font-variant-numeric:tabular-nums}td strong,td small{display:block}td small{color:var(--quiet);font-size:11px}.rate{display:inline-block;width:52px;height:2px;margin-right:8px;background:var(--rule);vertical-align:middle}.rate i{display:block;height:100%;background:var(--ink)}.message{margin:0 0 12px;padding:20px;border:1px solid var(--rule)}.message.unread{border-left:3px solid var(--ink)}.message header{display:flex;justify-content:space-between;gap:24px}.message header small{display:block;color:var(--quiet)}.message time{color:var(--quiet);font-size:11px;white-space:nowrap}.message p{margin:20px 0;white-space:normal}.message button{padding:7px 10px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);font:inherit;font-size:11px;cursor:pointer}.read-label,.empty{color:var(--quiet);font-size:11px}@media(max-width:640px){main{padding-top:36px}.toolbar{align-items:flex-start;flex-direction:column}.summary{grid-template-columns:1fr}table{font-size:12px}th,td{padding:11px 5px}td:nth-child(n+2){width:auto}.rate{display:none}.message header{display:block}.message time{display:block;margin-top:5px}}
  </style></head><body><main><h1>Private reading dashboard</h1><p class="intro">Only you can see these reading figures and messages. No raw IP addresses are stored.</p>
  <nav class="toolbar" aria-label="Dashboard controls"><div class="periods" aria-label="Statistics period">${periodLinks}</div><div class="exports"><a class="export" href="/admin/export.csv?range=${period.value}">Export CSV</a><a class="export" href="/admin/backup.json">Private backup</a></div></nav>
  <section class="summary"><div><strong>${totalViews}</strong><span>Article views · ${period.label}</span></div><div><strong>${overallRate}%</strong><span>Completion rate · ${period.label}</span></div><div><strong>${unread}</strong><span>Unread private messages · all time</span></div></section>
  <h2>By article and language · ${period.label}</h2><table><thead><tr><th>Article</th><th>Views</th><th>Completed</th><th>Rate</th></tr></thead><tbody>${statsRows}</tbody></table>
  <h2>Private messages</h2>${messageCards}</main></body></html>`;
}

async function handleAdmin(request, env) {
  if (!(await authorized(request, env))) return authRequired();
  const period = statsPeriod(new URL(request.url));
  const [stats, messageRows] = await env.DB.batch([
    statsStatement(env, period),
    env.DB.prepare(`
      SELECT id, article_slug, article_title, language, path, sender_name,
             sender_email, message, status, created_at
      FROM messages ORDER BY CASE status WHEN 'unread' THEN 0 ELSE 1 END, created_at DESC
      LIMIT 200
    `)
  ]);
  return new Response(dashboardHtml(stats.results || [], messageRows.results || [], period), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

async function handleAdminExport(request, env) {
  if (!(await authorized(request, env))) return authRequired();
  const period = statsPeriod(new URL(request.url));
  const stats = await statsStatement(env, period).all();
  return new Response(statsCsv(stats.results || [], period), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rxxldq-reading-insights-${period.value}.csv"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

async function handleAdminBackup(request, env) {
  if (!(await authorized(request, env))) return authRequired();
  const [eventRows, messageRows] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, view_id, article_slug, article_title, language, path,
             event_type, created_at
      FROM reading_events ORDER BY id ASC
    `),
    env.DB.prepare(`
      SELECT id, article_slug, article_title, language, path, sender_name,
             sender_email, message, status, created_at
      FROM messages ORDER BY id ASC
    `)
  ]);
  const exportedAt = new Date().toISOString();
  const backup = privateBackup(
    eventRows.results || [],
    messageRows.results || [],
    exportedAt
  );
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="rxxldq-private-insights-${exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

async function handleMarkRead(request, env) {
  if (!(await authorized(request, env))) return authRequired();
  const period = statsPeriod(new URL(request.url));
  const data = await request.formData();
  const id = Number(data.get("id"));
  if (Number.isInteger(id) && id > 0) {
    await env.DB.prepare("UPDATE messages SET status = 'read' WHERE id = ?").bind(id).run();
  }
  return Response.redirect(new URL(`/admin?range=${period.value}`, request.url), 303);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/admin" && request.method === "GET") return handleAdmin(request, env);
    if (url.pathname === "/admin/export.csv" && request.method === "GET") return handleAdminExport(request, env);
    if (url.pathname === "/admin/backup.json" && request.method === "GET") return handleAdminBackup(request, env);
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
