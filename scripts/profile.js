(function initProfilePage() {
  function apiUrl(path) {
    if (typeof window.apiUrl === "function") return window.apiUrl(path);
    return path;
  }

  function getToken() {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Vui lòng đăng nhập để xem thông tin!");
      try {
        window.location.href = "/login.html";
      } catch {
        window.location.href = "login.html";
      }
      return null;
    }
    return token;
  }

  async function loadProfile() {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(apiUrl("/api/profile"), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 401) {
        alert("Phiên đăng nhập hết hạn!");
        try {
          window.location.href = "/login.html";
        } catch {
          window.location.href = "login.html";
        }
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("Lỗi: " + (data.msg || "Không thể tải thông tin"));
        return;
      }

      const username = data.username || "";
      const email = data.email || "";
      const phone = data.phone || "";
      const address = data.address || "";

      const usernameEl = document.getElementById("username");
      const emailEl = document.getElementById("email");
      const phoneEl = document.getElementById("phone");
      const addressEl = document.getElementById("address");

      if (usernameEl) usernameEl.value = username;
      if (emailEl) emailEl.value = email;
      if (phoneEl) phoneEl.value = phone;
      if (addressEl) addressEl.value = address;

      const displayName = document.getElementById("display-name");
      const displayEmail = document.getElementById("display-email");
      const avatarInitial = document.getElementById("avatar-initial");

      if (displayName) displayName.innerText = username || "User";
      if (displayEmail) displayEmail.innerText = email || "Chưa có email";
      if (avatarInitial)
        avatarInitial.innerText = (username || "U").charAt(0).toUpperCase();
    } catch (error) {
      console.error("Lỗi khi tải Profile:", error);
      alert("Không thể kết nối đến máy chủ!");
    }
  }

  async function updateProfile() {
    const token = getToken();
    if (!token) return;

    const phone = (document.getElementById("phone")?.value || "").trim();
    const address = (document.getElementById("address")?.value || "").trim();
    const old_password = document.getElementById("old_password")?.value || "";
    const new_password = document.getElementById("new_password")?.value || "";
    const confirm_password =
      document.getElementById("confirm_password")?.value || "";

    const body = {
      phone,
      address,
    };

    if (new_password) {
      if (!old_password) {
        alert("Bạn phải nhập mật khẩu cũ để thiết lập mật khẩu mới!");
        return;
      }
      if (new_password !== confirm_password) {
        alert("Mật khẩu xác nhận không khớp!");
        return;
      }
      if (String(new_password).length < 6) {
        alert("Mật khẩu mới phải từ 6 ký tự!");
        return;
      }
      body.old_password = old_password;
      body.new_password = new_password;
    }

    try {
      const res = await fetch(apiUrl("/api/profile/update"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const result = await res.json().catch(() => ({}));

      if (res.ok) {
        alert("Cập nhật thông tin thành công!");

        const oldEl = document.getElementById("old_password");
        const newEl = document.getElementById("new_password");
        const confirmEl = document.getElementById("confirm_password");
        if (oldEl) oldEl.value = "";
        if (newEl) newEl.value = "";
        if (confirmEl) confirmEl.value = "";

        await loadProfile();
      } else {
        alert("Lỗi: " + (result.msg || "Không thể cập nhật"));
      }
    } catch (error) {
      console.error("Update profile failed:", error);
      alert("Lỗi kết nối Backend!");
    }
  }

  // Expose for inline onclick
  window.updateProfile = updateProfile;

  document.addEventListener("DOMContentLoaded", loadProfile);
})();
