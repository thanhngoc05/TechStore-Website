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
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Vui lòng đăng nhập để gửi yêu cầu hoàn tiền.");
      window.location.href = "login.html";
      return;
    }

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
    };

    const oldText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Đang gửi...";
    }

    try {
      const res = await fetch(window.apiUrl("/api/public/refund-request"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert("Gửi yêu cầu thất bại: " + (data.msg || "Lỗi"));
        return;
      }

      alert("Đã gửi yêu cầu hoàn tiền. Bộ phận hỗ trợ sẽ kiểm tra và phản hồi; đơn hàng chưa được hủy tự động.");
      window.location.href = "Tra_cuu.html";
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
