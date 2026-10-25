(function initPasswordReset() {
  const form = document.getElementById("resetPasswordForm");
  if (!form) return;
  const password = document.getElementById("newPassword");
  const confirmation = document.getElementById("confirmPassword");
  const button = document.getElementById("resetPasswordButton");
  const message = document.getElementById("resetMessage");
  const token = new URLSearchParams(window.location.search).get("token") || "";
  let submitting = false;
  let completed = false;

  if (token) {
    try { window.history.replaceState(null, "", window.location.pathname); } catch {}
  } else {
    message.textContent = "Thiếu liên kết xác nhận. Vui lòng quay lại đăng nhập và yêu cầu email mới.";
    button.disabled = true;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!token || submitting || completed) return;
    if (password.value !== confirmation.value) {
      message.textContent = "Hai mật khẩu không khớp.";
      return;
    }
    if (password.value.length < 6 || new TextEncoder().encode(password.value).length > 72) {
      message.textContent = "Mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte UTF-8.";
      return;
    }
    submitting = true;
    button.disabled = true;
    message.textContent = "Đang cập nhật mật khẩu...";
    try {
      const response = await fetch(window.apiUrl("/api/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password.value }),
      });
      const data = await response.json();
      message.textContent = data.msg || "Không thể đặt lại mật khẩu. Vui lòng yêu cầu liên kết mới.";
      if (response.ok) {
        completed = true;
        password.value = "";
        confirmation.value = "";
      }
    } catch {
      message.textContent = "Không thể kết nối. Vui lòng thử lại khi có mạng.";
    } finally {
      submitting = false;
      button.disabled = completed;
    }
  });
})();
