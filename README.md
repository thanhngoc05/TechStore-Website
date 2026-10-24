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
node --test tests/payment-return.test.cjs tests/order-detail.test.cjs tests/product-reviews.test.cjs tests/refund-form.test.cjs tests/order-lookup.test.cjs
```

Lệnh này kiểm tra thông báo và điều hướng khi quay về từ payOS, gồm cả kết quả giả trên URL, lỗi kết nối và hiển thị trạng thái thanh toán trong chi tiết đơn hàng. Không gọi dịch vụ thanh toán thật.

GitHub Actions chạy kiểm tra API trên SQLite và một MySQL 8.4 riêng, đồng thời kiểm tra giao diện, đường dẫn nội bộ và nội dung email thử. SMTP được giả lập khi kiểm tra: không có email thật hoặc giao dịch payOS thật.

Để chạy kiểm tra MySQL trên máy, chuẩn bị database riêng tên `techstore_test`, cấp quyền cho tài khoản thử và chạy:

```powershell
$env:TECHSTORE_TEST_DATABASE_URI = 'mysql+pymysql://test_user:test_password@127.0.0.1:3306/techstore_test'
$env:TECHSTORE_ALLOW_DATABASE_RESET = '1'
.venv/Scripts/python.exe -m unittest discover -s tests -v
Remove-Item Env:TECHSTORE_TEST_DATABASE_URI
Remove-Item Env:TECHSTORE_ALLOW_DATABASE_RESET
```

Dòng đầu chọn database thử với thông tin tài khoản do bạn tạo. Dòng thứ hai cho phép bộ kiểm tra xóa và tạo lại các bảng của database thử. Lệnh thứ ba chạy kiểm tra; hai lệnh cuối gỡ cấu hình thử khỏi phiên terminal. Bộ kiểm tra từ chối database tên khác hoặc máy chủ ngoài `localhost`/`127.0.0.1`.

## Quy tắc dữ liệu

- Mật khẩu tài khoản tối thiểu 6 ký tự và tối đa 72 byte UTF-8; tài khoản do quản trị viên tạo cần mật khẩu được nhập rõ ràng.
- Không thể khóa hoặc hạ quyền quản trị viên hoạt động cuối cùng.
- Giá và tồn kho phải là số nguyên không âm; cập nhật một phần giữ nguyên các trường còn lại.
- Sản phẩm đã nằm trong đơn hàng được giữ lại để bảo toàn lịch sử; có thể ẩn khi ngừng bán.
- Ảnh tải lên chỉ nhận PNG, JPEG và WebP hợp lệ, tối đa 5 MB và 20 triệu điểm ảnh. Ảnh được xử lý lại và đặt tên riêng.
- `EMAIL_MODE=file` luôn lưu email cục bộ, kể cả khi có sẵn cấu hình SMTP.

## Yêu cầu hoàn tiền

Chủ đơn đăng nhập rồi mở yêu cầu hoàn tiền từ chi tiết hoặc trang tra cứu đơn hàng. Chỉ đơn có thanh toán trực tuyến thành công mới gửi được yêu cầu; dữ liệu thanh toán được đối chiếu ở backend.

Biểu mẫu gửi thông tin cho bộ phận hỗ trợ qua `CONTACT_TO_EMAIL`. Thông báo gửi thành công chỉ xác nhận đã gửi yêu cầu: tiền chưa được hoàn, đơn chưa bị hủy và tồn kho chưa được cộng lại. Bộ phận hỗ trợ cần kiểm tra giao dịch và xử lý hoàn tiền riêng.

Đơn online chưa thanh toán vẫn có thể hủy bình thường. Đơn đã thanh toán online cần được hỗ trợ duyệt hoàn tiền trước khi hủy; API trả mã 409 và thông tin `requires_refund` cho trường hợp này. Đường dẫn API hoàn tiền cũ `/api/public/refund-request` được giữ để tương thích nhưng hiện yêu cầu đăng nhập.

Trước khi triển khai, vẫn cần kiểm tra dữ liệu chuyển đổi trên bản sao database, thao tác trong trình duyệt, SMTP và payOS thật.

## Cấu trúc

- `backend/`: API, cấu hình và thư viện Python.
- `pages/`, `scripts/`, `assets/`: giao diện và tài nguyên.
- `tests/`: kiểm tra API tự động.
- `docs/PROJECT_PLAN.md`: tiến độ và công việc tích hợp còn lại.
