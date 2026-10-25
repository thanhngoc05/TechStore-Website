import re
import os
import json
import hashlib
import hmac
import importlib.util
import uuid
import random
import secrets
import click
import string
import smtplib
import ssl
import socket
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
import urllib.request
import urllib.error
from urllib.parse import urlsplit
from contextlib import contextmanager
import threading
from flask import Flask, request, jsonify, send_from_directory, send_file, abort
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt, get_jwt_identity
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from datetime import timedelta, datetime
from io import BytesIO
from PIL import Image as PillowImage, UnidentifiedImageError
import requests
# Import PayOS
from payos import PayOS
import time

# Import ReportLab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

from werkzeug.utils import secure_filename
from sqlalchemy import inspect, func, select, case
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.exc import OperationalError, IntegrityError, InvalidRequestError, SQLAlchemyError

# Load local .env (dev)
try:
    _env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'env.py')
    if os.path.exists(_env_path):
        _spec = importlib.util.spec_from_file_location('nextech_env', _env_path)
        if _spec and _spec.loader:
            _env_mod = importlib.util.module_from_spec(_spec)
            _spec.loader.exec_module(_env_mod)
            if hasattr(_env_mod, 'load_env'):
                _env_mod.load_env()
except Exception:
    pass

EMAIL_REGEX = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'

def _is_valid_email(email: str) -> bool:
    try:
        v = (email or '').strip()
    except Exception:
        return False
    if not v:
        return False
    return re.match(EMAIL_REGEX, v) is not None

app = Flask(__name__)

# --- CẤU HÌNH ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'assets', 'img')
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', '').strip()
if len(app.config['JWT_SECRET_KEY']) < 32:
    raise RuntimeError('Set JWT_SECRET_KEY to a private random value of at least 32 characters.')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
app.config['MAX_CONTENT_LENGTH'] = 6 * 1024 * 1024
app.config['MAX_JSON_BODY_LENGTH'] = 1024 * 1024

# --- DATABASE CONFIG (backend/config.py) ---
config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.py')
if not os.path.exists(config_path):
    raise RuntimeError(
        "Không tìm thấy backend/config.py. Vui lòng tạo file backend/config.py và cấu hình SQLALCHEMY_DATABASE_URI."
    )

try:
    spec = importlib.util.spec_from_file_location('nextech_config', config_path)
    if not spec or not spec.loader:
        raise RuntimeError("Không thể tải backend/config.py (spec/loader không hợp lệ).")

    config_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config_module)

    app.config['SQLALCHEMY_DATABASE_URI'] = getattr(config_module, 'SQLALCHEMY_DATABASE_URI', None)
    if not app.config['SQLALCHEMY_DATABASE_URI']:
        raise RuntimeError("Thiếu SQLALCHEMY_DATABASE_URI trong backend/config.py")

    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = getattr(
        config_module, 'SQLALCHEMY_TRACK_MODIFICATIONS', False
    )

    engine_opts = getattr(config_module, 'SQLALCHEMY_ENGINE_OPTIONS', None)
    if engine_opts:
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = engine_opts
except RuntimeError:
    raise
except Exception as e:
    raise RuntimeError(f"Lỗi khi tải cấu hình database từ backend/config.py: {str(e)}")

DEFAULT_PRODUCT_STOCK = int(os.getenv('DEFAULT_PRODUCT_STOCK', '999'))

try:
    db = SQLAlchemy(app)
except ModuleNotFoundError as e:
    if getattr(e, 'name', None) == 'pymysql':
        raise SystemExit(
            "Thiếu thư viện PyMySQL nên không tạo được kết nối MySQL. "
            "Hãy dùng đúng virtualenv (.venv) và cài dependencies: pip install -r backend/requirements.txt"
        ) from None
    raise
bcrypt = Bcrypt(app)
jwt = JWTManager(app)
CORS(app)

# --- Khởi tạo PayOS client từ biến môi trường ---
payos_client = None
try:
    payos_client_id = os.getenv('PAYOS_CLIENT_ID', '').strip()
    payos_api_key = os.getenv('PAYOS_API_KEY', '').strip()
    payos_checksum_key = os.getenv('PAYOS_CHECKSUM_KEY', '').strip()
    if payos_client_id and payos_api_key and payos_checksum_key:
        payos_client = PayOS(client_id=payos_client_id, api_key=payos_api_key, checksum_key=payos_checksum_key)
        app.logger.info("PayOS client initialized")
    else:
        app.logger.warning("PayOS credentials missing, payment will fallback to COD")
except Exception as e:
    app.logger.error(f"PayOS init error: {e}")

@contextmanager
def _session_begin():
    try:
        # Authentication queries may have already opened an implicit transaction.
        yield
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

# --- MODELS ---
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone = db.Column(db.String(15), nullable=True)
    role = db.Column(db.String(20), default='user')
    is_locked = db.Column(db.Boolean, default=False)
    address = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class PasswordResetToken(db.Model):
    __tablename__ = 'password_reset_tokens'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    token_hash = db.Column(db.String(64), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)

class RequestRateBucket(db.Model):
    __tablename__ = 'request_rate_buckets'
    key_hash = db.Column(db.String(64), primary_key=True)
    hits = db.Column(db.Integer, nullable=False, default=1)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)

class Product(db.Model):
    __tablename__ = 'products'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    brand = db.Column(db.String(50))
    price = db.Column(db.BigInteger, nullable=False)
    old_price = db.Column(db.BigInteger, default=0)
    img = db.Column(db.String(500), nullable=False)
    specs = db.Column(db.Text)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.now)
    rating = db.Column(db.Float, default=0.0)
    review_count = db.Column(db.Integer, default=0)
    stock = db.Column(db.Integer, nullable=False, default=DEFAULT_PRODUCT_STOCK)
    is_hidden = db.Column(db.Boolean, default=False, nullable=False)

class Banner(db.Model):
    __tablename__ = 'banners'
    id = db.Column(db.Integer, primary_key=True)
    img = db.Column(db.Text, nullable=False)
    position = db.Column(db.String(50))

class NewsPost(db.Model):
    __tablename__ = 'news_posts'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(250), nullable=False)
    slug = db.Column(db.String(260), unique=True, nullable=False)
    summary = db.Column(db.Text, nullable=True)
    content = db.Column(db.Text, nullable=False)
    thumbnail = db.Column(db.String(600), nullable=True)
    banner = db.Column(db.String(600), nullable=True)
    status = db.Column(db.String(20), nullable=False, default='draft')
    scheduled_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class WarrantyRecord(db.Model):
    __tablename__ = 'warranty_records'
    id = db.Column(db.Integer, primary_key=True)
    warranty_code = db.Column(db.String(80), unique=True, nullable=False)
    product_name = db.Column(db.String(250), nullable=False)
    serial_imei = db.Column(db.String(120), nullable=True)
    customer_name = db.Column(db.String(120), nullable=True)
    phone = db.Column(db.String(25), nullable=False)
    activated_at = db.Column(db.Date, nullable=True)
    expired_at = db.Column(db.Date, nullable=True)
    status = db.Column(db.String(20), nullable=False, default='active')
    history = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

class Review(db.Model):
    __tablename__ = 'reviews'
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    username = db.Column(db.String(80), nullable=False)
    rating = db.Column(db.Integer, nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

class CartItem(db.Model):
    __tablename__ = 'cart_items'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime, default=datetime.now)
    __table_args__ = (db.UniqueConstraint('user_id', 'product_id', name='uq_cart_user_product'),)

class Order(db.Model):
    __tablename__ = 'orders'
    id = db.Column(db.Integer, primary_key=True)
    order_code = db.Column(db.String(40), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(30), default='processing')
    total_amount = db.Column(db.BigInteger, nullable=False, default=0)
    payment_method = db.Column(db.String(20), nullable=True)
    customer_name = db.Column(db.String(120), nullable=False)
    customer_phone = db.Column(db.String(20), nullable=False)
    customer_address = db.Column(db.Text, nullable=False)
    customer_email = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

class OrderItem(db.Model):
    __tablename__ = 'order_items'
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    product_name = db.Column(db.String(200), nullable=False)
    price = db.Column(db.BigInteger, nullable=False)
    quantity = db.Column(db.Integer, nullable=False)

class Payment(db.Model):
    __tablename__ = 'payments'
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False)
    provider = db.Column(db.String(20), nullable=False, default='mock')
    amount = db.Column(db.BigInteger, nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')
    payment_ref = db.Column(db.String(64), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)
    checkout_url = db.Column(db.String(500), nullable=True)  # Lưu link thanh toán PayOS

class OrderIdempotency(db.Model):
    __tablename__ = 'order_idempotency'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    key = db.Column(db.String(120), nullable=False)
    request_hash = db.Column(db.String(64), nullable=False)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    __table_args__ = (db.UniqueConstraint('user_id', 'key', name='uq_order_idem_user_key'),)

class RefundRequest(db.Model):
    __tablename__ = 'refund_requests'
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False, unique=True)
    status = db.Column(db.String(20), nullable=False, default='pending')
    revision = db.Column(db.Integer, nullable=False, default=1)
    name = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    email = db.Column(db.String(120), nullable=False, default='')
    bank_name = db.Column(db.String(120), nullable=False)
    account_number = db.Column(db.String(100), nullable=False)
    account_holder = db.Column(db.String(120), nullable=False)
    note = db.Column(db.Text, nullable=False, default='')
    staff_note = db.Column(db.Text, nullable=False, default='')
    reviewed_by = db.Column(db.String(80), nullable=True)
    notification_sent = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

class RefundReviewEvent(db.Model):
    __tablename__ = 'refund_review_events'
    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('refund_requests.id'), nullable=False, index=True)
    from_status = db.Column(db.String(20), nullable=False)
    to_status = db.Column(db.String(20), nullable=False)
    staff_note = db.Column(db.Text, nullable=False)
    actor = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

