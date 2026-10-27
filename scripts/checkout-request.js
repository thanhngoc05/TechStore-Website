(function initCheckoutRequest() {
  window.submitCheckoutRequest = async function submitCheckoutRequest(build, forcePaymentMethod) {
    const method = String(forcePaymentMethod || "").trim().toLowerCase();
    const payload = method ? { ...build.payload, payment_method: method, provider: method } : build.payload;
    const res = await fetch(window.apiUrl('/api/orders'), {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${build.token}`, 'Idempotency-Key': build.idemKey },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    // A conflict or rate limit must never silently become a different order.
    return { res, data };
  };
})();
