(function () {
  window.handlePayOSReturn = async function handlePayOSReturn() {
    const params = new URLSearchParams(window.location.search);
    const paymentRef = params.get("orderCode");
    if (!paymentRef || !params.has("status")) return false;

    const nextButton = document.getElementById("mainNextBtn");
    if (nextButton) nextButton.disabled = true;
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Vui lòng đăng nhập rồi tra cứu đơn hàng để kiểm tra thanh toán.");
      window.location.replace("login.html");
      return true;
    }

    try {
      const response = await fetch(window.apiUrl("/api/payment/confirm"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ payment_ref: paymentRef }),
      });
      const data = await response.json();
      if (!response.ok || !data.order_code) {
        throw new Error(data.msg || "Không xác minh được thanh toán.");
      }
      if (data.payment_status === "success") {
        alert("Thanh toán đã được xác nhận. Bạn sẽ được chuyển đến đơn hàng.");
      } else if (data.payment_status === "failed") {
        alert("Thanh toán không thành công. Vui lòng kiểm tra trạng thái đơn hàng.");
      } else {
        alert("Thanh toán chưa được xác nhận. Bạn có thể kiểm tra lại tại chi tiết đơn hàng.");
      }
      // The internal order code comes only from the authenticated API response.
      window.location.replace(`order-detail.html?order_code=${encodeURIComponent(data.order_code)}`);
    } catch (error) {
      alert("Chưa xác minh được thanh toán. Vui lòng tra cứu đơn hàng hoặc thử tải lại trang.");
      // Keep checkout disabled to avoid creating another order on a return URL.
    }
    return true;
  };
})();
