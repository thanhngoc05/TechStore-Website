Bước A: Chuẩn bị Database (MySQL)
Dự án hiện tại sử dụng MySQL thay vì SQLite để đảm bảo hiệu năng.

Mở MySQL Workbench.

Tạo một Database mới với tên: nextech_db.

Vô file config.py trong backend , đổi mật khẩu My SQL tại dòng số 10

Bước B: Tạo môi trường ảo (Virtual Environment)
python -m venv venv

Kích hoạt môi trường ảo:

Windows: venv\Scripts\activate

Mac/Linux: source venv/bin/activate

Bước C: Cài đặt thư viện
Cài đặt các thư viện cần thiết để hệ thống vận hành:
Tệp dependency `backend/requirements.txt` sẽ được bổ sung ở giai đoạn backend sau.

Khởi chạy dự án
Bước 1: Chạy Backend (Python Flask)
Duy chuyển vào thư mục backend và chạy server:

cd backend
python app.py
Lưu ý: Khi chạy lần đầu, hệ thống sẽ tự động tạo các bảng và nạp dữ liệu mẫu (Seed data).

Bước 2: Chạy Frontend
Bạn chỉ cần mở file index.html trong thư mục gốc bằng trình duyệt hoặc dùng Live Server trong VS Code.

Tài khoản quản trị được cấu hình riêng trong môi trường phát triển và không được lưu công khai trong repository.

📂 Cấu trúc thư mục hiện tại

NexTech/
├── backend/
│ └── app.py # Server Flask, API & Model Database
├── pages/ # Các trang giao diện chính
│ ├── index.html # Trang chủ hiển thị sản phẩm & sao trung bình
│ ├── login.html # Đăng nhập (Có chế độ Admin/User)
│ ├── register.html # Đăng ký thành viên mới
│ ├── admin.html # CMS dành cho quản trị viên
│ ├── product-detail.html # Chi tiết sản phẩm & Gửi đánh giá
│ └── profile.html # Trang cá nhân của người dùng
├── scripts/ # Logic điều khiển JavaScript
│ ├── scripts.js # Xử lý hiển thị trang chủ
│ ├── product-detail.js # Xử lý API bình luận & rating
│ ├── profile.js # Xử lý cập nhật thông tin cá nhân
│ ├── CheckLogin.js # Quản lý trạng thái đăng nhập Header
│ └── sidebar.js # Hiệu ứng Menu
├── assets/ # Tài nguyên tĩnh
│ ├── CSS/ # File phong cách giao diện
│ └── img/ # Hình ảnh sản phẩm & Banner
└── README.md # Hướng dẫn này
NexTech 2026 - Developed with passion for Technology.
