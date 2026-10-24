let allProductsById = {};
let cachedOrders = [];

let _initPromise = null;

function formatMoneyVND(value) {
  const n = Number(value || 0);
  try {
    return n.toLocaleString("vi-VN");
  } catch {
    return String(n);
  }
}
 
function _normalizeStatus(status) {
  const s = String(status || "").toLowerCase();
  return s;
}

function requireLoginForBE2() {
  const token = localStorage.getItem("token");
  if (!token) {
    const container = document.getElementById("orderListArea");
    if (container) {
      container.innerHTML = `
                <div class="empty-notify">
                    <i class="fas fa-user-lock" style="font-size: 36px; display: block; margin-bottom: 10px;"></i>
                    <div style="font-weight:700; margin-bottom:6px;">Bạn chưa đăng nhập.</div>
                    <div style="font-size:12px; color:#666; margin-bottom:10px;">
                        Vui lòng đăng nhập để xem và quản lý đơn hàng của bạn.
                    </div>
                    <a href="login.html" style="display:inline-block; padding:10px 14px; border-radius:10px; background:#d70018; color:#fff; text-decoration:none;">Đăng nhập lại</a>
                </div>
            `;
    }
    // Redirect to login (keep a short delay so user can read the message)
    setTimeout(() => {
      try {
        window.location.href = "login.html";
      } catch {
        // ignore
      }
    }, 500);
    return null;
  }
  return token;
}

function _safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const ms = typeof timeoutMs === "number" ? timeoutMs : 8000;
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadProductsIndex() {
  try {
    const res = await fetchWithTimeout(
      window.apiUrl("/api/public/products"),
      {},
      10000,
    );
    const text = await res.text();
    const data = _safeJsonParse(text) || {};
    const flat = Object.values(data || {}).flat();
    allProductsById = {};
    flat.forEach((p) => {
      if (p && p.id != null) allProductsById[p.id] = p;
    });
  } catch (e) {
    console.error("Không thể tải danh sách sản phẩm:", e);
    allProductsById = {};
  }
}

async function fetchMyOrders(token) {
  const res = await fetchWithTimeout(
    window.apiUrl("/api/orders/me"),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
    8000,
  );
  const text = await res.text();
  const data = _safeJsonParse(text);
  if (!res.ok) {
    const msg = data && data.msg ? data.msg : text || "Không thể tải đơn hàng";
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.raw = data || text;
    throw err;
  }
  const rows = Array.isArray(data) ? data : [];
  // Normalize legacy statuses client-side as a safety net.
  return rows.map((o) => ({
    ...(o || {}),
    status: _normalizeStatus(o && o.status),
  }));
}

async function fetchOrderDetail(token, orderCode) {
  const res = await fetchWithTimeout(
    window.apiUrl(`/api/orders/${orderCode}`),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
    8000,
  );
  const text = await res.text();
  const data = _safeJsonParse(text);
  if (!res.ok) return null;
  if (data && typeof data === "object") {
    data.status = _normalizeStatus(data.status);
  }
  return data;
}

async function cancelOrder(token, orderCode) {
  const encoded = encodeURIComponent(String(orderCode || "").trim());
  const res = await fetchWithTimeout(
    window.apiUrl(`/api/orders/${encoded}/cancel`),
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    },
    8000,
  );
  const text = await res.text();
  const data = _safeJsonParse(text);
  if (!res.ok) {
    const msg = data && data.msg ? data.msg : text || "Không thể hủy đơn hàng";
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.raw = data || text;
    throw err;
  }
  return data || {};
}

async function addToCart(token, productId, quantity) {
  const pid = Number(productId || 0);
  const qty = Number(quantity || 0);
  if (!pid || pid <= 0 || !qty || qty <= 0) {
    throw new Error("Dữ liệu sản phẩm không hợp lệ");
  }

  const res = await fetchWithTimeout(
    window.apiUrl("/api/cart"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ product_id: pid, quantity: qty }),
    },
    8000,
  );

  const text = await res.text();
  const data = _safeJsonParse(text);
  if (!res.ok) {
    const msg =
      data && data.msg ? data.msg : text || "Không thể thêm vào giỏ hàng";
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.raw = data || text;
    throw err;
  }

  return data || {};
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(Boolean)
    .map((it) => ({
      product_id: it.product_id,
      name: it.name || it.product_name,
      price: it.price,
      quantity: it.quantity,
      subtotal: it.subtotal,
    }))
    .filter((it) => it.name);
}

