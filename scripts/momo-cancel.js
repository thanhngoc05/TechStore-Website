function _getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return (url.searchParams.get(name) || "").trim();
  } catch {
    return "";
  }
}

function _isValidEmail(email) {
  const val = String(email || "").trim();
  if (!val) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

document.addEventListener("DOMContentLoaded", () => {
  const orderCodeInput = document.getElementById("orderCode");
  const nameInput = document.getElementById("customerName");
  const phoneInput = document.getElementById("customerPhone");
  const emailInput = document.getElementById("customerEmail");
  const bankNameInput = document.getElementById("bankName");
  const accNoInput = document.getElementById("bankAccountNumber");
  const accHolderInput = document.getElementById("bankAccountHolder");
  const noteInput = document.getElementById("refundNote");
  const form = document.getElementById("refundForm");
  const submitBtn = document.getElementById("submitRefundBtn");
  const backHomeBtn = document.getElementById("backHomeBtn");

  const orderFromQuery = _getQueryParam("order_code");
  if (orderFromQuery && orderCodeInput) {
    orderCodeInput.value = orderFromQuery;
    try {
      orderCodeInput.readOnly = true;
    } catch {
      // ignore
    }
  }

  if (backHomeBtn) {
    backHomeBtn.addEventListener("click", () => {
      window.location.href = "index.html";
    });
  }

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const order_code = String(orderCodeInput?.value || "").trim();
    const name = String(nameInput?.value || "").trim();
    const phone = String(phoneInput?.value || "").trim();
    const email = String(emailInput?.value || "").trim();
    const bank_name = String(bankNameInput?.value || "").trim();
    const account_number = String(accNoInput?.value || "").trim();
    const account_holder = String(accHolderInput?.value || "").trim();
    const note = String(noteInput?.value || "").trim();

    if (
      !order_code ||
      !name ||
      !phone ||
      !bank_name ||
      !account_number ||
      !account_holder
    ) {
      alert("Vui lòng nhập đầy đủ thông tin bắt buộc!");
      return;
    }

    if (!_isValidEmail(email)) {
      alert("Định dạng Email không hợp lệ!");
      return;
    }

    const payload = {
      order_code,
      name,
      phone,
      email,
      bank_name,
      account_number,
      account_holder,
      note,
      payment_method: "momo",
    };

    const oldText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Đang gửi...";
    }

    try {
      const res = await fetch(window.apiUrl("/api/public/refund-request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert("Gửi yêu cầu thất bại: " + (data.msg || "Lỗi"));
        return;
      }

      // Try to cancel the order as well (best-effort).
      let cancelled = false;
      let cancelError = "";
      try {
        const token = localStorage.getItem("token");
        if (token) {
          const encoded = encodeURIComponent(order_code);
          const r2 = await fetch(
            window.apiUrl(`/api/orders/${encoded}/cancel`),
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (r2.ok) {
            cancelled = true;
          } else {
            const t2 = await r2.text();
            const j2 = (() => {
              try {
                return JSON.parse(t2);
              } catch {
                return null;
              }
            })();
            cancelError =
              j2 && j2.msg ? String(j2.msg) : t2 || `HTTP ${r2.status}`;
          }
        }
      } catch (e2) {
        cancelError = e2 && e2.message ? String(e2.message) : "";
      }

      if (cancelled) {
        alert("Đã gửi yêu cầu hoàn tiền và đã hủy đơn hàng thành công!");
        window.location.href = "Tra_cuu.html";
      } else {
        const extra = cancelError
          ? `\n(Lưu ý: Chưa hủy tự động được: ${cancelError})`
          : "";
        alert("Đã gửi yêu cầu hoàn tiền thành công!" + extra);
        window.location.href = "Tra_cuu.html";
      }
    } catch (err) {
      console.error(err);
      alert("Không thể kết nối đến server!");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = oldText || "Gửi yêu cầu hoàn tiền";
      }
    }
  });
});