class RefundNotificationAttempt(db.Model):
    __tablename__ = 'refund_notification_attempts'
    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('refund_requests.id'), nullable=False, index=True)
    outcome = db.Column(db.String(16), nullable=False)
    error_code = db.Column(db.String(80), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

# --- HELPERS ---
app.config['RATE_LIMIT_ENABLED'] = os.getenv('RATE_LIMIT_ENABLED', '1').lower() not in ('0', 'false', 'no')
app.config['REQUEST_RATE_LIMITS'] = {
    'login': (30, 60), 'register': (10, 60),
    'forgot_password': (5, 60), 'reset_password': (10, 60),
    'public_contact': (10, 60), 'public_refund_request': (5, 60),
    'add_review': (30, 60), 'admin_review_refund': (30, 60),
    'admin_retry_refund_notification': (5, 60),
}


@app.before_request
def limit_request_body():
    if request.is_json:
        request.max_content_length = min(app.config['MAX_CONTENT_LENGTH'], app.config['MAX_JSON_BODY_LENGTH'])
    if request.content_length and request.content_length > request.max_content_length:
        return request_too_large(None)


@app.errorhandler(413)
def request_too_large(error):
    return jsonify({'msg': 'Dữ liệu gửi lên vượt quá dung lượng cho phép.'}), 413


@app.after_request
def protect_response_metadata(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer' if request.path.endswith('reset-password.html') else 'same-origin'
    private = (request.method not in ('GET', 'HEAD', 'OPTIONS') or request.headers.get('Authorization')
        or request.path.startswith(('/admin/', '/api/profile', '/api/cart', '/api/orders', '/api/refund-requests'))
        or request.path in ('/login', '/register', '/api/forgot-password', '/api/reset-password', '/api/ready'))
    if private:
        response.headers['Cache-Control'] = 'no-store'
        response.vary.add('Authorization')
    return response


@app.before_request
def enforce_request_rate_limit():
    rule = app.config['REQUEST_RATE_LIMITS'].get(request.endpoint)
    if not app.config['RATE_LIMIT_ENABLED'] or not rule or request.method not in ('POST', 'PUT', 'DELETE'):
        return None
    limit, seconds = rule
    now = int(time.time())
    window = now // seconds
    identity = f'{request.endpoint}|{request.remote_addr or "unknown"}|{window}'
    key = hmac.new(app.config['JWT_SECRET_KEY'].encode(), identity.encode(), hashlib.sha256).hexdigest()
    table = RequestRateBucket.__table__
    values = {'key_hash': key, 'hits': 1, 'expires_at': datetime.fromtimestamp((window + 1) * seconds) + timedelta(days=1)}
    increment = case((table.c.hits < limit + 1, table.c.hits + 1), else_=table.c.hits)
    try:
        with db.engine.begin() as connection:
            if connection.dialect.name == 'sqlite':
                statement = sqlite_insert(table).values(**values).on_conflict_do_update(
                    index_elements=['key_hash'], set_={'hits': increment})
            elif connection.dialect.name == 'mysql':
                statement = mysql_insert(table).values(**values).on_duplicate_key_update(hits=increment)
            else:
                return jsonify({'msg': 'Database chưa hỗ trợ giới hạn yêu cầu.'}), 503
            connection.execute(statement)
            hits = connection.execute(select(table.c.hits).where(table.c.key_hash == key)).scalar_one()
    except SQLAlchemyError:
        app.logger.exception('Request rate storage unavailable')
        return jsonify({'msg': 'Tạm thời chưa xử lý được yêu cầu. Vui lòng thử lại.'}), 503
    if hits > limit:
        retry_after = (window + 1) * seconds - now
        response = jsonify({'msg': 'Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.', 'retry_after': retry_after})
        response.status_code = 429
        response.headers['Retry-After'] = str(retry_after)
        return response


def _positive_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError('Expected a positive integer')
    result = int(value)
    if result < 1:
        raise ValueError('Expected a positive integer')
    return result

def _validated_account_input(data, allow_role=False):
    if not isinstance(data, dict):
        raise ValueError('Dữ liệu tài khoản không hợp lệ')
    values = {}
    for field, limit in (('username', 80), ('email', 120), ('phone', 15), ('address', 1000)):
        value = data.get(field, '')
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError('Thông tin tài khoản không hợp lệ hoặc quá dài')
        values[field] = value.strip()
    password = data.get('password')
    if not isinstance(password, str) or len(password) < 6 or len(password.encode('utf-8')) > 72:
        raise ValueError('Mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte')
    if not values['username'] or not _is_valid_email(values['email']):
        raise ValueError('Tên tài khoản và email không hợp lệ')
    role = data.get('role', 'user') if allow_role else 'user'
    if role not in ('user', 'admin'):
        raise ValueError('Quyền tài khoản không hợp lệ')
    values.update(password=password, role=role)
    return values

def _nonnegative_int(value, maximum=9223372036854775807):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError('Giá và tồn kho phải là số nguyên không âm')
    result = int(value)
    if not 0 <= result <= maximum:
        raise ValueError('Giá hoặc tồn kho nằm ngoài phạm vi cho phép')
    return result

def _validated_text_fields(data, fields, required=(), single_line=()):
    if not isinstance(data, dict):
        raise ValueError('Dữ liệu yêu cầu không hợp lệ')
    result = {}
    for name, limit in fields.items():
        value = data.get(name, '')
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError('Thông tin không hợp lệ hoặc quá dài')
        value = value.strip()
        if (name in required and not value) or (name in single_line and ('\r' in value or '\n' in value)):
            raise ValueError('Thiếu thông tin bắt buộc hoặc có ký tự xuống dòng không hợp lệ')
        result[name] = value
    return result


def _validated_product_input(data, partial=False):
    if not isinstance(data, dict):
        raise ValueError('Dữ liệu sản phẩm không hợp lệ')
    values = {}
    for field, limit in (('name', 200), ('category', 50), ('img', 500), ('brand', 50), ('description', 100000)):
        if partial and field not in data:
            continue
        value = data.get(field, '')
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError('Thông tin sản phẩm không hợp lệ hoặc quá dài')
        if field in ('name', 'category', 'img') and not value.strip():
            raise ValueError('Thiếu tên, danh mục hoặc ảnh sản phẩm')
        values[field] = value.strip()
    for field in ('price', 'old_price', 'stock'):
        if partial and field not in data:
            continue
        values[field] = _nonnegative_int(data.get(field, 0), 2147483647 if field == 'stock' else 9223372036854775807)
    if not partial or 'specs' in data:
        specs = data.get('specs', {})
        if not isinstance(specs, dict):
            raise ValueError('Thông số sản phẩm phải là một đối tượng JSON')
        values['specs'] = json.dumps(specs, ensure_ascii=False)
    return values
def _password_version(user):
    return hashlib.sha256(user.password.encode('utf-8')).hexdigest()


@jwt.token_in_blocklist_loader
def _password_changed_since_login(jwt_header, jwt_payload):
    user = User.query.filter_by(username=jwt_payload.get('sub')).first()
    # Existing access checks supply the appropriate deleted/locked-user response.
    if not user:
        return False
    return not secrets.compare_digest(str(jwt_payload.get('password_version', '')), _password_version(user))


def _get_current_user_entity():
    current_username = get_jwt_identity()
    user = User.query.filter_by(username=current_username).first()
    if not user:
        return None, (jsonify({"msg": "User không tồn tại"}), 404)
    if user.is_locked:
        return None, (jsonify({"msg": "Tài khoản của bạn hiện đang bị khóa!"}), 403)
    return user, None

def _refundable_payment(order):
    return Payment.query.filter(Payment.order_id == order.id, Payment.status == 'success',
        Payment.provider.in_(('payos', 'momo', 'bank', 'napas', 'atm'))).order_by(Payment.id.desc()).first()

def _refund_payload(record, full=False):
    order = db.session.get(Order, record.order_id)
    result = {'id': record.id, 'order_code': order.order_code, 'status': record.status, 'revision': record.revision,
        'bank_name': record.bank_name, 'account_last4': record.account_number[-4:],
        'staff_note': record.staff_note, 'created_at': _fmt_dt(record.created_at),
        'updated_at': _fmt_dt(record.updated_at), 'notification_sent': record.notification_sent}
    if full:
        result.update(name=record.name, phone=record.phone, email=record.email,
            account_number=record.account_number, account_holder=record.account_holder,
            note=record.note, reviewed_by=record.reviewed_by, amount=order.total_amount)
        events = RefundReviewEvent.query.filter_by(request_id=record.id).order_by(RefundReviewEvent.id.desc()).limit(20).all()
        result['events'] = [{'from_status': event.from_status, 'to_status': event.to_status,
            'staff_note': event.staff_note, 'actor': event.actor, 'created_at': _fmt_dt(event.created_at)} for event in events]
        result['notification'] = _refund_notification_state(record)
    return result

def _refund_notification_state(record):
    query = RefundNotificationAttempt.query.filter_by(request_id=record.id)
    latest = query.order_by(RefundNotificationAttempt.id.desc()).first()
    state = 'sent' if record.notification_sent else (latest.outcome if latest else 'pending')
    dev_mode = (os.getenv('EMAIL_MODE') or '').strip().lower() in ('file', 'console')
    return {'state': state, 'attempts': query.count(), 'error_code': latest.error_code if latest else None,
            'retry_allowed': state != 'sent' and (state != 'simulated' or not dev_mode)}


def _deliver_refund_notification(request_id):
    # Serialize delivery attempts for one request across application workers.
    with _session_begin():
        record = RefundRequest.query.filter_by(id=request_id).with_for_update().one()
        if not _refund_notification_state(record)['retry_allowed']:
            return _refund_notification_state(record)
        receiver = (os.getenv('CONTACT_TO_EMAIL') or os.getenv('SMTP_USER') or os.getenv('SMTP_FROM') or '').strip()
        sent, error = False, 'missing_receiver'
        if receiver:
            order = db.session.get(Order, record.order_id)
            payment = _refundable_payment(order)
            provider = payment.provider if payment else 'online'
            try:
                sent, error = _send_email_if_configured(receiver,
                    f'NexTech - Yêu cầu hoàn tiền ({provider.upper()}) - Mã đơn {order.order_code}',
                    f'Yêu cầu #{record.id} đã được lưu.\nMã đơn: {order.order_code}\nHọ tên: {record.name}\n'
                    'Vui lòng mở hàng đợi hoàn tiền trong trang quản trị để kiểm tra chi tiết.',
                    reply_to_override=record.email)
            except Exception:
                app.logger.exception('Refund notification delivery failed')
                sent, error = False, 'delivery_exception'
        dev_mode = (os.getenv('EMAIL_MODE') or '').strip().lower() in ('file', 'console')
        outcome = ('simulated' if dev_mode else 'sent') if sent else 'failed'
        record.notification_sent = outcome == 'sent'
        safe_error = error if isinstance(error, str) and re.fullmatch(r'[a-z0-9_]{1,80}', error) else 'delivery_failed'
        db.session.add(RefundNotificationAttempt(request_id=record.id, outcome=outcome,
                                                error_code=None if sent else safe_error))
    return _refund_notification_state(record)

def _require_admin():
    user, err = _get_current_user_entity()
    if err:
        return None, err
    if (user.role or '').lower() != 'admin':
        return None, (jsonify({"msg": "Bạn không có quyền Admin"}), 403)
    return user, None

def _restock_order_items(order_id: int):
    items = OrderItem.query.filter_by(order_id=order_id).all()
    if not items:
        return
    qty_map = {}
    for it in items:
        qty_map[it.product_id] = qty_map.get(it.product_id, 0) + int(it.quantity)
    products = Product.query.filter(Product.id.in_(list(qty_map.keys()))).with_for_update().all()
    prod_map = {p.id: p for p in products}
    for pid, qty in qty_map.items():
        p = prod_map.get(pid)
        if not p:
            continue
        p.stock = int(p.stock) + int(qty)

def _generate_order_code():
    ts = datetime.now().strftime('%y%m%d%H%M%S')
    rand = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"ORD{ts}{rand}"

def _slugify(v: str) -> str:
    raw = (v or '').strip().lower()
    raw = re.sub(r'[^a-z0-9\s-]', '', raw)
    raw = re.sub(r'\s+', '-', raw)
    raw = re.sub(r'-{2,}', '-', raw)
    return raw.strip('-') or f"post-{uuid.uuid4().hex[:8]}"

def _parse_datetime(value: str):
    s = (value or '').strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M'):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None

def _parse_date(value: str):
    s = (value or '').strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    return None

def _fmt_dt(v):
    return v.strftime('%d/%m/%Y %H:%M:%S') if v else None

def _fmt_date(v):
    return v.strftime('%d/%m/%Y') if v else None

def _compute_order_request_hash(
    customer_name: str,
    customer_phone: str,
    customer_address: str,
    customer_email: str,
    qty_map: dict,
    payment_method: str,
) -> str:
    items = sorted(
        [(int(pid), int(qty)) for pid, qty in (qty_map or {}).items()],
        key=lambda x: x[0],
    )
    payload = {
        "customer": {
            "name": (customer_name or '').strip(),
            "phone": (customer_phone or '').strip(),
            "address": (customer_address or '').strip(),
            "email": (customer_email or '').strip(),
        },
        "items": items,
        "payment_method": (payment_method or '').strip().lower(),
    }
    raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()

def _send_email_if_configured(to_email: str, subject: str, body: str, reply_to_override=None):
    to_email = (to_email or '').strip()
    if not to_email or not _is_valid_email(to_email):
        return False, 'invalid_email'

    smtp_host = (os.getenv('SMTP_HOST') or '').strip()
    smtp_user = (os.getenv('SMTP_USER') or '').strip()
    smtp_pass = os.getenv('SMTP_PASS') or ''
    smtp_from = (os.getenv('SMTP_FROM') or smtp_user or '').strip()
    smtp_from_name = (os.getenv('SMTP_FROM_NAME') or '').strip()
    envelope_from = (os.getenv('SMTP_ENVELOPE_FROM') or smtp_user or smtp_from).strip()

    effective_reply_to = ''
    try:
        override = (reply_to_override or '').strip()
        if override and _is_valid_email(override) and ('\n' not in override) and ('\r' not in override):
            effective_reply_to = override
    except Exception:
        pass
    if not effective_reply_to:
        try:
            env_reply_to = (os.getenv('SMTP_REPLY_TO') or '').strip()
            if env_reply_to and _is_valid_email(env_reply_to) and ('\n' not in env_reply_to) and ('\r' not in env_reply_to):
                effective_reply_to = env_reply_to
        except Exception:
            pass

    smtp_ready = bool(smtp_host and smtp_user and smtp_pass and smtp_from)

    email_mode = (os.getenv('EMAIL_MODE') or '').strip().lower()
    if email_mode in ('file', 'console'):
        try:
            msg = EmailMessage()
            msg['To'] = to_email
            msg['Subject'] = subject
            dev_from = (os.getenv('SMTP_FROM') or os.getenv('SMTP_USER') or 'noreply@nextech.local').strip()
            msg['From'] = dev_from
            msg['Date'] = formatdate(localtime=True)
            try:
                domain = dev_from.split('@', 1)[1] if '@' in dev_from else None
            except Exception:
                domain = None
            msg['Message-ID'] = make_msgid(domain=domain)
            if effective_reply_to:
                msg['Reply-To'] = effective_reply_to
            msg.set_content(body, subtype='plain', charset='utf-8')

            if email_mode == 'console':
                try:
                    app.logger.info('DEV EMAIL (console)\n%s', msg.as_string())
                except Exception:
                    pass
                return True, None

            from pathlib import Path
            root_dir = Path(__file__).resolve().parent.parent
            out_dir = Path(os.getenv('EMAIL_FILE_DIR') or (root_dir / 'instance' / 'emails'))
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
            safe_to = ''.join(ch for ch in to_email if ch.isalnum() or ch in ('@', '.', '_', '-'))
            filename = f"email_{ts}_{rand}_{safe_to}.eml"
            out_path = out_dir / filename
            out_path.write_text(msg.as_string(), encoding='utf-8')
            try:
                app.logger.info('DEV EMAIL (file) saved: %s', str(out_path))
            except Exception:
                pass
            return True, None
        except Exception:
            try:
                app.logger.exception('DEV EMAIL failed (mode=%s to=%s)', email_mode, to_email)
            except Exception:
                pass
            return False, 'dev_email_failed'

    missing = []
    if not smtp_host:
        missing.append('SMTP_HOST')
    if not smtp_user:
        missing.append('SMTP_USER')
    if not smtp_pass:
        missing.append('SMTP_PASS')
    if not smtp_from:
        missing.append('SMTP_FROM')

    if missing:
        try:
            app.logger.warning(
                'SMTP not configured; email_mode=%s missing=%s',
                email_mode or '<empty>',
                ','.join(missing),
            )
        except Exception:
            pass
        return False, 'smtp_not_configured'

    smtp_ssl = os.getenv('SMTP_SSL', 'false').lower() in ('1', 'true', 'yes')
    smtp_tls = os.getenv('SMTP_TLS', 'true').lower() in ('1', 'true', 'yes')
    if smtp_ssl:
        default_port = 465
    elif smtp_tls:
        default_port = 587
    else:
        default_port = 25
    try:
        smtp_port = int(os.getenv('SMTP_PORT', str(default_port)))
    except Exception:
        smtp_port = default_port

    try:
        smtp_timeout = int(os.getenv('SMTP_TIMEOUT', '10'))
    except Exception:
        smtp_timeout = 10
    smtp_timeout = max(1, min(smtp_timeout, 120))

    try:
        msg = EmailMessage()
        msg['From'] = formataddr((smtp_from_name, smtp_from)) if smtp_from_name else smtp_from
        msg['To'] = to_email
        msg['Subject'] = subject
        msg['Date'] = formatdate(localtime=True)
        try:
            domain = smtp_from.split('@', 1)[1] if '@' in smtp_from else None
        except Exception:
            domain = None
        msg['Message-ID'] = make_msgid(domain=domain)
        if effective_reply_to:
            msg['Reply-To'] = effective_reply_to
        msg.set_content(body, subtype='plain', charset='utf-8')

        ssl_context = ssl.create_default_context()

        if smtp_ssl:
            with smtplib.SMTP_SSL(
                smtp_host,
                smtp_port,
                timeout=smtp_timeout,
                context=ssl_context,
            ) as server:
                server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg, from_addr=envelope_from, to_addrs=[to_email])
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=smtp_timeout) as server:
                server.ehlo()
                if smtp_tls:
                    server.starttls(context=ssl_context)
                    server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg, from_addr=envelope_from, to_addrs=[to_email])
        return True, None
    except smtplib.SMTPAuthenticationError:
        return False, 'smtp_auth_failed'
    except smtplib.SMTPRecipientsRefused:
        return False, 'smtp_recipient_refused'
    except (socket.timeout, TimeoutError):
        return False, 'smtp_timeout'
    except (smtplib.SMTPConnectError, ConnectionRefusedError, socket.gaierror, OSError):
        return False, 'smtp_connect_failed'
    except Exception as e:
        try:
            app.logger.exception('SMTP send failed')
        except Exception:
            pass
        return False, f"smtp_failed:{type(e).__name__}"

def _send_email_async(to_email: str, subject: str, body: str, reply_to_override=None):
    thread = threading.Thread(
        target=_send_email_if_configured,
        args=(to_email, subject, body, reply_to_override),
        daemon=True
    )
    thread.start()
    return True, "queued"

