/**
 * NEXTECH - PRODUCT-DETAIL.JS (FULL UPDATED & SYNCED)
 */

// 1. Lấy ID sản phẩm từ URL
const params = new URLSearchParams(window.location.search);
const productId = parseInt(params.get("id"));

// 2. Hàm lấy dữ liệu và hiển thị chi tiết
async function loadProductDetail() {
  try {
    const response = await fetch(window.apiUrl("/api/public/products"));
    const allProductsFromDB = await response.json();

    let product = null;
    let categoryKey = "";

    for (let key in allProductsFromDB) {
      let found = allProductsFromDB[key].find((item) => item.id === productId);
      if (found) {
        product = found;
        categoryKey = key;
        break;
      }
    }

    if (product) {
      renderProductUI(product, categoryKey);
      // Tải bình luận ngay khi sản phẩm hiển thị thành công
      loadReviews(product.id);
    } else {
      renderNotFound();
    }
  } catch (error) {
    console.error("Lỗi khi tải chi tiết sản phẩm:", error);
    renderNotFound();
  }
}

// 3. Hàm hiển thị bình luận từ Database
async function loadReviews(pid) {
  try {
    const res = await fetch(window.apiUrl(`/api/reviews/${pid}`));
    const reviews = await res.json();
    const list = document.getElementById("review-list");

    if (!list) return;

    if (reviews.length === 0) {
      list.innerHTML = `<p style="color:#999; text-align:center; padding: 20px;">Sản phẩm này chưa có đánh giá nào. Hãy là người đầu tiên!</p>`;
      return;
    }

    list.innerHTML = reviews
      .map((r) => {
        let starHtml = "";
        for (let i = 1; i <= 5; i++) {
          starHtml += `<i class="fas fa-star" style="color: ${i <= r.rating ? "#ffc107" : "#ccc"}"></i>`;
        }
        return `
            <div class="review-item" style="border-bottom: 1px solid #eee; padding: 15px 0;">
                <div class="author" style="font-weight:bold; color:#1a234a">
                    ${r.username} <span style="font-weight: normal; font-size: 12px; color: #999;">- ${r.date}</span>
                </div>
                <div class="stars" style="margin: 5px 0;">${starHtml}</div>
                <div class="content" style="color:#444; line-height:1.5">${r.content}</div>
            </div>`;
      })
      .join("");
  } catch (e) {
    console.error("Lỗi tải bình luận:", e);
  }
}

// 4. Hàm đổ dữ liệu sản phẩm vào HTML
function renderProductUI(product, categoryKey) {
  const breadcrumb = document.getElementById("dynamic-breadcrumb");
  if (breadcrumb) {
    breadcrumb.innerHTML = `
        <a href="index.html"><i class="fas fa-home"></i> Trang chủ</a> > 
        <a href="#" onclick="history.back(); return false;"> ${categoryKey} </a> >
        <strong>${product.name}</strong>
    `;
  }

  const contentArea = document.getElementById("product-content");
  if (contentArea) {
    contentArea.innerHTML = `
        <div class="detail-grid">
            <div class="left">
                <div class="main-img-container" style="background:#fff; padding:20px; border-radius:8px; text-align:center">
                    <img src="${product.img}" class="product-main-img" alt="${product.name}" style="object-fit:contain">
                </div>
                <div class="product-description-content" style="margin-top:30px; background:#fff; padding:20px; border-radius:8px">
                    <h3 style="margin-bottom:15px; border-left:4px solid #d70018; padding-left:10px">Mô tả sản phẩm</h3>
                    ${product.description || "<p>Nội dung đang được cập nhật...</p>"}
                </div>
            </div>

            <div class="right">
                <h1 style="font-size:24px; color:#1a234a">${product.brand ? product.brand + ' - ' : ''}${product.name}</h1>
                
                <div class="rating-summary" style="margin:10px 0; color:#ffbe00">
                    ${generateStaticStars(product.rating)}
                    <span style="color:#666; font-size:14px"> (${product.review_count || 0} đánh giá)</span>
                </div>

                <div style="margin: 15px 0; display: flex; align-items: baseline; gap:15px; flex-wrap: wrap;">
                    <span class="price-big" style="color:#d70018; font-size:28px; font-weight:bold">${product.price.toLocaleString()}đ</span>
                    ${product.oldPrice > 0 ? `<span class="old-price-detail" style="text-decoration:line-through; color:#999">${product.oldPrice.toLocaleString()}đ</span>` : ""}
                </div>

                <div class="buy-group">
                  <div class="buy-row">
                    <button class="btn-add-cart" id="btnAddToCart">
                      THÊM VÀO GIỎ
                      <small>Xem giỏ hàng trước khi thanh toán</small>
                    </button>
                    <button class="btn-now" id="btnBuyNow">
                      MUA NGAY
                      <small>Giao tận nơi hoặc nhận tại cửa hàng</small>
                    </button>
                  </div>
                  <button class="btn-advise" id="btnAdvise">
                    <i class="fas fa-comment-dots"></i> TƯ VẤN NGAY
                  </button>
                </div>

                <div class="promo-box">
                    <div class="promo-header"><i class="fas fa-gift"></i> Khuyến mãi</div>
                    <div class="promo-body">
                        <p><i class="fas fa-check-circle"></i> Giảm ngay 100.000đ khi thanh toán qua chuyển khoản.</p>
                        <p><i class="fas fa-check-circle"></i> Miễn phí vận chuyển bán kính 5km.</p>
                    </div>
                </div>

                <div class="specs-detail-title">THÔNG SỐ KỸ THUẬT</div>
                <table class="specs-table">
                    ${Object.entries(product.specs || {})
                      .map(
                        ([k, v]) => `
                        <tr>
                            <td style="background:#f9f9f9; font-weight:600; width:35%">${k}</td>
                            <td>${v}</td>
                        </tr>
                    `,
                      )
                      .join("")}
                </table>
            </div>
        </div>
    `;
  }

  const ratingTitle = document.getElementById("rating-title");
  if (ratingTitle)
    ratingTitle.innerText = `Đánh giá & Nhận xét: ${product.name}`;

  initButtons(product);
}

