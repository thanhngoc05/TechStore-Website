/**
 * NEXTECH - SCRIPTS.JS (FINAL OPTIMIZED FOR BANNERS & PRODUCTS)
 */
 
let allProducts = {};
let currentProducts = [];

// 1. Hàm tổng hợp lấy dữ liệu (Sản phẩm & Banner)
async function fetchDataFromDB() {
  try {
    // Lấy danh sách sản phẩm
    const productRes = await fetch(window.apiUrl("/api/public/products"));
    if (!productRes.ok) throw new Error("Không thể tải dữ liệu sản phẩm");
    allProducts = await productRes.json();
 
    const isHomePage =
      window.location.pathname.includes("index.html") ||
      window.location.pathname.endsWith("/") ||
      window.location.pathname === "";

    if (isHomePage) {
      // Đổ dữ liệu sản phẩm vào trang chủ theo ID
      renderHomeGrid(allProducts["Iphone"], "iphone-grid");
      renderHomeGrid(allProducts["SamSung"], "samsung-grid");
      renderHomeGrid(allProducts["Laptop DELL"], "laptop-grid");
      renderHomeGrid(allProducts["CPU"], "cpu-grid");
      renderHomeGrid(allProducts["RAM"], "ram-grid");
      renderHomeGrid(allProducts["Bàn Phím"], "banphim-grid");
      renderHomeGrid(allProducts["Màn hình ASUS"], "manhinh-grid");

      // Slider đề xuất ngẫu nhiên
      const randomList = Object.values(allProducts)
        .flat()
        .sort(() => 0.5 - Math.random())
        .slice(0, 12);
      renderHomeGrid(randomList, "random-slider");

      // Quan trọng: Gọi hàm nạp Banner ngay sau khi nạp sản phẩm
      await fetchHomeBanners();
    }

    // Xử lý các trang danh mục (sub-pages)
    const container = document.getElementById("productContainer");
    if (container) {
      const category = container.getAttribute("data-category");
      currentProducts = allProducts[category] || [];
      renderProducts(currentProducts);
    }
  } catch (error) {
    console.error("Lỗi kết nối Backend:", error);
  }
}