def ensure_schema():
    def _column_exists(table_name: str, column_name: str) -> bool:
        try:
            insp = inspect(db.engine)
            cols = insp.get_columns(table_name)
            return any((c.get('name') == column_name) for c in (cols or []))
        except Exception:
            return False

    def _try_ddl(sql: str):
        try:
            db.session.execute(db.text(sql))
            db.session.commit()
        except Exception:
            db.session.rollback()

    if not _column_exists('products', 'stock'):
        _try_ddl(f"ALTER TABLE products ADD COLUMN stock INT NOT NULL DEFAULT {DEFAULT_PRODUCT_STOCK}")
    if not _column_exists('products', 'is_hidden'):
        _try_ddl("ALTER TABLE products ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT 0")
    if not _column_exists('orders', 'payment_method'):
        _try_ddl("ALTER TABLE orders ADD COLUMN payment_method VARCHAR(20)")
    if not _column_exists('users', 'created_at'):
        _try_ddl("ALTER TABLE users ADD COLUMN created_at DATETIME")
        _try_ddl("UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
    if not _column_exists('users', 'updated_at'):
        _try_ddl("ALTER TABLE users ADD COLUMN updated_at DATETIME")
        _try_ddl("UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL")
    if not _column_exists('payments', 'checkout_url'):
        _try_ddl("ALTER TABLE payments ADD COLUMN checkout_url VARCHAR(500)")

    try:
        changed = 0
        changed += Order.query.filter(Order.status.in_(['paid', 'paid ', 'PAID'])).update({"status": "processing"})
        changed += Order.query.filter(Order.status == 'payment_failed').update({"status": "cancelled"})
        changed += Order.query.filter(Order.status.in_(['shipping', 'shipping ', 'SHIPPING'])).update({"status": "processing"})
        if changed:
            db.session.commit()
    except Exception:
        db.session.rollback()

# --- SEED DATA ---
def seed_data():
    if Product.query.first():
        return
    full_data = {
        "Iphone": [
            {"name": "iPhone 17 Pro Max 256GB | Chính hãng", "price": 37790000, "oldPrice": 37990000, "img": "../assets/img/IP1.png", "brand": "Apple", "specs": {"Màn hình": "6.9 inch, LTPO Super Retina XDR", "Chip": "Apple A19 Bionic (3nm)", "RAM": "12GB", "Pin": "4500 mAh", "Camera": "48MP + 48MP + 48MP"}, "description": "<h3>Đỉnh cao công nghệ dẫn đầu kỷ nguyên AI</h3><p>iPhone 17 Pro Max không chỉ là một chiếc điện thoại, mà là một cỗ máy trí tuệ nhân tạo thực thụ.</p>"},
            {"name": "iPhone 17 256GB | Chính hãng", "price": 24590000, "oldPrice": 24990000, "img": "../assets/img/IP2.png", "brand": "Apple", "specs": {"Màn hình": "6.1 inch OLED", "Chip": "Apple A19", "RAM": "8GB", "Bộ nhớ": "256GB", "Camera": "48MP Dual"}, "description": "<h3>Sự kết hợp hoàn hảo giữa thiết kế và sức mạnh</h3><p>iPhone 17 tiêu chuẩn mang đến sự đột phá với bảng màu pastel mới cực kỳ thời thượng.</p>"},
            {"name": "iPhone Air 256GB | Chính hãng", "price": 24990000, "oldPrice": 31990000, "img": "../assets/img/IP3.png", "brand": "Apple", "specs": {"Thiết kế": "Siêu mỏng (5.5mm)", "Trọng lượng": "155g", "Chip": "Apple A18 Pro", "RAM": "8GB", "Màn hình": "6.3 inch"}, "description": "<h3>Định nghĩa lại sự mỏng nhẹ</h3><p>iPhone Air là dòng sản phẩm hoàn toàn mới với độ mỏng chỉ 5.5mm.</p>"},
            {"name": "iPhone 15 128GB | Chính hãng VN/A", "price": 17990000, "oldPrice": 19990000, "img": "../assets/img/IP4.png", "specs": {"Chip": "A16 Bionic", "RAM": "6GB", "Cổng sạc": "USB-C", "Màn hình": "6.1 inch Dynamic Island", "Camera": "48MP"}, "description": "<h3>Bước nhảy vọt với Dynamic Island</h3><p>iPhone 15 mang đến trải nghiệm tương tác hoàn toàn mới với Dynamic Island.</p>"},
            {"name": "iPhone 17e 256GB | Chính hãng", "price": 17990000, "oldPrice": 0, "img": "../assets/img/IP5.png", "specs": {"Chip": "Apple A18", "RAM": "8GB", "Màn hình": "6.1 inch OLED", "Pin": "3200 mAh"}, "description": "<h3>Lựa chọn tối ưu cho túi tiền</h3><p>iPhone 17e là phiên bản đặc biệt mang chip xử lý A18 mạnh mẽ xuống phân khúc giá rẻ hơn.</p>"},
            {"name": "iPhone 16e 128GB | Chính hãng VN/A", "price": 12490000, "oldPrice": 16990000, "img": "../assets/img/IP6.png", "specs": {"Chip": "A18 Bionic", "RAM": "8GB", "Màn hình": "6.1 inch", "Bộ nhớ": "128GB"}, "description": "<h3>Nhỏ gọn nhưng đầy uy lực</h3><p>Chip A18 đảm bảo máy hoạt động ổn định trong ít nhất 5 năm tới.</p>"},
            {"name": "iPhone 16 Pro 128GB | Chính hãng VN/A", "price": 26590000, "oldPrice": 28990000, "img": "../assets/img/IP7.png", "specs": {"Chip": "A18 Pro", "RAM": "8GB", "Màn hình": "6.3 inch 120Hz", "Vỏ": "Titanium cấp độ 5"}, "description": "<h3>Chất liệu Titanium đẳng cấp</h3><p>Khung viền Titanium bền bỉ và nhẹ hơn hẳn thép không gỉ.</p>"},
            {"name": "iPhone 16 Plus 128GB | Chính hãng VN/A", "price": 24790000, "oldPrice": 25990000, "img": "../assets/img/IP8.png", "specs": {"Pin": "4400 mAh (Cực trâu)", "Màn hình": "6.7 inch", "Chip": "A18", "RAM": "8GB"}, "description": "<h3>Pin trâu cho ngày dài năng động</h3><p>Nhà vô địch về thời lượng pin trong dòng iPhone 16.</p>"}
        ],
        "SamSung": [
            {"name": "Samsung Galaxy S26 Ultra 12GB 256GB", "price": 33990000, "oldPrice": 36990000, "img": "../assets/img/SS1.png", "brand": "Samsung", "specs": {"Chip": "Snapdragon 8 Gen 5", "RAM": "12GB", "Camera": "200MP Main", "Màn hình": "6.8 inch Dynamic AMOLED 2X", "AI": "Galaxy AI 2.0"}, "description": "<h3>Quyền năng tối thượng từ Galaxy AI</h3><p>Galaxy S26 Ultra định nghĩa lại trải nghiệm smartphone với Galaxy AI 2.0.</p>"},
            {"name": "Samsung Galaxy S25 Ultra 12GB 256GB", "price": 27490000, "oldPrice": 33380000, "img": "../assets/img/SS2.png", "specs": {"Chip": "Snapdragon 8 Gen 4", "RAM": "12GB", "Camera": "100x Space Zoom", "Pin": "5000 mAh"}, "description": "<h3>Vua nhiếp ảnh di động 2025</h3><p>Với khả năng Zoom 100x, Galaxy S25 Ultra cho phép bắt trọn chi tiết ở khoảng cách cực xa.</p>"},
            {"name": "Samsung Galaxy S26", "price": 22990000, "oldPrice": 25990000, "img": "../assets/img/SS3.png", "specs": {"Chip": "Exynos 2600", "RAM": "12GB", "Màn hình": "6.2 inch 120Hz", "Thiết kế": "Nhôm Armor Aluminum"}, "description": "<h3>Nhỏ gọn nhưng đầy nội lực</h3><p>Galaxy S26 mang lại hiệu năng ổn định và kiểm soát nhiệt độ cực tốt.</p>"},
            {"name": "Samsung Galaxy Z Fold7", "price": 41990000, "oldPrice": 46990000, "img": "../assets/img/SS4.png", "specs": {"Màn hình chính": "7.6 inch QXGA+", "Chip": "Snapdragon 8 Gen 5", "RAM": "12GB", "Bản lề": "Flex Hinge không kẽ hở"}, "description": "<h3>Máy tính bảng trong túi quần bạn</h3><p>Galaxy Z Fold7 với cơ chế gập Flex Hinge giúp máy phẳng hoàn toàn khi gập.</p>"},
            {"name": "Samsung Galaxy Z Flip7", "price": 23990000, "oldPrice": 28990000, "img": "../assets/img/SS5.png", "specs": {"Màn hình chính": "6.7 inch Gập", "Màn hình phụ": "3.9 inch", "RAM": "12GB", "Kháng nước": "IPX8"}, "description": "<h3>Biểu tượng thời trang công nghệ</h3><p>Z Flip7 với màn hình phụ cực đại 3.9 inch giúp bạn thao tác nhanh.</p>"},
            {"name": "Samsung Galaxy S24 Plus", "price": 16290000, "oldPrice": 18650000, "img": "../assets/img/SS6.png", "specs": {"Chip": "Exynos 2400", "RAM": "12GB", "Màn hình": "6.7 inch QHD+", "Pin": "4900 mAh"}, "description": "<h3>Lựa chọn Plus thông minh</h3><p>S24 Plus mang đến màn hình độ phân giải QHD+ siêu sắc nét.</p>"},
            {"name": "Samsung Galaxy S24 Ultra", "price": 25290000, "oldPrice": 29450000, "img": "../assets/img/SS7.png", "specs": {"Chip": "Snapdragon 8 Gen 3", "RAM": "12GB", "Vỏ": "Titanium"}, "description": "<h3>Flagship toàn diện</h3><p>Mẫu điện thoại đầu tiên của Samsung sử dụng khung Titanium cao cấp.</p>"},
            {"name": "Samsung Galaxy S25 Ultra 512GB", "price": 28810000, "oldPrice": 36810000, "img": "../assets/img/SS8.png", "specs": {"Bộ nhớ": "512GB", "RAM": "12GB", "Chip": "Snapdragon 8 Gen 4"}, "description": "<h3>Không gian lưu trữ vô tận</h3><p>Thoải mái lưu trữ hàng ngàn video 8K với dung lượng 512GB.</p>"}
        ],
        "Màn hình ASUS": [
            {"name": "Màn hình Asus ROG Strix XG32UQ 32 Fast IPS 4K", "price": 21990000, "oldPrice": 25990000, "img": "../assets/img/MH1.png", "brand": "Asus", "specs": {"Hz": "160", "Kích thước": "32 inch", "Độ phân giải": "4K", "Tấm nền": "IPS"}, "description": "<h3>Đỉnh cao đồ họa 4K</h3><p>ROG Strix XG32UQ mang lại hình ảnh sắc nét đến từng chi tiết.</p>"},
            {"name": "Màn hình Asus ROG Strix XG27ACMEG-G Hatsune", "price": 8990000, "oldPrice": 9990000, "img": "../assets/img/MH2.png", "brand": "Asus", "specs": {"Hz": "260", "Kích thước": "27 inch", "Màu sắc": "95% DCI-P3"}, "description": "<h3>Phiên bản giới hạn Hatsune Miku</h3><p>Thiết kế mang đậm phong cách nghệ thuật với tông màu xanh đặc trưng.</p>"},
            {"name": "Màn hình Asus ROG Swift PG27AQWP-W 27 WOLED", "price": 31990000, "oldPrice": 39990000, "img": "../assets/img/MH3.png", "brand": "Asus", "specs": {"Hz": "540", "Tấm nền": "WOLED", "Phản hồi": "0.03ms"}, "description": "<h3>Màn hình gaming nhanh nhất thế giới</h3><p>ROG Swift PG27AQWP phá vỡ mọi giới hạn với tần số quét 540Hz.</p>"}
        ],
        "Laptop DELL": [
            {"name": "Dell XPS 9350", "price": 54990000, "oldPrice": 59990000, "img": "../assets/img/DELL1.png", "brand": "Dell", "specs": {"RAM": "32GB", "SSD": "1TB", "CPU": "i7-1165G7", "Màn hình": "13.4 inch OLED 3K"}, "description": "<h3>Biểu tượng của sự sang trọng</h3><p>Dell XPS 13 sở hữu thiết kế nhôm nguyên khối cắt CNC tinh xảo.</p>"},
            {"name": "Laptop Dell Inspiron 5440 i5-1334U", "price": 16990000, "oldPrice": 19990000, "img": "../assets/img/DELL2.png", "brand": "Dell", "specs": {"RAM": "16GB", "SSD": "512GB", "CPU": "Core i5-1334U", "GPU": "NVIDIA MX550"}, "description": "<h3>Làm việc hiệu quả mỗi ngày</h3><p>Trang bị cấu hình ổn định giúp xử lý tốt các tác vụ văn phòng.</p>"},
            {"name": "Laptop Dell 15 DC15250 i7", "price": 20990000, "oldPrice": 23490000, "img": "../assets/img/DELL3.png", "brand": "Dell", "specs": {"CPU": "Core i7-1335U", "RAM": "16GB", "SSD": "1TB NVMe"}, "description": "<h3>Sức mạnh xử lý vượt trội</h3><p>Đáp ứng hoàn hảo nhu cầu đa nhiệm cao của người dùng doanh nghiệp.</p>"}
        ],
        "Bàn Phím": [
            {"name": "Bàn phím cơ VGN Không dây N75 Pro Blue Grey", "price": 1590000, "oldPrice": 1890000, "img": "../assets/img/BP1.png", "specs": {"Switch": "Akko CS Jelly Pink", "Kết nối": "Không dây", "Led": "RGB"}, "description": "<h3>Thiết kế nhỏ gọn, hiện đại</h3><p>Layout 75% tiết kiệm diện tích nhưng vẫn đầy đủ chức năng.</p>"},
            {"name": "Bàn phím cơ VGN không dây N75 Pro Orange Vaporware", "price": 5490000, "oldPrice": 5990000, "img": "../assets/img/BP2.png", "specs": {"Switch": "Razer Green Clicky", "Led": "Razer Chroma RGB", "Polling": "8KHz"}, "description": "<h3>Tốc độ phản hồi ánh sáng</h3><p>Tần số gửi tín hiệu lên đến 8000Hz, nhanh gấp 8 lần thông thường.</p>"},
            {"name": "Bàn phím cơ VGN Không dây N75 Pro Orange Azure", "price": 3590000, "oldPrice": 3990000, "img": "../assets/img/BP3.png", "specs": {"Switch": "GX Brown Tactile", "Kết nối": "Không dây Lightspeed"}, "description": "<h3>Thiết kế Esport chuyên nghiệp</h3><p>Dòng phím TKL huyền thoại nay đã có phiên bản không dây siêu tốc.</p>"},
            {"name": "Bàn phím cơ VGN Không dây N75 Pro Blue Grey Azure", "price": 2150000, "oldPrice": 2450000, "img": "../assets/img/BP4.png", "specs": {"Switch": "Keychron K Pro", "Tương thích": "Mac/Windows", "VIA": "Hỗ trợ"}, "description": "<h3>Hỗ trợ tối đa cho công việc</h3><p>Keychron K10 Pro hỗ trợ lập trình phím qua phần mềm VIA.</p>"}
        ],
        "SmartWatch": [
            {"name": "Đồng hồ thông minh Amazfit T-Rex 3 Pro", "price": 6590000, "oldPrice": 7290000, "img": "../assets/img/SW1.png", "specs": {"Pin": "25 ngày"}, "description": "Outdoor"},
            {"name": "Đồng hồ Huawei Watch GT6 Pro HONMA", "price": 15500000, "oldPrice": 17000000, "img": "../assets/img/SW2.png", "specs": {"Golf": True}, "description": "Luxury"},
            {"name": "Đồng hồ thông minh OPPO Watch S", "price": 3290000, "oldPrice": 3990000, "img": "../assets/img/SW3.png", "specs": {"Pin": "25 ngày", "Màn hình": "AMOLED 1.5 inch", "GPS": "Băng tần kép"}, "description": "<h3>Chiến binh bền bỉ</h3><p>Amazfit T-Rex 3 Pro đạt chuẩn quân đội với 15 chứng nhận độ bền.</p>"},
            {"name": "Đồng hồ thông minh Coros Pace 4", "price": 6190000, "oldPrice": 6500000, "img": "../assets/img/SW4.png", "specs": {"Trọng lượng": "28g"}, "description": "Chạy bộ"}
        ],
        "RAM": [
            {"name": "G.Skill Royal Gold", "price": 3450000, "oldPrice": 3850000, "img": "../assets/img/RAM1.png", "specs": {"Bus": "3600"}, "description": "RGB"},
            {"name": "G.Skill Royal Silver", "price": 3350000, "oldPrice": 3750000, "img": "../assets/img/RAM2.png", "specs": {"Bus": "3600"}, "description": "Silver"},
            {"name": "Kingston Fury 32GB", "price": 2190000, "oldPrice": 2590000, "img": "../assets/img/RAM3.png", "specs": {"Dung lượng": "32GB"}, "description": "Gaming"},
            {"name": "Corsair Dominator DDR5", "price": 5890000, "oldPrice": 6200000, "img": "../assets/img/RAM4.png", "specs": {"Bus": "6000"}, "description": "DDR5"}
        ],
        "CPU": [
            {"name": "Ryzen 5 9600X", "price": 7990000, "oldPrice": 8500000, "img": "../assets/img/CPU1.png", "specs": {"Socket": "AM5"}, "description": "Zen5"},
            {"name": "Ryzen 5 8500G", "price": 4890000, "oldPrice": 5200000, "img": "../assets/img/CPU2.png", "specs": {"iGPU": "740M"}, "description": "APU"},
            {"name": "Ryzen 5 5600", "price": 3150000, "oldPrice": 3500000, "img": "../assets/img/CPU3.png", "specs": {"Socket": "AM4"}, "description": "Giá tốt"}
        ]
    }
    for cat, items in full_data.items():
        for item in items:
            p = Product(name=item['name'], category=cat, price=item['price'], old_price=item['oldPrice'], img=item['img'], specs=json.dumps(item['specs']), description=item.get('description',''), brand=item.get('brand'), created_at=datetime.now())
            db.session.add(p)

    news_items = [
        {"title": "NEXTECH công bố flagship store mới tại thành phố Hồ Chí Minh", "summary": "Khai trương chi nhánh mới rộng 500m² với các sản phẩm công nghệ hàng đầu", "content": "NEXTECH tự hào khai trương flagship store mới tại 123 Nguyễn Huệ. Cửa hàng được thiết kế hiện đại với khu trưng bày tương tác, hỗ trợ khách hàng trực tiếp 24/7.", "thumbnail": "../assets/img/IP1.png", "status": "published"},
        {"title": "Khuyến mãi tháng 4: Giảm đến 40% cho iPhone 17 series", "summary": "Cơ hội vàng sở hữu iPhone 17 với mức giá ưu đãi niên kỷ", "content": "Chỉ trong tháng 4 này, khách hàng mua iPhone 17 Pro Max được giảm 10 triệu đồng, iPhone 17 giảm 6 triệu. Kèm quà tặng bao da, dán cường lực trị giá 2 triệu đồng.", "thumbnail": "../assets/img/IP2.png", "status": "published"},
        {"title": "Hướng dẫn chọn GPU gaming cho máy tính cấu hình cao", "summary": "Bộ hướng dẫn chi tiết từ các chuyên gia NEXTECH", "content": "Nếu bạn định xây dựng một máy tính gaming mạnh mẽ, chọn GPU thích hợp là điều quan trọng. Bài viết này sẽ giúp bạn hiểu rõ về hiệu suất, công suất tiêu thụ và giá cả.", "thumbnail": "../assets/img/CPU1.png", "status": "published"},
        {"title": "Samsung Galaxy S26: Sự kết hợp hoàn hảo giữa thiết kế và công nghệ", "summary": "Đánh giá chi tiết flagship mới từ Samsung", "content": "Samsung Galaxy S26 mang đến màn hình AMOLED 120Hz sắc nét, chip xử lý mạnh mẽ, camera AI nâng cao. Một bước tiến lớn trong công nghệ di động.", "thumbnail": "../assets/img/SS1.png", "status": "published"},
        {"title": "Bảo vệ dữ liệu cá nhân khi mua sắm online: Những bí quyết từ NEXTECH", "summary": "Hướng dẫn bảo mật toàn diện cho người dùng", "content": "Hơn 80% người dùng lo lắng về bảo vệ dữ liệu khi mua sắm online. NEXTECH cung cấp những bí quyết giúp bạn yên tâm mọc mũi trong các giao dịch.", "thumbnail": "../assets/img/IP3.png", "status": "published"},
        {"title": "Laptop siêu nhẹ vs Máy tính để bàn: Lựa chọn nào phù hợp?", "summary": "So sánh chi tiết giữa hai dòng sản phẩm phổ biến", "content": "Mỗi lựa chọn có ưu và nhược điểm riêng. Tìm hiểu chi tiết để đưa ra quyết định tốt nhất cho nhu cầu công việc của bạn.", "thumbnail": "../assets/img/LT1.png", "status": "published"},
        {"title": "Ra mắt sản phẩm: Smartwatch NEXTECH Pro 2026", "summary": "Thiết bị đeo thông minh với pin trâu 14 ngày", "content": "NEXTECH Smartwatch Pro 2026 có thể hoạt động liên tục 14 ngày một lần sạc, tích hợp AI health monitoring, giá chỉ từ 3,99 triệu đồng.", "thumbnail": "../assets/img/SW1.png", "status": "scheduled"},
        {"title": "Cẩm nang lựa chọn RAM cho máy tính: DDR4 vs DDR5", "summary": "Hiểu rõ sự khác biệt để nâng cấp máy tính hiệu quả", "content": "DDR5 nhanh hơn DDR4 nhưng chi phí cao hơn. Bài viết này sẽ giúp bạn quyết định nên nâng cấp hay không.", "thumbnail": "../assets/img/RAM1.png", "status": "draft"},
        {"title": "Dự báo xu hướng công nghệ năm 2026", "summary": "AI, folding phones, và công nghệ hologram sắp chiếm lĩnh thị trường", "content": "Năm 2026 hứa hẹn những bước tiến vượt bậc. Điều gì sẽ thay đổi? Tìm hiểu dự báo của các chuyên gia công nghệ hàng đầu.", "thumbnail": "../assets/img/IP1.png", "status": "draft"},
        {"title": "Đáng tiếc: Lý do tại sao bạn nên tránh mua smartphone cũ", "summary": "Những rủi ro tiềm ẩn khi mua thiết bị đã qua sử dụng", "content": "Pin có thể hư hỏng, lỗi ẩn, không bảo hành. Hãy chọn sản phẩm chính hãng từ NEXTECH với đủ bảo hành.", "thumbnail": "../assets/img/IP4.png", "status": "hidden"}
    ]
    for news_data in news_items:
        slug = _slugify(news_data['title'])
        ns = NewsPost(title=news_data['title'], slug=slug, summary=news_data['summary'], content=news_data['content'], thumbnail=news_data.get('thumbnail'), status=news_data.get('status', 'draft'), created_at=datetime.now())
        db.session.add(ns)

    warranty_items = [
        {"code": "WR26-0001-APPLE", "product_name": "iPhone 17 Pro Max", "serial": "A2Z9M4K8P2L5", "customer_name": "Nguyễn Văn A", "phone": "0987654321", "activated": "2026-01-15", "expired": "2028-01-15", "status": "active"},
        {"code": "WR26-0002-SAM", "product_name": "Samsung Galaxy S26", "serial": "R38K2M9P1L7", "customer_name": "Trần Thị B", "phone": "0912345678", "activated": "2025-12-20", "expired": "2027-12-20", "status": "active"},
        {"code": "WR26-0003-ASUS", "product_name": "ASUS ROG Laptop", "serial": "L92K3M1P5R8", "customer_name": "Phạm Hoàng C", "phone": "0901234567", "activated": "2024-06-10", "expired": "2026-06-10", "status": "active"},
        {"code": "WR26-0004-SONIC", "product_name": "Sonic Smartwatch Pro", "serial": "S48M2K1P9L3", "customer_name": "Lê Minh D", "phone": "0945678901", "activated": "2025-11-05", "expired": "2027-11-05", "status": "active"},
        {"code": "WR26-0005-APPLE", "product_name": "MacBook Pro M5", "serial": "M86K4P9L2M1", "customer_name": "Huỳnh Tuấn E", "phone": "0978901234", "activated": "2025-03-20", "expired": "2027-03-20", "status": "active"},
        {"code": "WR25-0006-SAM", "product_name": "Samsung Galaxy Z Fold7", "serial": "Z72K5M8P3L1", "customer_name": "Võ Thị F", "phone": "0934567890", "activated": "2024-09-15", "expired": "2025-09-15", "status": "expired"},
        {"code": "WR26-0007-INTEL", "product_name": "Intel Core i9 Processor", "serial": "I98K1M6P4L9", "customer_name": "Đỗ Văn G", "phone": "0956789012", "activated": "2025-07-01", "expired": "2028-07-01", "status": "active"},
        {"code": "WR26-0008-SAMSUNG", "product_name": "Samsung 4K Monitor", "serial": "M64K7M2P5L3", "customer_name": "Bùi Thu H", "phone": "0923456789", "activated": "2025-10-12", "expired": "2026-10-12", "status": "processing"},
        {"code": "WR26-0009-NVIDIA", "product_name": "NVIDIA RTX 5090", "serial": "G90K3M9P1L6", "customer_name": "Cao Nhật I", "phone": "0967890123", "activated": "2025-12-01", "expired": "2027-12-01", "status": "active"},
        {"code": "WR26-0010-CORSAIR", "product_name": "Corsair Gaming Keyboard", "serial": "K92K5M3P7L2", "customer_name": "Nông Hữu K", "phone": "0945123456", "activated": "2025-11-20", "expired": "2026-11-20", "status": "active"}
    ]
    for wr_data in warranty_items:
        wr = WarrantyRecord(
            warranty_code=wr_data['code'],
            product_name=wr_data['product_name'],
            serial_imei=wr_data['serial'],
            customer_name=wr_data['customer_name'],
            phone=wr_data['phone'],
            activated_at=datetime.strptime(wr_data['activated'], '%Y-%m-%d').date(),
            expired_at=datetime.strptime(wr_data['expired'], '%Y-%m-%d').date(),
            status=wr_data['status'],
            created_at=datetime.now()
        )
        db.session.add(wr)

    db.session.commit()

with app.app_context():
    try:
        db.create_all()
        ensure_schema()
        seed_data()
        admin_username = os.getenv('ADMIN_USERNAME', '').strip()
        admin_email = os.getenv('ADMIN_EMAIL', '').strip()
        admin_password = os.getenv('ADMIN_PASSWORD', '')
        if admin_username and admin_email and admin_password and not User.query.filter_by(username=admin_username).first():
            if len(admin_password) < 12 or not _is_valid_email(admin_email):
                raise RuntimeError('Initial admin requires a valid email and a password of at least 12 characters.')
            db.session.add(User(username=admin_username, password=bcrypt.generate_password_hash(admin_password).decode('utf-8'), email=admin_email, role='admin'))
            db.session.commit()
    except OperationalError as e:
        uri = app.config.get('SQLALCHEMY_DATABASE_URI', '')
        safe_uri = uri
        if isinstance(uri, str) and '://' in uri and '@' in uri:
            try:
                prefix, rest = uri.split('://', 1)
                creds, tail = rest.split('@', 1)
                if ':' in creds:
                    user_part = creds.split(':', 1)[0]
                    safe_uri = f"{prefix}://{user_part}:***@{tail}"
            except Exception:
                safe_uri = '<unavailable>'
        msg = (
            "Không kết nối được database khi khởi động ứng dụng. "
            f"URI đang dùng: {safe_uri}. "
            f"Chi tiết lỗi: {str(e.orig) if getattr(e, 'orig', None) else str(e)}"
        )
        if os.getenv('SHOW_DB_TRACE', '0').lower() in ('1', 'true', 'yes'):
            raise
        raise SystemExit(msg) from None

# --- FRONTEND (serve UI) ---
PAGES_DIR = os.path.join(BASE_DIR, 'pages')
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
SCRIPTS_DIR = os.path.join(BASE_DIR, 'scripts')

@app.route('/', methods=['GET'])
def home():
    resp = send_from_directory(PAGES_DIR, 'index.html')
    return _no_cache(resp)

@app.route('/<path:filename>', methods=['GET'])
def serve_pages(filename):
    if filename.endswith('.html'):
        file_path = os.path.join(PAGES_DIR, filename)
        if os.path.isfile(file_path):
            resp = send_from_directory(PAGES_DIR, filename)
            return _no_cache(resp)
    abort(404)

@app.route('/pages/<path:filename>', methods=['GET'])
def serve_pages_compat(filename):
    if filename.endswith('.html'):
        file_path = os.path.join(PAGES_DIR, filename)
        if os.path.isfile(file_path):
            resp = send_from_directory(PAGES_DIR, filename)
            return _no_cache(resp)
    abort(404)

@app.route('/assets/<path:filename>', methods=['GET'])
def serve_assets(filename):
    resp = send_from_directory(ASSETS_DIR, filename)
    if filename.lower().endswith('.css'):
        return _no_cache(resp)
    return resp

@app.route('/scripts/<path:filename>', methods=['GET'])
def serve_scripts(filename):
    resp = send_from_directory(SCRIPTS_DIR, filename)
    if filename.lower().endswith('.js'):
        return _no_cache(resp)
    return resp

def _no_cache(resp):
    try:
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
    except Exception:
        pass
    return resp

# --- PUBLIC API ---
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"}), 200

@app.route('/api/ready', methods=['GET'])
def readiness():
    try:
        with db.engine.connect() as connection:
            connection.execute(select(1))
    except SQLAlchemyError:
        return jsonify({'status': 'not_ready'}), 503, {'Retry-After': '5'}
    return jsonify({'status': 'ready'}), 200

@app.route('/api/debug/email-config', methods=['GET'])
def debug_email_config():
    if not app.config.get('DEBUG') and os.getenv('ENABLE_DEBUG_ROUTES', '0').lower() not in ('1', 'true', 'yes'):
        return jsonify({"msg": "Not Found"}), 404
    email_mode = (os.getenv('EMAIL_MODE') or '').strip().lower() or None
    contact_to_email = (os.getenv('CONTACT_TO_EMAIL') or os.getenv('SMTP_USER') or os.getenv('SMTP_FROM') or '').strip() or None
    smtp_host = (os.getenv('SMTP_HOST') or '').strip()
    smtp_user = (os.getenv('SMTP_USER') or '').strip()
    smtp_pass_set = bool(os.getenv('SMTP_PASS'))
    smtp_from = (os.getenv('SMTP_FROM') or smtp_user or '').strip()
    smtp_ssl = (os.getenv('SMTP_SSL', 'false').lower() in ('1', 'true', 'yes'))
    smtp_tls = (os.getenv('SMTP_TLS', 'true').lower() in ('1', 'true', 'yes'))
    if smtp_ssl:
        default_port = 465
    elif smtp_tls:
        default_port = 587
    else:
        default_port = 25
    try:
        smtp_port = int(os.getenv('SMTP_PORT', str(default_port)))
    except Exception:
        smtp_port = default_port
    try:
        smtp_timeout = int(os.getenv('SMTP_TIMEOUT', '10'))
    except Exception:
        smtp_timeout = 10
    missing = []
    if not smtp_host:
        missing.append('SMTP_HOST')
    if not smtp_user:
        missing.append('SMTP_USER')
    if not smtp_pass_set:
        missing.append('SMTP_PASS')
    if not smtp_from:
        missing.append('SMTP_FROM')
    return jsonify({
        "email_mode": email_mode,
        "contact": {"to_email": contact_to_email},
        "smtp": {
            "host_set": bool(smtp_host),
            "user_set": bool(smtp_user),
            "pass_set": smtp_pass_set,
            "from_set": bool(smtp_from),
            "port": smtp_port,
            "tls": smtp_tls,
            "ssl": smtp_ssl,
            "timeout": smtp_timeout,
            "missing": missing,
        },
    }), 200

@app.route('/api/debug/routes', methods=['GET'])
def debug_routes():
    if not app.config.get('DEBUG') and os.getenv('ENABLE_DEBUG_ROUTES', '0').lower() not in ('1', 'true', 'yes'):
        return jsonify({"msg": "Not Found"}), 404
    try:
        rules = sorted({getattr(r, 'rule', '') for r in app.url_map.iter_rules() if getattr(r, 'rule', None)})
    except Exception as e:
        return jsonify({"msg": "Không thể liệt kê routes", "error": str(e)}), 500
    return jsonify({"count": len(rules), "routes": rules}), 200

@app.route('/api/public/contact', methods=['POST'])
def public_contact():
    try:
        data = _validated_text_fields(request.get_json(silent=True),
            {'name': 120, 'email': 120, 'message': 5000}, required=('name', 'message'), single_line=('name', 'email'))
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    name, email, message = (data[field] for field in ('name', 'email', 'message'))
    if not name or not message:
        return jsonify({"msg": "Vui lòng nhập Họ tên và Nội dung!"}), 400
    if email and not _is_valid_email(email):
        return jsonify({"msg": "Định dạng Email không hợp lệ!"}), 400
    to_email = (os.getenv('CONTACT_TO_EMAIL') or os.getenv('SMTP_USER') or os.getenv('SMTP_FROM') or '').strip()
    if not to_email:
        return jsonify({"msg": "Chưa cấu hình email nhận phản hồi.", "email_error": "missing_receiver"}), 500
    subject = f"NexTech - Liên hệ từ {name}"
    lines = [f"Nội dung liên hệ từ website NexTech", "", f"Họ tên: {name}", f"Email: {email or '(không cung cấp)'}", f"Thời gian: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}", "", "Nội dung:", message]
    body = "\n".join(lines)
    sent, email_error = _send_email_if_configured(to_email, subject, body, reply_to_override=email)
    if not sent:
        return jsonify({"msg": "Không gửi được email phản hồi.", "email_error": email_error}), 502
    return jsonify({"msg": "Gửi yêu cầu thành công!"}), 200

@app.route('/api/public/refund-request', methods=['POST'])
@jwt_required()
def public_refund_request():
    user, err = _get_current_user_entity()
    if err:
        return err
    fields = {'order_code': 40, 'name': 120, 'phone': 20, 'email': 120,
        'bank_name': 120, 'account_number': 100, 'account_holder': 120, 'note': 5000}
    try:
        data = _validated_text_fields(request.get_json(silent=True), fields,
            required=('order_code', 'name', 'phone', 'bank_name', 'account_number', 'account_holder'),
            single_line=tuple(field for field in fields if field != 'note'))
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    order_code, name, phone, email, bank_name, account_number, account_holder, note = (data[field] for field in fields)
    if email and not _is_valid_email(email):
        return jsonify({"msg": "Định dạng email không hợp lệ"}), 400
    with _session_begin():
        order = Order.query.filter_by(order_code=order_code, user_id=user.id).with_for_update().first()
        if not order:
            return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
        existing = RefundRequest.query.filter_by(order_id=order.id).first()
        if existing:
            return jsonify({"msg": "Yêu cầu đã được tiếp nhận trước đó", "request": _refund_payload(existing), "existing": True}), 200
        payment = _refundable_payment(order)
        if not payment:
            return jsonify({"msg": "Đơn hàng chưa có thanh toán trực tuyến thành công để hoàn tiền"}), 409
        record = RefundRequest(order_id=order.id, name=name, phone=phone, email=email,
            bank_name=bank_name, account_number=account_number, account_holder=account_holder, note=note)
        db.session.add(record)
        db.session.flush()
        record_id = record.id
    # The request remains durable if notification or its bookkeeping fails.
    try:
        _deliver_refund_notification(record_id)
    except SQLAlchemyError:
        db.session.rollback()
        app.logger.exception('Refund request saved but notification bookkeeping failed')
    record = db.session.get(RefundRequest, record_id)
    return jsonify({"msg": "Đã lưu yêu cầu. Bộ phận hỗ trợ sẽ kiểm tra và phản hồi.",
                    "request": _refund_payload(record), "existing": False}), 201


@app.route('/api/refund-requests/me', methods=['GET'])
@jwt_required()
def my_refund_requests():
    user, err = _get_current_user_entity()
    if err:
        return err
    try:
        page = _positive_int(request.args.get('page', '1'))
        limit = min(_positive_int(request.args.get('limit', '25')), 100)
    except ValueError:
        return jsonify({"msg": "Phân trang không hợp lệ"}), 400
    query = RefundRequest.query.join(Order).filter(Order.user_id == user.id)
    records = query.order_by(RefundRequest.id.desc()).offset((page - 1) * limit).limit(limit).all()
    return jsonify({'items': [_refund_payload(record) for record in records],
                    'total': query.count(), 'page': page, 'limit': limit}), 200


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu đăng nhập không hợp lệ"}), 400
    username = data.get('username')
    password = data.get('password')
    required_role = data.get('required_role')
    if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
        return jsonify({"msg": "Vui lòng nhập tài khoản và mật khẩu"}), 400
    if len(username) > 80 or len(password.encode('utf-8')) > 72:
        return jsonify({"msg": "Thông tin đăng nhập không hợp lệ"}), 400
    user = User.query.filter_by(username=username).first()
    if user and bcrypt.check_password_hash(user.password, password) and user.role == required_role:
        if user.is_locked:
            return jsonify({"msg": "Tài khoản của bạn hiện đang bị khóa!"}), 403
        token = create_access_token(identity=user.username, additional_claims={
            "role": user.role, "password_version": _password_version(user)})
        return jsonify({"access_token": token, "role": user.role, "username": user.username}), 200
    return jsonify({"msg": "Sai tài khoản hoặc mật khẩu!"}), 401

@app.route('/register', methods=['POST'])
def register():
    try:
        data = _validated_account_input(request.get_json(silent=True))
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    username, password, email, phone = (data[field] for field in ('username', 'password', 'email', 'phone'))

    # Validate
    if not username or not password or not email:
        return jsonify({"msg": "Vui lòng nhập đầy đủ username, password, email"}), 400
    if not _is_valid_email(email):
        return jsonify({"msg": "Email không hợp lệ"}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"msg": "Tên đăng nhập đã tồn tại"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"msg": "Email đã được sử dụng"}), 400

    hashed_pw = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(
        username=username,
        password=hashed_pw,
        email=email,
        phone=phone or None,
        role='user',
        created_at=datetime.now(),
        updated_at=datetime.now()
    )
    db.session.add(new_user)
    db.session.commit()

    return jsonify({"msg": "Đăng ký thành công"}), 201