function pickOrderThumbnail(items) {
  const first = items && items[0];
  if (!first) return { img: "../assets/img/LOGO1.png", name: "Sản phẩm", images: [] };
  
  const images = (items || []).map(it => {
    const product = it.product_id != null ? allProductsById[it.product_id] : null;
    return product && product.img ? product.img : "../assets/img/LOGO1.png";
  }).filter(Boolean);

  const product =
    first.product_id != null ? allProductsById[first.product_id] : null;
  return {
    img: product && product.img ? product.img : "../assets/img/LOGO1.png",
    name: first.name || (product && product.name) || "Sản phẩm",
    images: images
  };
}

/**
 * Hàm render giao diện stack ảnh xòe bài cho danh sách đơn hàng
 */
function renderOrderImagesStack(images) {
  if (!images || images.length === 0) images = ["../assets/img/LOGO1.png"];
 
  const itemsToShow = images.length > 1 ? images.slice(0, 5) : [images[0]]; 
  
  let html = `<div class="order-img-stack" style="position:relative; width:80px; height:80px; flex-shrink:0; margin-right:20px; display:flex; justify-content:center; align-items:center;">`;
  itemsToShow.forEach((src, idx) => {
    let style = `position:absolute; width:60px; height:60px; object-fit:contain; background:#fff; border:1px solid #eee; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); z-index:${idx};`;
    
    if (itemsToShow.length > 1) {
      const offset = idx - (itemsToShow.length - 1) / 2;
      const rotate = offset * 15;
      const tx = offset * 18;
      const ty = Math.abs(offset) * 4;
      style += `transform: translateX(${tx}px) translateY(${ty}px) rotate(${rotate}deg);`;
    } else {
      // Nếu là ảnh đơn, giữ nguyên không xoay để kích thước "khung" nhìn đồng nhất với stack
      style += `transform: none;`;
    }
    
    html += `<img src="${src}" style="${style}">`;
  });
  html += `</div>`;
  return html;
}

async function loadOrdersFromBE2() {
  if (typeof window.apiUrl !== "function") {
    const container = document.getElementById("orderListArea");
    if (container) {
      container.innerHTML = `<div class="empty-notify">Không thể tải đơn hàng: thiếu cấu hình API. Vui lòng tải lại trang.</div>`;
    }
    throw new Error("api-config-not-loaded");
  }

  const token = requireLoginForBE2();
  if (!token) return;

  const container = document.getElementById("orderListArea");
  if (container) {
    container.innerHTML = `<div class="empty-notify">Đang tải đơn hàng...</div>`;
  }

  // Always request orders first (to make debugging easier).
  const orders = await fetchMyOrders(token);

  // Products index is optional (for thumbnails); don't block order listing.
  await loadProductsIndex();

  // Fallback: if user just placed an order and list is empty, show that order.
  const lastOrderCode = (localStorage.getItem("last_order_code") || "").trim();
  if ((!orders || orders.length === 0) && lastOrderCode) {
    const detail = await fetchOrderDetail(token, lastOrderCode);
    if (detail && detail.order_code) {
      const items = normalizeOrderItems(detail.items);
      const thumb = pickOrderThumbnail(items);
      const totalQty = items.reduce(
        (sum, it) => sum + (Number(it.quantity) || 0),
        0,
      );

      cachedOrders = [
        {
          orderCode: detail.order_code,
          status: detail.status || "processing",
          paymentMethod: (detail.payment_method || "").toLowerCase(),
          orderDate: detail.created_at || "",
          totalAmount: detail.total_amount || 0,
          productName: thumb.name,
          productImg: thumb.img,
          productImages: thumb.images,
          quantity: totalQty || 0,
          items: items,
        },
      ];

      // Cập nhật tên người dùng nếu có
      const username = localStorage.getItem("username");
      if (username) {
        const el = document.getElementById("userNameDisplay");
        if (el) el.innerText = username;
      }
      return;
    }
  }

  // Enrich each order with detail (full items) for UI
  const enriched = await Promise.all(
    orders.map(async (o) => {
      const detail = await fetchOrderDetail(token, o.order_code);
      const items = normalizeOrderItems(detail && detail.items);
      const thumb = pickOrderThumbnail(items);
      const totalQty = items.reduce(
        (sum, it) => sum + (Number(it.quantity) || 0),
        0,
      );

      return {
        orderCode: o.order_code,
        status: o.status,
        paymentMethod: ((detail && detail.payment_method) || "").toLowerCase(),
        orderDate: o.created_at,
        totalAmount: o.total_amount,
        productName: thumb.name,
        productImg: thumb.img,
        productImages: thumb.images,
        quantity: totalQty || 0,
        items: items,
      };
    }),
  );

  cachedOrders = enriched;

  // Cập nhật tên người dùng nếu có
  const username = localStorage.getItem("username");
  if (username) {
    const el = document.getElementById("userNameDisplay");
    if (el) el.innerText = username;
  }
}

