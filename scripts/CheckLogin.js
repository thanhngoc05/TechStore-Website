function clearStorefrontSession() {
  for (const key of ["token", "role", "username", "last_order_code"]) {
    localStorage.removeItem(key);
  }
  for (const key of ["checkout_order_code", "checkout_selected_cart_item_ids", "order_idempotency_key"]) {
    sessionStorage.removeItem(key);
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const userDisplay = document.getElementById("user-display");
  const username = localStorage.getItem("username");

  if (!userDisplay || !username || !localStorage.getItem("token")) return;

  userDisplay.href = "profile.html";
  userDisplay.innerHTML = '<i class="fas fa-user-circle" aria-hidden="true"></i><span></span>';
  userDisplay.querySelector("span").textContent = username;

  const logout = document.createElement("button");
  logout.type = "button";
  logout.id = "logout-btn";
  logout.className = "logout-btn";
  logout.setAttribute("aria-label", "Đăng xuất");
  logout.textContent = "Thoát";
  logout.addEventListener("click", function () {
    clearStorefrontSession();
    alert("Đã đăng xuất!");
    window.location.href = "index.html";
  });
  userDisplay.after(logout);
});