@app.route('/api/public/products', methods=['GET'])
def get_public_products():
    prods = Product.query.filter_by(is_hidden=False).all()
    res = {}
    for p in prods:
        if p.category not in res:
            res[p.category] = []
        res[p.category].append({
            "id": p.id, "name": p.name, "price": p.price, "oldPrice": p.old_price,
            "img": p.img, "specs": json.loads(p.specs or '{}'), "description": p.description,
            "rating": p.rating, "review_count": p.review_count, "brand": p.brand
        })
    return jsonify(res)

@app.route('/api/public/locations', methods=['GET'])
def get_public_locations():
    depth_raw = request.args.get('depth', '3')
    try:
        depth = int(depth_raw)
    except Exception:
        depth = 3
    depth = max(1, min(depth, 3))
    upstream_url = f"https://provinces.open-api.vn/api/?depth={depth}"
    try:
        req = urllib.request.Request(upstream_url, headers={'User-Agent': 'NexTech/1.0', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read()
        response = app.response_class(body, status=200, mimetype='application/json')
        response.headers['Cache-Control'] = 'public, max-age=86400'
        return response
    except Exception as e:
        return jsonify({"msg": "Không thể tải locations", "upstream": "provinces.open-api.vn", "detail": str(e)}), 502

@app.route('/api/reviews/add', methods=['POST'])
@jwt_required()
def add_review():
    user, err = _get_current_user_entity()
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu đánh giá không hợp lệ"}), 400
    try:
        product_id = _positive_int(data.get('product_id'))
        rating = _positive_int(data.get('rating'))
    except (TypeError, ValueError):
        return jsonify({"msg": "Sản phẩm và điểm sao phải là số nguyên hợp lệ"}), 400
    content = data.get('content')
    if rating > 5 or not isinstance(content, str) or not content.strip() or len(content) > 5000:
        return jsonify({"msg": "Chọn từ 1 đến 5 sao và nhập nội dung tối đa 5000 ký tự"}), 400
    product = Product.query.filter_by(id=product_id, is_hidden=False).with_for_update().first()
    if not product:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    db.session.add(Review(product_id=product.id, username=user.username, rating=rating, content=content.strip()))
    db.session.flush()
    average, count = db.session.query(func.avg(Review.rating), func.count(Review.id)).filter_by(product_id=product.id).one()
    product.rating = round(float(average), 1)
    product.review_count = count
    db.session.commit()
    return jsonify({"msg": "Đã gửi đánh giá!"}), 201

@app.route('/api/reviews/<int:pid>', methods=['GET'])
def get_reviews(pid):
    revs = Review.query.filter_by(product_id=pid).order_by(Review.created_at.desc()).all()
    return jsonify([{"username": r.username, "rating": r.rating, "content": r.content, "date": r.created_at.strftime("%d/%m/%Y")} for r in revs])

@app.route('/api/profile', methods=['GET'])
@jwt_required()
def get_profile():
    user, err = _get_current_user_entity()
    if err:
        return err
    return jsonify({
        "username": user.username, "email": user.email, "phone": user.phone, "address": user.address or "",
        "role": user.role, "created_at": user.created_at.strftime('%d/%m/%Y %H:%M:%S') if user.created_at else None,
        "updated_at": user.updated_at.strftime('%d/%m/%Y %H:%M:%S') if user.updated_at else None,
    })

@app.route('/api/profile/update', methods=['PUT'])
@jwt_required()
def update_profile():
    user, err = _get_current_user_entity()
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu hồ sơ không hợp lệ"}), 400
    for field, max_length in (('phone', 15), ('address', 1000)):
        value = data.get(field)
        if value is not None and (not isinstance(value, str) or len(value) > max_length):
            return jsonify({"msg": "Số điện thoại hoặc địa chỉ không hợp lệ"}), 400
    new_pwd = data.get('new_password')
    old_pwd = data.get('old_password')
    for value in (new_pwd, old_pwd):
        if value is not None and (not isinstance(value, str) or len(value.encode('utf-8')) > 72):
            return jsonify({"msg": "Mật khẩu phải là chuỗi và không vượt quá 72 byte"}), 400
    if new_pwd:
        if len(new_pwd) < 6:
            return jsonify({"msg": "Mật khẩu mới phải từ 6 ký tự"}), 400
        if not old_pwd or not bcrypt.check_password_hash(user.password, old_pwd):
            return jsonify({"msg": "Mật khẩu hiện tại không chính xác!"}), 400
        user.password = bcrypt.generate_password_hash(new_pwd).decode('utf-8')
    # Apply partial updates only after validation succeeds.
    if 'phone' in data:
        user.phone = (data['phone'] or '').strip() or None
    if 'address' in data:
        user.address = (data['address'] or '').strip()
    user.updated_at = datetime.now()
    db.session.commit()
    return jsonify({"msg": "Cập nhật thông tin thành công!", "password_changed": bool(new_pwd)}), 200

# --- BE2: CART / ORDERS / PAYMENT ROUTES ---
@app.route('/api/cart', methods=['GET'])
@jwt_required()
def get_cart():
    user, err = _get_current_user_entity()
    if err:
        return err
    items = CartItem.query.filter_by(user_id=user.id).order_by(CartItem.created_at.desc()).all()
    res = []
    for it in items:
        p = db.session.get(Product, it.product_id)
        if not p:
            continue
        res.append({
            "id": it.id, "product_id": p.id, "name": p.name, "img": p.img,
            "price": p.price, "quantity": it.quantity, "stock": p.stock,
            "subtotal": int(p.price) * int(it.quantity)
        })
    return jsonify(res), 200

@app.route('/api/cart', methods=['POST'])
@jwt_required()
def add_to_cart():
    user, err = _get_current_user_entity()
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu không hợp lệ"}), 400
    try:
        product_id = _positive_int(data.get('product_id', 0))
        quantity = _positive_int(data.get('quantity', 1))
    except Exception:
        return jsonify({"msg": "Dữ liệu không hợp lệ"}), 400
    if product_id <= 0 or quantity <= 0:
        return jsonify({"msg": "product_id/quantity không hợp lệ"}), 400
    p = db.session.get(Product, product_id)
    if not p or p.is_hidden:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    item = CartItem.query.filter_by(user_id=user.id, product_id=product_id).first()
    total_quantity = (int(item.quantity) if item else 0) + quantity
    if p.stock is not None and total_quantity > p.stock:
        return jsonify({"msg": "Sản phẩm không đủ tồn kho"}), 409
    if item:
        item.quantity = int(item.quantity) + quantity
    else:
        item = CartItem(user_id=user.id, product_id=product_id, quantity=quantity)
        db.session.add(item)
    db.session.commit()
    return jsonify({"msg": "OK", "cart_item_id": item.id}), 201

@app.route('/api/cart/<int:item_id>', methods=['PUT'])
@jwt_required()
def update_cart_item(item_id):
    user, err = _get_current_user_entity()
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu không hợp lệ"}), 400
    try:
        quantity = _positive_int(data.get('quantity', 0))
    except Exception:
        return jsonify({"msg": "Dữ liệu không hợp lệ"}), 400
    if quantity < 1:
        return jsonify({"msg": "quantity phải >= 1"}), 400
    item = CartItem.query.filter_by(id=item_id, user_id=user.id).first()
    if not item:
        return jsonify({"msg": "Cart item không tồn tại"}), 404
    product = db.session.get(Product, item.product_id)
    if not product or product.is_hidden:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    if product.stock is not None and quantity > product.stock:
        return jsonify({"msg": "Sản phẩm không đủ tồn kho"}), 409
    item.quantity = quantity
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/api/cart/<int:item_id>', methods=['DELETE'])
@jwt_required()
def delete_cart_item(item_id):
    user, err = _get_current_user_entity()
    if err:
        return err
    item = CartItem.query.filter_by(id=item_id, user_id=user.id).first()
    if not item:
        return jsonify({"msg": "Cart item không tồn tại"}), 404
    db.session.delete(item)
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/api/orders', methods=['POST'])
@jwt_required()
def create_order():
    user, err = _get_current_user_entity()
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu đơn hàng không hợp lệ"}), 400
    customer = data.get('customer') or {}
    if not isinstance(customer, dict):
        return jsonify({"msg": "Dữ liệu khách hàng không hợp lệ"}), 400
    items = data.get('items')
    used_cart = False
    clear_cart_item_ids = data.get('clear_cart_item_ids')
    clear_cart_ids = None
    if clear_cart_item_ids is not None:
        if not isinstance(clear_cart_item_ids, list):
            return jsonify({"msg": "clear_cart_item_ids không hợp lệ"}), 400
        try:
            clear_cart_ids = sorted({int(x) for x in clear_cart_item_ids if int(x) > 0})
        except Exception:
            return jsonify({"msg": "clear_cart_item_ids không hợp lệ"}), 400
    if not items:
        used_cart = True
        cart_items = CartItem.query.filter_by(user_id=user.id).all()
        if not cart_items:
            return jsonify({"msg": "Giỏ hàng trống"}), 400
        items = [{"product_id": ci.product_id, "quantity": ci.quantity} for ci in cart_items]
    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"msg": "items không hợp lệ"}), 400
    qty_map = {}
    try:
        for it in items:
            pid = _positive_int(it.get('product_id', 0))
            qty = _positive_int(it.get('quantity', 0))
            if pid <= 0 or qty <= 0:
                return jsonify({"msg": "product_id/quantity không hợp lệ"}), 400
            qty_map[pid] = qty_map.get(pid, 0) + qty
    except Exception:
        return jsonify({"msg": "Dữ liệu items không hợp lệ"}), 400
    customer_name = (customer.get('name') or user.username or '').strip()
    customer_phone = (customer.get('phone') or user.phone or '').strip()
    customer_address = (customer.get('address') or user.address or '').strip()
    customer_email = (customer.get('email') or '').strip()
    if not customer_name or not customer_phone or not customer_address:
        return jsonify({"msg": "Thiếu thông tin khách hàng (name/phone/address)!"}), 400
    if customer_email and not _is_valid_email(customer_email):
        return jsonify({"msg": "Định dạng Email không hợp lệ!"}), 400
    payment_method = (data.get('payment_method') or data.get('provider') or 'cod')
    payment_method = str(payment_method or '').strip().lower()
    if payment_method not in ('cod', 'payos'):
        payment_method = 'cod'
    idem_key = ((data.get('idempotency_key') if isinstance(data, dict) else None) or request.headers.get('Idempotency-Key') or '').strip()
    idem_hash = None
    if idem_key:
        idem_hash = _compute_order_request_hash(customer_name, customer_phone, customer_address, customer_email, qty_map, payment_method)
    order_code = None
    total_amount = 0
    try:
        idem_row = None
        if idem_key:
            idem_row = OrderIdempotency(user_id=user.id, key=idem_key, request_hash=idem_hash, order_id=None, created_at=datetime.now())
            db.session.add(idem_row)
            try:
                db.session.flush()
            except IntegrityError:
                db.session.rollback()
                existing = OrderIdempotency.query.filter_by(user_id=user.id, key=idem_key).first()
                if not existing:
                    return jsonify({"msg": "Yêu cầu này chưa thể tạo lại. Vui lòng kiểm tra danh sách đơn hàng."}), 409
                if existing.request_hash != idem_hash:
                    return jsonify({"msg": "Idempotency-Key đã được dùng cho yêu cầu khác"}), 409
                if existing.order_id:
                    old_order = Order.query.filter_by(id=existing.order_id, user_id=user.id).first()
                    if not old_order:
                        return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
                    return jsonify({
                        "msg": "Tạo đơn hàng thành công!",
                        "order_code": old_order.order_code,
                        "total_amount": old_order.total_amount,
                        "status": old_order.status,
                        "email_sent": False,
                        "email_error": None,
                        "idempotent": True,
                    }), 200
                return jsonify({"msg": "Yêu cầu này chưa thể tạo lại. Vui lòng kiểm tra danh sách đơn hàng.", "idempotent": True}), 409
        products = Product.query.filter(Product.id.in_(list(qty_map.keys()))).with_for_update().all()
        prod_map = {p.id: p for p in products}
        for pid in qty_map.keys():
            if pid not in prod_map or prod_map[pid].is_hidden:
                raise ValueError('missing_product')
        for pid, qty in qty_map.items():
            p = prod_map[pid]
            if p.stock is not None and int(p.stock) < int(qty):
                raise RuntimeError(f'out_of_stock:{pid}')
        for pid, qty in qty_map.items():
            p = prod_map[pid]
            total_amount += int(p.price) * int(qty)
            if p.stock is not None:
                p.stock = int(p.stock) - int(qty)
        for _ in range(10):
            candidate = _generate_order_code()
            if not Order.query.filter_by(order_code=candidate).first():
                order_code = candidate
                break
        if not order_code:
            order_code = f"ORD{uuid.uuid4().hex[:12].upper()}"
        order = Order(order_code=order_code, user_id=user.id, status='processing', total_amount=total_amount,
                      payment_method=payment_method, customer_name=customer_name, customer_phone=customer_phone,
                      customer_address=customer_address, customer_email=customer_email or None, created_at=datetime.now())
        db.session.add(order)
        db.session.flush()
        if idem_row:
            idem_row.order_id = order.id
        for pid, qty in qty_map.items():
            p = prod_map[pid]
            db.session.add(OrderItem(order_id=order.id, product_id=p.id, product_name=p.name, price=p.price, quantity=int(qty)))
        if clear_cart_ids is not None and len(clear_cart_ids) > 0:
            CartItem.query.filter(CartItem.user_id == user.id, CartItem.id.in_(clear_cart_ids)).delete(synchronize_session=False)
        elif used_cart and data.get('clear_cart', True):
            CartItem.query.filter_by(user_id=user.id).delete()
        db.session.commit()
        email_sent = False
        email_error = None
        if customer_email and payment_method != 'payos':  # PayOS sẽ gửi email sau khi thanh toán thành công
            subject = f"NexTech - Xác nhận đơn hàng {order_code}"
            created_at_text = order.created_at.strftime('%d/%m/%Y %H:%M:%S') if order.created_at else ''
            payment_text = 'Thanh toán qua PayOS' if payment_method == 'payos' else 'Thanh toán khi nhận hàng (COD)'
            lines = [f"Xin chào {customer_name},", "", f"Đơn hàng {order_code} đã được tạo thành công."]
            if created_at_text:
                lines.append(f"Thời gian: {created_at_text}")
            lines.extend(["", "Thông tin giao hàng:", f"- Họ tên: {customer_name}", f"- SĐT: {customer_phone}", f"- Địa chỉ: {customer_address}", f"- Email: {customer_email}", f"- Phương thức thanh toán: {payment_text}", "", "Chi tiết đơn hàng:"])
            item_rows = []
            try:
                for pid in sorted(qty_map.keys()):
                    qty = int(qty_map.get(pid) or 0)
                    p = prod_map.get(pid)
                    if not p:
                        continue
                    unit_price = int(p.price)
                    subtotal = unit_price * qty
                    item_rows.append((p.name, qty, unit_price, subtotal))
            except Exception:
                pass
            for idx, (name, qty, unit_price, subtotal) in enumerate(item_rows, start=1):
                lines.append(f"{idx}. {name} x{qty} | Đơn giá: {unit_price:,} VND | Thành tiền: {subtotal:,} VND")
            lines.extend(["", f"Tổng tiền: {total_amount:,} VND", "Trạng thái: processing", "", "Cảm ơn bạn đã mua hàng tại NexTech!"])
            body = "\n".join(lines)
            sent, err_code = _send_email_async(customer_email, subject, body)
            email_mode = (os.getenv('EMAIL_MODE') or '').strip().lower()
            if email_mode in ('file', 'console'):
                email_sent = False
                email_error = err_code or f"dev_email_mode:{email_mode}"
                if sent and not err_code:
                    email_error = f"dev_email_mode:{email_mode}"
            else:
                email_sent, email_error = sent, err_code
        return jsonify({
            "msg": "Tạo đơn hàng thành công!",
            "order_code": order_code,
            "total_amount": total_amount,
            "status": "processing",
            "email_sent": email_sent,
            "email_error": email_error
        }), 201
    except ValueError:
        db.session.rollback()
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    except RuntimeError as e:
        db.session.rollback()
        msg = str(e)
        if msg.startswith('out_of_stock:'):
            try:
                pid = int(msg.split(':', 1)[1])
            except Exception:
                pid = None
            return jsonify({"msg": "Sản phẩm không đủ tồn kho!", "product_id": pid}), 409
        return jsonify({"msg": "Lỗi xử lý đơn hàng"}), 400
    except Exception as e:
        db.session.rollback()
        try:
            app.logger.exception("BE2 create_order failed")
        except Exception:
            pass
        return jsonify({"msg": "Lỗi hệ thống: " + str(e)}), 500

