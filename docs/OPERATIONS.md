# Vận hành TechStore

Các lệnh dưới đây chạy từ thư mục gốc dự án với môi trường Python đã cài `backend/requirements.lock.txt`. Không có lịch chạy tự động hoặc máy chủ bên ngoài nào được tạo bởi đợt cập nhật này.

## Kiểm tra database trước khi chạy

```powershell
$env:DB_AUTO_INITIALIZE = '0'
.venv/Scripts/python.exe -m flask --app backend/app.py schema-check
```

Dòng đầu tắt việc tự tạo bảng, chỉnh schema và nạp dữ liệu mẫu khi ứng dụng được tải. Lệnh thứ hai chỉ đọc cấu trúc, trả danh sách bảng/cột còn thiếu và mã thoát 1 nếu chưa đạt. Lệnh không tự sửa dữ liệu. Kiểm tra trên bản sao database và chuẩn bị các bảng cần thiết trước khi cập nhật môi trường đang vận hành.

Môi trường phát triển có thể dùng `DB_AUTO_INITIALIZE=1` như tệp mẫu để giữ hành vi khởi tạo cũ. Biến đặt trong terminal ưu tiên hơn `.env`; dùng `Remove-Item Env:DB_AUTO_INITIALIZE` để bỏ thiết lập của phiên terminal khi cần trở lại cấu hình trong tệp.

## Chạy máy chủ

Sau khi schema đạt:

```powershell
.venv/Scripts/python.exe backend/serve.py
```

Lệnh khởi động ứng dụng qua Waitress, mặc định tại `127.0.0.1:5001`, với 4 luồng và debugger tắt. `BIND_HOST`, `PORT` và `WSGI_THREADS` điều chỉnh địa chỉ, cổng và số luồng; giá trị không hợp lệ làm máy chủ dừng trước khi mở cổng. Cách dùng WSGI của Waitress được mô tả trong [tài liệu chính thức](https://docs.pylonsproject.org/projects/waitress/en/stable/usage.html).

Bản chạy này không tự cấu hình HTTPS, reverse proxy hoặc dịch vụ chạy nền. `PUBLIC_BASE_URL` vẫn phải trỏ đến địa chỉ HTTPS của website khi gửi liên kết khôi phục thật.

## Kiểm tra sống và sẵn sàng

- `/api/health`: tiến trình đang trả lời; không kiểm tra database.
- `/api/ready`: thử truy vấn database, trả 200 khi kết nối được hoặc 503 kèm `Retry-After: 5` khi không được. Không trả địa chỉ hoặc mật khẩu kết nối.
- `schema-check`: kiểm tra bảng và cột; readiness không thay thế kiểm tra schema.

Phản hồi chứa thông tin riêng tư dùng `Cache-Control: no-store`. JSON giới hạn 1 MiB, toàn bộ yêu cầu giới hạn 6 MiB; ảnh tải lên vẫn giới hạn 5 MiB và 20 triệu điểm ảnh.

## Giới hạn thao tác

Bộ đếm được lưu trong `request_rate_buckets`, dùng chung database và cửa sổ cố định theo phút. Database chỉ lưu mã HMAC của phạm vi/IP/cửa sổ, không lưu IP thô trong bảng này. Khi vượt giới hạn, API trả 429 cùng `retry_after` và `Retry-After`.

| Thao tác | Yêu cầu mỗi phút trên một IP |
| --- | ---: |
| Đăng nhập | 30 |
| Đăng ký | 10 |
| Yêu cầu email khôi phục | 5 |
| Xác nhận mật khẩu mới | 10 |
| Liên hệ | 10 |
| Gửi yêu cầu hoàn tiền | 5 |
| Gửi đánh giá | 30 |
| Cập nhật duyệt yêu cầu | 30 |
| Gửi lại thông báo hoàn tiền | 5 |

`RATE_LIMIT_ENABLED=1` mặc định bật. Nếu kho bộ đếm không truy cập được, các thao tác được giới hạn trả 503. Cửa sổ cố định có thể cho phép một đợt yêu cầu ở cuối phút và một đợt nữa ở đầu phút tiếp theo.

Bộ đếm dùng `REMOTE_ADDR`, không tin `X-Forwarded-For` do khách gửi. Cấu hình proxy tin cậy cần được kiểm chứng riêng để nhiều khách phía sau reverse proxy không bị nhận thành cùng một IP. Đây chưa phải kiểm tra tải hoặc bảo vệ chống mọi hình thức lạm dụng.

## Thông báo hoàn tiền bị lỗi

Mở **Quản trị → Yêu cầu hoàn tiền**, chọn hồ sơ và xem trạng thái thông báo. Nút **Gửi lại thông báo hỗ trợ** chỉ gửi khi hồ sơ chưa có lần gửi thật thành công; email thử được phân biệt là `simulated`.

Mỗi lần thử được lưu trong `refund_notification_attempts`. Các lần xử lý cùng hồ sơ được tuần tự hóa bằng khóa hàng trong database trong lúc gửi. Thao tác không đổi phản hồi đang nhập, trạng thái duyệt, thanh toán hoặc tồn kho.

Email và giao dịch database không thể cam kết cùng lúc: nếu tiến trình dừng sau khi SMTP nhận email nhưng trước khi lưu kết quả, lần thử lại có thể gửi trùng. Đối chiếu hộp thư khi xử lý trường hợp này. Không có tác vụ tự gửi lại được tạo.

## Dọn bộ đếm hết hạn

```powershell
.venv/Scripts/python.exe -m flask --app backend/app.py cleanup-rate-buckets
```

Lệnh chỉ thống kê bộ đếm hết thời gian lưu; cửa sổ đang hoạt động không bị chọn.

```powershell
.venv/Scripts/python.exe -m flask --app backend/app.py cleanup-rate-buckets --apply
```

Lệnh có `--apply` mới xóa các bộ đếm đã được chọn. Dữ liệu cửa sổ được giữ thêm một ngày sau khi hết phút. Công cụ dọn mã khôi phục `cleanup-reset-tokens` vẫn hoạt động độc lập như mô tả trong README.

Các bảng mới của đợt này là `request_rate_buckets` và `refund_notification_attempts`. Khởi tạo, sao lưu, lưu giữ dữ liệu ngân hàng, gửi mail thật và tích hợp payOS vẫn cần quy trình vận hành riêng.
