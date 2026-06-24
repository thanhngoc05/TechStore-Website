function formatMoneyVND(value) {
  const n = Number(value || 0);
  try {
    return n.toLocaleString("vi-VN");
  } catch {
    return String(n);
  }
}

function getStatusText(status) {
  const map = {
    processing: "Đang xử lý",
    shipping: "Đang giao",
    completed: "Hoàn thành",
    cancelled: "Đã hủy",
  };
  return map[String(status || "").toLowerCase()] || "Không xác định";
}

function getPaymentMethodText(method) {
  const m = String(method || "").toLowerCase();
  if (m === "momo") return "Ví MoMo";
  if (m === "cod") return "Thanh toán khi nhận hàng (COD)";
  if (m === "mock") return "Thanh toán (Mock)";
  return safeText(method);
}

function getPaymentStatusText(status) {
  const s = String(status || "").toLowerCase();
  if (s === "success") return "Đã thanh toán";
  if (s === "failed") return "Thất bại";
  if (s === "pending") return "Chờ thanh toán";
  if (s === "unpaid") return "Chưa thanh toán";
  if (s === "pending_transfer") return "Chờ thanh toán";
  return safeText(status);
}

function getPaymentStatusTextByMethod(status, method) {
  const m = String(method || "").toLowerCase();
  const s = String(status || "").toLowerCase();

  // Preserve explicit failures if they exist.
  if (s === "failed") return "Thất bại";

  // Per requirement: only COD is "Chờ thanh toán"; MoMo is treated as "Đã thanh toán".
  if (m === "cod") return "Chờ thanh toán";
  if (m === "momo") return "Đã thanh toán";

  return getPaymentStatusText(status);
}