@app.route('/api/orders/me', methods=['GET'])
@jwt_required()
def list_my_orders():
    user, err = _get_current_user_entity()
    if err:
        return err
    orders = Order.query.filter_by(user_id=user.id).order_by(Order.created_at.desc()).all()
    return jsonify([{
        "order_code": o.order_code,
        "status": o.status,
        "total_amount": o.total_amount,
        "created_at": o.created_at.strftime('%d/%m/%Y %H:%M:%S') if o.created_at else None
    } for o in orders]), 200

@app.route('/api/orders/<string:order_code>', methods=['GET'])
@jwt_required()
def get_order_detail(order_code):
    user, err = _get_current_user_entity()
    if err:
        return err
    order = Order.query.filter_by(order_code=order_code, user_id=user.id).first()
    if not order:
        return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
    items = OrderItem.query.filter_by(order_id=order.id).all()
    product_ids = sorted({int(i.product_id) for i in items if i.product_id is not None})
    prod_map = {}
    if product_ids:
        prods = Product.query.filter(Product.id.in_(product_ids)).all()
        prod_map = {int(p.id): p for p in prods}
    payments = Payment.query.filter_by(order_id=order.id).order_by(Payment.created_at.asc()).all()
    initial_payment = payments[0] if payments else None
    last_payment = payments[-1] if payments else None
    def _fmt_dt(dt):
        return dt.strftime('%d/%m/%Y %H:%M:%S') if dt else None
    def _payment_payload(p: Payment):
        if not p:
            return None
        provider = p.provider
        if provider in ('bank', 'napas', 'atm'):
            provider = 'payos'
        return {
            "provider": provider,
            "status": p.status,
            "payment_ref": p.payment_ref,
            "amount": p.amount,
            "created_at": _fmt_dt(p.created_at),
            "updated_at": _fmt_dt(p.updated_at),
        }
    def _initial_payment_from_order(method: str):
        m = str(method or '').strip().lower()
        if not m:
            return None
        if m in ('bank', 'napas', 'atm'):
            m = 'payos'
        if m not in ('cod', 'payos'):
            return None
        status = 'pending'
        return {
            "provider": m,
            "status": status,
            "payment_ref": None,
            "amount": order.total_amount,
            "created_at": _fmt_dt(order.created_at),
            "updated_at": None,
        }
    payment_method = (order.payment_method or '').strip().lower() if hasattr(order, 'payment_method') else ''
    if payment_method in ('bank', 'napas', 'atm'):
        payment_method = 'payos'
    derived_initial = _initial_payment_from_order(payment_method) if not payments else None
    refund_record = RefundRequest.query.filter_by(order_id=order.id).first()
    return jsonify({
        "order_code": order.order_code,
        "status": order.status,
        "total_amount": order.total_amount,
        "payment_method": payment_method or None,
        "customer": {
            "name": order.customer_name,
            "phone": order.customer_phone,
            "address": order.customer_address,
            "email": order.customer_email
        },
        "created_at": order.created_at.strftime('%d/%m/%Y %H:%M:%S') if order.created_at else None,
        "items": [{
            "product_id": i.product_id,
            "name": i.product_name,
            "img": (prod_map.get(int(i.product_id)).img if (i.product_id is not None and prod_map.get(int(i.product_id))) else None),
            "price": i.price,
            "quantity": i.quantity,
            "subtotal": int(i.price) * int(i.quantity)
        } for i in items],
        "payment": _payment_payload(last_payment),
        "payment_initial": _payment_payload(initial_payment) or derived_initial,
        "payment_latest": _payment_payload(last_payment),
        "payments_count": len(payments),
        "requires_refund": _refundable_payment(order) is not None,
        "refund_request": _refund_payload(refund_record) if refund_record else None,
    }), 200

@app.route('/api/orders/<string:order_code>/cancel', methods=['PUT'])
@jwt_required()
def cancel_my_order(order_code):
    user, err = _get_current_user_entity()
    if err:
        return err
    email_to = None
    customer_name = None
    customer_phone = None
    customer_address = None
    cancelled_at = None
    total_amount = None
    already_cancelled = False
    item_lines = []
    try:
        with _session_begin():
            order = Order.query.filter_by(order_code=order_code, user_id=user.id).with_for_update().first()
            if not order:
                return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
            if _refundable_payment(order):
                return jsonify({"msg": "Đơn đã thanh toán trực tuyến. Vui lòng gửi yêu cầu hoàn tiền để được hỗ trợ.",
                                "requires_refund": True}), 409
            try:
                items = OrderItem.query.filter_by(order_id=order.id).all()
                item_lines = []
                for i in (items or []):
                    if not i or not i.product_name:
                        continue
                    try:
                        qty = int(i.quantity or 0)
                    except Exception:
                        qty = 0
                    try:
                        unit = int(i.price or 0)
                    except Exception:
                        unit = 0
                    sub = unit * max(qty, 0)
                    item_lines.append(f"- {i.product_name} x{qty} • {unit:,} VND • {sub:,} VND")
            except Exception:
                pass
            current = (order.status or '').lower()
            if current == 'cancelled':
                already_cancelled = True
            elif current != 'processing':
                return jsonify({"msg": "Chỉ có thể hủy đơn khi đang xử lý (processing)"}), 400
            if not already_cancelled:
                Payment.query.filter_by(order_id=order.id, status='pending').update({"status": "failed"})
                order.status = 'cancelled'
                _restock_order_items(order.id)
            email_to = order.customer_email
            customer_name = order.customer_name
            customer_phone = order.customer_phone
            customer_address = order.customer_address
            cancelled_at = datetime.now()
            total_amount = order.total_amount
        email_sent = False
        email_error = None
        if email_to:
            subject = f"NexTech - Đơn hàng {order_code} đã bị hủy"
            time_text = cancelled_at.strftime('%d/%m/%Y %H:%M:%S') if cancelled_at else ''
            lines = [f"Xin chào {customer_name},", "", f"Đơn hàng {order_code} đã được hủy."]
            if time_text:
                lines.append(f"Thời gian hủy: {time_text}")
            lines.extend(["", "Thông tin đơn hàng:", f"- Mã đơn: {order_code}"])
            if total_amount is not None:
                lines.append(f"- Tổng tiền: {int(total_amount):,} VND")
            if item_lines:
                lines.append("- Sản phẩm:")
                lines.extend(item_lines)
            lines.extend(["", "Thông tin giao hàng:", f"- Họ tên: {customer_name}", f"- SĐT: {customer_phone}", f"- Địa chỉ: {customer_address}", "", "Nếu bạn cần hỗ trợ, vui lòng liên hệ NexTech."])
            body = "\n".join(lines)
            sent, err_code = _send_email_if_configured(email_to, subject, body)
            email_mode = (os.getenv('EMAIL_MODE') or '').strip().lower()
            if email_mode in ('file', 'console'):
                email_sent = False
                email_error = err_code or f"dev_email_mode:{email_mode}"
                if sent and not err_code:
                    email_error = f"dev_email_mode:{email_mode}"
            else:
                email_sent, email_error = sent, err_code
        return jsonify({
            "msg": "OK",
            "order_code": order_code,
            "status": "cancelled",
            "email_sent": email_sent,
            "email_error": email_error,
            "already_cancelled": already_cancelled,
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"msg": "Lỗi hệ thống: " + str(e)}), 500

