function escapeWarrantyText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  document.querySelectorAll(".tab-item").forEach((t) => t.classList.remove("active"));
  document.getElementById("resultBox").style.display = "none";

  document.getElementById(tabId).classList.add("active");
  const trigger = Array.from(document.querySelectorAll(".tab-item")).find((x) => {
    if (tabId === "tab-phone") return x.textContent.toLowerCase().includes("điện thoại");
    return x.textContent.toLowerCase().includes("imei");
  });
  if (trigger) trigger.classList.add("active");
}

async function handleLookup(type) {
  const input = type === "phone" ? document.getElementById("inputPhone") : document.getElementById("inputImei");
  const errorMsg = type === "phone" ? document.getElementById("errPhone") : document.getElementById("errImei");
  const resultBox = document.getElementById("resultBox");

  input.classList.remove("error");
  errorMsg.style.display = "none";
  resultBox.style.display = "none";

  const value = input.value.trim();
  const verification = document.getElementById(type === "phone" ? "inputPhoneIdentifier" : "inputImeiPhone").value.trim();
  if (!value || !verification) {
    errorMsg.textContent = "Vui lòng nhập đủ số điện thoại và mã bảo hành hoặc Serial/IMEI.";
    input.classList.add("error");
    errorMsg.style.display = "block";
    input.focus();
    return;
  }

  try {
    const params = new URLSearchParams();
    params.set("phone", type === "phone" ? value : verification);
    params.set("identifier", type === "phone" ? verification : value);

    const res = await fetch(window.apiUrl(`/api/public/warranty/lookup?${params.toString()}`));
    const data = await res.json().catch(() => []);
    if (!res.ok) {
      throw new Error((data && data.msg) || `HTTP ${res.status}`);
    }

    const first = Array.isArray(data) ? data[0] : null;
    if (!first) {
      resultBox.innerHTML = `<h3 style="color:#d70018">Không tìm thấy dữ liệu bảo hành</h3><p style="margin:0;color:#666">Vui lòng kiểm tra lại thông tin tra cứu.</p>`;
      resultBox.style.display = "block";
      return;
    }

    const statusText = {
      active: "Còn bảo hành",
      expired: "Hết bảo hành",
      processing: "Đang xử lý",
    }[String(first.status || "").toLowerCase()] || first.status || "N/A";

    const history = Array.isArray(first.history) && first.history.length
      ? `<div style="margin-top:10px;font-size:13px;color:#475569"><b>Lịch sử xử lý:</b><ul style="margin:6px 0 0 16px;padding:0">${first.history
          .map((h) => `<li>${escapeWarrantyText(h)}</li>`)
          .join("")}</ul></div>`
      : "";

    resultBox.innerHTML = `
      <h3>Thông tin sản phẩm</h3>
      <div class="result-item"><span>Mã bảo hành:</span><span>${escapeWarrantyText(first.warranty_code || "-")}</span></div>
      <div class="result-item"><span>Tên sản phẩm:</span><span>${escapeWarrantyText(first.product_name || "-")}</span></div>
      <div class="result-item"><span>Serial/IMEI:</span><span>${escapeWarrantyText(first.serial_imei || "-")}</span></div>
      <div class="result-item"><span>Ngày kích hoạt:</span><span>${escapeWarrantyText(first.activated_at || "-")}</span></div>
      <div class="result-item"><span>Hạn bảo hành:</span><span>${escapeWarrantyText(first.expired_at || "-")}</span></div>
      <div class="result-item"><span>Trạng thái:</span><span style="color:${String(first.status || "").toLowerCase() === "active" ? "#16a34a" : "#d70018"}">${escapeWarrantyText(statusText)}</span></div>
      ${history}
    `;
    resultBox.style.display = "block";
    resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    resultBox.innerHTML = `<h3 style="color:#d70018">Không thể tra cứu bảo hành</h3><p style="margin:0;color:#666">${escapeWarrantyText(err.message || "Lỗi không xác định")}</p>`;
    resultBox.style.display = "block";
  }
}

document.querySelectorAll(".tabs .tab-item").forEach((item) => {
  item.addEventListener("click", () => {
    const isPhone = item.textContent.toLowerCase().includes("điện thoại");
    switchTab(isPhone ? "tab-phone" : "tab-imei");
  });
});

document.querySelectorAll("input").forEach((inp) => {
  inp.addEventListener("input", function () {
    this.classList.remove("error");
    const err = this.parentElement.querySelector(".error-msg");
    if (err) err.style.display = "none";
  });
});
