(function initNewsPage() {
  const listEl = document.getElementById("newsList");
  const filterEl = document.getElementById("newsFilterInput");
  let allNews = [];

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function render(items) {
    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = `<div class="news-empty"><i class="fas fa-newspaper" style="font-size:28px;display:block;margin-bottom:8px;"></i>Chưa có tin tức được xuất bản.</div>`;
      return;
    }

    listEl.innerHTML = items
      .map(
        (n) => `<article class="news-card">
          ${n.thumbnail || n.banner ? `<img src="${escapeHtml(n.thumbnail || n.banner)}" alt="${escapeHtml(n.title || "")}" />` : ""}
          <div class="news-card-body">
            <span class="news-tag">${escapeHtml(n.status || "published")}</span>
            <h3>${escapeHtml(n.title || "")}</h3>
            <p>${escapeHtml(n.summary || "")}</p>
            <div class="news-meta">${escapeHtml(n.updated_at || "")}</div>
          </div>
        </article>`,
      )
      .join("");
  }

  async function loadNews() {
    try {
      const res = await fetch(window.apiUrl("/api/public/news"));
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data && data.msg) || `HTTP ${res.status}`);
      allNews = (Array.isArray(data) ? data : []).filter(
        (n) => String(n.status || "").toLowerCase() === "published",
      );
      render(allNews);
    } catch (err) {
      console.error(err);
      if (listEl) {
        listEl.innerHTML = `<div class="news-empty">Không thể tải tin tức lúc này.</div>`;
      }
    }
  }

  filterEl?.addEventListener("input", () => {
    const q = String(filterEl.value || "").trim().toLowerCase();
    if (!q) {
      render(allNews);
      return;
    }
    const filtered = allNews.filter((n) =>
      `${n.title || ""} ${n.summary || ""} ${n.content || ""}`.toLowerCase().includes(q),
    );
    render(filtered);
  });

  loadNews();
})();