@app.route('/api/payment/create', methods=['POST'])
@jwt_required()
def create_payment():
    user, err = _get_current_user_entity()
    if err:
        return err

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu thanh toán không hợp lệ"}), 400
    order_code = data.get('order_code') or ''
    provider = data.get('provider') or 'cod'
    if not isinstance(order_code, str) or not isinstance(provider, str):
        return jsonify({"msg": "Mã đơn hàng hoặc phương thức thanh toán không hợp lệ"}), 400
    order_code = order_code.strip()
    provider = provider.strip().lower()
    if provider in ('momo', 'payos'):
        provider = 'payos'
    if provider not in ('payos', 'cod'):
        return jsonify({"msg": "Phương thức thanh toán không được hỗ trợ"}), 400

    if not order_code:
        return jsonify({"msg": "Thiếu order_code"}), 400

    order = Order.query.filter_by(order_code=order_code, user_id=user.id).first()
    if not order:
        return jsonify({"msg": "Đơn hàng không tồn tại"}), 404

    if order.status != 'processing':
        return jsonify({"msg": "Chỉ tạo thanh toán cho đơn đang xử lý"}), 409
    if Payment.query.filter_by(order_id=order.id, status='success').first():
        return jsonify({"msg": "Đơn hàng đã được thanh toán"}), 409
    expected_provider = 'payos' if order.payment_method in ('payos', 'momo') else 'cod'
    if provider != expected_provider:
        return jsonify({"msg": "Phương thức thanh toán không khớp với đơn hàng"}), 409

    # Xử lý COD
    if provider == 'cod':
        existing = Payment.query.filter_by(order_id=order.id, status='pending', provider='cod').first()
        if existing:
            return jsonify({
                "msg": "OK",
                "payment_id": existing.id,
                "payment_ref": existing.payment_ref,
                "provider": existing.provider,
                "amount": existing.amount,
                "status": existing.status,
            }), 200
        payment_ref = uuid.uuid4().hex
        pay = Payment(
            order_id=order.id,
            provider='cod',
            amount=order.total_amount,
            status='pending',
            payment_ref=payment_ref
        )
        db.session.add(pay)
        db.session.commit()
        return jsonify({
            "msg": "OK",
            "payment_id": pay.id,
            "payment_ref": pay.payment_ref,
            "provider": pay.provider,
            "amount": pay.amount,
            "status": pay.status,
        }), 201

    # --- PayOS integration ---
    from payos import PayOS
    from payos.types import CreatePaymentLinkRequest

    payos_client_id = os.getenv('PAYOS_CLIENT_ID', '').strip()
    payos_api_key = os.getenv('PAYOS_API_KEY', '').strip()
    payos_checksum_key = os.getenv('PAYOS_CHECKSUM_KEY', '').strip()
    if not payos_client_id or not payos_api_key or not payos_checksum_key:
        return jsonify({"msg": "PayOS chưa được cấu hình (thiếu key)"}), 500

    # Khởi tạo PayOS client
    payos_client = PayOS(
        client_id=payos_client_id,
        api_key=payos_api_key,
        checksum_key=payos_checksum_key
    )

    # Kiểm tra payment pending cũ
    existing_payment = Payment.query.filter_by(
        order_id=order.id, status='pending', provider='payos'
    ).first()
    if existing_payment and existing_payment.checkout_url:
        return jsonify({
            "msg": "OK",
            "payment_id": existing_payment.id,
            "payment_ref": existing_payment.payment_ref,
            "provider": existing_payment.provider,
            "amount": existing_payment.amount,
            "status": existing_payment.status,
            "checkout_url": existing_payment.checkout_url
        }), 200
    if existing_payment:
        db.session.delete(existing_payment)
        db.session.commit()

    # Tạo mã đơn hàng duy nhất cho PayOS (integer)
    payos_order_code = int(time.time() * 1000) % 1000000000
    while Payment.query.filter_by(payment_ref=str(payos_order_code)).first():
        payos_order_code = (payos_order_code + 1) % 1000000000

    # Lấy URL từ env
    return_url = os.getenv('PAYOS_RETURN_URL') or request.host_url.rstrip('/') + '/pages/order-information.html'
    cancel_url = os.getenv('PAYOS_CANCEL_URL') or request.host_url.rstrip('/') + '/pages/order-information.html'
    desc = f"Don {order.order_code[-6:]}"

    # Tạo request đúng chuẩn SDK
    try:
        payment_request = CreatePaymentLinkRequest(
            order_code=payos_order_code,
            amount=order.total_amount,
            description=desc,
            cancel_url=cancel_url,
            return_url=return_url,
            buyer_name=order.customer_name,
            buyer_email=order.customer_email or user.email,
            buyer_phone=order.customer_phone,
        )
        payment_link = payos_client.payment_requests.create(payment_request)

        # Lấy checkout_url - thử các trường hợp
        if hasattr(payment_link, 'checkoutUrl'):
            checkout_url = payment_link.checkoutUrl
        elif hasattr(payment_link, 'checkout_url'):
            checkout_url = payment_link.checkout_url
        elif hasattr(payment_link, 'data') and hasattr(payment_link.data, 'checkoutUrl'):
            checkout_url = payment_link.data.checkoutUrl
        else:
            # Fallback: nếu không tìm thấy, in ra cấu trúc để debug
            app.logger.error(f"Payment link response structure: {dir(payment_link)}")
            return jsonify({"msg": "Không lấy được checkout_url từ PayOS"}), 500

        # Lưu vào database
        new_payment = Payment(
            order_id=order.id,
            provider='payos',
            amount=order.total_amount,
            status='pending',
            payment_ref=str(payos_order_code),
            checkout_url=checkout_url
        )
        db.session.add(new_payment)
        db.session.commit()

        return jsonify({
            "msg": "OK",
            "payment_id": new_payment.id,
            "payment_ref": new_payment.payment_ref,
            "provider": new_payment.provider,
            "amount": new_payment.amount,
            "status": new_payment.status,
            "checkout_url": checkout_url
        }), 201

    except Exception as e:
        app.logger.exception("PayOS create payment link error")
        return jsonify({"msg": f"Lỗi tạo thanh toán: {str(e)}"}), 500
def _apply_verified_payment(payment, order, status):
    """Apply a provider-confirmed transition once; keep fulfillment separate."""
    if payment.status != 'pending':
        return
    if status == 'PAID':
        if order.status == 'cancelled':
            raise ValueError('Cancelled order requires manual payment reconciliation')
        payment.status = 'success'
    elif status in ('CANCELLED', 'EXPIRED', 'FAILED'):
        payment.status = 'failed'
        if order.status == 'processing':
            order.status = 'cancelled'
            _restock_order_items(order.id)


def _notify_paid_order(order):
    if order.customer_email and _is_valid_email(order.customer_email):
        subject = f"NexTech - Xác nhận thanh toán đơn hàng {order.order_code}"
        body = f"Xin chào {order.customer_name},\n\nĐơn hàng {order.order_code} đã được thanh toán thành công qua PayOS."
        try:
            _send_email_async(order.customer_email, subject, body)
        except Exception:
            app.logger.exception('Payment saved but notification failed')


@app.route('/api/payment/confirm', methods=['POST'])
@jwt_required()
def confirm_payment():
    user, err = _get_current_user_entity()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    payment_ref = str(data.get('payment_ref') or '').strip()
    if not payment_ref:
        return jsonify({"msg": "Thiếu payment_ref"}), 400
    try:
        newly_paid = False
        with _session_begin():
            payment = Payment.query.filter_by(payment_ref=payment_ref).with_for_update().first()
            if not payment:
                return jsonify({"msg": "Payment không tồn tại"}), 404
            order = Order.query.filter_by(id=payment.order_id, user_id=user.id).with_for_update().first()
            if not order:
                return jsonify({"msg": "Không có quyền thao tác"}), 403
            if payment.provider != 'payos':
                return jsonify({"msg": "COD được xác nhận khi giao hàng"}), 400
            if payment.status == 'pending':
                if payos_client is None:
                    return jsonify({"msg": "PayOS chưa được cấu hình"}), 503
                # Never trust result/status sent by the browser.
                verified = payos_client.payment_requests.get(int(payment.payment_ref))
                if (str(verified.order_code) != payment.payment_ref
                        or verified.amount != payment.amount
                        or (verified.status == 'PAID' and verified.amount_paid < payment.amount)):
                    return jsonify({"msg": "Thông tin thanh toán không khớp"}), 409
                _apply_verified_payment(payment, order, verified.status)
                newly_paid = payment.status == 'success'
        if newly_paid:
            _notify_paid_order(order)
        return jsonify({"msg": "OK", "order_code": order.order_code, "order_status": order.status,
                        "payment_status": payment.status}), 200
    except ValueError:
        return jsonify({"msg": "Thanh toán cần được đối soát thủ công"}), 409
    except Exception:
        app.logger.exception('Payment verification failed')
        return jsonify({"msg": "Không xác minh được thanh toán"}), 502


@app.route('/payment/webhook', methods=['POST'])
def payos_webhook():
    if payos_client is None:
        return jsonify({"msg": "PayOS chưa được cấu hình"}), 503
    try:
        verified = payos_client.webhooks.verify(request.get_data())
    except Exception:
        return jsonify({"msg": "Webhook không hợp lệ"}), 400
    if verified.code != '00':
        return jsonify({"message": "Ignored non-success notification"}), 200
    try:
        newly_paid = False
        with _session_begin():
            payment = Payment.query.filter_by(payment_ref=str(verified.order_code), provider='payos').with_for_update().first()
            if not payment:
                return jsonify({"message": "Payment not found"}), 200
            order = Order.query.filter_by(id=payment.order_id).with_for_update().first()
            if not order or verified.amount != payment.amount or verified.currency != 'VND':
                return jsonify({"msg": "Thông tin thanh toán không khớp"}), 409
            was_pending = payment.status == 'pending'
            _apply_verified_payment(payment, order, 'PAID')
            newly_paid = was_pending and payment.status == 'success'
        if newly_paid:
            _notify_paid_order(order)
        return jsonify({"message": "OK"}), 200
    except ValueError:
        return jsonify({"msg": "Thanh toán cần được đối soát thủ công"}), 409
    except Exception:
        app.logger.exception('Webhook processing failed')
        return jsonify({"msg": "Không xử lý được thanh toán"}), 500

# --- ADMIN ROUTES ---
@app.route('/admin/refund-requests/<int:request_id>/notification', methods=['POST'])
@jwt_required()
def admin_retry_refund_notification(request_id):
    admin, err = _require_admin()
    if err:
        return err
    if not db.session.get(RefundRequest, request_id):
        return jsonify({'msg': 'Yêu cầu không tồn tại'}), 404
    state = _deliver_refund_notification(request_id)
    message = {'sent': 'Đã gửi thông báo hỗ trợ.', 'simulated': 'Email thử đã được lưu trên máy.',
               'failed': 'Chưa gửi được email. Hồ sơ vẫn được giữ trong hàng đợi.'}.get(state['state'], 'Chưa gửi thông báo.')
    return jsonify({'notification': state, 'msg': message}), 200

@app.route('/admin/refund-requests', methods=['GET'])
@jwt_required()
def admin_refund_requests():
    admin, err = _require_admin()
    if err:
        return err
    status = request.args.get('status', 'all')
    if status not in ('all', 'pending', 'reviewing', 'resolved', 'rejected'):
        return jsonify({'msg': 'Trạng thái không hợp lệ'}), 400
    try:
        page = _positive_int(request.args.get('page', '1'))
        limit = min(_positive_int(request.args.get('limit', '25')), 100)
    except ValueError:
        return jsonify({'msg': 'Phân trang không hợp lệ'}), 400
    query = RefundRequest.query
    if status != 'all':
        query = query.filter_by(status=status)
    rows = query.order_by(RefundRequest.id.desc()).offset((page - 1) * limit).limit(limit).all()
    return jsonify({'items': [_refund_payload(row) for row in rows],
                    'total': query.count(), 'page': page, 'limit': limit}), 200


@app.route('/admin/refund-requests/<int:request_id>', methods=['GET', 'PUT'])
@jwt_required()
def admin_review_refund(request_id):
    admin, err = _require_admin()
    if err:
        return err
    if request.method == 'GET':
        record = db.session.get(RefundRequest, request_id)
        if not record:
            return jsonify({'msg': 'Yêu cầu không tồn tại'}), 404
        return jsonify(_refund_payload(record, full=True)), 200
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'msg': 'Dữ liệu không hợp lệ'}), 400
    status, note = data.get('status'), data.get('staff_note')
    if status not in ('pending', 'reviewing', 'resolved', 'rejected') or not isinstance(note, str) or len(note) > 5000:
        return jsonify({'msg': 'Trạng thái hoặc phản hồi không hợp lệ'}), 400
    note = note.strip()
    if status in ('resolved', 'rejected') and not note:
        return jsonify({'msg': 'Vui lòng nhập phản hồi cho khách trước khi kết thúc yêu cầu'}), 400
    try:
        revision = _positive_int(data.get('revision'))
    except (ValueError, TypeError):
        return jsonify({'msg': 'Thiếu phiên bản yêu cầu hợp lệ'}), 400
    with _session_begin():
        record = RefundRequest.query.filter_by(id=request_id).with_for_update().first()
        if not record:
            return jsonify({'msg': 'Yêu cầu không tồn tại'}), 404
        if record.revision != revision:
            return jsonify({'msg': 'Yêu cầu đã được người khác cập nhật. Vui lòng tải lại.'}), 409
        if record.status == status and record.staff_note == note:
            return jsonify(_refund_payload(record, full=True)), 200
        transitions = {'pending': ('pending', 'reviewing', 'rejected'),
                       'reviewing': ('reviewing', 'resolved', 'rejected'), 'resolved': (), 'rejected': ()}
        if status not in transitions.get(record.status, ()):
            return jsonify({'msg': 'Không thể chuyển trạng thái yêu cầu theo cách này'}), 409
        db.session.add(RefundReviewEvent(request_id=record.id, from_status=record.status,
            to_status=status, staff_note=note, actor=admin.username))
        record.status, record.staff_note, record.reviewed_by = status, note, admin.username
        record.revision += 1
    return jsonify(_refund_payload(record, full=True)), 200


@app.route('/admin/dashboard/stats', methods=['GET'])
@jwt_required()
def get_dashboard_stats():
    admin, err = _require_admin()
    if err:
        return err
    total_products = Product.query.count()
    total_stock = db.session.query(func.sum(Product.stock)).scalar() or 0
    pending_orders = Order.query.filter_by(status='processing').count()
    revenue = db.session.query(func.sum(Order.total_amount)).filter(Order.status.in_(['completed', 'shipping'])).scalar() or 0
    return jsonify({"total_products": total_products, "total_stock": int(total_stock), "pending_orders": pending_orders, "revenue": int(revenue)}), 200

@app.route('/admin/dashboard/revenue-chart', methods=['GET'])
@jwt_required()
def get_revenue_chart():
    admin, err = _require_admin()
    if err:
        return err
    from datetime import timedelta
    data = []
    today = datetime.now().date()
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_start = datetime.combine(day, datetime.min.time())
        day_end = datetime.combine(day, datetime.max.time())
        revenue = db.session.query(func.sum(Order.total_amount)).filter(Order.created_at.between(day_start, day_end), Order.status.in_(['completed', 'shipping'])).scalar() or 0
        data.append({"date": day.strftime('%d/%m'), "revenue": int(revenue), "day_num": 6 - i})
    return jsonify({"data": data}), 200

@app.route('/admin/products/<int:product_id>/toggle-visibility', methods=['PUT'])
@jwt_required()
def toggle_product_visibility(product_id):
    admin, err = _require_admin()
    if err:
        return err
    product = Product.query.filter_by(id=product_id).first()
    if not product:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    product.is_hidden = not product.is_hidden
    db.session.commit()
    return jsonify({"msg": "Cập nhật thành công", "product_id": product_id, "is_hidden": product.is_hidden}), 200

@app.route('/admin/inventory', methods=['GET'])
@jwt_required()
def get_inventory():
    admin, err = _require_admin()
    if err:
        return err
    products = Product.query.order_by(Product.stock.asc()).all()
    return jsonify([{"id": p.id, "name": p.name, "category": p.category, "price": p.price, "stock": p.stock} for p in products]), 200

@app.route('/admin/inventory/update/<int:id>', methods=['PUT'])
@jwt_required()
def update_inventory(id):
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'stock' not in data:
        return jsonify({"msg": "Thiếu thông tin số lượng tồn kho"}), 400
    try:
        new_stock = _nonnegative_int(data['stock'], 2147483647)
    except (ValueError, TypeError):
        return jsonify({"msg": "Số lượng phải là một con số"}), 400
    p = db.session.get(Product, id)
    if not p:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    p.stock = new_stock
    db.session.commit()
    return jsonify({"msg": "Cập nhật tồn kho thành công!", "new_stock": p.stock}), 200

@app.route('/admin/users/delete/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_user(id):
    admin, err = _require_admin()
    if err:
        return err
    u = db.session.get(User, id)
    if not u:
        return jsonify({"msg": "Người dùng không tồn tại"}), 404
    if u.role == 'admin':
        return jsonify({"msg": "Không thể xóa tài khoản Admin"}), 400
    if Order.query.filter_by(user_id=u.id).first():
        return jsonify({"msg": "Tài khoản có lịch sử đơn hàng. Hãy khóa thay vì xóa để giữ dữ liệu."}), 409
    CartItem.query.filter_by(user_id=u.id).delete()
    PasswordResetToken.query.filter_by(user_id=u.id).delete()
    OrderIdempotency.query.filter_by(user_id=u.id).delete()
    db.session.delete(u)
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/products/add', methods=['POST'])
@jwt_required()
def add_product():
    admin, err = _require_admin()
    if err:
        return err
    try:
        data = _validated_product_input(request.get_json(silent=True))
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    db.session.add(Product(**data, created_at=datetime.now()))
    db.session.commit()
    return jsonify({"msg": "OK"}), 201

@app.route('/admin/products/update/<int:id>', methods=['PUT'])
@jwt_required()
def update_product(id):
    admin, err = _require_admin()
    if err:
        return err
    p = db.session.get(Product, id)
    if not p:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    try:
        data = _validated_product_input(request.get_json(silent=True), partial=True)
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    for field, value in data.items():
        setattr(p, field, value)
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/products/delete/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_product(id):
    admin, err = _require_admin()
    if err:
        return err
    p = db.session.get(Product, id)
    if not p:
        return jsonify({"msg": "Sản phẩm không tồn tại"}), 404
    if OrderItem.query.filter_by(product_id=id).first():
        return jsonify({"msg": "Sản phẩm đã có trong đơn hàng. Hãy ẩn thay vì xóa để giữ lịch sử."}), 409
    try:
        CartItem.query.filter_by(product_id=id).delete()
        Review.query.filter_by(product_id=id).delete()
        db.session.delete(p)
        db.session.commit()
        return jsonify({"msg": "Đã xóa sản phẩm và các bình luận liên quan!"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"msg": "Lỗi hệ thống: " + str(e)}), 500

@app.route('/admin/products', methods=['GET'])
@jwt_required()
def admin_get_products():
    admin, err = _require_admin()
    if err:
        return err
    prods = Product.query.all()
    res = {}
    for p in prods:
        if p.category not in res:
            res[p.category] = []
        res[p.category].append({
            "id": p.id, "name": p.name, "price": p.price, "oldPrice": p.old_price,
            "img": p.img, "specs": json.loads(p.specs or '{}'), "description": p.description,
            "rating": p.rating, "review_count": p.review_count, "brand": p.brand,
            "stock": p.stock, "is_hidden": p.is_hidden
        })
    return jsonify(res)

@app.route('/admin/users', methods=['GET'])
@jwt_required()
def list_users():
    admin, err = _require_admin()
    if err:
        return err
    users = User.query.all()
    return jsonify([{
        "id": u.id, "username": u.username, "phone": u.phone, "email": u.email,
        "address": u.address, "role": u.role, "is_locked": u.is_locked,
        "created_at": _fmt_dt(u.created_at), "updated_at": _fmt_dt(u.updated_at)
    } for u in users])

@app.route('/admin/users/toggle-lock/<int:id>', methods=['PUT'])
@jwt_required()
def toggle_lock(id):
    admin, err = _require_admin()
    if err:
        return err
    u = db.session.get(User, id)
    if u and u.role != 'admin':
        u.is_locked = not u.is_locked
        db.session.commit()
        return jsonify({"msg": "OK"})
    return jsonify({"msg": "Lỗi"}), 400

@app.route('/admin/users/update/<int:id>', methods=['PUT'])
@jwt_required()
def update_user_by_admin(id):
    admin, err = _require_admin()
    if err:
        return err
    user = db.session.get(User, id)
    if not user:
        return jsonify({"msg": "Người dùng không tồn tại"}), 404
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu tài khoản không hợp lệ"}), 400
    changes = {}
    for field, limit in (('username', 80), ('email', 120), ('phone', 15), ('address', 1000)):
        if field not in data:
            continue
        value = data[field]
        if not isinstance(value, str) or len(value) > limit:
            return jsonify({"msg": "Thông tin tài khoản không hợp lệ hoặc quá dài"}), 400
        value = value.strip()
        if field in ('username', 'email') and not value:
            continue
        if field == 'email' and not _is_valid_email(value):
            return jsonify({"msg": "Email không hợp lệ"}), 400
        if field in ('username', 'email') and User.query.filter(
                getattr(User, field) == value, User.id != user.id).first():
            return jsonify({"msg": "Tên tài khoản hoặc email đã tồn tại"}), 400
        changes[field] = value or None
    role = data.get('role', user.role)
    locked = data.get('is_locked', user.is_locked)
    if role not in ('admin', 'user') or not isinstance(locked, bool):
        return jsonify({"msg": "Quyền hoặc trạng thái khóa không hợp lệ"}), 400
    if user.role == 'admin' and not user.is_locked and (role != 'admin' or locked):
        active_admins = User.query.filter_by(role='admin', is_locked=False).order_by(User.id).with_for_update().all()
        if len(active_admins) <= 1:
            return jsonify({"msg": "Không thể khóa hoặc hạ quyền quản trị viên cuối cùng"}), 400
    for field, value in changes.items():
        setattr(user, field, value)
    user.role = role
    user.is_locked = locked
    user.updated_at = datetime.now()
    db.session.commit()
    return jsonify({"msg": "OK", "user": {
        "id": user.id, "username": user.username, "email": user.email, "phone": user.phone,
        "address": user.address, "role": user.role, "is_locked": user.is_locked,
        "created_at": _fmt_dt(user.created_at), "updated_at": _fmt_dt(user.updated_at)
    }}), 200

@app.route('/admin/users/add', methods=['POST'])
@jwt_required()
def add_user():
    admin, err = _require_admin()
    if err:
        return err
    try:
        data = _validated_account_input(request.get_json(silent=True), allow_role=True)
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    username, email, password, phone, role, address = (data[field] for field in
        ('username', 'email', 'password', 'phone', 'role', 'address'))
    if not username or not email:
        return jsonify({"msg": "Thiếu username/email"}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"msg": "Username đã tồn tại"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"msg": "Email đã tồn tại"}), 400
    if not _is_valid_email(email):
        return jsonify({"msg": "Email không hợp lệ"}), 400
    if role not in ('admin', 'user'):
        role = 'user'
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password=hashed_password, email=email, phone=phone or None, role=role, address=address or None)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"msg": "OK", "user": {
        "id": new_user.id, "username": new_user.username, "email": new_user.email,
        "phone": new_user.phone, "address": new_user.address, "role": new_user.role,
        "is_locked": new_user.is_locked, "created_at": _fmt_dt(new_user.created_at),
        "updated_at": _fmt_dt(new_user.updated_at)
    }}), 201

