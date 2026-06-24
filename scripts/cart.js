function clearAuthAndGoLogin(message) {
  try {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
  } catch {
    // ignore
  }
  alert(message || "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!");
  window.location.href = "login.html";
}

function requireLogin() {
  const token = localStorage.getItem("token");
  if (!token) {
    alert("Bạn cần đăng nhập để xem giỏ hàng!");
    window.location.href = "login.html";
    return null;
  }
  return token;
}

async function fetchCart() {
  const token = requireLogin();
  if (!token) return null;

  const res = await fetch(window.apiUrl("/api/cart"), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((data && data.msg) || "").toLowerCase();
    if (
      res.status === 401 &&
      (msg.includes("expired") || msg.includes("token"))
    ) {
      clearAuthAndGoLogin();
      return null;
    }
    alert("Lỗi tải giỏ hàng: " + ((data && data.msg) || `HTTP ${res.status}`));
    return null;
  }

  return Array.isArray(data) ? data : [];
}

async function updateCartItem(itemId, quantity) {
  const token = requireLogin();
  if (!token) return false;

  const res = await fetch(window.apiUrl(`/api/cart/${itemId}`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ quantity }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((data && data.msg) || "").toLowerCase();
    if (
      res.status === 401 &&
      (msg.includes("expired") || msg.includes("token"))
    ) {
      clearAuthAndGoLogin();
      return false;
    }
    alert(
      "Lỗi cập nhật giỏ hàng: " + ((data && data.msg) || `HTTP ${res.status}`),
    );
    return false;
  }

  return true;
}