function filterOrders(status, element) {
  // Cập nhật giao diện tab
  document
    .querySelectorAll(".step-item")
    .forEach((el) => el.classList.remove("active"));
  if (element) element.classList.add("active");

  const container = document.getElementById("orderListArea");
  if (!container) return;

  const orders = cachedOrders || [];
  const filtered =
    status === "all" ? orders : orders.filter((o) => o.status === status);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-notify"><i class="fas fa-box-open" style="font-size: 40px; display: block; margin-bottom: 10px;"></i>Chưa có đơn hàng nào.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemsHtml = items.length
        ? items
            .map((it) => {
              const qty = Number(it.quantity) || 0;
              return `<div style="font-size:12px; color:#555; margin-top:2px;">â€¢ ${it.name} x${qty}</div>`;
            })
            .join("")
        : `<div style="font-size:12px; color:#777; margin-top:4px;">(Không tải được chi tiết sản phẩm)</div>`;

      const totalText = formatMoneyVND(order.totalAmount || 0);
      const statusNorm = String(order.status || "").toLowerCase();
          const canCancel = statusNorm === "processing";
      const canRebuy = String(order.status || "").toLowerCase() === "cancelled";
      const viewBtnHtml = `<button type="button" class="btn-view-order" data-view-order="${order.orderCode}">Xem chi tiết</button>`;
      const cancelBtnHtml = canCancel
        ? `<button type="button" class="btn-cancel-order" data-cancel-order="${order.orderCode}">Hủy đơn hàng</button>`
        : "";
      const rebuyBtnHtml = canRebuy
        ? `<button type="button" class="btn-rebuy-order" data-rebuy-order="${order.orderCode}">Mua lại</button>`
        : "";
      const actionsHtml = `<div class="order-actions">${viewBtnHtml}${cancelBtnHtml}${rebuyBtnHtml}</div>`;
      return `
        <div class="order-card-item">
            ${renderOrderImagesStack(order.productImages)}
            <div class="order-card-info">
                <h4>${order.productName}</h4>
                <p>Mã đơn: <b>${order.orderCode}</b></p>
                <p>Số lượng: ${order.quantity || 0}</p>
                <p>Trạng thái: <span style="color: #28a745;">${getStatusText(order.status)}</span></p>
                <p>Ngày đặt: ${order.orderDate || ""}</p>
                <div style="margin-top:6px;">${itemsHtml}</div>
                ${actionsHtml}
            </div>
            <div class="order-price">${totalText} VND</div>
        </div>
        `;
    })
    .join("");
}

function _findTabElementForStatus(status) {
  const tabs = Array.from(
    document.querySelectorAll(".stepper-header .step-item"),
  );
  const needle = String(status || "").trim();
  if (!needle) return tabs[0] || null;

  for (const tab of tabs) {
    const attr = (tab.getAttribute("onclick") || "").toLowerCase();
    if (attr.includes(`'${needle.toLowerCase()}'`)) return tab;
    if (attr.includes(`"${needle.toLowerCase()}"`)) return tab;
  }

  // Fallbacks: match by text
  if (needle.toLowerCase() === "cancelled") {
    return (
      tabs.find((t) => (t.textContent || "").trim().toLowerCase() === "hủy") ||
      null
    );
  }
  return null;
}