@app.route('/admin/upload', methods=['POST'])
@jwt_required()
def upload_file():
    admin, err = _require_admin()
    if err:
        return err
    limit = 5 * 1024 * 1024
    if request.content_length and request.content_length > limit + 65536:
        return jsonify({"msg": "Ảnh không được vượt quá 5 MB"}), 413
    if 'file' not in request.files:
        return jsonify({"msg": "No file"}), 400
    file = request.files['file']
    content = file.read(limit + 1)
    if len(content) > limit:
        return jsonify({"msg": "Ảnh không được vượt quá 5 MB"}), 413
    try:
        with PillowImage.open(BytesIO(content)) as image:
            image_format = image.format
            extension = {'PNG': '.png', 'JPEG': '.jpg', 'WEBP': '.webp'}.get(image_format)
            if not extension or image.width * image.height > 20000000:
                return jsonify({"msg": "Chỉ nhận ảnh PNG, JPEG, WebP tối đa 20 triệu điểm ảnh"}), 400
            image.load()
            # Re-encode decoded pixels; do not publish arbitrary uploaded bytes.
            output = BytesIO()
            image.save(output, format=image_format)
    except (UnidentifiedImageError, OSError, ValueError, PillowImage.DecompressionBombError):
        return jsonify({"msg": "Tệp ảnh không hợp lệ hoặc bị hỏng"}), 400
    if output.tell() > limit:
        return jsonify({"msg": "Ảnh sau xử lý không được vượt quá 5 MB"}), 413
    filename = uuid.uuid4().hex + extension
    with open(os.path.join(app.config['UPLOAD_FOLDER'], filename), 'xb') as destination:
        destination.write(output.getvalue())
    return jsonify({"url": f"../assets/img/{filename}"}), 200

@app.route('/api/public/banners', methods=['GET'])
def get_banners():
    banners = Banner.query.all()
    return jsonify([{"id": b.id, "img": b.img, "position": b.position} for b in banners])

@app.route('/admin/banners/add', methods=['POST'])
@jwt_required()
def add_banner():
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json()
    db.session.add(Banner(img=data['img'], position=data['position']))
    db.session.commit()
    return jsonify({"msg": "OK"}), 201

@app.route('/admin/banners/delete/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_banner(id):
    admin, err = _require_admin()
    if err:
        return err
    b = db.session.get(Banner, id)
    db.session.delete(b)
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/banner', methods=['GET'])
@jwt_required()
def admin_get_banners():
    admin, err = _require_admin()
    if err:
        return err
    banners = Banner.query.all()
    return jsonify([{"id": b.id, "img": b.img, "position": b.position} for b in banners])

@app.route('/admin/banner/<int:id>', methods=['PUT'])
@jwt_required()
def update_banner(id):
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json()
    b = db.session.get(Banner, id)
    b.img = data['img']
    b.position = data['position']
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/banner', methods=['POST'])
@jwt_required()
def create_banner():
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json()
    db.session.add(Banner(img=data['img'], position=data['position']))
    db.session.commit()
    return jsonify({"msg": "OK"}), 201

@app.route('/api/public/news', methods=['GET'])
def public_news_list():
    status = (request.args.get('status') or '').strip().lower()
    now = datetime.now()
    q = NewsPost.query
    if status in ('draft', 'published', 'scheduled', 'hidden'):
        q = q.filter(NewsPost.status == status)
    else:
        q = q.filter(NewsPost.status.in_(['published', 'scheduled']))
    rows = q.order_by(NewsPost.updated_at.desc()).all()
    res = []
    for r in rows:
        if r.status == 'scheduled' and r.scheduled_at and r.scheduled_at > now and not status:
            continue
        res.append({
            "id": r.id, "title": r.title, "slug": r.slug, "summary": r.summary,
            "content": r.content, "thumbnail": r.thumbnail, "banner": r.banner,
            "status": 'published' if (r.status == 'scheduled' and r.scheduled_at and r.scheduled_at <= now) else r.status,
            "scheduled_at": _fmt_dt(r.scheduled_at), "created_at": _fmt_dt(r.created_at),
            "updated_at": _fmt_dt(r.updated_at),
        })
    return jsonify(res), 200

@app.route('/admin/news', methods=['GET'])
@jwt_required()
def admin_news_list():
    admin, err = _require_admin()
    if err:
        return err
    rows = NewsPost.query.order_by(NewsPost.updated_at.desc()).all()
    return jsonify([{
        "id": r.id, "title": r.title, "slug": r.slug, "summary": r.summary,
        "content": r.content, "thumbnail": r.thumbnail, "banner": r.banner,
        "status": r.status, "scheduled_at": _fmt_dt(r.scheduled_at),
        "created_at": _fmt_dt(r.created_at), "updated_at": _fmt_dt(r.updated_at),
    } for r in rows]), 200

@app.route('/admin/news', methods=['POST'])
@jwt_required()
def admin_news_create():
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    title = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    slug = _slugify((data.get('slug') or '').strip() or title)
    status = (data.get('status') or 'draft').strip().lower()
    if status not in ('draft', 'published', 'scheduled', 'hidden'):
        status = 'draft'
    if not title or not content:
        return jsonify({"msg": "Thiếu title/content"}), 400
    dup = NewsPost.query.filter_by(slug=slug).first()
    if dup:
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"
    row = NewsPost(
        title=title, slug=slug, summary=(data.get('summary') or '').strip() or None,
        content=content, thumbnail=(data.get('thumbnail') or '').strip() or None,
        banner=(data.get('banner') or '').strip() or None, status=status,
        scheduled_at=_parse_datetime(data.get('scheduled_at') or '')
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({"msg": "OK", "id": row.id}), 201

@app.route('/admin/news/<int:id>', methods=['PUT'])
@jwt_required()
def admin_news_update(id):
    admin, err = _require_admin()
    if err:
        return err
    row = db.session.get(NewsPost, id)
    if not row:
        return jsonify({"msg": "Bài viết không tồn tại"}), 404
    data = request.get_json() or {}
    if 'title' in data:
        row.title = (data.get('title') or '').strip() or row.title
    if 'slug' in data:
        wanted = _slugify((data.get('slug') or '').strip() or row.title)
        if wanted != row.slug and NewsPost.query.filter(NewsPost.slug == wanted, NewsPost.id != row.id).first():
            wanted = f"{wanted}-{uuid.uuid4().hex[:6]}"
        row.slug = wanted
    if 'summary' in data:
        row.summary = (data.get('summary') or '').strip() or None
    if 'content' in data:
        row.content = (data.get('content') or '').strip() or row.content
    if 'thumbnail' in data:
        row.thumbnail = (data.get('thumbnail') or '').strip() or None
    if 'banner' in data:
        row.banner = (data.get('banner') or '').strip() or None
    if 'status' in data:
        status = (data.get('status') or '').strip().lower()
        if status in ('draft', 'published', 'scheduled', 'hidden'):
            row.status = status
    if 'scheduled_at' in data:
        row.scheduled_at = _parse_datetime(data.get('scheduled_at') or '')
    row.updated_at = datetime.now()
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/news/<int:id>', methods=['DELETE'])
@jwt_required()
def admin_news_delete(id):
    admin, err = _require_admin()
    if err:
        return err
    row = db.session.get(NewsPost, id)
    if not row:
        return jsonify({"msg": "Bài viết không tồn tại"}), 404
    db.session.delete(row)
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/api/warranty', methods=['GET'])
@jwt_required()
def admin_warranty_list():
    admin, err = _require_admin()
    if err:
        return err
    rows = WarrantyRecord.query.order_by(WarrantyRecord.updated_at.desc()).all()
    return jsonify([{
        "id": r.id, "warranty_code": r.warranty_code, "product_name": r.product_name,
        "serial_imei": r.serial_imei, "customer_name": r.customer_name, "phone": r.phone,
        "activated_at": _fmt_date(r.activated_at), "expired_at": _fmt_date(r.expired_at),
        "status": r.status, "history": json.loads(r.history) if r.history else [],
        "created_at": _fmt_dt(r.created_at), "updated_at": _fmt_dt(r.updated_at),
    } for r in rows]), 200

@app.route('/api/public/warranty/lookup', methods=['GET'])
def public_warranty_lookup():
    code = (request.args.get('code') or '').strip()
    serial = (request.args.get('serial') or '').strip()
    phone = (request.args.get('phone') or '').strip()
    q = WarrantyRecord.query
    if code:
        q = q.filter(WarrantyRecord.warranty_code == code)
    elif serial:
        q = q.filter(WarrantyRecord.serial_imei == serial)
    elif phone:
        q = q.filter(WarrantyRecord.phone == phone)
    else:
        return jsonify({"msg": "Thiếu tham số tra cứu"}), 400
    rows = q.order_by(WarrantyRecord.updated_at.desc()).all()
    return jsonify([{
        "id": r.id, "warranty_code": r.warranty_code, "product_name": r.product_name,
        "serial_imei": r.serial_imei, "customer_name": r.customer_name, "phone": r.phone,
        "activated_at": _fmt_date(r.activated_at), "expired_at": _fmt_date(r.expired_at),
        "status": r.status, "history": json.loads(r.history) if r.history else [],
    } for r in rows]), 200

@app.route('/admin/warranty', methods=['POST'])
@jwt_required()
def admin_warranty_create():
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    code = (data.get('warranty_code') or '').strip()
    product = (data.get('product_name') or '').strip()
    phone = (data.get('phone') or '').strip()
    if not code or not product or not phone:
        return jsonify({"msg": "Thiếu warranty_code/product_name/phone"}), 400
    if WarrantyRecord.query.filter_by(warranty_code=code).first():
        return jsonify({"msg": "Mã bảo hành đã tồn tại"}), 400
    status = (data.get('status') or 'active').strip().lower()
    if status not in ('active', 'processing', 'expired'):
        status = 'active'
    history = data.get('history') or []
    if not isinstance(history, list):
        history = []
    row = WarrantyRecord(
        warranty_code=code, product_name=product, serial_imei=(data.get('serial_imei') or '').strip() or None,
        customer_name=(data.get('customer_name') or '').strip() or None, phone=phone,
        activated_at=_parse_date(data.get('activated_at') or ''), expired_at=_parse_date(data.get('expired_at') or ''),
        status=status, history=json.dumps(history, ensure_ascii=False),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({"msg": "OK", "id": row.id}), 201

@app.route('/admin/warranty/<int:id>', methods=['PUT'])
@jwt_required()
def admin_warranty_update(id):
    admin, err = _require_admin()
    if err:
        return err
    row = db.session.get(WarrantyRecord, id)
    if not row:
        return jsonify({"msg": "Hồ sơ bảo hành không tồn tại"}), 404
    data = request.get_json() or {}
    if 'warranty_code' in data:
        code = (data.get('warranty_code') or '').strip()
        if not code:
            return jsonify({"msg": "warranty_code không hợp lệ"}), 400
        dup = WarrantyRecord.query.filter(WarrantyRecord.warranty_code == code, WarrantyRecord.id != id).first()
        if dup:
            return jsonify({"msg": "Mã bảo hành đã tồn tại"}), 400
        row.warranty_code = code
    if 'product_name' in data:
        row.product_name = (data.get('product_name') or '').strip() or row.product_name
    if 'serial_imei' in data:
        row.serial_imei = (data.get('serial_imei') or '').strip() or None
    if 'customer_name' in data:
        row.customer_name = (data.get('customer_name') or '').strip() or None
    if 'phone' in data:
        row.phone = (data.get('phone') or '').strip() or row.phone
    if 'activated_at' in data:
        row.activated_at = _parse_date(data.get('activated_at') or '')
    if 'expired_at' in data:
        row.expired_at = _parse_date(data.get('expired_at') or '')
    if 'status' in data:
        status = (data.get('status') or '').strip().lower()
        if status in ('active', 'processing', 'expired'):
            row.status = status
    if 'history' in data:
        history = data.get('history') or []
        if not isinstance(history, list):
            history = []
        row.history = json.dumps(history, ensure_ascii=False)
    row.updated_at = datetime.now()
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/warranty/<int:id>', methods=['DELETE'])
@jwt_required()
def admin_warranty_delete(id):
    admin, err = _require_admin()
    if err:
        return err
    row = db.session.get(WarrantyRecord, id)
    if not row:
        return jsonify({"msg": "Hồ sơ bảo hành không tồn tại"}), 404
    db.session.delete(row)
    db.session.commit()
    return jsonify({"msg": "OK"}), 200

@app.route('/admin/orders', methods=['GET'])
@jwt_required()
def admin_list_orders():
    admin, err = _require_admin()
    if err:
        return err
    try:
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
    except Exception:
        limit, offset = 100, 0
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    orders = Order.query.order_by(Order.created_at.desc()).offset(offset).limit(limit).all()
    return jsonify([{
        "order_code": o.order_code, "status": o.status, "total_amount": o.total_amount,
        "customer_name": o.customer_name, "customer_phone": o.customer_phone,
        "created_at": o.created_at.strftime('%d/%m/%Y %H:%M:%S') if o.created_at else None
    } for o in orders]), 200

@app.route('/admin/orders/<string:order_code>', methods=['GET'])
@jwt_required()
def admin_get_order_detail(order_code):
    admin, err = _require_admin()
    if err:
        return err
    order = Order.query.filter_by(order_code=order_code).first()
    if not order:
        return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
    items = OrderItem.query.filter_by(order_id=order.id).all()
    last_payment = Payment.query.filter_by(order_id=order.id).order_by(Payment.created_at.desc()).first()
    return jsonify({
        "order_code": order.order_code, "status": order.status, "total_amount": order.total_amount,
        "customer": {"name": order.customer_name, "phone": order.customer_phone, "address": order.customer_address, "email": order.customer_email},
        "created_at": order.created_at.strftime('%d/%m/%Y %H:%M:%S') if order.created_at else None,
        "items": [{"product_id": i.product_id, "name": i.product_name, "price": i.price, "quantity": i.quantity, "subtotal": int(i.price) * int(i.quantity)} for i in items],
        "payment": None if not last_payment else {"provider": last_payment.provider, "status": last_payment.status, "payment_ref": last_payment.payment_ref, "amount": last_payment.amount}
    }), 200

@app.route('/admin/orders/<string:order_code>', methods=['DELETE'])
@jwt_required()
def admin_delete_order(order_code):
    admin, err = _require_admin()
    if err:
        return err
    order = Order.query.filter_by(order_code=order_code).first()
    if not order:
        return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
    current = (order.status or '').lower()
    if current not in ('completed', 'cancelled'):
        return jsonify({"msg": "Chỉ được xóa đơn completed hoặc cancelled"}), 400
    if RefundRequest.query.filter_by(order_id=order.id).first():
        return jsonify({'msg': 'Đơn hàng có hồ sơ hoàn tiền cần được lưu lại để đối chiếu.'}), 409
    try:
        # Keep a retry tombstone without leaving a foreign key to the deleted order.
        OrderIdempotency.query.filter_by(order_id=order.id).update({'order_id': None})
        Payment.query.filter_by(order_id=order.id).delete()
        OrderItem.query.filter_by(order_id=order.id).delete()
        db.session.delete(order)
        db.session.commit()
        return jsonify({"msg": "OK"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"msg": "Lỗi hệ thống: " + str(e)}), 500

@app.route('/api/orders/<string:order_code>/invoice.pdf', methods=['GET'])
@jwt_required()
def user_download_order_invoice_pdf(order_code):
    user, err = _get_current_user_entity()
    if err:
        return err
    order = Order.query.filter_by(order_code=order_code, user_id=user.id).first()
    if not order:
        return jsonify({"msg": "Đơn hàng không tồn tại hoặc không thuộc quyền sở hữu của bạn"}), 404
    if (order.status or '').lower() != 'completed':
        return jsonify({"msg": "Chỉ xuất hóa đơn khi đơn đã hoàn thành"}), 400
    try:
        font_name = "Arial"
        font_path = "C:\\Windows\\Fonts\\Arial.ttf"
        font_bold_path = "C:\\Windows\\Fonts\\Arialbd.ttf"
        if not os.path.exists(font_path):
            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            font_bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
            font_name = "DejaVuSans"
        if os.path.exists(font_path):
            pdfmetrics.registerFont(TTFont(font_name, font_path))
            if os.path.exists(font_bold_path):
                pdfmetrics.registerFont(TTFont(f"{font_name}-Bold", font_bold_path))
                font_bold = f"{font_name}-Bold"
            else:
                font_bold = font_name
        else:
            font_name = "Helvetica"
            font_bold = "Helvetica-Bold"
        buf = BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=15*mm, leftMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm)
        elements = []
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('Title', fontName=font_bold, fontSize=22, alignment=TA_CENTER, spaceAfter=10*mm, color=colors.HexColor("#1a234a"))
        normal_text = ParagraphStyle('NormalText', fontName=font_name, fontSize=10, leading=14)
        elements.append(Paragraph("HÓA ĐƠN BÁN HÀNG", title_style))
        elements.append(Spacer(1, 5*mm))
        info_data = [
            [Paragraph(f"<b>Mã đơn hàng:</b> {order.order_code}", normal_text), Paragraph(f"<b>Khách hàng:</b> {order.customer_name}", normal_text)],
            [Paragraph(f"<b>Ngày đặt:</b> {order.created_at.strftime('%d/%m/%Y %H:%M')}", normal_text), Paragraph(f"<b>Số điện thoại:</b> {order.customer_phone}", normal_text)],
            [Paragraph(f"<b>Trạng thái:</b> {order.status.upper()}", normal_text), Paragraph(f"<b>Địa chỉ:</b> {order.customer_address}", normal_text)]
        ]
        info_table = Table(info_data, colWidths=[85*mm, 95*mm])
        info_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('BOTTOMPADDING', (0,0), (-1,-1), 4)]))
        elements.append(info_table)
        elements.append(Spacer(1, 10*mm))
        table_data = [["Ảnh", "Sản phẩm", "Số lượng", "Đơn giá", "Thành tiền"]]
        items = OrderItem.query.filter_by(order_id=order.id).all()
        p_ids = [it.product_id for it in items]
        prods = Product.query.filter(Product.id.in_(p_ids)).all()
        prod_map = {p.id: p for p in prods}
        for it in items:
            p = prod_map.get(it.product_id)
            img_element = "N/A"
            if p and p.img:
                img_path_rel = p.img.replace('../', '')
                abs_img_path = os.path.join(BASE_DIR, img_path_rel)
                if os.path.exists(abs_img_path):
                    try:
                        img_element = Image(abs_img_path, width=18*mm, height=18*mm)
                    except Exception:
                        img_element = "[Lỗi ảnh]"
            unit_price = int(it.price or 0)
            qty = int(it.quantity or 0)
            subtotal = unit_price * qty
            table_data.append([img_element, Paragraph(it.product_name, normal_text), str(qty), f"{unit_price:,} đ", f"{subtotal:,} đ"])
        item_table = Table(table_data, colWidths=[25*mm, 85*mm, 20*mm, 25*mm, 25*mm])
        item_table.setStyle(TableStyle([
            ('FONTNAME', (0,0), (-1,0), font_bold), ('FONTSIZE', (0,0), (-1,0), 11),
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#1a234a")), ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
            ('ALIGN', (0,0), (-1,0), 'CENTER'), ('ALIGN', (2,1), (-1,-1), 'CENTER'),
            ('GRID', (0,0), (-1,-1), 0.5, colors.grey), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6), ('TOPPADDING', (0,0), (-1,-1), 6),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.whitesmoke, colors.white])
        ]))
        elements.append(item_table)
        elements.append(Spacer(1, 10*mm))
        total_data = [["", "", Paragraph("<b>TỔNG CỘNG:</b>", ParagraphStyle('Right', fontName=font_bold, fontSize=12, alignment=TA_RIGHT)), Paragraph(f"<b>{int(order.total_amount):,} đ</b>", ParagraphStyle('Total', fontName=font_bold, fontSize=12, color=colors.red, alignment=TA_RIGHT))]]
        total_table = Table(total_data, colWidths=[25*mm, 85*mm, 35*mm, 35*mm])
        elements.append(total_table)
        elements.append(Spacer(1, 20*mm))
        elements.append(Paragraph("Cảm ơn quý khách đã tin tưởng lựa chọn NexTech!", ParagraphStyle('Footer', fontName=font_name, fontSize=10, alignment=TA_CENTER, fontStyle='Italic')))
        doc.build(elements)
        buf.seek(0)
        filename = f'invoice-{order.order_code}.pdf'
        return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({"msg": "Lỗi xuất PDF: " + str(e)}), 500

