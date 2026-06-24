document.addEventListener("DOMContentLoaded", function () {
  const userDisplay = document.getElementById("user-display");
  const username = localStorage.getItem("username");

  if (username) {
    userDisplay.href = "profile.html"; // Dẫn đến trang profile mới
    userDisplay.innerHTML = `
            <i class="fas fa-user-circle"></i>
            <span>${username}</span>
            <button id="logout-btn" class="logout-btn"><i class="fas fa-sign-out-alt"></i></button>
        `;

    document
      .getElementById("logout-btn")
      .addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        localStorage.clear();
        alert("Đã đăng xuất!");
        window.location.href = "index.html";
      });
  }
});