async function deleteCartItem(itemId) {
  const token = requireLogin();
  if (!token) return false;

  const res = await fetch(window.apiUrl(`/api/cart/${itemId}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((data && data.msg) || "").toLowerCase();
    if (
      res.status === 401 &&
      (msg.includes("expired") || msg.includes("token"))
    ) {
      clearAuthAndGoLogin();
      return false;
    }
    alert("Lỗi xóa sản phẩm: " + ((data && data.msg) || `HTTP ${res.status}`));
    return false;
  }

  return true;
}

function fmtMoney(v) {
  return (parseInt(v || 0, 10) || 0).toLocaleString("vi-VN") + "đ";
}

const CART_SELECTED_KEY = "checkout_selected_cart_item_ids";

function _loadSelectedIds() {
  try {
    const raw = sessionStorage.getItem(CART_SELECTED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => parseInt(x, 10)).filter((n) => !!n));
  } catch {
    return new Set();
  }
}

function _saveSelectedIds(selectedIds) {
  try {
    sessionStorage.setItem(
      CART_SELECTED_KEY,
      JSON.stringify(Array.from(selectedIds || [])),
    );
  } catch {
    // ignore
  }
}

function renderCart(items) {
  const list = document.getElementById("cartList");
  const totalEl = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const selectAllRow = document.getElementById("cartSelectAllRow");
  const selectAllCb = document.getElementById("cartSelectAll");

  if (!list || !totalEl || !checkoutBtn) return;

  if (!items || items.length === 0) {
    list.innerHTML = '<p class="cart-empty">Giỏ hàng trống.</p>';
    totalEl.textContent = "";
    checkoutBtn.disabled = true;
    _saveSelectedIds(new Set());
    if (selectAllRow) selectAllRow.style.display = "none";
    return;
  }

  if (selectAllRow) selectAllRow.style.display = "flex";

  // Selection state (persisted in sessionStorage)
  const selectedIds = _loadSelectedIds();
  const validIds = new Set(
    items.map((it) => parseInt(it.id || 0, 10)).filter((n) => !!n),
  );
  // Drop any stale ids
  Array.from(selectedIds).forEach((id) => {
    if (!validIds.has(id)) selectedIds.delete(id);
  });
  _saveSelectedIds(selectedIds);

  const selectedItems = items.filter((it) =>
    selectedIds.has(parseInt(it.id || 0, 10)),
  );
  const total = selectedItems.reduce(
    (sum, it) => sum + (parseInt(it.subtotal || 0, 10) || 0),
    0,
  );

  if (selectAllCb) {
    const selectedCount = selectedItems.length;
    const totalCount = items.length;
    selectAllCb.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    selectAllCb.checked = totalCount > 0 && selectedCount === totalCount;

    // Use assignment to avoid stacking listeners on re-render.
    selectAllCb.onchange = () => {
      const next = new Set();
      if (selectAllCb.checked) {
        items.forEach((it) => {
          const id = parseInt(it.id || 0, 10);
          if (id) next.add(id);
        });
      }
      _saveSelectedIds(next);
      renderCart(items);
    };
  }

  if (selectedItems.length > 0) {
    totalEl.textContent = "Tổng: " + fmtMoney(total);
    checkoutBtn.disabled = false;
  } else {
    totalEl.textContent = "";
    checkoutBtn.disabled = true;
  }

  list.innerHTML = items
    .map((it) => {
      const checked = selectedIds.has(parseInt(it.id || 0, 10));
      return `
        <div class="cart-row" data-item-id="${it.id}">
          <div class="cart-select">
            <input class="cart-check" type="checkbox" ${checked ? "checked" : ""} aria-label="Chọn sản phẩm" />
          </div>
          <img src="${it.img}" alt="${it.name}" />
          <div class="cart-meta">
            <div class="cart-name">${it.name}</div>
            <div class="cart-price">${fmtMoney(it.price)} • Tạm tính: ${fmtMoney(it.subtotal)}</div>
          </div>
          <div class="cart-actions">
            <div class="qty-stepper" aria-label="Số lượng">
              <button class="qty-btn" type="button" data-delta="-1" aria-label="Giảm số lượng">-</button>
              <span class="qty-val" aria-live="polite">${it.quantity}</span>
              <button class="qty-btn" type="button" data-delta="1" aria-label="Tăng số lượng">+</button>
            </div>
            <button class="btn-del" type="button" title="Xóa sản phẩm">
              <i class="fas fa-trash"></i>
              <span>Xóa</span>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".cart-check").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      const row = e.target.closest(".cart-row");
      const itemId = parseInt(row?.getAttribute("data-item-id") || "0", 10);
      if (!itemId) return;

      const selected = _loadSelectedIds();
      if (e.target.checked) selected.add(itemId);
      else selected.delete(itemId);
      _saveSelectedIds(selected);

      // Re-render totals + button states without refetch
      renderCart(items);
    });
  });

  list.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();

      const row = e.target.closest(".cart-row");
      const itemId = parseInt(row?.getAttribute("data-item-id") || "0", 10);
      if (!itemId) return;

      const stepper = row?.querySelector(".qty-stepper");
      const valEl = stepper?.querySelector(".qty-val");
      const currentQty = parseInt(valEl?.textContent || "1", 10) || 1;
      const delta = parseInt(btn.getAttribute("data-delta") || "0", 10) || 0;
      const nextQty = Math.max(1, currentQty + delta);
      if (nextQty === currentQty) return;

      const ok = await updateCartItem(itemId, nextQty);
      if (!ok) return;

      const refreshed = await fetchCart();
      if (refreshed) renderCart(refreshed);
    });
  });

  list.querySelectorAll(".btn-del").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const row = e.target.closest(".cart-row");
      const itemId = parseInt(row?.getAttribute("data-item-id") || "0", 10);
      if (!itemId) return;
      if (!confirm("Xóa sản phẩm này khỏi giỏ hàng?")) return;

      const ok = await deleteCartItem(itemId);
      if (!ok) return;

      const refreshed = await fetchCart();
      if (refreshed) renderCart(refreshed);
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const items = await fetchCart();
  if (items) renderCart(items);

  const checkoutBtn = document.getElementById("checkoutBtn");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      const selected = _loadSelectedIds();
      if (!selected || selected.size === 0) {
        alert("Vui lòng chọn ít nhất 1 sản phẩm để thanh toán.");
        return;
      }

      window.location.href = "order-information.html?cart=1";
    });
  }
});