@app.route('/admin/orders/<string:order_code>/invoice.pdf', methods=['GET'])
@jwt_required()
def admin_download_order_invoice_pdf(order_code):
    admin, err = _require_admin()
    if err:
        return err
    order = Order.query.filter_by(order_code=order_code).first()
    if not order:
        return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
    if (order.status or '').lower() != 'completed':
        return jsonify({"msg": "Chỉ xuất hóa đơn khi đơn đã completed"}), 400
    try:
        font_name = "Arial"
        font_path = "C:\\Windows\\Fonts\\Arial.ttf"
        font_bold_path = "C:\\Windows\\Fonts\\Arialbd.ttf"
        if not os.path.exists(font_path):
            font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
            font_bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
            font_name = "DejaVuSans"
        if os.path.exists(font_path):
            pdfmetrics.registerFont(TTFont(font_name, font_path))
            if os.path.exists(font_bold_path):
                pdfmetrics.registerFont(TTFont(f"{font_name}-Bold", font_bold_path))
                font_bold = f"{font_name}-Bold"
            else:
                font_bold = font_name
        else:
            font_name = "Helvetica"
            font_bold = "Helvetica-Bold"
        buf = BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=15*mm, leftMargin=15*mm, topMargin=15*mm, bottomMargin=15*mm)
        elements = []
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('Title', fontName=font_bold, fontSize=22, alignment=TA_CENTER, spaceAfter=10*mm, color=colors.HexColor("#1a234a"))
        normal_text = ParagraphStyle('NormalText', fontName=font_name, fontSize=10, leading=14)
        elements.append(Paragraph("HÓA ĐƠN BÁN HÀNG", title_style))
        elements.append(Spacer(1, 5*mm))
        info_data = [
            [Paragraph(f"<b>Mã đơn hàng:</b> {order.order_code}", normal_text), Paragraph(f"<b>Khách hàng:</b> {order.customer_name}", normal_text)],
            [Paragraph(f"<b>Ngày đặt:</b> {order.created_at.strftime('%d/%m/%Y %H:%M')}", normal_text), Paragraph(f"<b>Số điện thoại:</b> {order.customer_phone}", normal_text)],
            [Paragraph(f"<b>Trạng thái:</b> {order.status.upper()}", normal_text), Paragraph(f"<b>Địa chỉ:</b> {order.customer_address}", normal_text)]
        ]
        info_table = Table(info_data, colWidths=[85*mm, 95*mm])
        info_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('BOTTOMPADDING', (0,0), (-1,-1), 4)]))
        elements.append(info_table)
        elements.append(Spacer(1, 10*mm))
        table_data = [["Ảnh", "Sản phẩm", "Số lượng", "Đơn giá", "Thành tiền"]]
        items = OrderItem.query.filter_by(order_id=order.id).all()
        p_ids = [it.product_id for it in items]
        prods = Product.query.filter(Product.id.in_(p_ids)).all()
        prod_map = {p.id: p for p in prods}
        for it in items:
            p = prod_map.get(it.product_id)
            img_element = "N/A"
            if p and p.img:
                img_path_rel = p.img.replace('../', '')
                abs_img_path = os.path.join(BASE_DIR, img_path_rel)
                if os.path.exists(abs_img_path):
                    try:
                        img_element = Image(abs_img_path, width=18*mm, height=18*mm)
                    except Exception:
                        img_element = "[Lỗi ảnh]"
            unit_price = int(it.price or 0)
            qty = int(it.quantity or 0)
            subtotal = unit_price * qty
            table_data.append([img_element, Paragraph(it.product_name, normal_text), str(qty), f"{unit_price:,} đ", f"{subtotal:,} đ"])
        item_table = Table(table_data, colWidths=[25*mm, 85*mm, 20*mm, 25*mm, 25*mm])
        item_table.setStyle(TableStyle([
            ('FONTNAME', (0,0), (-1,0), font_bold), ('FONTSIZE', (0,0), (-1,0), 11),
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#1a234a")), ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
            ('ALIGN', (0,0), (-1,0), 'CENTER'), ('ALIGN', (2,1), (-1,-1), 'CENTER'),
            ('GRID', (0,0), (-1,-1), 0.5, colors.grey), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6), ('TOPPADDING', (0,0), (-1,-1), 6),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.whitesmoke, colors.white])
        ]))
        elements.append(item_table)
        elements.append(Spacer(1, 10*mm))
        total_data = [["", "", Paragraph("<b>TỔNG CỘNG:</b>", ParagraphStyle('Right', fontName=font_bold, fontSize=12, alignment=TA_RIGHT)), Paragraph(f"<b>{int(order.total_amount):,} đ</b>", ParagraphStyle('Total', fontName=font_bold, fontSize=12, color=colors.red, alignment=TA_RIGHT))]]
        total_table = Table(total_data, colWidths=[25*mm, 85*mm, 35*mm, 35*mm])
        elements.append(total_table)
        elements.append(Spacer(1, 20*mm))
        elements.append(Paragraph("Cảm ơn quý khách đã tin tưởng lựa chọn NexTech!", ParagraphStyle('Footer', fontName=font_name, fontSize=10, alignment=TA_CENTER, fontStyle='Italic')))
        doc.build(elements)
        buf.seek(0)
        filename = f'invoice-{order.order_code}.pdf'
        return send_file(buf, mimetype='application/pdf', as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({"msg": "Lỗi xuất PDF: " + str(e)}), 500

@app.route('/admin/orders/<string:order_code>/status', methods=['PUT'])
@jwt_required()
def admin_update_order_status(order_code):
    admin, err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    new_status = (data.get('status') or '').strip().lower()
    allowed = {'processing', 'shipping', 'completed', 'cancelled'}
    if new_status not in allowed:
        return jsonify({"msg": "status không hợp lệ"}), 400
    email_to = None
    customer_name = None
    customer_phone = None
    customer_address = None
    total_amount = None
    action_type = None
    item_lines = []
    try:
        with _session_begin():
            order = Order.query.filter_by(order_code=order_code).with_for_update().first()
            if not order:
                return jsonify({"msg": "Đơn hàng không tồn tại"}), 404
            current = (order.status or '').lower()
            if current == 'completed' and new_status != 'completed':
                return jsonify({"msg": "Không thể đổi trạng thái từ completed"}), 400
            if new_status == 'processing' and current != 'processing':
                return jsonify({"msg": "Không thể chuyển về processing"}), 400
            if new_status == 'shipping' and current not in ('processing', 'shipping'):
                return jsonify({"msg": "Chỉ có thể chuyển sang shipping từ processing"}), 400
            if new_status == 'completed' and current not in ('shipping', 'completed'):
                return jsonify({"msg": "Chỉ có thể completed khi đang shipping"}), 400
            prev_status = current
            if new_status == prev_status:
                return jsonify({"msg": "OK", "status": order.status}), 200
            email_to = order.customer_email
            customer_name = order.customer_name
            customer_phone = order.customer_phone
            customer_address = order.customer_address
            total_amount = order.total_amount
            try:
                items = OrderItem.query.filter_by(order_id=order.id).all()
                for i in (items or []):
                    if not i or not i.product_name:
                        continue
                    qty = int(i.quantity or 0)
                    unit = int(i.price or 0)
                    sub = unit * max(qty, 0)
                    item_lines.append(f"- {i.product_name} x{qty} • {unit:,} VND • {sub:,} VND")
            except Exception:
                pass
            if new_status == 'cancelled':
                Payment.query.filter_by(order_id=order.id, status='pending').update({"status": "failed"})
                order.status = 'cancelled'
                if prev_status != 'cancelled':
                    _restock_order_items(order.id)
                    action_type = 'cancel'
            elif new_status == 'shipping':
                order.status = 'shipping'
                if prev_status == 'processing':
                    action_type = 'ship'
            else:
                order.status = new_status
        email_sent = False
        email_error = None
        if action_type and email_to:
            if action_type == 'cancel':
                subject = f"NexTech - Đơn hàng {order_code} đã bị hủy"
                intro_text = f"Đơn hàng {order_code} đã được hủy bởi hệ thống quản trị."
            else:
                subject = f"NexTech - Đơn hàng {order_code} đang được giao"
                intro_text = f"Tin vui! Đơn hàng {order_code} của bạn đã được xác nhận và đang trên đường giao đến bạn."
            time_text = datetime.now().strftime('%d/%m/%Y %H:%M:%S')
            lines = [f"Xin chào {customer_name},", "", intro_text, f"Thời gian: {time_text}", "", "Thông tin đơn hàng:", f"- Mã đơn: {order_code}"]
            if total_amount is not None:
                lines.append(f"- Tổng tiền: {int(total_amount):,} VND")
            if item_lines:
                lines.append("- Sản phẩm:")
                lines.extend(item_lines)
            lines.extend(["", "Thông tin giao hàng:", f"- Họ tên: {customer_name}", f"- SĐT: {customer_phone}", f"- Địa chỉ: {customer_address}", "", "Cảm ơn bạn đã đồng hành cùng NexTech!"])
            body = "\n".join(lines)
            sent, err_code = _send_email_if_configured(email_to, subject, body)
            email_mode = (os.getenv('EMAIL_MODE') or '').strip().lower()
            if email_mode in ('file', 'console'):
                email_sent = False
                email_error = err_code or f"dev_email_mode:{email_mode}"
                if sent and not err_code:
                    email_error = f"dev_email_mode:{email_mode}"
            else:
                email_sent, email_error = sent, err_code
        return jsonify({"msg": "OK", "status": new_status, "email_sent": email_sent, "email_error": email_error}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"msg": "Lỗi hệ thống: " + str(e)}), 500

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = _validated_text_fields(request.get_json(silent=True), {'email': 120},
                                      required=('email',), single_line=('email',))
    except ValueError as error:
        return jsonify({"msg": str(error)}), 400
    email = data['email']
    if not _is_valid_email(email):
        return jsonify({"msg": "Email không hợp lệ!"}), 400
    response = {"msg": "Nếu email hợp lệ trong hệ thống, liên kết đặt lại mật khẩu sẽ được gửi. Vui lòng kiểm tra hộp thư."}
    user = User.query.filter_by(email=email).first()
    if not user or user.is_locked:
        return jsonify(response), 200
    now = datetime.now()
    latest = PasswordResetToken.query.filter_by(user_id=user.id).order_by(PasswordResetToken.created_at.desc()).first()
    if latest and (now - latest.created_at).total_seconds() < 60:
        return jsonify(response), 200
    base = os.getenv('PUBLIC_BASE_URL', 'http://127.0.0.1:5001').strip().rstrip('/')
    parsed = urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.query or parsed.fragment:
        app.logger.error('Password reset requires a valid PUBLIC_BASE_URL')
        return jsonify(response), 200
    token = secrets.token_urlsafe(32)
    try:
        PasswordResetToken.query.filter_by(user_id=user.id, used_at=None).update({'used_at': now})
        db.session.add(PasswordResetToken(user_id=user.id,
            token_hash=hashlib.sha256(token.encode('utf-8')).hexdigest(),
            expires_at=now + timedelta(minutes=15), created_at=now))
        link = f"{base}/pages/reset-password.html?token={token}"
        body = (f"Xin chào {user.username},\n\nMở liên kết sau để đặt lại mật khẩu:\n{link}\n\n"
                "Liên kết dùng một lần và hết hạn sau 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này. Mật khẩu hiện tại chưa thay đổi.")
        sent, error = _send_email_if_configured(user.email, 'NexTech - Đặt lại mật khẩu', body)
        if not sent:
            db.session.rollback()
            app.logger.warning('Password reset email could not be delivered: %s', error)
            return jsonify(response), 200
        db.session.commit()
        return jsonify(response), 200
    except Exception:
        db.session.rollback()
        app.logger.exception('Password reset request failed')
        return jsonify(response), 200


@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "Dữ liệu không hợp lệ"}), 400
    token = data.get('token')
    password = data.get('new_password')
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', token):
        return jsonify({"msg": "Liên kết không hợp lệ hoặc đã hết hạn"}), 400
    if not isinstance(password, str) or len(password) < 6 or len(password.encode('utf-8')) > 72:
        return jsonify({"msg": "Mật khẩu cần ít nhất 6 ký tự và tối đa 72 byte"}), 400
    now = datetime.now()
    with _session_begin():
        record = PasswordResetToken.query.filter_by(token_hash=hashlib.sha256(token.encode('utf-8')).hexdigest()).with_for_update().first()
        if not record or record.used_at or record.expires_at <= now:
            return jsonify({"msg": "Liên kết không hợp lệ hoặc đã hết hạn"}), 400
        user = User.query.filter_by(id=record.user_id).with_for_update().first()
        if not user or user.is_locked:
            return jsonify({"msg": "Liên kết không hợp lệ hoặc đã hết hạn"}), 400
        user.password = bcrypt.generate_password_hash(password).decode('utf-8')
        user.updated_at = now
        PasswordResetToken.query.filter_by(user_id=user.id, used_at=None).update({'used_at': now})
    return jsonify({"msg": "Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới."}), 200

@app.cli.command('cleanup-reset-tokens')
@click.option('--retention-days', default=7, type=click.IntRange(1, 365), show_default=True)
@click.option('--apply', 'apply_changes', is_flag=True, help='Delete matched expired tokens; otherwise only report the count.')
def cleanup_reset_tokens(retention_days, apply_changes):
    """Remove only tokens expired longer than the chosen retention period."""
    cutoff = datetime.now() - timedelta(days=retention_days)
    query = PasswordResetToken.query.filter(PasswordResetToken.expires_at < cutoff)
    matched = query.count()
    deleted = 0
    if apply_changes:
        deleted = query.delete(synchronize_session=False)
        db.session.commit()
    click.echo(json.dumps({'matched': matched, 'deleted': deleted, 'dry_run': not apply_changes}))

@app.cli.command('cleanup-rate-buckets')
@click.option('--apply', 'apply_changes', is_flag=True, help='Delete expired counters; otherwise preview only.')
def cleanup_rate_buckets(apply_changes):
    """Clean old request counters without removing active rate windows."""
    query = RequestRateBucket.query.filter(RequestRateBucket.expires_at < datetime.now())
    matched = query.count()
    deleted = query.delete(synchronize_session=False) if apply_changes else 0
    if apply_changes:
        db.session.commit()
    click.echo(json.dumps({'matched': matched, 'deleted': deleted, 'dry_run': not apply_changes}))


if __name__ == '__main__':
    debug = os.getenv('FLASK_DEBUG', '0').lower() in ('1', 'true', 'yes')
    app.run(debug=debug, port=int(os.getenv('PORT', '5001')), use_reloader=debug)