function safeText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function resolveProductImgSrc(src) {
  const s = (src || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return s;
  if (s.startsWith("../assets/")) return s.replace(/^\.\.\//, "/");
  if (s.startsWith("./assets/")) return s.replace(/^\.\//, "/");
  return s;
}

function getOrderCodeFromUrl() {
  const qs = new URLSearchParams(window.location.search);
  const code = (qs.get("code") || qs.get("order_code") || "").trim();
  return code;
}

function requireLoginToken() {
  const token = localStorage.getItem("token");
  if (!token) {
    const area = document.getElementById("orderDetailArea");
    if (area) {
      area.innerHTML = `<div class="empty-notify">Bạn chưa đăng nhập. Đang chuyển sang trang đăng nhập...</div>`;
    }
    setTimeout(() => {
      try {
        window.location.href = "login.html";
      } catch {
        // ignore
      }
    }, 400);
    return null;
  }
  return token;
}

async function fetchOrderDetail(token, orderCode) {
  if (typeof window.apiUrl !== "function")
    throw new Error("api-config-not-loaded");

  const res = await fetch(
    window.apiUrl(`/api/orders/${encodeURIComponent(orderCode)}`),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg =
      data && data.msg ? data.msg : text || "Không thể tải chi tiết đơn hàng";
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.raw = data || text;
    throw err;
  }

  return data;
}

async function cancelOrder(token, orderCode) {
  if (typeof window.apiUrl !== "function")
    throw new Error("api-config-not-loaded");

  const res = await fetch(
    window.apiUrl(`/api/orders/${encodeURIComponent(orderCode)}/cancel`),
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data && data.msg ? data.msg : text || "Không thể hủy đơn hàng";
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.raw = data || text;
    throw err;
  }

  return data;
}
 
async function downloadInvoicePdf(token, orderCode) {
    if (typeof window.apiUrl !== "function") return;
    
    const res = await fetch(window.apiUrl(`/api/orders/${encodeURIComponent(orderCode)}/invoice.pdf`), {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
        const txt = await res.text();
        let msg = "Không thể tải hóa đơn";
        try {
            const j = JSON.parse(txt);
            msg = j.msg || msg;
        } catch {}
        throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${orderCode}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function renderOrderActions(detail) {
  const area = document.getElementById("orderDetailArea");
  if (!area) return;

  const code = safeText(detail.order_code);
  const status = String(detail.status || "").toLowerCase();
  const canCancel = status === "processing";
  const isCompleted = status === "completed";

  const paymentMethod = String(detail.payment_method || "").toLowerCase();
  const p1 = detail && detail.payment_initial ? detail.payment_initial : null;
  const p2 = detail && detail.payment_latest ? detail.payment_latest : null;
  const p3 = detail && detail.payment ? detail.payment : null;
  const provider1 = String((p1 && p1.provider) || "").toLowerCase();
  const provider2 = String((p2 && p2.provider) || "").toLowerCase();
  const provider3 = String((p3 && p3.provider) || "").toLowerCase();
  const isMomo =
    paymentMethod === "momo" ||
    provider1 === "momo" ||
    provider2 === "momo" ||
    provider3 === "momo";

  const actionsEl = document.createElement("div");
  actionsEl.className = "od-actions";
  actionsEl.innerHTML = canCancel
    ? `<button type="button" class="od-btn od-btn-danger" id="odCancelBtn"><i class="fas fa-ban"></i> Hủy đơn hàng</button>`
    : "";
    
  if (isCompleted) {
    const invoiceBtn = document.createElement("button");
    invoiceBtn.type = "button";
    invoiceBtn.className = "od-btn";
    invoiceBtn.style.backgroundColor = "#1a234a";
    invoiceBtn.style.color = "#fff";
    invoiceBtn.id = "odInvoiceBtn";
    invoiceBtn.innerHTML = `<i class="fas fa-file-pdf"></i> Tải hóa đơn (PDF)`;
    actionsEl.appendChild(invoiceBtn);
    
    invoiceBtn.addEventListener("click", async () => {
        const token = requireLoginToken();
        if (!token) return;
        invoiceBtn.disabled = true;
        const original = invoiceBtn.innerHTML;
        invoiceBtn.innerHTML = "Đang tạo PDF...";
        try {
            await downloadInvoicePdf(token, code);
        } catch (err) {
            alert(err.message);
        } finally {
            invoiceBtn.disabled = false;
            invoiceBtn.innerHTML = original;
        }
    });
  }

  if (canCancel) {
    actionsEl
      .querySelector("#odCancelBtn")
      ?.addEventListener("click", async () => {
        if (!code) return;

        // MoMo orders: open refund request form instead of cancelling immediately.
        if (isMomo) {
          const nextUrl = `/momo-cancel.html?order_code=${encodeURIComponent(code)}`;
          window.location.href = nextUrl;
          return;
        }

        const ok = window.confirm(`Bạn có chắc muốn hủy đơn ${code}?`);
        if (!ok) return;

        const token = requireLoginToken();
        if (!token) return;

        const btn = actionsEl.querySelector("#odCancelBtn");
        if (btn) {
          btn.disabled = true;
          btn.dataset.oldText = btn.innerHTML;
          btn.innerHTML = "Đang hủy...";
        }

        try {
          const result = await cancelOrder(token, code);
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

          window.alert(`Đã hủy đơn ${code} thành công.${emailText}`);

          // Reload detail after cancel
          const next = await fetchOrderDetail(token, code);
          renderOrderDetail(next);
        } catch (err) {
          console.error(err);
          const msg =
            err && err.message
              ? String(err.message)
              : "Không thể hủy đơn hàng.";
          window.alert(msg);
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML =
              btn.dataset.oldText || '<i class="fas fa-ban"></i> Hủy đơn hàng';
          }
        }
      });
  }

  // Insert actions at the top of the detail area
  area.prepend(actionsEl);
}

function renderOrderDetail(detail) {
  const area = document.getElementById("orderDetailArea");
  if (!area) return;

  const orderCode = safeText(detail.order_code);
  const status = safeText(detail.status);
  const createdAt = safeText(detail.created_at);
  const totalAmount = detail.total_amount || 0;

  const subtitle = document.getElementById("od-subtitle");
  if (subtitle) {
    subtitle.textContent = orderCode
      ? `Mã đơn: ${orderCode} • ${getStatusText(status)}${createdAt ? ` • ${createdAt}` : ""}`
      : "";
  }

  try {
    if (orderCode) document.title = `Đơn ${orderCode} - NexTech`;
  } catch {
    // ignore
  }

  const cust = detail.customer || {};
  const items = Array.isArray(detail.items) ? detail.items : [];
  const payInitial = detail.payment_initial || null;
  const payLatest = detail.payment_latest || detail.payment || null;

  const itemsHtml = items.length
    ? items
        .map((it) => {
          const qty = Number(it.quantity) || 0;
          const unit = Number(it.price) || 0;
          const sub = Number(it.subtotal) || unit * qty;
          const imgSrc = resolveProductImgSrc(it.img);
          const imgHtml = imgSrc
            ? `<img class="od-item-img" src="${imgSrc}" alt="${safeText(it.name || it.product_name)}" loading="lazy" />`
            : `<div class="od-item-img od-item-img--empty"><i class="fas fa-image"></i></div>`;

          return `
            <div class="od-item">
              ${imgHtml}
              <div class="od-item-info">
                <div class="name">${safeText(it.name || it.product_name)}</div>
                <div class="meta">SL: ${qty} • Đơn giá: ${formatMoneyVND(unit)} VND</div>
              </div>
              <div class="price">${formatMoneyVND(sub)} VND</div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty-notify" style="padding: 18px;">Không có dữ liệu sản phẩm.</div>`;

  function paymentBlock(title, pay) {
    if (!pay) return "";
    const effectiveMethod = pay.provider || detail.payment_method || pay.method;
    return `
      <div class="od-pay-block">
        <div class="od-pay-title">${title}</div>
        <div class="od-kv">
          <div class="k">Phương thức</div><div>${getPaymentMethodText(effectiveMethod)}</div>
          <div class="k">Trạng thái</div><div>${getPaymentStatusTextByMethod(pay.status, effectiveMethod)}</div>
          ${pay.payment_ref ? `<div class="k">Mã thanh toán</div><div>${safeText(pay.payment_ref)}</div>` : ""}
          ${pay.amount != null ? `<div class="k">Số tiền</div><div>${formatMoneyVND(pay.amount)} VND</div>` : ""}
          ${pay.created_at ? `<div class="k">Tạo lúc</div><div>${safeText(pay.created_at)}</div>` : ""}
          ${pay.updated_at ? `<div class="k">Cập nhật</div><div>${safeText(pay.updated_at)}</div>` : ""}
        </div>
      </div>
    `;
  }

  const hasInitial = !!(
    payInitial &&
    (payInitial.payment_ref || payInitial.provider || payInitial.status)
  );
  const hasLatest = !!(
    payLatest &&
    (payLatest.payment_ref || payLatest.provider || payLatest.status)
  );
  const showBoth =
    hasInitial &&
    hasLatest &&
    payInitial.payment_ref &&
    payLatest.payment_ref &&
    String(payInitial.payment_ref) !== String(payLatest.payment_ref);

  let paymentHtml = "";
  if (!hasInitial && !hasLatest) {
    paymentHtml = `<div style="font-size: 13px; color: #666;">(Chưa có thông tin thanh toán)</div>`;
  } else if (showBoth) {
    paymentHtml =
      paymentBlock("Thanh toán ban đầu", payInitial) +
      paymentBlock("Thanh toán hiện tại", payLatest);
  } else if (hasInitial) {
    paymentHtml = paymentBlock("Thanh toán ban đầu", payInitial);
  } else {
    paymentHtml = paymentBlock("Thanh toán", payLatest);
  }

  area.innerHTML = `
    <div class="od-actions"></div>
    <div class="od-section">
      <h4><i class="fas fa-receipt"></i> Thông tin đơn hàng</h4>
      <div class="od-kv">
        <div class="k">Mã đơn</div><div><b>${orderCode}</b></div>
        <div class="k">Trạng thái</div><div>${getStatusText(status)}</div>
        <div class="k">Ngày đặt</div><div>${createdAt || ""}</div>
        <div class="k">Tổng tiền</div><div><span style="color:#ff0000; font-weight:800;">${formatMoneyVND(totalAmount)} VND</span></div>
      </div>
    </div>

    <div class="od-section">
      <h4><i class="fas fa-user"></i> Thông tin khách hàng</h4>
      <div class="od-kv">
        <div class="k">Họ tên</div><div>${safeText(cust.name)}</div>
        <div class="k">SĐT</div><div>${safeText(cust.phone)}</div>
        <div class="k">Email</div><div>${safeText(cust.email)}</div>
        <div class="k">Địa chỉ</div><div>${safeText(cust.address)}</div>
      </div>
    </div>

    <div class="od-section">
      <h4><i class="fas fa-box"></i> Sản phẩm</h4>
      <div class="od-items">${itemsHtml}</div>
    </div>

    <div class="od-section">
      <h4><i class="fas fa-credit-card"></i> Thanh toán</h4>
      ${paymentHtml}
    </div>
  `;

  // Actions (cancel) rendered after the main HTML is in place
  renderOrderActions(detail);
}

function renderError(err) {
  const area = document.getElementById("orderDetailArea");
  if (!area) return;

  const msg =
    err && err.message
      ? safeText(err.message)
      : "Không thể tải chi tiết đơn hàng.";
  const status = err && err.status ? safeText(err.status) : "";

  let hint = "";
  if (status === "401" || status === "422") {
    hint = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  }

  area.innerHTML = `
    <div class="empty-notify">
      <i class="fas fa-triangle-exclamation" style="font-size: 36px; display: block; margin-bottom: 10px;"></i>
      <div style="font-weight:700; margin-bottom:6px;">Không thể tải chi tiết đơn hàng</div>
      <div style="font-size:12px; color:#666; margin-bottom:10px;">${hint}</div>
      <div style="text-align:left; background:#fff; border:1px solid #eee; border-radius:12px; padding:10px; font-size:12px; color:#333; max-width:680px; margin:0 auto; overflow:auto;">
        <div><b>Chi tiết:</b> ${msg}</div>
      </div>
      <div style="margin-top:12px;">
        <a href="Tra_cuu.html" style="display:inline-block; padding:10px 14px; border-radius:10px; background:#d70018; color:#fff; text-decoration:none;">Quay lại Tra cứu</a>
      </div>
    </div>
  `;
}

async function initOrderDetail() {
  const code = getOrderCodeFromUrl();
  const area = document.getElementById("orderDetailArea");
  if (!code) {
    if (area)
      area.innerHTML = `<div class="empty-notify">Thiếu mã đơn hàng.</div>`;
    return;
  }

  const username = localStorage.getItem("username");
  if (username) {
    const el = document.getElementById("userNameDisplay");
    if (el) el.innerText = username;
  }

  const token = requireLoginToken();
  if (!token) return;

  if (area)
    area.innerHTML = `<div class="empty-notify">Đang tải chi tiết đơn hàng...</div>`;

  try {
    const detail = await fetchOrderDetail(token, code);
    renderOrderDetail(detail);
  } catch (err) {
    console.error(err);
    renderError(err);

    const status = err && err.status ? String(err.status) : "";
    if (status === "401" || status === "422") {
      setTimeout(() => {
        try {
          window.location.href = "login.html";
        } catch {
          // ignore
        }
      }, 400);
    }
  }
}

if (document.readyState !== "loading") {
  initOrderDetail();
} else {
  document.addEventListener("DOMContentLoaded", initOrderDetail, {
    once: true,
  });
}
