function isValidEmail(email) {
  const v = String(email || "").trim();
  const emailRegex = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
  return emailRegex.test(v);
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  const nameEl = document.getElementById("contactName");
  const emailEl = document.getElementById("contactEmail");
  const msgEl = document.getElementById("contactMessage");
  const btn = document.getElementById("contactSubmit");

  if (!form || !nameEl || !emailEl || !msgEl || !btn) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = String(nameEl.value || "").trim();
    const email = String(emailEl.value || "").trim();
    const message = String(msgEl.value || "").trim();

    if (!name || !message) {
      alert("Vui lòng nhập Họ tên và Nội dung!");
      return;
    }

    if (email && !isValidEmail(email)) {
      alert("Định dạng Email không hợp lệ!");
      return;
    }

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "ĐANG GỬI...";

    try {
      const res = await fetch(window.apiUrl("/api/public/contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("Lỗi: " + ((data && data.msg) || `HTTP ${res.status}`));
        return;
      }

      alert((data && data.msg) || "Gửi yêu cầu thành công!");
      form.reset();
    } catch (err) {
      console.error("Contact send failed:", err);
      alert("Không thể kết nối đến server!");
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
});