let _cancelHandlerBound = false;
function bindCancelOrderHandler() {
  if (_cancelHandlerBound) return;
  const container = document.getElementById("orderListArea");
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const target = e && e.target ? e.target : null;
    const viewBtn =
      target && target.closest ? target.closest("[data-view-order]") : null;
    const cancelBtn =
      target && target.closest ? target.closest("[data-cancel-order]") : null;
    const rebuyBtn =
      target && target.closest ? target.closest("[data-rebuy-order]") : null;
    if (!viewBtn && !cancelBtn && !rebuyBtn) return;

    if (viewBtn) {
      const orderCode = (viewBtn.getAttribute("data-view-order") || "").trim();
      if (!orderCode) return;

      const token = requireLoginForBE2();
      if (!token) return;

      const nextUrl = `order-detail.html?code=${encodeURIComponent(orderCode)}`;
      window.location.href = nextUrl;

      return;
    }

    if (rebuyBtn) {
      const orderCode = (
        rebuyBtn.getAttribute("data-rebuy-order") || ""
      ).trim();
      if (!orderCode) return;

      const token = requireLoginForBE2();
      if (!token) return;

      rebuyBtn.disabled = true;
      const oldText = rebuyBtn.textContent;
      rebuyBtn.textContent = "Đang chuẩn bị...";

      try {
        const detail = await fetchOrderDetail(token, orderCode);
        const rawItems = Array.isArray(detail && detail.items)
          ? detail.items
          : [];
        const validItems = rawItems
          .map((it) => ({
            product_id:
              it && (it.product_id != null ? it.product_id : it.productId),
            quantity: it && (it.quantity != null ? it.quantity : it.qty),
          }))
          .filter(
            (it) =>
              Number(it.product_id || 0) > 0 && Number(it.quantity || 0) > 0,
          );
        if (validItems.length === 0) {
          window.alert(
            "Không thể mua lại: thiếu dữ liệu sản phẩm trong đơn hàng.",
          );
          return;
        }

        for (const it of validItems) {
          await addToCart(token, it.product_id, it.quantity);
        }

        try {
          sessionStorage.removeItem("order_idempotency_key");
        } catch {
          // ignore
        }

        window.location.href = "cart.html";
      } catch (err) {
        console.error(err);
        const msg =
          err && err.message
            ? String(err.message)
            : "Không thể mua lại đơn hàng.";
        window.alert(msg);
      } finally {
        rebuyBtn.disabled = false;
        rebuyBtn.textContent = oldText || "Mua lại";
      }

      return;
    }

    const btn = cancelBtn;

    const orderCode = (btn.getAttribute("data-cancel-order") || "").trim();
    if (!orderCode) return;

    // Check current server state; never infer payment from its provider name.
    const accessToken = requireLoginForBE2();
    if (!accessToken) return;
    try {
      const detail = await fetchOrderDetail(accessToken, orderCode);
      if (detail.requires_refund === true) {
        window.location.href = `momo-cancel.html?order_code=${encodeURIComponent(orderCode)}`;
        return;
      }
    } catch (error) {
      alert("Không tải được trạng thái đơn hàng. Vui lòng thử lại.");
      return;
    }

    const ok = window.confirm(`Bạn có chắc muốn hủy đơn ${orderCode}?`);
    if (!ok) return;

    const token = requireLoginForBE2();
    if (!token) return;

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "Đang hủy...";

    try {
      const result = await cancelOrder(token, orderCode);

      await loadOrdersFromBE2();
      const tab = _findTabElementForStatus("cancelled");
      filterOrders("cancelled", tab);

      const emailSent = !!(result && result.email_sent);
      const emailError =
        result && result.email_error ? String(result.email_error) : "";
      let emailText = "";
      if (emailSent) {
        emailText = "\nĐã gửi email thông báo hủy đơn.";
      } else if (emailError && emailError.startsWith("dev_email_mode:")) {
        const mode = emailError.split(":", 2)[1] || "";
        emailText = `\nEmail đang ở chế độ DEV (EMAIL_MODE=${mode}). Chưa gửi qua SMTP.`;
      } else if (emailError) {
        emailText = `\nChưa gửi được email (${emailError}).`;
      }
      window.alert(`Đã hủy đơn ${orderCode} thành công.${emailText}`);
    } catch (err) {
      console.error(err);
      const status = err && err.status ? String(err.status) : "";
      const msg =
        err && err.message ? String(err.message) : "Không thể hủy đơn hàng.";

      // Token hết hạn/không hợp lệ
      if (status === "401" || status === "422") {
        window.alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        try {
          window.location.href = "login.html";
        } catch {
          // ignore
        }
        return;
      }

      if (status === "405") {
        window.alert(
          "Không hủy được (405). Backend có thể đang chạy phiên bản cũ/chưa restart.\nHãy tắt backend (CTRL+C) và chạy lại: .\\.venv\\Scripts\\python.exe backend\\app.py",
        );
      } else {
        window.alert(msg);
      }

      // Refresh UI so user sees latest status (in case it already changed)
      try {
        await loadOrdersFromBE2();
        const currentTab = document.querySelector(
          ".stepper-header .step-item.active",
        );
        const activeText = (
          currentTab?.getAttribute("onclick") || ""
        ).toLowerCase();
        if (activeText.includes("processing"))
          filterOrders("processing", currentTab);
        else if (activeText.includes("shipping"))
          filterOrders("processing", currentTab);
        else if (activeText.includes("completed"))
          filterOrders("completed", currentTab);
        else if (activeText.includes("cancelled"))
          filterOrders("cancelled", currentTab);
        else filterOrders("all", currentTab);
      } catch {
        // ignore
      }
      btn.disabled = false;
      btn.textContent = oldText || "Hủy đơn hàng";
    }
  });

  _cancelHandlerBound = true;
}