// Hàm hỗ trợ vẽ sao dựa trên rating trung bình
function generateStaticStars(rating) {
  let html = "";
  const r = rating || 0;
  for (let i = 1; i <= 5; i++) {
    // Nếu r = 0 thì tất cả là màu xám (#ccc), nếu r > 0 thì tô vàng (#ffbe00)
    const starColor = r > 0 && i <= Math.round(r) ? "#ffbe00" : "#ccc";
    html += `<i class="fas fa-star" style="color: ${starColor}"></i>`;
  }
  return html;
}

// 5. Hàm xử lý các nút bấm
function initButtons(product) {
  const btnAddToCart = document.getElementById("btnAddToCart");
  if (btnAddToCart) {
    btnAddToCart.onclick = async () => {
      try {
        if (typeof addToCartBE2 !== "function") {
          alert("Không thể thêm vào giỏ: thiếu hàm giỏ hàng!");
          return;
        }
        const result = await addToCartBE2(product.id, 1);
        if (result && result.ok) {
          alert("Đã thêm sản phẩm vào giỏ hàng!");
        }
      } catch (err) {
        console.error("Add to cart failed:", err);
        alert("Không thể kết nối đến server!");
      }
    };
  }

  const btnBuyNow = document.getElementById("btnBuyNow");
  if (btnBuyNow) {
    btnBuyNow.onclick = () =>
      (window.location.href = `order-information.html?id=${product.id}`);
  }

  const btnAdvise = document.getElementById("btnAdvise");
  if (btnAdvise) {
    btnAdvise.onclick = () => (window.location.href = "tel:19001234");
  }
}

// 6. Xử lý Gửi Đánh Giá (Lưu Database)
document.addEventListener("DOMContentLoaded", () => {
  loadProductDetail();

  const submitBtn = document.getElementById("submitReview");
  if (submitBtn) {
    submitBtn.onclick = async function () {
      const token = localStorage.getItem("token");

      if (!token) {
        alert("Bạn cần đăng nhập để gửi đánh giá!");
        window.location.href = "login.html";
        return;
      }

      const content = document.getElementById("reviewText").value;
      const starInput = document.querySelector('input[name="stars"]:checked');

      if (!starInput || !content.trim()) {
        alert("Vui lòng chọn số sao và nhập nội dung cảm nhận!");
        return;
      }

      const body = {
        product_id: productId,
        rating: parseInt(starInput.value),
        content: content,
      };

      try {
        const res = await fetch(window.apiUrl("/api/reviews/add"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          alert("Gửi đánh giá thành công! Cảm ơn bạn.");
          location.reload();
        } else {
          const errData = await res.json();
          alert("Lỗi: " + (errData.msg || "Không thể gửi đánh giá"));
        }
      } catch (error) {
        console.error("Lỗi API:", error);
        alert("Không thể kết nối đến server!");
      }
    };
  }
});

function renderNotFound() {
  const contentArea = document.getElementById("product-content");
  if (contentArea) {
    contentArea.innerHTML = `
        <div style="text-align: center; padding: 100px 0;">
            <i class="fas fa-search" style="font-size: 60px; color: #ccc; margin-bottom: 20px;"></i>
            <h2>Sản phẩm không tồn tại hoặc đã bị gỡ bỏ!</h2>
            <a href="index.html" style="color:#007bff; font-weight:600">Quay về trang chủ</a>
        </div>
    `;
  }
}