// 2. Hàm nạp Banner từ Database (Sửa lỗi không lưu/hiển thị banner)
async function fetchHomeBanners() {
  try {
    const res = await fetch(window.apiUrl("/api/public/banners"));
    const banners = await res.json();

    // Định nghĩa bảng tra cứu (Key là position trong DB, Value là tên file ảnh gốc)
    const bannerMap = {
      banner_slider: "nextech-laptop-nvidia-rtx-50-series-slider.jpg",
      ad_monitor: "ads-monitor.png",
      ad_deal: "ads-deal.png",
      ad_laptop: "ads-laptopgaming.png",
      ad_phimco_1: "ads-phimco.png",
      ad_bottom_3: "quangcao3.jpg",
      ad_bottom_4: "quangcao4.jpg",
    };

    banners.forEach((b) => {
      const fileNameOriginal = bannerMap[b.position];
      if (fileNameOriginal) {
        // Tìm tất cả ảnh trên trang có chứa tên file gốc trong thuộc tính src
        const targetImgs = document.querySelectorAll(
          `img[src*="${fileNameOriginal}"]`,
        );

        // Riêng với ads-phimco.png nếu có 2 cái, ta xử lý đặc biệt
        if (b.position === "ad_phimco_1" && targetImgs[0])
          targetImgs[0].src = b.img;
        if (b.position === "ad_phimco_2") {
          const allPhimCo = document.querySelectorAll(
            'img[src*="ads-phimco.png"]',
          );
          if (allPhimCo[1]) allPhimCo[1].src = b.img;
        }

        // Với các ảnh còn lại
        targetImgs.forEach((img) => {
          img.src = b.img;
        });
      }
    });
  } catch (e) {
    console.error("Lỗi đồng bộ Banner:", e);
  }
}
// 3. Hàm hiển thị cho trang chủ (Đã cập nhật logic hiển thị SAO TRUNG BÌNH)
function renderHomeGrid(data, elementId) {
  const grid = document.getElementById(elementId);
  if (!grid || !data) return;

  grid.innerHTML = data
    .map((p) => {
      const discount =
        p.oldPrice > 0
          ? Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100)
          : 0;

      // --- KHỐI LOGIC TÍNH SAO ---
      let starsHtml = "";
      const ratingValue = p.rating || 0; // Lấy rating từ DB, nếu null/undefined thì là 0

      for (let i = 1; i <= 5; i++) {
        // Nếu rating > 0 và i nhỏ hơn hoặc bằng số sao đã làm tròn thì màu Vàng (#ffbe00)
        // Ngược lại tất cả đều màu Xám (#ccc)
        const starColor =
          ratingValue > 0 && i <= Math.round(ratingValue) ? "#ffbe00" : "#ccc";
        starsHtml += `<i class="fas fa-star" style="color: ${starColor}; font-size: 11px;"></i>`;
      }
      // ---------------------------

      return `
            <div class="product-card" onclick="window.location.href='product-detail.html?id=${p.id}'" style="cursor: pointer;">
                ${discount > 0 ? `<span class="tag-off">-${discount}%</span>` : ""}
                <div class="product-img-box">
                    <img src="${p.img}" alt="${p.name}" loading="lazy">
                </div>
                <div class="product-info">
                    <div class="product-name">${p.name}</div>
                    
                    <div class="product-rating" style="margin: 5px 0; display: flex; align-items: center; gap: 5px;">
                        <div class="stars">${starsHtml}</div>
                        <span style="font-size: 11px; color: #888;">(${p.review_count || 0})</span>
                    </div>

                    <div class="product-price">${p.price.toLocaleString()}đ</div>
                    ${p.oldPrice > 0 ? `<div style="text-decoration:line-through; color:#999; font-size:12px;">${p.oldPrice.toLocaleString()}đ</div>` : ""}
                </div>
            </div>
        `;
    })
    .join("");
}
// 4. Hàm render trang danh mục
function renderProducts(data) {
  const container = document.getElementById("productContainer");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 50px;">Đang cập nhật sản phẩm...</p>`;
    return;
  }

  container.innerHTML = data
    .map((p) => {
      const discount =
        p.oldPrice > 0
          ? Math.round(((p.oldPrice - p.price) / p.oldPrice) * 100)
          : 0;
      let specsHtml = '<div class="p-specs">';
      if (p.specs && typeof p.specs === "object") {
        Object.entries(p.specs)
          .slice(0, 3)
          .forEach(([key, value]) => {
            let icon = "fa-info-circle";
            const k = key.toLowerCase();
            if (k.includes("màn hình")) icon = "fa-desktop";
            if (k.includes("chip") || k.includes("cpu")) icon = "fa-microchip";
            if (k.includes("ram")) icon = "fa-memory";
            specsHtml += `<span><i class="fas ${icon}"></i> ${value}</span>`;
          });
      }
      specsHtml += "</div>";

      return `
            <div class="p-card" onclick="window.location.href='product-detail.html?id=${p.id}'" style="cursor: pointer;">
                ${discount > 0 ? `<span class="tag-off">-${discount}%</span>` : ""}
                <img src="${p.img}" alt="${p.name}" loading="lazy">
                <div class="p-name">${p.name}</div>
                ${specsHtml}
                <div class="p-old">${p.oldPrice > 0 ? p.oldPrice.toLocaleString() + "đ" : "&nbsp;"}</div>
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <span class="p-price">${p.price.toLocaleString()}đ</span>
              <span style="display:flex; flex-direction:row; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
              </span>
                </div>
            </div>
        `;
    })
    .join("");
}

async function addToCartBE2(productId, quantity) {
  const token = localStorage.getItem("token");
  if (!token) {
    alert("Bạn cần đăng nhập để thêm vào giỏ hàng!");
    window.location.href = "login.html";
    return { ok: false };
  }

  const res = await fetch(window.apiUrl("/api/cart"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ product_id: productId, quantity: quantity || 1 }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    // JWT expired/invalid -> force re-login instead of leaking raw backend message
    const msg = String((data && data.msg) || "").toLowerCase();
    if (res.status === 401 && (msg.includes("expired") || msg.includes("token"))) {
      try {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
      } catch {
        // ignore
      }
      alert("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!");
      window.location.href = "login.html";
      return { ok: false, data };
    }
    alert("Lỗi: " + ((data && data.msg) || "Không thể thêm vào giỏ"));
    return { ok: false, data };
  }

  // Keep cart badge in sync after successful add
  try {
    refreshCartBadgeFromServer();
  } catch {
    // ignore
  }

  return { ok: true, data };
}

function ensureCartLinkInHeader() {
  const headerTools = document.querySelector("header .header-tools");
  if (!headerTools) return;
  if (document.getElementById("cart-tool")) return;

  const cartLink = document.createElement("a");
  cartLink.id = "cart-tool";
  cartLink.href = "cart.html";
  cartLink.className = "tool-item";
  cartLink.innerHTML = `
    <span class="cart-icon" aria-hidden="true">
      <i class="fas fa-shopping-cart"></i>
      <span class="cart-badge" id="cart-badge" hidden>0</span>
    </span>
    <div class="text">
      <span>Giỏ</span>
      <strong>hàng</strong>
    </div>
  `;

  const userAccount = document.getElementById("user-account");
  if (userAccount && userAccount.parentElement === headerTools) {
    headerTools.insertBefore(cartLink, userAccount);
  } else {
    headerTools.appendChild(cartLink);
  }
}

