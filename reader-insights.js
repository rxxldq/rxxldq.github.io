(function () {
  "use strict";

  const body = document.body;
  const endpoint = (body.dataset.insightsEndpoint || "").replace(/\/$/, "");
  if (!endpoint || new URLSearchParams(window.location.search).has("notrack")) return;

  const article = document.querySelector(".article-body");
  const path = body.dataset.articlePath || window.location.pathname;
  const slug = path.replace(/^\/+|\/?(?:-en)?\.html$/g, "") || "home";
  const title = body.dataset.articleTitle || document.title;
  const lang = body.dataset.articleLanguage || document.documentElement.lang || "zh";
  const viewId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let viewSent = false;
  let completionSent = false;
  const openedAt = Date.now();

  function payload(type) {
    return JSON.stringify({ type, viewId, slug, title, lang, path });
  }

  function send(type) {
    const data = payload(type);
    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(`${endpoint}/api/track`, blob)) return;
    }
    fetch(`${endpoint}/api/track`, {
      method: "POST",
      mode: "cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: data
    }).catch(function () {});
  }

  function markView() {
    if (viewSent || document.visibilityState !== "visible") return;
    viewSent = true;
    send("view");
  }

  window.setTimeout(function () {
    if (document.visibilityState === "visible") {
      markView();
    }
  }, 3000);
  document.addEventListener("visibilitychange", function () {
    if (Date.now() - openedAt >= 3000) markView();
  });

  if (article) {
    const lastBlock = article.lastElementChild;
    if (lastBlock && "IntersectionObserver" in window) {
      function markCompletionIfReady() {
        if (completionSent || Date.now() - openedAt < 15000) return;
        const rect = lastBlock.getBoundingClientRect();
        const visible = rect.top < window.innerHeight && rect.bottom > 0;
        if (visible) {
          completionSent = true;
          markView();
          send("complete");
          observer.disconnect();
        }
      }
      const observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        if (Date.now() - openedAt < 15000) {
          window.setTimeout(markCompletionIfReady, 15000 - (Date.now() - openedAt));
          return;
        }
        markCompletionIfReady();
      }, { threshold: 0.6 });
      observer.observe(lastBlock);
    }
  }

  const form = document.querySelector("[data-reader-message-form]");
  if (!form) return;
  const status = form.querySelector("[data-reader-message-status]");
  const submit = form.querySelector('button[type="submit"]');
  const english = lang === "en";

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const data = new FormData(form);
    const message = String(data.get("message") || "").trim();
    if (!message) {
      status.textContent = english ? "Please write a message." : "请先写下留言。";
      return;
    }
    submit.disabled = true;
    status.textContent = english ? "Sending…" : "正在发送……";
    try {
      const response = await fetch(`${endpoint}/api/message`, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, title, lang, path,
          message,
          name: String(data.get("name") || "").trim(),
          email: String(data.get("email") || "").trim(),
          website: String(data.get("website") || "")
        })
      });
      if (!response.ok) throw new Error("send failed");
      form.reset();
      status.textContent = english ? "Sent. Thank you." : "已发送，谢谢。";
    } catch (_) {
      status.textContent = english ? "Could not send. Please try again later." : "暂时未能发送，请稍后再试。";
    } finally {
      submit.disabled = false;
    }
  });
})();
