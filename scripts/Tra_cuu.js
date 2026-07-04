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
      const origin = (() => {
        try {
          return window.location.origin;
        } catch {
          return "";
        }
      })();
      container.innerHTML = `
                <div class="empty-notify">
                    <i class="fas fa-user-lock" style="font-size: 36px; display: block; margin-bottom: 10px;"></i>
                    <div style="font-weight:700; margin-bottom:6px;">Báº¡n chÆ°a Ä‘Äƒng nháº­p.</div>
                    <div style="font-size:12px; color:#666; margin-bottom:10px;">
                        LÆ°u Ã½: token chá»‰ lÆ°u theo Ä‘Ãºng Ä‘á»‹a chá»‰ website. Náº¿u báº¡n Ä‘Äƒng nháº­p á»Ÿ <b>localhost</b> nhÆ°ng Ä‘ang má»Ÿ Tra cá»©u á»Ÿ <b>127.0.0.1</b> (hoáº·c ngÆ°á»£c láº¡i) thÃ¬ sáº½ bá»‹ máº¥t token.
                        ${origin ? `<br/>Äá»‹a chá»‰ hiá»‡n táº¡i: <b>${origin}</b>` : ""}
                    </div>
                    <a href="login.html" style="display:inline-block; padding:10px 14px; border-radius:10px; background:#d70018; color:#fff; text-decoration:none;">ÄÄƒng nháº­p láº¡i</a>
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
    console.error("KhÃ´ng thá»ƒ táº£i danh sÃ¡ch sáº£n pháº©m:", e);
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
    const msg = data && data.msg ? data.msg : text || "KhÃ´ng thá»ƒ táº£i Ä‘Æ¡n hÃ ng";
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
    const msg = data && data.msg ? data.msg : text || "KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n hÃ ng";
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
    throw new Error("Dá»¯ liá»‡u sáº£n pháº©m khÃ´ng há»£p lá»‡");
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
      data && data.msg ? data.msg : text || "KhÃ´ng thá»ƒ thÃªm vÃ o giá» hÃ ng";
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
  if (!first) return { img: "../assets/img/LOGO1.png", name: "Sáº£n pháº©m", images: [] };
  
  const images = (items || []).map(it => {
    const product = it.product_id != null ? allProductsById[it.product_id] : null;
    return product && product.img ? product.img : "../assets/img/LOGO1.png";
  }).filter(Boolean);

  const product =
    first.product_id != null ? allProductsById[first.product_id] : null;
  return {
    img: product && product.img ? product.img : "../assets/img/LOGO1.png",
    name: first.name || (product && product.name) || "Sáº£n pháº©m",
    images: images
  };
}

/**
 * HÃ m render giao diá»‡n stack áº£nh xÃ²e bÃ i cho danh sÃ¡ch Ä‘Æ¡n hÃ ng
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
      // Náº¿u lÃ  áº£nh Ä‘Æ¡n, giá»¯ nguyÃªn khÃ´ng xoay Ä‘á»ƒ kÃ­ch thÆ°á»›c "khung" nhÃ¬n Ä‘á»“ng nháº¥t vá»›i stack
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
      container.innerHTML = `<div class="empty-notify">KhÃ´ng thá»ƒ táº£i Ä‘Æ¡n hÃ ng: thiáº¿u cáº¥u hÃ¬nh API. Vui lÃ²ng táº£i láº¡i trang.</div>`;
    }
    throw new Error("api-config-not-loaded");
  }

  const token = requireLoginForBE2();
  if (!token) return;

  const container = document.getElementById("orderListArea");
  if (container) {
    container.innerHTML = `<div class="empty-notify">Äang táº£i Ä‘Æ¡n hÃ ng...</div>`;
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

      // Cáº­p nháº­t tÃªn ngÆ°á»i dÃ¹ng náº¿u cÃ³
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

  // Cáº­p nháº­t tÃªn ngÆ°á»i dÃ¹ng náº¿u cÃ³
  const username = localStorage.getItem("username");
  if (username) {
    const el = document.getElementById("userNameDisplay");
    if (el) el.innerText = username;
  }
}

function filterOrders(status, element) {
  // Cáº­p nháº­t giao diá»‡n tab
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
    container.innerHTML = `<div class="empty-notify"><i class="fas fa-box-open" style="font-size: 40px; display: block; margin-bottom: 10px;"></i>ChÆ°a cÃ³ Ä‘Æ¡n hÃ ng nÃ o.</div>`;
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
        : `<div style="font-size:12px; color:#777; margin-top:4px;">(KhÃ´ng táº£i Ä‘Æ°á»£c chi tiáº¿t sáº£n pháº©m)</div>`;

      const totalText = formatMoneyVND(order.totalAmount || 0);
      const statusNorm = String(order.status || "").toLowerCase();
          const canCancel = statusNorm === "processing";
      const canRebuy = String(order.status || "").toLowerCase() === "cancelled";
      const viewBtnHtml = `<button type="button" class="btn-view-order" data-view-order="${order.orderCode}">Xem chi tiáº¿t</button>`;
      const cancelBtnHtml = canCancel
        ? `<button type="button" class="btn-cancel-order" data-cancel-order="${order.orderCode}">Há»§y Ä‘Æ¡n hÃ ng</button>`
        : "";
      const rebuyBtnHtml = canRebuy
        ? `<button type="button" class="btn-rebuy-order" data-rebuy-order="${order.orderCode}">Mua láº¡i</button>`
        : "";
      const actionsHtml = `<div class="order-actions">${viewBtnHtml}${cancelBtnHtml}${rebuyBtnHtml}</div>`;
      return `
        <div class="order-card-item">
            ${renderOrderImagesStack(order.productImages)}
            <div class="order-card-info">
                <h4>${order.productName}</h4>
                <p>MÃ£ Ä‘Æ¡n: <b>${order.orderCode}</b></p>
                <p>Sá»‘ lÆ°á»£ng: ${order.quantity || 0}</p>
                <p>Tráº¡ng thÃ¡i: <span style="color: #28a745;">${getStatusText(order.status)}</span></p>
                <p>NgÃ y Ä‘áº·t: ${order.orderDate || ""}</p>
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
      tabs.find((t) => (t.textContent || "").trim().toLowerCase() === "há»§y") ||
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
      rebuyBtn.textContent = "Äang chuáº©n bá»‹...";

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
            "KhÃ´ng thá»ƒ mua láº¡i: thiáº¿u dá»¯ liá»‡u sáº£n pháº©m trong Ä‘Æ¡n hÃ ng.",
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
            : "KhÃ´ng thá»ƒ mua láº¡i Ä‘Æ¡n hÃ ng.";
        window.alert(msg);
      } finally {
        rebuyBtn.disabled = false;
        rebuyBtn.textContent = oldText || "Mua láº¡i";
      }

      return;
    }

    const btn = cancelBtn;

    const orderCode = (btn.getAttribute("data-cancel-order") || "").trim();
    if (!orderCode) return;

    // For MoMo orders: open refund request form instead of cancelling immediately.
    const meta = (cachedOrders || []).find((o) => o && o.orderCode === orderCode);
    let method = String((meta && meta.paymentMethod) || "").toLowerCase();
    let isMomo = method === "momo";

    // If we couldn't determine from cache (legacy orders), fetch detail to infer.
    if (!isMomo) {
      try {
        const token = requireLoginForBE2();
        if (!token) return;
        const detail = await fetchOrderDetail(token, orderCode);
        const pm = String((detail && detail.payment_method) || "").toLowerCase();
        const p1 = detail && detail.payment_initial ? detail.payment_initial : null;
        const p2 = detail && detail.payment_latest ? detail.payment_latest : null;
        const p3 = detail && detail.payment ? detail.payment : null;
        const pr1 = String((p1 && p1.provider) || "").toLowerCase();
        const pr2 = String((p2 && p2.provider) || "").toLowerCase();
        const pr3 = String((p3 && p3.provider) || "").toLowerCase();
        isMomo = pm === "momo" || pr1 === "momo" || pr2 === "momo" || pr3 === "momo";
        method = pm || method;
      } catch {
        // ignore and fall back to normal cancel
      }
    }

    if (isMomo) {
      const nextUrl = `momo-cancel.html?order_code=${encodeURIComponent(orderCode)}`;
      window.location.href = nextUrl;
      return;
    }

    const ok = window.confirm(`Báº¡n cÃ³ cháº¯c muá»‘n há»§y Ä‘Æ¡n ${orderCode}?`);
    if (!ok) return;

    const token = requireLoginForBE2();
    if (!token) return;

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "Äang há»§y...";

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
        emailText = "\nÄÃ£ gá»­i email thÃ´ng bÃ¡o há»§y Ä‘Æ¡n.";
      } else if (emailError && emailError.startsWith("dev_email_mode:")) {
        const mode = emailError.split(":", 2)[1] || "";
        emailText = `\nEmail Ä‘ang á»Ÿ cháº¿ Ä‘á»™ DEV (EMAIL_MODE=${mode}). ChÆ°a gá»­i qua SMTP.`;
      } else if (emailError) {
        emailText = `\nChÆ°a gá»­i Ä‘Æ°á»£c email (${emailError}).`;
      }
      window.alert(`ÄÃ£ há»§y Ä‘Æ¡n ${orderCode} thÃ nh cÃ´ng.${emailText}`);
    } catch (err) {
      console.error(err);
      const status = err && err.status ? String(err.status) : "";
      const msg =
        err && err.message ? String(err.message) : "KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n hÃ ng.";

      // Token háº¿t háº¡n/khÃ´ng há»£p lá»‡
      if (status === "401" || status === "422") {
        window.alert("PhiÃªn Ä‘Äƒng nháº­p Ä‘Ã£ háº¿t háº¡n. Vui lÃ²ng Ä‘Äƒng nháº­p láº¡i.");
        try {
          window.location.href = "login.html";
        } catch {
          // ignore
        }
        return;
      }

      if (status === "405") {
        window.alert(
          "KhÃ´ng há»§y Ä‘Æ°á»£c (405). Backend cÃ³ thá»ƒ Ä‘ang cháº¡y phiÃªn báº£n cÅ©/chÆ°a restart.\nHÃ£y táº¯t backend (CTRL+C) vÃ  cháº¡y láº¡i: .\\.venv\\Scripts\\python.exe backend\\app.py",
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
      btn.textContent = oldText || "Há»§y Ä‘Æ¡n hÃ ng";
    }
  });

  _cancelHandlerBound = true;
}

