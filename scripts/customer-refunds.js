(function initCustomerRefunds() {
  const byId = id => document.getElementById(id);
  const list = byId("refundCustomerList");
  if (!list) return;
  const message = byId("refundCustomerMessage");
  const labels = { pending: "Mới tiếp nhận", reviewing: "Đang kiểm tra", resolved: "Đã xử lý yêu cầu", rejected: "Không chấp nhận" };
  let page = 1, loading = false;
  async function load() {
    if (loading) return;
    const token = localStorage.getItem("token");
    byId("refundCustomerPrev").disabled = byId("refundCustomerNext").disabled = true;
    if (!token) { list.replaceChildren(); message.textContent = "Vui lòng đăng nhập để xem yêu cầu của bạn."; return; }
    loading = true;
    message.textContent = "Đang tải yêu cầu...";
    try {
      const response = await fetch(window.apiUrl(`/api/refund-requests/me?page=${page}&limit=25`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.msg || "Không tải được yêu cầu. Vui lòng đăng nhập lại hoặc thử lại.");
      list.replaceChildren();
      for (const record of data.items) {
        const card = document.createElement("article");
        card.className = "refund-entry";
        const title = document.createElement("h2");
        title.textContent = `Yêu cầu #${record.id} · ${record.order_code}`;
        const info = document.createElement("pre");
        info.textContent = [labels[record.status] || record.status, `Tạo lúc: ${record.created_at}`,
          `Ngân hàng: ${record.bank_name} · ****${record.account_last4}`,
          `Phản hồi: ${record.staff_note || "Chưa có phản hồi. Bộ phận hỗ trợ sẽ kiểm tra yêu cầu."}`].join("\n");
        const link = document.createElement("a");
        link.href = `order-detail.html?order_code=${encodeURIComponent(record.order_code)}`;
        link.textContent = "Xem đơn hàng";
        card.append(title, info, link);
        list.append(card);
      }
      byId("refundCustomerPage").textContent = `Trang ${page} · ${data.total} yêu cầu`;
      byId("refundCustomerPrev").disabled = page <= 1;
      byId("refundCustomerNext").disabled = page * 25 >= data.total;
      message.textContent = data.items.length ? "" : "Bạn chưa có yêu cầu hoàn tiền nào.";
    } catch (error) { list.replaceChildren(); message.textContent = error.message; }
    finally { loading = false; }
  }
  byId("refundCustomerReload").addEventListener("click", () => load());
  byId("refundCustomerPrev").addEventListener("click", () => { if (!loading && page > 1) { page--; return load(); } });
  byId("refundCustomerNext").addEventListener("click", () => { if (!loading && !byId("refundCustomerNext").disabled) { page++; return load(); } });
  load();
})();
