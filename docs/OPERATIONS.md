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

Nếu đã có reverse proxy, đặt `TRUSTED_PROXY` bằng đúng IP của máy proxy kết nối trực tiếp đến Waitress, ví dụ `127.0.0.1`. Mặc định để trống: các header chuyển tiếp từ khách bị loại bỏ. Không nhận `*`, tên miền hoặc dải mạng. `TRUSTED_PROXY_COUNT` từ 1 đến 5 là số proxy được tin trong chuỗi; chỉ tăng khi đã kiểm chứng toàn bộ chuỗi. `TRUSTED_PROXY_HEADERS` để trống sẽ chọn `x-forwarded-for x-forwarded-proto`; không nhận các header khác.

Proxy phải ghi đè hoặc làm sạch các header từ khách, và cổng Waitress chỉ cho proxy truy cập. Kiểm tra IP khách và HTTPS tại môi trường triển khai trước khi dùng giới hạn yêu cầu chung. Thay đổi này chỉ cung cấp tùy chọn ứng dụng, chưa cấu hình hạ tầng.

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
| Tra cứu bảo hành | 15 |

`RATE_LIMIT_ENABLED=1` mặc định bật. Nếu kho bộ đếm không truy cập được, các thao tác được giới hạn trả 503. Cửa sổ cố định có thể cho phép một đợt yêu cầu ở cuối phút và một đợt nữa ở đầu phút tiếp theo.

Bộ đếm dùng `REMOTE_ADDR` sau bước xử lý proxy của Waitress. Chỉ bật proxy tin cậy theo hướng dẫn trên để nhiều khách phía sau reverse proxy được nhận diện đúng. Đây chưa phải kiểm tra tải hoặc bảo vệ chống mọi hình thức lạm dụng.

## Tin tức, bảo hành và tạo đơn

Tin nháp/ẩn không xuất hiện qua API công khai. Tin hẹn giờ chỉ xuất hiện sau thời điểm được lưu; thời gian hiện dùng đồng hồ máy chủ, cần đặt múi giờ thống nhất với người biên tập. Lọc trạng thái khác `published` qua API công khai trả 400.

Tra cứu bảo hành yêu cầu cả số điện thoại và mã phiếu hoặc serial khớp hồ sơ. Kết quả công khai che serial và không trả tên khách, điện thoại, ghi chú nội bộ hoặc lịch sử nội bộ. Hướng dẫn khách dùng đủ hai thông tin sau khi cập nhật website.

Khi tạo đơn gặp 409, 429 hoặc mất kết nối, giữ nguyên mã yêu cầu để lần thử lại không tạo đơn khác. Giao diện chỉ xóa mã sau khi nhận được mã đơn hợp lệ; không tự gửi lại bằng mã mới khi gặp xung đột. Backend kiểm tra thông tin khách, phương thức thanh toán, số lượng và tổng tiền trước khi trừ kho.

Giao diện khóa thao tác gửi đơn trước khi bắt đầu tải sản phẩm/giỏ hàng, đồng thời khóa nút quay lại và phương thức thanh toán đến khi có kết quả. Sau lỗi, thử lại ngay trên trang hiện tại với thông tin giữ nguyên. Bài kiểm tra trình duyệt cố ý làm mất phản hồi sau khi database lưu thành công và xác nhận lần thử lại trả về đúng mã đơn cũ.

Nếu dịch vụ danh sách địa chỉ lỗi, khách vẫn nhập được địa chỉ đầy đủ bằng tay. Nút tải lại chỉ khởi chạy một lần tải tại một thời điểm và giữ nguyên thông tin đã nhập; danh sách trống hoặc lỗi được chuyển sang hướng dẫn nhập tay. Đây là lựa chọn thay thế cho dịch vụ địa chỉ, không xác minh địa chỉ có giao hàng được hay không.

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
