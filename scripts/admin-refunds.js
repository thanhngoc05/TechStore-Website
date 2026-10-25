(function initAdminRefunds() {
  const byId = id => document.getElementById(id);
  const queue = byId("refundQueue");
  if (!queue) return;
  const message = byId("refundAdminMessage");
  const labels = { pending: "Mới tiếp nhận", reviewing: "Đang kiểm tra", resolved: "Đã xử lý yêu cầu", rejected: "Không chấp nhận" };
  let page = 1, selected = null, loading = false;

  async function api(path, options = {}) {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Vui lòng đăng nhập bằng tài khoản quản trị.");
    const response = await fetch(window.apiUrl(path), {
      ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.msg || "Không tải được dữ liệu. Vui lòng đăng nhập lại hoặc thử lại.");
    return data;
  }

  function showDetail(record) {
    selected = record;
    byId("refundDetail").hidden = false;
    byId("refundTitle").textContent = `Yêu cầu #${record.id} · ${record.order_code}`;
    byId("refundInfo").textContent = [
      `Họ tên: ${record.name}`, `Điện thoại: ${record.phone}`, `Email: ${record.email || "—"}`,
      `Ngân hàng: ${record.bank_name}`, `Tài khoản: ${record.account_number}`,
      `Chủ tài khoản: ${record.account_holder}`, `Ghi chú khách hàng: ${record.note || "—"}`,
    ].join("\n");
    const terminal = ["resolved", "rejected"].includes(record.status);
    const allowed = record.status === "pending" ? ["pending", "reviewing", "rejected"] : ["reviewing", "resolved", "rejected"];
    const status = byId("refundReviewStatus");
    status.value = record.status;
    status.disabled = terminal;
    Array.from(status.options).forEach(option => { option.disabled = !allowed.includes(option.value); });
    byId("refundStaffNote").value = record.staff_note || "";
    byId("refundStaffNote").readOnly = terminal;
    byId("refundSave").disabled = terminal;
    byId("refundAudit").textContent = (record.events || []).map(event =>
      `${event.created_at} · ${event.actor}: ${labels[event.from_status]} → ${labels[event.to_status]}\n${event.staff_note || ""}`
    ).join("\n\n") || "Chưa có cập nhật.";
  }

  async function openRequest(id) {
    try { showDetail(await api(`/admin/refund-requests/${id}`)); message.textContent = ""; }
    catch (error) { message.textContent = error.message; }
  }

  async function loadQueue() {
    if (loading) return;
    loading = true;
    byId("refundPrev").disabled = byId("refundNext").disabled = true;
    selected = null;
    byId("refundDetail").hidden = true;
    message.textContent = "Đang tải yêu cầu...";
    try {
      const data = await api(`/admin/refund-requests?status=${encodeURIComponent(byId("refundFilter").value)}&page=${page}&limit=25`);
      queue.replaceChildren();
      for (const record of data.items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "refund-entry";
        button.textContent = `#${record.id} · ${record.order_code} · ${labels[record.status] || record.status}\n${record.bank_name} · ****${record.account_last4}`;
        button.addEventListener("click", () => openRequest(record.id));
        queue.append(button);
      }
      byId("refundPage").textContent = `Trang ${page} · ${data.total} yêu cầu`;
      byId("refundPrev").disabled = page <= 1;
      byId("refundNext").disabled = page * 25 >= data.total;
      message.textContent = data.items.length ? "" : "Không có yêu cầu trong bộ lọc này.";
    } catch (error) { queue.replaceChildren(); message.textContent = error.message; }
    finally { loading = false; }
  }

  byId("refundReviewForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!selected || byId("refundSave").disabled) return;
    byId("refundSave").disabled = true;
    try {
      const record = await api(`/admin/refund-requests/${selected.id}`, { method: "PUT", body: JSON.stringify({
        revision: selected.revision, status: byId("refundReviewStatus").value, staff_note: byId("refundStaffNote").value,
      }) });
      showDetail(record);
      message.textContent = "Đã lưu phản hồi. Thanh toán và trạng thái đơn hàng không thay đổi.";
    } catch (error) {
      message.textContent = error.message;
      byId("refundSave").disabled = false;
    }
  });
  byId("refundFilter").addEventListener("change", () => { if (!loading) { page = 1; return loadQueue(); } });
  byId("refundReload").addEventListener("click", () => loadQueue());
  byId("refundPrev").addEventListener("click", () => { if (!loading && page > 1) { page--; return loadQueue(); } });
  byId("refundNext").addEventListener("click", () => { if (!loading && !byId("refundNext").disabled) { page++; return loadQueue(); } });
  loadQueue();
})();
