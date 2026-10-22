(function initAdmin() {
  const state = {
    token: localStorage.getItem("token") || "",
    activeTab: localStorage.getItem("admin_active_tab_v2") || "dashboard",
    selectedDays: 7,
    products: [],
    inventory: [],
    users: [],
    orders: [],
    news: [],
    warranties: [],
    revenueChartData: [],
    editingProductId: null,
    editingNewsId: null,
    editingWarrantyId: null,
    editingUserId: null,
    editingBannerId: null,
    banners: [],
    productPage: 1,
    productPageSize: 10,
    totalProducts: 0,
    newItems: { users: new Set(), orders: new Set(), products: new Set() }, // Lưu ID các mục mới để highlight
    audioUnlocked: false // Trình duyệt cần click để cho phép phát âm thanh
  };

  const pageMeta = {
    dashboard: {
      title: "Thống kê vận hành",
      desc: "Theo dõi doanh thu, đơn hàng, tồn kho và cảnh báo nhanh.",
    },
    products: {
      title: "Quản lý sản phẩm",
      desc: "CRUD sản phẩm có tìm kiếm, lọc, ẩn/hiện và bulk actions.",
    },
    inventory: {
      title: "Tổng kho",
      desc: "Giám sát tồn kho, cảnh báo sắp hết/hết hàng, cập nhật nhanh.",
    },
    users: {
      title: "Quản lý người dùng",
      desc: "Phân tách Admin/User, khóa mở khóa, xóa và kiểm soát rủi ro.",
    },
    news: {
      title: "Tin tức / Khuyến mãi",
      desc: "Quản trị nội dung với draft/published/scheduled/hidden.",
    },
    orders: {
      title: "Quản lý đơn hàng",
      desc: "Theo dõi trạng thái, timeline, chi tiết, hóa đơn và xuất PDF placeholder.",
    },
    warranty: {
      title: "Tra cứu bảo hành",
      desc: "Quản lý mã bảo hành, trạng thái và lịch sử xử lý.",
    },
    banner: {
      title: "Quản lý banner",
      desc: "Quản lý banner quảng cáo, vị trí hiển thị và hình ảnh.",
    },
    reports: {
      title: "Báo cáo",
      desc: "Báo cáo doanh thu, sản phẩm bán chạy và tồn kho.",
    },
  };

  const refs = {
    pageTitle: byId("pageTitle"),
    pageDesc: byId("pageDesc"),
    authChip: byId("authChip"),
    tabs: Array.from(document.querySelectorAll(".sidebar-link[data-tab]")),
    panels: Array.from(document.querySelectorAll(".tab-panel")),

    kpiProducts: byId("kpiProducts"),
    kpiStock: byId("kpiStock"),
    kpiPending: byId("kpiPending"),
    kpiRevenue: byId("kpiRevenue"),
    revenueChart: byId("revenueChart"),
    revenueLabels: byId("revenueLabels"),
    stockAlerts: byId("stockAlerts"),
    topProductBody: byId("topProductBody"),
    recentOrderBody: byId("recentOrderBody"),

    productBody: byId("productBody"),
    productSearch: byId("productSearch"),
    productCategoryFilter: byId("productCategoryFilter"),
    productSelectAll: byId("productSelectAll"),

    inventoryBody: byId("inventoryBody"),
    inventorySearch: byId("inventorySearch"),
    inventoryCategoryFilter: byId("inventoryCategoryFilter"),
    inventoryStockFilter: byId("inventoryStockFilter"),

    userBody: byId("userBody"),
    userSearch: byId("userSearch"),
    userRoleTabs: byId("userRoleTabs"),

    newsBody: byId("newsBody"),
    newsSearch: byId("newsSearch"),
    newsStatusFilter: byId("newsStatusFilter"),
    newsPreview: byId("newsPreview"),

    orderBody: byId("orderBody"),
    orderSearch: byId("orderSearch"),
    orderStatusFilter: byId("orderStatusFilter"),

    warrantyBody: byId("warrantyBody"),
    warrantySearch: byId("warrantySearch"),
    warrantyStatusFilter: byId("warrantyStatusFilter"),

    bannerBody: byId("bannerBody"),
    btnOpenBannerModal: byId("btn-open-banner-modal"),
    bannerModalBackdrop: byId("bannerModalBackdrop"),
    bannerModalTitle: byId("bannerModalTitle"),
    bImg: byId("bImg"),
    bImgFile: byId("bImgFile"),
    bPosition: byId("bPosition"),
    btnSaveBanner: byId("btn-save-banner"),

    pImgFile: byId("pImgFile"),

    reportPeriod: byId("reportPeriod"),
    btnExportRevenue: byId("btn-export-revenue"),
    revenueReportChart: byId("revenueReportChart"),
    topProductsReport: byId("topProductsReport"),
    inventoryReport: byId("inventoryReport"),

    btnAddUserModal: byId("btn-add-user-modal"),
    addUserModalBackdrop: byId("addUserModalBackdrop"),
    auUsername: byId("auUsername"),
    auEmail: byId("auEmail"),
    auPassword: byId("auPassword"),
    auRole: byId("auRole"),
    btnAddUser: byId("btn-add-user"),
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage issues
    }
  }

  function setAuthChip(text, type) {
    refs.authChip.className = `chip ${type || "info"}`;
    refs.authChip.innerHTML = `<i class="fas fa-user-shield"></i> ${escapeHtml(text)}`;
  }

  // --- HÀM TIỆN ÍCH THÔNG BÁO ---
  function playNotifySound() {
    if (!state.audioUnlocked) {
      console.warn("Âm thanh bị chặn: Vui lòng click vào trang để kích hoạt thông báo.");
      return;
    }
    const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
    audio.volume = 0.5;
    audio.play().catch(() => {}); // Tránh lỗi nếu trình duyệt chặn tự động phát
  }

  function showAdminToast(message, icon = "fa-bell") {
    let container = document.querySelector(".admin-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "admin-toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "admin-toast";
    toast.innerHTML = `
      <i class="fas ${icon}" style="color: #28a745;"></i>
      <div class="toast-content">
        <div style="font-weight: bold; font-size: 13px;">Hệ thống</div>
        <div style="font-size: 12px; opacity: 0.9;">${message}</div>
      </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(20px)";
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  function money(v) {
    const n = Number(v || 0);
    try {
      return `${n.toLocaleString("vi-VN")}đ`;
    } catch {
      return `${n}đ`;
    }
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function statusChip(status) {
    const s = String(status || "").toLowerCase();
    if (s === "completed" || s === "active" || s === "published") {
      return `<span class="chip success">${escapeHtml(status)}</span>`;
    }
    if (s === "processing" || s === "shipping" || s === "scheduled") {
      return `<span class="chip warning">${escapeHtml(status)}</span>`;
    }
    if (s === "cancelled" || s === "expired" || s === "hidden") {
      return `<span class="chip danger">${escapeHtml(status)}</span>`;
    }
    return `<span class="chip info">${escapeHtml(status || "N/A")}</span>`;
  }

  async function api(path, options) {
    const headers = Object.assign({}, options?.headers || {});
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    const config = Object.assign({}, options || {}, { headers });
    const response = await fetch(window.apiUrl(path), config);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const msg = (data && data.msg) || `HTTP ${response.status}`;
      const err = new Error(msg);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function requireAdmin() {
    if (!state.token) {
      setAuthChip("Chưa đăng nhập, chuyển về Login", "danger");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 600);
      return false;
    }

    try {
      const me = await api("/api/profile");
      const role = String(me && me.role ? me.role : "").toLowerCase();
      if (role !== "admin") {
        setAuthChip("Tài khoản không có quyền Admin", "danger");
        return false;
      }
      setAuthChip(`Xin chào ${me.username || ""}`.trim(), "success");
      return true;
    } catch (err) { 
      if (err && (err.status === 401 || err.status === 422)) {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        setAuthChip("Phiên đăng nhập hết hạn", "danger");
        setTimeout(() => {
          window.location.href = "login.html";
        }, 700);
      } else {
        setAuthChip("Không thể xác thực quyền Admin", "danger");
      }
      return false;
    }
  }

  function switchTab(tab) {
    state.activeTab = tab;
    localStorage.setItem("admin_active_tab_v2", tab);
    refs.tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
    refs.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${tab}`));

    refs.pageTitle.textContent = pageMeta[tab].title;
    refs.pageDesc.textContent = pageMeta[tab].desc;

    if (tab === "dashboard") renderDashboard();
    if (tab === "products") renderProducts();
    if (tab === "inventory") renderInventory();
    if (tab === "users") renderUsers();
    if (tab === "news") renderNews();
    if (tab === "orders") renderOrders();
    if (tab === "warranty") renderWarranties();
    if (tab === "banner") renderBanners();
    if (tab === "reports") renderReports();
  }

  async function loadDashboardStats() {
    const stats = await api("/admin/dashboard/stats");
    refs.kpiProducts.textContent = String(stats.total_products || 0);
    refs.kpiStock.textContent = String(stats.total_stock || 0);
    refs.kpiPending.textContent = String(stats.pending_orders || 0);
    refs.kpiRevenue.textContent = money(stats.revenue || 0);
    
    // Load real revenue chart data
    try {
      const chartData = await api("/admin/dashboard/revenue-chart");
      state.revenueChartData = chartData.data || [];
    } catch (err) {
      state.revenueChartData = [];
    }
  }

  function renderRevenueChart() {
    // Use real revenue data from API
    const bars = [];
    const labels = [];
    
    if (!state.revenueChartData || state.revenueChartData.length === 0) {
      refs.revenueChart.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8">Chưa có dữ liệu doanh thu</div>';
      refs.revenueLabels.innerHTML = '';
      return;
    }
    
    state.revenueChartData.forEach((item) => {
      const maxRevenue = Math.max(1, ...state.revenueChartData.map(x => x.revenue || 0));
      const height = maxRevenue > 0 ? Math.floor((item.revenue / maxRevenue) * 100) : 10;
      bars.push(`<div class="bar" style="height:${Math.max(10, height)}%"><span>${money(item.revenue)}</span></div>`);
      labels.push(`<div>${escapeHtml(item.date)}</div>`);
    });
    
    refs.revenueChart.innerHTML = bars.join("");
    refs.revenueLabels.innerHTML = labels.join("");
  }

  function renderStockAlerts() {
    const low = state.inventory.filter((item) => Number(item.stock || 0) > 0 && Number(item.stock || 0) <= 5);
    const out = state.inventory.filter((item) => Number(item.stock || 0) <= 0);
    if (!low.length && !out.length) {
      refs.stockAlerts.innerHTML = `<div class="alert low">Kho đang ở trạng thái an toàn.</div>`;
      return;
    }
    const html = [];
    out.slice(0, 5).forEach((item) => {
      html.push(`<div class="alert out">${escapeHtml(item.name)} đã hết hàng.</div>`);
    });
    low.slice(0, 5).forEach((item) => {
      html.push(`<div class="alert low">${escapeHtml(item.name)} còn ${Number(item.stock || 0)} sản phẩm.</div>`);
    });
    refs.stockAlerts.innerHTML = html.join("");
  }

  function renderTopProductsAndRecentOrders() {
    const sold = new Map();
    state.orders.forEach((order) => {
      (order.items || []).forEach((it) => {
        const key = it.name || it.product_name || `SP-${it.product_id || "?"}`;
        const rec = sold.get(key) || { qty: 0, revenue: 0 };
        rec.qty += Number(it.quantity || 0);
        rec.revenue += Number(it.subtotal || Number(it.price || 0) * Number(it.quantity || 0));
        sold.set(key, rec);
      });
    });

    const top = Array.from(sold.entries())
      .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);

    refs.topProductBody.innerHTML = top.length
      ? top
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.name)}</td><td>${item.qty}</td><td>${money(item.revenue)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3">Chưa có dữ liệu bán hàng.</td></tr>`;

    const recent = [...state.orders].slice(0, 6);
    refs.recentOrderBody.innerHTML = recent.length
      ? recent
          .map(
            (o) => `<tr class="${state.newItems.orders.has(o.order_code) ? 'new-item-row' : ''}">
              <td>${escapeHtml(o.order_code || "")}</td>
              <td>${escapeHtml(o.customer_name || "")}</td>
              <td>${statusChip(o.status)}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="3">Chưa có đơn hàng.</td></tr>`;
  }

  async function loadProducts() {
    const grouped = await api("/admin/products");
    const list = [];
    Object.keys(grouped || {}).forEach((category) => {
      const arr = Array.isArray(grouped[category]) ? grouped[category] : [];
      arr.forEach((product) => {
        list.push({
          ...product,
          category: product.category || category,
          stock: Number(product.stock || 0),
          is_hidden: Boolean(product.is_hidden),
        });
      });
    });
    state.products = list;

    const cats = ["all", ...new Set(list.map((x) => x.category).filter(Boolean))];
    refs.productCategoryFilter.innerHTML = cats
      .map((c) => `<option value="${escapeHtml(c)}">${c === "all" ? "Tất cả danh mục" : escapeHtml(c)}</option>`)
      .join("");

    refs.inventoryCategoryFilter.innerHTML = cats
      .map((c) => `<option value="${escapeHtml(c)}">${c === "all" ? "Tất cả danh mục" : escapeHtml(c)}</option>`)
      .join("");

    const pCategory = byId("pCategory");
    if (pCategory) {
      pCategory.innerHTML = cats
        .filter((c) => c !== "all")
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join("");
    }
  }

  async function loadInventory() {
    state.inventory = await api("/admin/inventory");
  }

  async function loadUsers() {
    state.users = await api("/admin/users");
  }

  async function loadOrders() {
    const list = await api("/admin/orders");
    const details = await Promise.all(
      (list || []).slice(0, 120).map(async (o) => {
        try {
          const detail = await api(`/admin/orders/${encodeURIComponent(o.order_code)}`);
          return { ...o, ...detail };
        } catch {
          return { ...o, items: [] };
        }
      }),
    );
    state.orders = details;
  }

  async function loadNews() {
    try {
      state.news = await api("/admin/news");
    } catch (err) {
      if (err && err.status === 404) {
        try {
          state.news = await api("/api/public/news?status=published");
        } catch {
          state.news = [];
        }
        return;
      }
      throw err;
    }
  }

  async function loadWarranties() {
    try {
      state.warranties = await api("/api/warranty");
    } catch (err) {
      if (err && err.status === 404) {
        state.warranties = [];
        return;
      }
      throw err;
    }
  }

  async function loadBanners() {
    try {
      state.banners = await api("/api/public/banners");
    } catch (err) {
      if (err && err.status === 404) {
        state.banners = [];
        return;
      }
      throw err;
    }
  }

  function getProductFilters() {
    return {
      query: String(refs.productSearch.value || "").trim().toLowerCase(),
      category: refs.productCategoryFilter.value || "all",
    };
  }

  function renderProducts() {
    const { query, category } = getProductFilters();
    const filtered = state.products.filter((p) => {
      const okQuery = !query || String(p.name || "").toLowerCase().includes(query);
      const okCat = category === "all" || p.category === category;
      return okQuery && okCat;
    });

    state.totalProducts = filtered.length;
    const totalPages = Math.ceil(state.totalProducts / state.productPageSize);
    const start = (state.productPage - 1) * state.productPageSize;
    const end = start + state.productPageSize;
    const pageItems = filtered.slice(start, end);

    refs.productBody.innerHTML = pageItems.length
      ? pageItems
          .map((p) => {
            const hidden = Boolean(p.is_hidden);
            return `<tr class="${state.newItems.products.has(p.id) ? 'new-item-row' : ''}">
              <td><input type="checkbox" data-product-check="${p.id}" /></td>
              <td><img src="${escapeHtml(p.img || "")}" alt="${escapeHtml(p.name || "")}" width="42" style="border-radius:8px;border:1px solid #e8edf5" /></td>
              <td>${escapeHtml(p.name || "")}</td>
              <td>${escapeHtml(p.category || "")}</td>
              <td>${money(p.price || 0)}</td>
              <td>${Number(p.stock || 0)}</td>
              <td>${hidden ? `<span class="chip danger">Ẩn</span>` : `<span class="chip success">Hiển thị</span>`}</td>
              <td>
                <button class="btn ghost" data-quick-view="${p.id}"><i class="fas fa-eye"></i> Xem nhanh</button>
                <button class="btn warning" data-edit-product="${p.id}"><i class="fas fa-pen"></i> Sửa</button>
                <button class="btn ${hidden ? "success" : "ghost"}" data-toggle-product="${p.id}">${hidden ? "Hiện" : "Ẩn"}</button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8">Không có sản phẩm phù hợp.</td></tr>`;

    // Add pagination controls
    const paginationHtml = totalPages > 1 ? `
      <div class="pagination" style="margin-top:20px;text-align:center;">
        <button class="btn ghost" ${state.productPage <= 1 ? 'disabled' : ''} onclick="changeProductPage(${state.productPage - 1})">Trước</button>
        <span>Trang ${state.productPage} / ${totalPages}</span>
        <button class="btn ghost" ${state.productPage >= totalPages ? 'disabled' : ''} onclick="changeProductPage(${state.productPage + 1})">Sau</button>
      </div>
    ` : '';
    
    const tableWrap = refs.productBody.closest('.table-wrap');
    const existingPagination = tableWrap.querySelector('.pagination');
    if (existingPagination) existingPagination.remove();
    if (paginationHtml) tableWrap.insertAdjacentHTML('afterend', paginationHtml);
  }

  function changeProductPage(page) {
    state.productPage = page;
    renderProducts();
  }

  // Expose to window
  window.changeProductPage = changeProductPage;

  function getInventoryFilters() {
    return {
      query: String(refs.inventorySearch.value || "").trim().toLowerCase(),
      category: refs.inventoryCategoryFilter.value || "all",
      stockType: refs.inventoryStockFilter.value || "all",
    };
  }

  function stockStatus(stock) {
    const n = Number(stock || 0);
    if (n <= 0) return { cls: "danger", text: "Hết hàng" };
    if (n <= 5) return { cls: "warning", text: "Sắp hết" };
    return { cls: "success", text: "Còn hàng" };
  }

  function renderInventory() {
    const { query, category, stockType } = getInventoryFilters();
    const filtered = state.inventory.filter((item) => {
      const byQuery =
        !query ||
        String(item.name || "").toLowerCase().includes(query) ||
        String(item.id || "").includes(query);
      const byCategory = category === "all" || item.category === category;
      const s = Number(item.stock || 0);
      let byStock = true;
      if (stockType === "in-stock") byStock = s > 5;
      if (stockType === "low-stock") byStock = s > 0 && s <= 5;
      if (stockType === "out-stock") byStock = s <= 0;
      return byQuery && byCategory && byStock;
    });

    refs.inventoryBody.innerHTML = filtered.length
      ? filtered
          .map((item) => {
            const status = stockStatus(item.stock);
            return `<tr class="${state.newItems.orders.has(item.id) ? 'new-item-row' : ''}">
              <td>#${item.id}</td>
              <td>${escapeHtml(item.name || "")}</td>
              <td>${escapeHtml(item.category || "")}</td>
              <td><input class="admin-input" style="width:90px" type="number" min="0" value="${Number(item.stock || 0)}" id="stock-${item.id}" /></td>
              <td><span class="chip ${status.cls}">${status.text}</span></td>
              <td><button class="btn success" data-save-stock="${item.id}"><i class="fas fa-floppy-disk"></i> Lưu</button></td>
              <td><button class="btn danger" data-delete-product="${item.id}"><i class="fas fa-trash"></i> Xóa</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7">Không có dữ liệu tồn kho phù hợp.</td></tr>`;
  }

  function renderUsers() {
    const query = String(refs.userSearch.value || "").trim().toLowerCase();
    const activeRoleTab = refs.userRoleTabs.querySelector("button.active")?.dataset.role || "all";

    const filtered = state.users.filter((u) => {
      const role = String(u.role || "user").toLowerCase();
      const byRole = activeRoleTab === "all" || role === activeRoleTab;
      const hay = `${u.username || ""} ${u.email || ""} ${u.phone || ""}`.toLowerCase();
      const byQuery = !query || hay.includes(query);
      return byRole && byQuery;
    });

    refs.userBody.innerHTML = filtered.length
      ? filtered
          .map((u) => {
            const isAdmin = String(u.role || "").toLowerCase() === "admin";
            return `<tr class="${state.newItems.users.has(u.id) ? 'new-item-row' : ''}">
              <td>#${u.id}</td>
              <td><strong>${escapeHtml(u.username || "")}</strong><div style="font-size:12px;color:#64748b">${escapeHtml(u.email || "N/A")}</div></td>
              <td>${escapeHtml(u.phone || "N/A")}</td>
              <td>${isAdmin ? `<span class="chip info">Admin</span>` : `<span class="chip ghost">User</span>`}</td>
              <td>${u.is_locked ? `<span class="chip danger">Đang khóa</span>` : `<span class="chip success">Hoạt động</span>`}</td>
              <td>${escapeHtml(u.created_at || "-")}</td>
              <td>${escapeHtml(u.updated_at || "-")}</td>
              <td>
                <button class="btn ghost" data-edit-user="${u.id}"><i class="fas fa-pen"></i></button>
                ${isAdmin ? "" : `<button class="btn warning" data-toggle-lock="${u.id}">${u.is_locked ? "Mở khóa" : "Khóa"}</button>`}
                ${isAdmin ? "" : `<button class="btn danger" data-delete-user="${u.id}"><i class="fas fa-trash"></i></button>`}
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8">Không có người dùng phù hợp.</td></tr>`;
  }

  function renderBanners() {
    refs.bannerBody.innerHTML = state.banners.length
      ? state.banners
          .map((b) => {
            return `<tr>
              <td>#${b.id}</td>
              <td><img src="${escapeHtml(b.img || "")}" alt="Banner" style="max-width:100px;max-height:50px;object-fit:cover;" /></td>
              <td>${escapeHtml(b.position || "")}</td>
              <td>
                <button class="btn ghost" data-edit-banner="${b.id}"><i class="fas fa-pen"></i></button>
                <button class="btn danger" data-delete-banner="${b.id}"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4">Không có banner nào.</td></tr>`;
  }

  function renderReports() {
    // Top products report
    const productSales = {};
    state.orders.forEach(order => {
      (order.items || []).forEach(item => {
        const key = item.product_id || item.name;
        if (!productSales[key]) productSales[key] = { name: item.name || item.product_name, sold: 0, revenue: 0 };
        productSales[key].sold += Number(item.quantity || 0);
        productSales[key].revenue += Number(item.subtotal || (item.price * item.quantity) || 0);
      });
    });
    
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    
    refs.topProductsReport.innerHTML = topProducts.length
      ? topProducts.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${p.sold}</td><td>${money(p.revenue)}</td></tr>`).join('')
      : '<tr><td colspan="3">Chưa có dữ liệu</td></tr>';

    // Inventory report
    const inventoryStats = {};
    state.products.forEach(p => {
      const cat = p.category || 'Khác';
      if (!inventoryStats[cat]) inventoryStats[cat] = { count: 0, stock: 0, value: 0 };
      inventoryStats[cat].count++;
      inventoryStats[cat].stock += Number(p.stock || 0);
      inventoryStats[cat].value += Number(p.stock || 0) * Number(p.price || 0);
    });
    
    refs.inventoryReport.innerHTML = Object.entries(inventoryStats)
      .map(([cat, stats]) => `<tr><td>${escapeHtml(cat)}</td><td>${stats.count}</td><td>${stats.stock}</td><td>${money(stats.value)}</td></tr>`)
      .join('');

    // Revenue chart for reports (similar to dashboard but with different period)
    renderRevenueReportChart();
  }

  function renderRevenueReportChart() {
    const period = Number(refs.reportPeriod.value || 30);
    // For now, use same data as dashboard, but could be extended to fetch different periods
    const data = state.revenueChartData.slice(-period);
    
    if (!refs.revenueReportChart || !data.length) return;
    
    const ctx = refs.revenueReportChart.getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => d.date),
        datasets: [{
          label: 'Doanh thu',
          data: data.map(d => d.revenue),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: value => money(value)
            }
          }
        }
      }
    });
  }

  async function exportRevenueReport() {
    const period = Number(refs.reportPeriod.value || 30);
    const data = state.revenueChartData.slice(-period);
    
    if (!data.length) {
      alert('Không có dữ liệu để xuất');
      return;
    }

    // Create CSV content
    const csvContent = [
      'Ngày,Doanh thu',
      ...data.map(d => `${d.date},${d.revenue}`)
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `bao-cao-doanh-thu-${period}-ngay.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function renderNews() {
    const query = String(refs.newsSearch.value || "").trim().toLowerCase();
    const status = refs.newsStatusFilter.value || "all";
    const filtered = state.news.filter((n) => {
      const byQuery =
        !query ||
        `${n.title || ""} ${n.summary || ""} ${n.content || ""}`.toLowerCase().includes(query);
      const byStatus = status === "all" || String(n.status || "").toLowerCase() === status;
      return byQuery && byStatus;
    });

    refs.newsBody.innerHTML = filtered.length
      ? filtered
          .map(
            (n) => `<tr>
              <td>${escapeHtml(n.title || "")}</td>
              <td>${statusChip(n.status || "draft")}</td>
              <td>${escapeHtml(n.scheduled_at || "-")}</td>
              <td>${escapeHtml(n.updated_at || "-")}</td>
              <td>
                <button class="btn warning" data-edit-news="${n.id}"><i class="fas fa-pen"></i></button>
                <button class="btn ghost" data-toggle-news="${n.id}">${String(n.status || "").toLowerCase() === "hidden" ? "Hiện" : "Ẩn"}</button>
                <button class="btn danger" data-delete-news="${n.id}"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="5">Chưa có bài viết.</td></tr>`;

    const preview = filtered[0] || state.news[0];
    if (!preview) {
      refs.newsPreview.innerHTML = `<div class="alert low">Chưa có dữ liệu bài viết. Hãy tạo bài viết mới từ Admin.</div>`;
      return;
    }

    refs.newsPreview.innerHTML = `
      ${preview.banner || preview.thumbnail ? `<img src="${escapeHtml(preview.banner || preview.thumbnail)}" alt="${escapeHtml(preview.title || "")}" />` : ""}
      <h5>${escapeHtml(preview.title || "")}</h5>
      <p>${escapeHtml(preview.summary || "")}</p>
      <p>${escapeHtml((preview.content || "").slice(0, 280))}${(preview.content || "").length > 280 ? "..." : ""}</p>
      <div>${statusChip(preview.status || "draft")}</div>
    `;
  }

  function orderStatusOptions(current) {
    const options = ["processing", "shipping", "completed", "cancelled"];
    return options
      .map((o) => `<option value="${o}" ${o === current ? "selected" : ""}>${o}</option>`)
      .join("");
  }

  function renderOrders() {
    const query = String(refs.orderSearch.value || "").trim().toLowerCase();
    const status = refs.orderStatusFilter.value || "all";

    const filtered = state.orders.filter((o) => {
      const hay = `${o.order_code || ""} ${o.customer_name || ""}`.toLowerCase();
      const byQuery = !query || hay.includes(query);
      const byStatus = status === "all" || String(o.status || "").toLowerCase() === status;
      return byQuery && byStatus;
    });

    refs.orderBody.innerHTML = filtered.length
      ? filtered
          .map((o) => {
            const payment = o.payment || o.payment_latest || null;
            const paymentMethod = payment?.provider || o.payment_method || "cod";
            const paymentStatus = payment?.status || "pending";
            const canDelete = ["cancelled", "completed"].includes(String(o.status || "").toLowerCase());
            return `<tr class="${state.newItems.orders.has(o.order_code) ? 'new-item-row' : ''}">
              <td><strong>${escapeHtml(o.order_code || "")}</strong><div style="font-size:12px;color:#64748b">${escapeHtml(o.created_at || "")}</div></td>
              <td>${escapeHtml(o.customer_name || "")}<div style="font-size:12px;color:#64748b">${escapeHtml(o.customer_phone || "")}</div></td>
              <td>${money(o.total_amount || 0)}</td>
              <td>${escapeHtml(paymentMethod)}<div style="font-size:12px;color:#64748b">${escapeHtml(paymentStatus)}</div></td>
              <td>${statusChip(o.status || "processing")}</td>
              <td>
                <select class="admin-select" id="order-status-${escapeHtml(o.order_code || "")}">
                  ${orderStatusOptions(String(o.status || "").toLowerCase())}
                </select>
              </td>
              <td>
                <button class="btn success" data-save-order="${escapeHtml(o.order_code || "")}"><i class="fas fa-check"></i></button>
                <button class="btn ghost" data-view-order="${escapeHtml(o.order_code || "")}"><i class="fas fa-eye"></i></button>
                <button class="btn ${canDelete ? "danger" : "ghost"}" data-delete-order="${escapeHtml(o.order_code || "")}" ${canDelete ? "" : "disabled"}><i class="fas fa-trash"></i></button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7">Không có đơn hàng phù hợp.</td></tr>`;
  }

  function renderWarrantyHistory(historyRaw) {
    const list = Array.isArray(historyRaw)
      ? historyRaw
      : String(historyRaw || "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
    if (!list.length) return "-";
    return `<div class="timeline">${list
      .map((h) => `<div class="timeline-item"><div class="time">Event</div><div class="text">${escapeHtml(h)}</div></div>`)
      .join("")}</div>`;
  }

  function renderWarranties() {
    const query = String(refs.warrantySearch.value || "").trim().toLowerCase();
    const status = refs.warrantyStatusFilter.value || "all";
    const filtered = state.warranties.filter((w) => {
      const hay = `${w.warranty_code || ""} ${w.serial_imei || ""} ${w.phone || ""} ${w.product_name || ""}`.toLowerCase();
      const byQuery = !query || hay.includes(query);
      const byStatus = status === "all" || String(w.status || "").toLowerCase() === status;
      return byQuery && byStatus;
    });

    refs.warrantyBody.innerHTML = filtered.length
      ? filtered
          .map(
            (w) => `<tr>
              <td>${escapeHtml(w.warranty_code || "")}</td>
              <td>${escapeHtml(w.product_name || "")}<div style="font-size:12px;color:#64748b">${escapeHtml(w.serial_imei || "")}</div></td>
              <td>${escapeHtml(w.customer_name || "")}<div style="font-size:12px;color:#64748b">${escapeHtml(w.phone || "")}</div></td>
              <td>${escapeHtml(w.activated_at || "-")} -> ${escapeHtml(w.expired_at || "-")}</td>
              <td>${statusChip(w.status || "active")}</td>
              <td>${renderWarrantyHistory(w.history)}</td>
              <td>
                <button class="btn warning" data-edit-warranty="${w.id}"><i class="fas fa-pen"></i></button>
                <button class="btn danger" data-delete-warranty="${w.id}"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="7">Chưa có hồ sơ bảo hành.</td></tr>`;
  }

  function renderDashboard() {
    renderRevenueChart();
    renderStockAlerts();
    renderTopProductsAndRecentOrders();
  }

  function openModal(id) {
    byId(id)?.classList.add("show");
  }

  function closeModal(id) {
    byId(id)?.classList.remove("show");
  }

  function fillProductModal(product) {
    state.editingProductId = product ? product.id : null;
    byId("productModalTitle").textContent = state.editingProductId ? "Sửa sản phẩm" : "Thêm sản phẩm";
    byId("pName").value = product?.name || "";
    byId("pCategory").value = product?.category || byId("pCategory").value;
    byId("pPrice").value = Number(product?.price || 0);
    byId("pOldPrice").value = Number(product?.oldPrice || product?.old_price || 0);
    byId("pStock").value = Number(product?.stock || 0);
    byId("pImg").value = product?.img || "";
    refs.pImgFile.value = ""; // Reset file input
    byId("pDesc").value = product?.description || "";
    try {
      const specs = product?.specs && typeof product.specs === "string" ? JSON.parse(product.specs) : product?.specs || {};
      byId("pSpecs").value = JSON.stringify(specs, null, 2);
    } catch {
      byId("pSpecs").value = "{}";
    }
    openModal("productModalBackdrop");
  }

  async function saveProduct() {
    const name = byId("pName").value.trim();
    const category = byId("pCategory").value;
    const price = Number(byId("pPrice").value || 0);
    const old_price = Number(byId("pOldPrice").value || 0);
    const stock = Number(byId("pStock").value || 0);
    let img = byId("pImg").value.trim();
    const description = byId("pDesc").value.trim();
    const specsText = byId("pSpecs").value.trim() || "{}";

    // Validation
    if (!name) {
      alert("Tên sản phẩm là bắt buộc.");
      byId("pName").focus();
      return;
    }
    if (!category) {
      alert("Danh mục là bắt buộc.");
      byId("pCategory").focus();
      return;
    }
    if (price <= 0) {
      alert("Giá bán phải lớn hơn 0.");
      byId("pPrice").focus();
      return;
    }
    if (stock < 0) {
      alert("Số lượng tồn không được âm.");
      byId("pStock").focus();
      return;
    }
    if (!img && refs.pImgFile.files.length === 0) {
      alert("Ảnh sản phẩm là bắt buộc.");
      byId("pImg").focus();
      return;
    }

    // Upload file if selected
    if (refs.pImgFile.files.length > 0) {
      const formData = new FormData();
      formData.append('file', refs.pImgFile.files[0]);
      const uploadRes = await fetch(window.apiUrl('/admin/upload'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}` },
        body: formData
      });
      if (!uploadRes.ok) {
        alert('Upload ảnh thất bại');
        return;
      }
      const uploadData = await uploadRes.json();
      img = uploadData.url;
    }

    let specs = {};
    try {
      specs = JSON.parse(specsText);
    } catch {
      alert("Thông số phải là JSON hợp lệ.");
      byId("pSpecs").focus();
      return;
    }

    const body = { name, category, price, old_price, img, specs, description, stock };
    if (state.editingProductId) {
      await api(`/admin/products/update/${state.editingProductId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/admin/products/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    closeModal("productModalBackdrop");
    await Promise.all([loadProducts(), loadInventory(), loadDashboardStats()]);
    renderProducts();
    renderInventory();
    renderDashboard();
  }

  async function toggleProductVisibility(id) {
    try {
      const res = await api(`/admin/products/${id}/toggle-visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      
      // Update local state
      const product = state.products.find((p) => p.id === id);
      if (product) {
        product.is_hidden = res.is_hidden;
      }
      
      renderProducts();
    } catch (err) {
      alert(`Lỗi cập nhật: ${err.message || "Unknown error"}`);
    }
  }

  function fillNewsModal(news) {
    state.editingNewsId = news ? news.id : null;
    byId("newsModalTitle").textContent = state.editingNewsId ? "Sửa bài viết" : "Tạo bài viết";
    byId("nTitle").value = news?.title || "";
    byId("nSlug").value = news?.slug || "";
    byId("nStatus").value = news?.status || "draft";
    byId("nScheduledAt").value = news?.scheduled_at || "";
    byId("nThumb").value = news?.thumbnail || "";
    byId("nBanner").value = news?.banner || "";
    byId("nSummary").value = news?.summary || "";
    byId("nContent").value = news?.content || "";
    openModal("newsModalBackdrop");
  }

  async function saveNews() {
    const body = {
      title: byId("nTitle").value.trim(),
      slug: byId("nSlug").value.trim(),
      status: byId("nStatus").value,
      scheduled_at: byId("nScheduledAt").value.trim(),
      thumbnail: byId("nThumb").value.trim(),
      banner: byId("nBanner").value.trim(),
      summary: byId("nSummary").value.trim(),
      content: byId("nContent").value.trim(),
    };

    if (!body.title || !body.content) {
      alert("Tiêu đề và nội dung bài viết là bắt buộc.");
      return;
    }

    if (state.editingNewsId) {
      await api(`/admin/news/${state.editingNewsId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/admin/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    closeModal("newsModalBackdrop");
    await loadNews();
    renderNews();
  }

  function fillWarrantyModal(w) {
    state.editingWarrantyId = w ? w.id : null;
    byId("warrantyModalTitle").textContent = state.editingWarrantyId ? "Sửa hồ sơ bảo hành" : "Tạo hồ sơ bảo hành";
    byId("wCode").value = w?.warranty_code || "";
    byId("wProduct").value = w?.product_name || "";
    byId("wSerial").value = w?.serial_imei || "";
    byId("wPhone").value = w?.phone || "";
    byId("wActivatedAt").value = w?.activated_at || "";
    byId("wExpiredAt").value = w?.expired_at || "";
    byId("wStatus").value = w?.status || "active";
    if (Array.isArray(w?.history)) byId("wHistory").value = w.history.join("\n");
    else byId("wHistory").value = w?.history || "";
    openModal("warrantyModalBackdrop");
  }

  async function saveWarranty() {
    const body = {
      warranty_code: byId("wCode").value.trim(),
      product_name: byId("wProduct").value.trim(),
      serial_imei: byId("wSerial").value.trim(),
      phone: byId("wPhone").value.trim(),
      activated_at: byId("wActivatedAt").value.trim(),
      expired_at: byId("wExpiredAt").value.trim(),
      status: byId("wStatus").value,
      history: byId("wHistory").value
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    };

    if (!body.warranty_code || !body.product_name || !body.phone) {
      alert("Mã BH, sản phẩm, số điện thoại là bắt buộc.");
      return;
    }

    if (state.editingWarrantyId) {
      await api(`/admin/warranty/${state.editingWarrantyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/admin/warranty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    closeModal("warrantyModalBackdrop");
    await loadWarranties();
    renderWarranties();
  }

  function fillBannerModal(id) {
    const b = id ? state.banners.find((x) => Number(x.id) === Number(id)) : null;
    state.editingBannerId = id ? Number(id) : null;
    refs.bannerModalTitle.textContent = id ? "Sửa banner" : "Thêm banner";
    refs.bImg.value = b?.img || "";
    refs.bImgFile.value = ""; // Reset file input
    refs.bPosition.value = b?.position || "";
    openModal("bannerModalBackdrop");
  }

  async function saveBanner() {
    let imgUrl = refs.bImg.value.trim();

    // Upload file if selected
    if (refs.bImgFile.files.length > 0) {
      const formData = new FormData();
      formData.append('file', refs.bImgFile.files[0]);
      const uploadRes = await fetch(window.apiUrl('/admin/upload'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}` },
        body: formData
      });
      if (!uploadRes.ok) {
        alert('Upload ảnh thất bại');
        return;
      }
      const uploadData = await uploadRes.json();
      imgUrl = uploadData.url;
    }

    const position = refs.bPosition.value.trim();

    // Validation
    if (!imgUrl) {
      alert("Ảnh banner là bắt buộc.");
      refs.bImg.focus();
      return;
    }
    if (!position) {
      alert("Vị trí banner là bắt buộc.");
      refs.bPosition.focus();
      return;
    }

    const body = {
      img: imgUrl,
      position: position,
    };

    if (state.editingBannerId) {
      await api(`/admin/banner/${state.editingBannerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/admin/banners/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    closeModal("bannerModalBackdrop");
    await loadBanners();
    renderBanners();
  }

  function openAddUserModal() {
    refs.auUsername.value = "";
    refs.auEmail.value = "";
    refs.auPassword.value = "";
    refs.auRole.value = "user";
    openModal("addUserModalBackdrop");
  }

  async function addUser() {
    const body = {
      username: refs.auUsername.value.trim(),
      email: refs.auEmail.value.trim(),
      password: refs.auPassword.value.trim(),
      role: refs.auRole.value,
    };

    if (!body.username || !body.email || !body.password) {
      alert("Username, email và mật khẩu là bắt buộc.");
      return;
    }

    await api("/admin/users/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    closeModal("addUserModalBackdrop");
    await loadUsers();
    renderUsers();
  }

  function toStatusTimeline(status) {
    const s = String(status || "").toLowerCase();
    const flow = ["processing", "shipping", "completed"];
    const activeIndex = flow.indexOf(s);
    if (s === "cancelled") {
      return [
        { text: "Đơn được tạo", done: true },
        { text: "Đơn đã bị hủy", done: true },
      ];
    }
    return flow.map((st, idx) => ({ text: st, done: activeIndex >= idx }));
  }

  function buildInvoiceText(order) {
    const lines = [];
    lines.push(`NEXTECH INVOICE - ${order.order_code || ""}`);
    lines.push(`Khach hang: ${order.customer?.name || order.customer_name || ""}`);
    lines.push(`So dien thoai: ${order.customer?.phone || order.customer_phone || ""}`);
    lines.push(`Dia chi: ${order.customer?.address || ""}`);
    lines.push(`Trang thai: ${order.status || ""}`);
    lines.push("-------------------------------------");
    (order.items || []).forEach((it) => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price || 0);
      lines.push(`${it.name || it.product_name} x${qty} - ${money(price * qty)}`);
    });
    lines.push("-------------------------------------");
    lines.push(`Tong tien: ${money(order.total_amount || 0)}`);
    lines.push("PDF placeholder - ready for real PDF service integration.");
    return lines.join("\n");
  }

  async function downloadInvoicePdf(order) {
    const code = encodeURIComponent(order.order_code || "");
    if (!code) return;

    const res = await fetch(window.apiUrl(`/admin/orders/${code}/invoice.pdf`), {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      let msg = `HTTP ${res.status}`;
      try {
        const j = txt ? JSON.parse(txt) : null;
        msg = (j && j.msg) || msg;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${order.order_code || "order"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showOrderDetail(order) {
    const timeline = toStatusTimeline(order.status)
      .map(
        (item) => `<div class="timeline-item"><div class="time">${item.done ? "Done" : "Pending"}</div><div class="text">${escapeHtml(item.text)}</div></div>`,
      )
      .join("");

    const itemsHtml = (order.items || [])
      .map(
        (it) => `<tr><td>${escapeHtml(it.name || it.product_name || "")}</td><td>${Number(it.quantity || 0)}</td><td>${money(Number(it.price || 0))}</td><td>${money(Number(it.subtotal || Number(it.price || 0) * Number(it.quantity || 0)))}</td></tr>`,
      )
      .join("");

    const canInvoice = String(order.status || "").toLowerCase() === "completed";

    byId("orderDetailContent").innerHTML = `
      <div class="split-grid">
        <div class="admin-card">
          <h3>Thông tin đơn</h3>
          <p><strong>Mã đơn:</strong> ${escapeHtml(order.order_code || "")}</p>
          <p><strong>Khách:</strong> ${escapeHtml(order.customer?.name || order.customer_name || "")}</p>
          <p><strong>SĐT:</strong> ${escapeHtml(order.customer?.phone || order.customer_phone || "")}</p>
          <p><strong>Thanh toán:</strong> ${escapeHtml(order.payment?.provider || order.payment_method || "")}</p>
          <p><strong>Tổng tiền:</strong> ${money(order.total_amount || 0)}</p>
          ${canInvoice ? `<div class="chip success" style="margin-bottom:8px">Đơn hoàn thành - sẵn sàng xuất hóa đơn</div><button class="btn primary" id="btn-download-invoice"><i class="fas fa-file-arrow-down"></i> Tải PDF hóa đơn</button>` : `<div class="chip warning">Hóa đơn chỉ hiển thị khi đơn hoàn thành</div>`}
        </div>
        <div class="admin-card">
          <h3>Timeline trạng thái</h3>
          <div class="timeline">${timeline}</div>
        </div>
      </div>
      <div class="admin-card">
        <h3>Sản phẩm trong đơn</h3>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Tên</th><th>SL</th><th>Đơn giá</th><th>Tạm tính</th></tr></thead>
            <tbody>${itemsHtml || `<tr><td colspan="4">Không có dữ liệu item.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;

    if (canInvoice) {
      byId("btn-download-invoice")?.addEventListener("click", async () => {
        try {
          await downloadInvoicePdf(order);
        } catch (err) {
          alert(`Không thể tải PDF: ${err.message}`);
        }
      });
    }

    openModal("orderDetailModalBackdrop");
  }

  async function saveOrderStatus(orderCode) {
    const select = byId(`order-status-${orderCode}`);
    if (!select) return;
    const status = select.value;
    await api(`/admin/orders/${encodeURIComponent(orderCode)}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await Promise.all([loadOrders(), loadDashboardStats()]);
    renderOrders();
    renderDashboard();
  }

  function fillUserModal(user) {
    state.editingUserId = user ? user.id : null;
    byId("userModalTitle").textContent = "Sửa người dùng";
    byId("uUsername").value = user?.username || "";
    byId("uEmail").value = user?.email || "";
    byId("uPhone").value = user?.phone || "";
    byId("uRole").value = String(user?.role || "user").toLowerCase();
    byId("uAddress").value = user?.address || "";
    byId("uLocked").checked = !!user?.is_locked;
    openModal("userModalBackdrop");
  }

  async function saveUserByAdmin() {
    if (!state.editingUserId) return;
    const body = {
      username: byId("uUsername").value.trim(),
      email: byId("uEmail").value.trim(),
      phone: byId("uPhone").value.trim(),
      role: byId("uRole").value,
      address: byId("uAddress").value.trim(),
      is_locked: byId("uLocked").checked,
    };

    await api(`/admin/users/update/${state.editingUserId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    closeModal("userModalBackdrop");
    await loadUsers();
    renderUsers();
  }

  async function deleteOrder(orderCode) {
    await api(`/admin/orders/${encodeURIComponent(orderCode)}`, {
      method: "DELETE",
    });
    await Promise.all([loadOrders(), loadDashboardStats()]);
    renderOrders();
    renderDashboard();
  }

  async function bindEvents() {
    refs.tabs.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
    byId("btn-go-store").addEventListener("click", () => {
      window.location.href = "index.html";
    });

    byId("btn-refresh-dashboard").addEventListener("click", async () => {
      await Promise.all([loadDashboardStats(), loadOrders(), loadInventory()]);
      renderDashboard();
    });

    byId("timeFilterGroup").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-days]");
      if (!btn) return;
      state.selectedDays = Number(btn.dataset.days || 7);
      Array.from(byId("timeFilterGroup").querySelectorAll("button")).forEach((b) => b.classList.toggle("active", b === btn));
      renderRevenueChart();
    });

    refs.productSearch.addEventListener("input", renderProducts);
    refs.productCategoryFilter.addEventListener("change", renderProducts);

    refs.inventorySearch.addEventListener("input", renderInventory);
    refs.inventoryCategoryFilter.addEventListener("change", renderInventory);
    refs.inventoryStockFilter.addEventListener("change", renderInventory);

    refs.userSearch.addEventListener("input", renderUsers);
    refs.userRoleTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-role]");
      if (!btn) return;
      Array.from(refs.userRoleTabs.querySelectorAll("button")).forEach((b) => b.classList.toggle("active", b === btn));
      renderUsers();
    });

    refs.newsSearch.addEventListener("input", renderNews);
    refs.newsStatusFilter.addEventListener("change", renderNews);

    refs.orderSearch.addEventListener("input", renderOrders);
    refs.orderStatusFilter.addEventListener("change", renderOrders);

    refs.warrantySearch.addEventListener("input", renderWarranties);
    refs.warrantyStatusFilter.addEventListener("change", renderWarranties);

    refs.reportPeriod.addEventListener("change", renderReports);
    refs.btnExportRevenue.addEventListener("click", exportRevenueReport);

    byId("btn-open-product-modal").addEventListener("click", () => fillProductModal(null));
    byId("btn-save-product").addEventListener("click", async () => {
      try {
        await saveProduct();
      } catch (err) {
        alert(`Lỗi lưu sản phẩm: ${err.message}`);
      }
    });

    byId("btn-open-news-modal").addEventListener("click", () => fillNewsModal(null));
    byId("btn-save-news").addEventListener("click", async () => {
      try {
        await saveNews();
      } catch (err) {
        alert(`Lỗi lưu bài viết: ${err.message}`);
      }
    });

    byId("btn-open-warranty-modal").addEventListener("click", () => fillWarrantyModal(null));
    byId("btn-save-warranty").addEventListener("click", async () => {
      try {
        await saveWarranty();
      } catch (err) {
        alert(`Lỗi lưu bảo hành: ${err.message}`);
      }
    });

    refs.btnOpenBannerModal.addEventListener("click", () => fillBannerModal(null));
    refs.btnSaveBanner.addEventListener("click", async () => {
      try {
        await saveBanner();
      } catch (err) {
        alert(`Lỗi lưu banner: ${err.message}`);
      }
    });

    refs.btnAddUserModal.addEventListener("click", () => openAddUserModal());
    refs.btnAddUser.addEventListener("click", async () => {
      try {
        await addUser();
      } catch (err) {
        alert(`Lỗi thêm người dùng: ${err.message}`);
      }
    });

    byId("btn-save-user").addEventListener("click", async () => {
      try {
        await saveUserByAdmin();
      } catch (err) {
        alert(`Lỗi lưu người dùng: ${err.message}`);
      }
    });

    byId("btn-bulk-hide").addEventListener("click", () => {
      const checked = Array.from(document.querySelectorAll("[data-product-check]:checked")).map((x) => x.getAttribute("data-product-check"));
      checked.forEach((id) => {
        state.hiddenProducts[String(id)] = true;
      });
      saveJson("admin_hidden_products", state.hiddenProducts);
      renderProducts();
    });

    byId("btn-bulk-delete").addEventListener("click", async () => {
      const checked = Array.from(document.querySelectorAll("[data-product-check]:checked")).map((x) => x.getAttribute("data-product-check"));
      if (checked.length === 0) {
        alert("Chọn ít nhất một sản phẩm để xóa.");
        return;
      }
      if (!confirm(`Xóa ${checked.length} sản phẩm đã chọn?`)) return;
      try {
        await Promise.all(checked.map(id => api(`/admin/products/delete/${id}`, { method: "DELETE" })));
        await Promise.all([loadProducts(), loadInventory(), loadDashboardStats()]);
        renderProducts();
        renderInventory();
        renderDashboard();
      } catch (err) {
        alert(`Lỗi xóa sản phẩm: ${err.message}`);
      }
    });

    refs.productSelectAll.addEventListener("change", () => {
      document.querySelectorAll("[data-product-check]").forEach((cb) => {
        cb.checked = refs.productSelectAll.checked;
      });
    });

    document.body.addEventListener("click", async (e) => {
      const closeBtn = e.target.closest("[data-close-modal]");
      if (closeBtn) {
        closeModal(closeBtn.getAttribute("data-close-modal"));
        return;
      }

      const quick = e.target.closest("[data-quick-view]");
      if (quick) {
        const id = Number(quick.getAttribute("data-quick-view") || 0);
        const p = state.products.find((x) => Number(x.id) === id);
        if (p) {
          alert(`${p.name}\nDanh mục: ${p.category}\nGiá: ${money(p.price)}\nTồn: ${Number(p.stock || 0)}`);
        }
        return;
      }

      const editProductBtn = e.target.closest("[data-edit-product]");
      if (editProductBtn) {
        const id = Number(editProductBtn.getAttribute("data-edit-product") || 0);
        const p = state.products.find((x) => Number(x.id) === id);
        if (p) fillProductModal(p);
        return;
      }

      const toggleProductBtn = e.target.closest("[data-toggle-product]");
      if (toggleProductBtn) {
        const id = Number(toggleProductBtn.getAttribute("data-toggle-product") || 0);
        toggleProductVisibility(id);
        return;
      }

      const saveStockBtn = e.target.closest("[data-save-stock]");
      if (saveStockBtn) {
        const id = Number(saveStockBtn.getAttribute("data-save-stock") || 0);
        const input = byId(`stock-${id}`);
        const stock = Number(input?.value || 0);
        try {
          await api(`/admin/inventory/update/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stock }),
          });
          await Promise.all([loadInventory(), loadDashboardStats()]);
          renderInventory();
          renderDashboard();
        } catch (err) {
          alert(`Lỗi cập nhật kho: ${err.message}`);
        }
        return;
      }

      const deleteProductBtn = e.target.closest("[data-delete-product]");
      if (deleteProductBtn) {
        const id = Number(deleteProductBtn.getAttribute("data-delete-product") || 0);
        if (!window.confirm("Xác nhận xóa sản phẩm?")) return;
        try {
          await api(`/admin/products/delete/${id}`, { method: "DELETE" });
          await Promise.all([loadProducts(), loadInventory(), loadDashboardStats()]);
          renderProducts();
          renderInventory();
          renderDashboard();
        } catch (err) {
          alert(`Lỗi xóa sản phẩm: ${err.message}`);
        }
        return;
      }

      const toggleLockBtn = e.target.closest("[data-toggle-lock]");
      if (toggleLockBtn) {
        const id = Number(toggleLockBtn.getAttribute("data-toggle-lock") || 0);
        if (!window.confirm("Xác nhận đổi trạng thái khóa tài khoản?")) return;
        try {
          await api(`/admin/users/toggle-lock/${id}`, { method: "PUT" });
          await loadUsers();
          renderUsers();
        } catch (err) {
          alert(`Lỗi khóa/mở khóa: ${err.message}`);
        }
        return;
      }

      const editUserBtn = e.target.closest("[data-edit-user]");
      if (editUserBtn) {
        const id = Number(editUserBtn.getAttribute("data-edit-user") || 0);
        const user = state.users.find((x) => Number(x.id) === id);
        if (user) fillUserModal(user);
        return;
      }

      const deleteUserBtn = e.target.closest("[data-delete-user]");
      if (deleteUserBtn) {
        const id = Number(deleteUserBtn.getAttribute("data-delete-user") || 0);
        if (!window.confirm("Xóa user này? Thao tác không thể hoàn tác.")) return;
        try {
          await api(`/admin/users/delete/${id}`, { method: "DELETE" });
          await loadUsers();
          renderUsers();
        } catch (err) {
          alert(`Lỗi xóa user: ${err.message}`);
        }
        return;
      }

      const editNewsBtn = e.target.closest("[data-edit-news]");
      if (editNewsBtn) {
        const id = Number(editNewsBtn.getAttribute("data-edit-news") || 0);
        const news = state.news.find((x) => Number(x.id) === id);
        if (news) fillNewsModal(news);
        return;
      }

      const toggleNewsBtn = e.target.closest("[data-toggle-news]");
      if (toggleNewsBtn) {
        const id = Number(toggleNewsBtn.getAttribute("data-toggle-news") || 0);
        const target = state.news.find((x) => Number(x.id) === id);
        if (!target) return;
        const nextStatus = String(target.status || "").toLowerCase() === "hidden" ? "published" : "hidden";
        try {
          await api(`/admin/news/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus }),
          });
          await loadNews();
          renderNews();
        } catch (err) {
          alert(`Lỗi cập nhật trạng thái bài viết: ${err.message}`);
        }
        return;
      }

      const deleteNewsBtn = e.target.closest("[data-delete-news]");
      if (deleteNewsBtn) {
        const id = Number(deleteNewsBtn.getAttribute("data-delete-news") || 0);
        if (!window.confirm("Xóa bài viết này?")) return;
        try {
          await api(`/admin/news/${id}`, { method: "DELETE" });
          await loadNews();
          renderNews();
        } catch (err) {
          alert(`Lỗi xóa bài viết: ${err.message}`);
        }
        return;
      }

      const saveOrderBtn = e.target.closest("[data-save-order]");
      if (saveOrderBtn) {
        const code = String(saveOrderBtn.getAttribute("data-save-order") || "");
        try {
          await saveOrderStatus(code);
        } catch (err) {
          alert(`Lỗi cập nhật trạng thái đơn: ${err.message}`);
        }
        return;
      }

      const viewOrderBtn = e.target.closest("[data-view-order]");
      if (viewOrderBtn) {
        const code = String(viewOrderBtn.getAttribute("data-view-order") || "");
        const order = state.orders.find((x) => x.order_code === code);
        if (order) showOrderDetail(order);
        return;
      }

      const deleteOrderBtn = e.target.closest("[data-delete-order]");
      if (deleteOrderBtn) {
        const code = String(deleteOrderBtn.getAttribute("data-delete-order") || "");
        if (!code || deleteOrderBtn.hasAttribute("disabled")) return;
        if (!window.confirm(`Xóa đơn ${code}? Chỉ áp dụng cho đơn completed/cancelled.`)) return;
        try {
          await deleteOrder(code);
        } catch (err) {
          alert(`Lỗi xóa đơn: ${err.message}`);
        }
        return;
      }

      const editWarrantyBtn = e.target.closest("[data-edit-warranty]");
      if (editWarrantyBtn) {
        const id = Number(editWarrantyBtn.getAttribute("data-edit-warranty") || 0);
        const w = state.warranties.find((x) => Number(x.id) === id);
        if (w) fillWarrantyModal(w);
        return;
      }

      const deleteWarrantyBtn = e.target.closest("[data-delete-warranty]");
      if (deleteWarrantyBtn) {
        const id = Number(deleteWarrantyBtn.getAttribute("data-delete-warranty") || 0);
        if (!window.confirm("Xóa hồ sơ bảo hành này?")) return;
        try {
          await api(`/admin/warranty/${id}`, { method: "DELETE" });
          await loadWarranties();
          renderWarranties();
        } catch (err) {
          alert(`Lỗi xóa bảo hành: ${err.message}`);
        }
        return;
      }

      const editBannerBtn = e.target.closest("[data-edit-banner]");
      if (editBannerBtn) {
        const id = Number(editBannerBtn.getAttribute("data-edit-banner") || 0);
        fillBannerModal(id);
        return;
      }

      const deleteBannerBtn = e.target.closest("[data-delete-banner]");
      if (deleteBannerBtn) {
        const id = Number(deleteBannerBtn.getAttribute("data-delete-banner") || 0);
        if (!window.confirm("Xóa banner này?")) return;
        try {
          await api(`/admin/banner/${id}`, { method: "DELETE" });
          await loadBanners();
          renderBanners();
        } catch (err) {
          alert(`Lỗi xóa banner: ${err.message}`);
        }
        return;
      }
    });
  }

  async function bootstrap() {
    const ok = await requireAdmin();
    if (!ok) return;

    const pCategory = byId("pCategory");
    if (pCategory) pCategory.innerHTML = "";

    await Promise.all([loadProducts(), loadInventory(), loadUsers(), loadOrders(), loadNews(), loadWarranties(), loadBanners(), loadDashboardStats()]);

    renderDashboard();
    renderProducts();
    renderInventory();
    renderUsers();
    renderNews();
    renderOrders();
    renderWarranties();
    renderBanners();

    switchTab(state.activeTab);
    await bindEvents();

    // Kích hoạt âm thanh khi người dùng click lần đầu vào trang
    document.addEventListener('click', () => { state.audioUnlocked = true; }, { once: true });

    // --- CƠ CHẾ TỰ ĐỘNG CẬP NHẬT DỮ LIỆU MỚI (AUTO-REFRESH) ---
    setInterval(async () => {
      try {
        // 0. Lưu danh sách ID cũ TRƯỚC KHI tải mới
        const oldUserIds = new Set(state.users.map(u => u.id));
        const oldOrderCodes = new Set(state.orders.map(o => o.order_code));
        const oldProductIds = new Set(state.products.map(p => p.id));

        // 1. Tải các dữ liệu "nhẹ" và quan trọng nhất trước
        await Promise.all([
          loadDashboardStats().catch(() => {}),
          loadInventory().catch(() => {}),
          loadUsers().catch(() => {}),
          loadProducts().catch(() => {})
        ]);

        // 2. Kiểm tra Người dùng mới
        const newUsers = state.users.filter(u => !oldUserIds.has(u.id));
        if (newUsers.length > 0) {
          state.newItems.users = new Set(newUsers.map(u => u.id));
          playNotifySound();
          showAdminToast(`Có ${newUsers.length} khách hàng mới vừa đăng ký!`, "fa-user-plus");
          if (state.activeTab === "users") renderUsers();
        }

        // 3. Kiểm tra Sản phẩm mới
        const newProds = state.products.filter(p => !oldProductIds.has(p.id));
        if (newProds.length > 0) {
          state.newItems.products = new Set(newProds.map(p => p.id));
          if (state.activeTab === "products") renderProducts();
          if (state.activeTab === "inventory") renderInventory();
        }

        // 4. Tải Đơn hàng (Nặng nhất)
        loadOrders().then(() => {
          const newOrders = state.orders.filter(o => !oldOrderCodes.has(o.order_code));
          if (newOrders.length > 0) {
            state.newItems.orders = new Set(newOrders.map(o => o.order_code));
            playNotifySound();
            showAdminToast(`Bạn có ${newOrders.length} đơn hàng mới cần xử lý!`, "fa-shopping-cart");
            
            if (state.activeTab === "orders") renderOrders();
            if (state.activeTab === "dashboard") renderDashboard();
          } else {
            // Refresh lại view hiện tại để cập nhật trạng thái (nếu có thay đổi nhỏ)
            switchTab(state.activeTab);
          }
        }).catch(err => console.warn("Cập nhật đơn hàng ngầm thất bại:", err));

        // Cập nhật Dashboard nếu đang mở để thấy biến động doanh thu/tồn kho
        if (state.activeTab === "dashboard") renderDashboard();

      } catch (err) {
        console.warn("Tự động cập nhật Admin tạm thời thất bại:", err);
      }
    }, 10000); // Rút ngắn xuống 10 giây một lần để cập nhật nhanh hơn
  }

  bootstrap().catch((err) => {
    console.error(err);
    alert(`Không thể khởi tạo Admin: ${err.message}`);
  });
})();