function ensureCartBadgeInHeader() {
  // If the cart link exists in markup (not created by ensureCartLinkInHeader), inject badge.
  const cartLink = document.getElementById("cart-tool") || document.querySelector('header .header-tools a[href*="cart"]');
  if (!cartLink) return;

  let iconWrap = cartLink.querySelector(".cart-icon");
  if (!iconWrap) {
    const icon = cartLink.querySelector("i.fas.fa-shopping-cart") || cartLink.querySelector("i.fa-shopping-cart");
    if (icon) {
      iconWrap = document.createElement("span");
      iconWrap.className = "cart-icon";
      iconWrap.setAttribute("aria-hidden", "true");
      icon.parentElement?.insertBefore(iconWrap, icon);
      iconWrap.appendChild(icon);
    }
  }

  if (iconWrap && !iconWrap.querySelector(".cart-badge")) {
    const badge = document.createElement("span");
    badge.className = "cart-badge";
    badge.id = "cart-badge";
    badge.hidden = true;
    badge.textContent = "0";
    iconWrap.appendChild(badge);
  }
}

function setCartBadgeCount(count) {
  const badge = document.getElementById("cart-badge") || document.querySelector(".cart-badge");
  if (!badge) return;

  const n = Math.max(0, parseInt(count || 0, 10) || 0);
  badge.textContent = String(n > 99 ? "99+" : n);
  badge.hidden = n <= 0;
}

async function refreshCartBadgeFromServer() {
  const token = localStorage.getItem("token");
  if (!token) {
    setCartBadgeCount(0);
    return;
  }

  try {
    const res = await fetch(window.apiUrl("/api/cart"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      // token expired -> hide badge until login
      setCartBadgeCount(0);
      return;
    }

    const items = Array.isArray(data) ? data : [];
    // Badge shows number of distinct products in cart (like screenshot #2)
    setCartBadgeCount(items.length);
  } catch {
    // network error -> don't block UI
  }
}

// 5. Khởi chạy khi DOM đã load
document.addEventListener("DOMContentLoaded", () => {
  fetchDataFromDB();
  ensureCartLinkInHeader();
  ensureCartBadgeInHeader();
  refreshCartBadgeFromServer();

  // --- TỰ ĐỘNG CẬP NHẬT DỮ LIỆU (AUTO-REFRESH) ---
  // 1. Tự động đồng bộ số lượng giỏ hàng mỗi 10 giây
  setInterval(refreshCartBadgeFromServer, 10000);

  // 2. Nếu đang ở trang chủ, nạp lại sản phẩm và banner mỗi 60 giây 
  // để cập nhật các thay đổi từ Admin (khuyến mãi, giá, banner mới)
  const isHomePage = window.location.pathname.includes("index.html") || 
                     window.location.pathname.endsWith("/") || 
                     window.location.pathname === "";
  if (isHomePage) {
    setInterval(fetchDataFromDB, 60000);
  }

  // BE2 Cart: click "Mua" to add to cart
  const productContainer = document.getElementById("productContainer");
  if (productContainer) {
    productContainer.addEventListener(
      "click",
      async (e) => {
        const addBtn = e.target.closest(".btn-add-cart");
        const buyNowBtn = e.target.closest(".btn-buy-now");
        if (!addBtn && !buyNowBtn) return;

        e.preventDefault();
        e.stopPropagation();

        const btn = addBtn || buyNowBtn;
        const pid = parseInt(btn.getAttribute("data-product-id"), 10);
        if (!pid) return;

        try {
          if (buyNowBtn) {
            window.location.href = `order-information.html?id=${pid}`;
            return;
          }

          const result = await addToCartBE2(pid, 1);
          if (result.ok) {
            alert("Đã thêm sản phẩm vào giỏ hàng!");
          }
        } catch (err) {
          console.error("Add to cart failed:", err);
          alert("Không thể kết nối đến server!");
        }
      },
      true,
    );
  }

  // Logic Filter
  const filterBtn = document.getElementById("filterToggle");
  const filterMenu = document.getElementById("filterMenu");
  if (filterBtn && filterMenu) {
    filterBtn.onclick = (e) => {
      e.stopPropagation();
      filterMenu.classList.toggle("active");
    };
    document.querySelectorAll(".flt-opt").forEach((opt) => {
      opt.onclick = function () {
        const sortType = this.dataset.sort;
        let sorted = [...currentProducts];
        if (sortType === "low-high") sorted.sort((a, b) => a.price - b.price);
        else sorted.sort((a, b) => b.price - a.price);
        renderProducts(sorted);
        filterMenu.classList.remove("active");
      };
    });
    document.addEventListener("click", () =>
      filterMenu.classList.remove("active"),
    );
  }
});

document.querySelectorAll(".footer-col h3").forEach((title) => {
title.addEventListener("click", () => {
if (window.innerWidth <= 768) {
title.parentElement.classList.toggle("active");
}
});
});