function getStatusText(status) {
  const map = {
    processing: "Đang xử lý",
    shipping: "Đang giao hàng",
    completed: "Hoàn thành",
    cancelled: "Đã hủy",
  };
  return map[status] || "Không xác định";
}

function _renderLoadError(err) {
  const container = document.getElementById("orderListArea");
  if (!container) return;

  const msg =
    err && err.message ? String(err.message) : "Không thể tải đơn hàng.";
  const status = err && err.status ? String(err.status) : "";

  let hint = "";
  if (status === "401") {
    hint =
      "Gợi ý: bạn đang hết hạn đăng nhập hoặc token đang nằm ở origin khác (localhost/127.0.0.1).";
  } else if (status === "403") {
    hint = "Gợi ý: tài khoản có thể đang bị khóa hoặc không đủ quyền.";
  }

  container.innerHTML = `
        <div class="empty-notify">
            <i class="fas fa-triangle-exclamation" style="font-size: 36px; display: block; margin-bottom: 10px;"></i>
            <div style="font-weight:700; margin-bottom:6px;">Không thể tải đơn hàng</div>
            <div style="font-size:12px; color:#666; margin-bottom:10px;">${hint}</div>
            <div style="text-align:left; background:#fff; border:1px solid #eee; border-radius:12px; padding:10px; font-size:12px; color:#333; max-width:680px; margin:0 auto; overflow:auto;">
                <div><b>Chi tiết:</b> ${msg}</div>
            </div>
            <div style="margin-top:12px;">
                <a href="login.html" style="display:inline-block; padding:10px 14px; border-radius:10px; background:#d70018; color:#fff; text-decoration:none;">Đăng nhập lại</a>
            </div>
        </div>
    `;
}

function initTraCuu() {
  if (_initPromise) return _initPromise;

  bindCancelOrderHandler();

  const firstTab = document.querySelector(".step-item");
  _initPromise = loadOrdersFromBE2()
    .then(() => filterOrders("all", firstTab))
    .catch((e) => {
      console.error(e);
      if (e && e.message === "api-config-not-loaded") {
        const container = document.getElementById("orderListArea");
        if (container) {
          container.innerHTML = `<div class="empty-notify">Không thể tải đơn hàng: thiếu cấu hình API. Vui lòng tải lại trang.</div>`;
        }
        return;
      }
      _renderLoadError(e);
    });

  // Tự động làm mới danh sách đơn hàng sau mỗi 20 giây để cập nhật trạng thái mới nhất từ Admin
  setInterval(async () => {
    const activeTab = document.querySelector(".step-item.active");
    if (!activeTab) return;

    const onclickAttr = activeTab.getAttribute("onclick") || "";
    const statusMatch = onclickAttr.match(/'([^']+)'/);
    const status = statusMatch ? statusMatch[1] : "all";

    try {
      await loadOrdersFromBE2();
      filterOrders(status, activeTab);
    } catch (err) {
      console.warn("Tự động cập nhật đơn hàng thất bại:", err);
    }
  }, 20000);

  return _initPromise;
}

function resetInitForBFCache() {
  _initPromise = null;
}

// Khởi tạo trang: Mặc định hiện tất cả
function runInitWhenReady() {
  if (document.readyState !== "loading") {
    initTraCuu();
  } else {
    document.addEventListener("DOMContentLoaded", () => initTraCuu(), {
      once: true,
    });
  }
}

runInitWhenReady();

// Handle back-forward cache restores (Safari/Chrome)
window.addEventListener("pageshow", (event) => {
  if (event && event.persisted) {
    resetInitForBFCache();
    initTraCuu();
  }
});