function getStatusText(status) {
  const map = {
    processing: "Äang xá»­ lÃ½",
    shipping: "Äang giao hÃ ng",
    completed: "HoÃ n thÃ nh",
    cancelled: "ÄÃ£ há»§y",
  };
  return map[status] || "KhÃ´ng xÃ¡c Ä‘á»‹nh";
}

function _renderLoadError(err) {
  const container = document.getElementById("orderListArea");
  if (!container) return;

  const msg =
    err && err.message ? String(err.message) : "KhÃ´ng thá»ƒ táº£i Ä‘Æ¡n hÃ ng.";
  const status = err && err.status ? String(err.status) : "";

  let hint = "";
  if (status === "401") {
    hint =
      "Gá»£i Ã½: báº¡n Ä‘ang háº¿t háº¡n Ä‘Äƒng nháº­p hoáº·c token Ä‘ang náº±m á»Ÿ origin khÃ¡c (localhost/127.0.0.1).";
  } else if (status === "403") {
    hint = "Gá»£i Ã½: tÃ i khoáº£n cÃ³ thá»ƒ Ä‘ang bá»‹ khÃ³a hoáº·c khÃ´ng Ä‘á»§ quyá»n.";
  }

  container.innerHTML = `
        <div class="empty-notify">
            <i class="fas fa-triangle-exclamation" style="font-size: 36px; display: block; margin-bottom: 10px;"></i>
            <div style="font-weight:700; margin-bottom:6px;">KhÃ´ng thá»ƒ táº£i Ä‘Æ¡n hÃ ng</div>
            <div style="font-size:12px; color:#666; margin-bottom:10px;">${hint}</div>
            <div style="text-align:left; background:#fff; border:1px solid #eee; border-radius:12px; padding:10px; font-size:12px; color:#333; max-width:680px; margin:0 auto; overflow:auto;">
                <div><b>Chi tiáº¿t:</b> ${msg}</div>
            </div>
            <div style="margin-top:12px;">
                <a href="login.html" style="display:inline-block; padding:10px 14px; border-radius:10px; background:#d70018; color:#fff; text-decoration:none;">ÄÄƒng nháº­p láº¡i</a>
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
          container.innerHTML = `<div class="empty-notify">KhÃ´ng thá»ƒ táº£i Ä‘Æ¡n hÃ ng: thiáº¿u cáº¥u hÃ¬nh API. Vui lÃ²ng táº£i láº¡i trang.</div>`;
        }
        return;
      }
      _renderLoadError(e);
    });

  // Tá»± Ä‘á»™ng lÃ m má»›i danh sÃ¡ch Ä‘Æ¡n hÃ ng sau má»—i 20 giÃ¢y Ä‘á»ƒ cáº­p nháº­t tráº¡ng thÃ¡i má»›i nháº¥t tá»« Admin
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
      console.warn("Tá»± Ä‘á»™ng cáº­p nháº­t Ä‘Æ¡n hÃ ng tháº¥t báº¡i:", err);
    }
  }, 20000);

  return _initPromise;
}

function resetInitForBFCache() {
  _initPromise = null;
}

// Khá»Ÿi táº¡o trang: Máº·c Ä‘á»‹nh hiá»‡n táº¥t cáº£
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
