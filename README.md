# TechStore Website

Website bán thiết bị công nghệ, gồm giao diện HTML/CSS/JavaScript và API Flask.

## Cài đặt trên Windows

Yêu cầu Python 3.13. Chạy các lệnh từ thư mục gốc của dự án.

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.lock.txt
Copy-Item backend/.env.example backend/.env
```

Lệnh đầu tạo môi trường Python riêng. Lệnh thứ hai cài đúng các phiên bản thư viện đã kiểm tra. Lệnh cuối tạo cấu hình cá nhân; chỉ chạy khi chưa có `backend/.env` để tránh ghi đè.

Tạo khóa xác thực riêng bằng lệnh sau, rồi điền kết quả vào `JWT_SECRET_KEY` trong `backend/.env`:

```powershell
.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

Lệnh này tạo chuỗi ngẫu nhiên cho việc ký mã đăng nhập. Không chia sẻ khóa và không đưa tệp `.env` lên GitHub.

Mặc định tệp mẫu chọn SQLite, dữ liệu được lưu trong `instance/nextech.sqlite3`. Muốn dùng MySQL: tạo database `nextech_db`, đặt `USE_SQLITE=0` và điền các biến `MYSQL_*`. Có thể đặt `SQLALCHEMY_DATABASE_URI` để thay thế toàn bộ địa chỉ kết nối.

Muốn tạo quản trị viên lần đầu: điền đủ `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` trong `.env`. Mật khẩu tối thiểu 12 ký tự. Không có tài khoản quản trị hoặc mật khẩu mặc định. Bỏ các biến này sau khi tài khoản đã được tạo; thay đổi chúng không đặt lại mật khẩu tài khoản có sẵn.

## Chạy ứng dụng

```powershell
.venv/Scripts/python.exe backend/app.py
```

Lệnh này khởi động API và phục vụ giao diện tại [localhost:5001](http://127.0.0.1:5001). Dùng cùng địa chỉ này cho toàn bộ website. Không cần mở Live Server riêng.

Lần chạy đầu tạo bảng và dữ liệu minh họa. Máy chủ Flask tích hợp dành cho phát triển; debug mặc định tắt. Đặt `FLASK_DEBUG=1` chỉ khi cần gỡ lỗi cục bộ.

## Email và thanh toán

- `EMAIL_MODE=file` lưu email thử trong `instance/emails/`, không gửi ra ngoài. Để gửi thật, điền `SMTP_*`, chọn `EMAIL_MODE=smtp` và cấu hình `CONTACT_TO_EMAIL` khi cần nhận liên hệ.
- COD dùng được mà không cần khóa payOS.
- Thanh toán trực tuyến cần đủ `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`. Cấu hình `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` bằng địa chỉ HTTPS của môi trường triển khai và đăng ký webhook `/payment/webhook`.
- Backend xác minh chữ ký webhook và đối chiếu số tiền. Kết quả do trình duyệt gửi lên không được dùng để đánh dấu đã thanh toán. Đơn đã hủy nhưng nhận thanh toán cần đối soát thủ công.

## Kiểm tra

```powershell
.venv/Scripts/python.exe -m unittest discover -s tests -v
.venv/Scripts/python.exe -m pip check
```

Lệnh đầu chạy kiểm tra API với SQLite tạm trong bộ nhớ, không dùng dữ liệu cá nhân, không chuyển tiền và không gửi email thật. Lệnh thứ hai kiểm tra tính tương thích giữa các thư viện đã cài.

Nếu có Node.js 22 trở lên, chạy thêm kiểm tra xử lý kết quả thanh toán:

```powershell
node --test tests/payment-return.test.cjs tests/order-detail.test.cjs
```

Lệnh này kiểm tra thông báo và điều hướng khi quay về từ payOS, gồm cả kết quả giả trên URL, lỗi kết nối và hiển thị trạng thái thanh toán trong chi tiết đơn hàng. Không gọi dịch vụ thanh toán thật.

GitHub Actions tự chạy bộ kiểm tra khi backend thay đổi. MySQL, SMTP và giao dịch payOS thật cần được kiểm tra riêng trước khi triển khai.

## Cấu trúc

- `backend/`: API, cấu hình và thư viện Python.
- `pages/`, `scripts/`, `assets/`: giao diện và tài nguyên.
- `tests/`: kiểm tra API tự động.
- `docs/PROJECT_PLAN.md`: tiến độ và công việc tích hợp còn lại.
