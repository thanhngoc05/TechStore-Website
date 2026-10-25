"""API regression tests with an isolated in-memory database and no external calls."""
import os
import re
from io import BytesIO
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
os.environ['JWT_SECRET_KEY'] = secrets.token_urlsafe(48)
test_uri = os.getenv('TECHSTORE_TEST_DATABASE_URI', 'sqlite:///:memory:')
if test_uri != 'sqlite:///:memory:':
    parsed = make_url(test_uri)
    if (os.getenv('TECHSTORE_ALLOW_DATABASE_RESET') != '1'
            or parsed.drivername != 'mysql+pymysql' or parsed.database != 'techstore_test'
            or parsed.host not in ('localhost', '127.0.0.1')):
        raise RuntimeError('Tests may reset only an explicitly authorized local techstore_test database.')
os.environ['SQLALCHEMY_DATABASE_URI'] = test_uri
os.environ['USE_SQLITE'] = '1' if test_uri.startswith('sqlite:') else '0'
for key in ('ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'PAYOS_CLIENT_ID',
            'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'):
    os.environ[key] = ''
sys.path.insert(0, str(ROOT / 'backend'))
import app as backend
from payos import PayOS
from payos.types.webhooks import WebhookData


class BackendTests(unittest.TestCase):
    def make_admin(self):
        with backend.app.app_context():
            user = backend.User.query.filter_by(username='buyer').one()
            user.role = 'admin'
            backend.db.session.commit()
            return user.id

    def setUp(self):
        backend.app.config['TESTING'] = True
        self.client = backend.app.test_client()
        with backend.app.app_context():
            backend.db.drop_all()
            backend.db.create_all()
            self.assertEqual(backend.User.query.count(), 0)
            backend.db.session.add(backend.Product(name='Test laptop', category='laptop',
                                                  price=100000, stock=5, img='test.png'))
            backend.db.session.commit()
        self.password = secrets.token_urlsafe(16)
        self.register('buyer')
        self.headers = self.login('buyer')
        self.email_patch = patch.object(backend, '_send_email_async', return_value=(True, None))
        self.email_patch.start()
        self.addCleanup(self.email_patch.stop)

    def register(self, name):
        return self.client.post('/register', json={'username': name, 'password': self.password,
                                                  'email': name + '@example.com'})

    def login(self, name):
        response = self.client.post('/login', json={'username': name, 'password': self.password,
                                                    'required_role': 'user'})
        self.assertEqual(response.status_code, 200, response.json)
        return {'Authorization': 'Bearer ' + response.json['access_token']}

    def order(self, method='cod', headers=None):
        return self.client.post('/api/orders', headers=headers or self.headers, json={
            'items': [{'product_id': 1, 'quantity': 2}], 'payment_method': method,
            'customer': {'name': 'Test Buyer', 'phone': '0901234567', 'address': 'Test Address'}})

    def pending_payment(self):
        response = self.order('payos')
        self.assertEqual(response.status_code, 201, response.json)
        code = response.json['order_code']
        with backend.app.app_context():
            order = backend.Order.query.filter_by(order_code=code).one()
            backend.db.session.add(backend.Payment(order_id=order.id, provider='payos',
                amount=order.total_amount, status='pending', payment_ref='123456'))
            backend.db.session.commit()
        return code

    def payment_state(self):
        with backend.app.app_context():
            return backend.Payment.query.one().status, backend.Order.query.one().status

    def test_health_and_frontend(self):
        for url in ('/api/health', '/', '/pages/admin.html', '/scripts/api-config.js', '/assets/CSS/styles.css'):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_public_apis(self):
        with patch.object(backend.urllib.request, 'urlopen', return_value=BytesIO(b'[]')):
            for url in ('/api/public/products', '/api/public/news', '/api/public/banners', '/api/public/locations'):
                with self.subTest(url=url):
                    self.assertEqual(self.client.get(url).status_code, 200)

    def test_login_validation(self):
        for body in ({}, [], {'username': 'buyer'}, {'username': 'buyer', 'password': 123}):
            with self.subTest(body=body):
                self.assertEqual(self.client.post('/login', json=body).status_code, 400)

    def test_registration_and_access_control(self):
        self.assertEqual(self.register('buyer').status_code, 400)
        self.assertEqual(self.client.get('/api/cart').status_code, 401)
        self.assertEqual(self.client.get('/admin/users', headers=self.headers).status_code, 403)
        with backend.app.app_context():
            buyer = backend.User.query.filter_by(username='buyer').one()
            buyer.is_locked = True
            backend.db.session.commit()
        self.assertEqual(self.client.get('/api/cart', headers=self.headers).status_code, 403)

    def test_cart_order_cancel_persistence(self):
        r = self.client.post('/api/cart', headers=self.headers, json={'product_id': 1, 'quantity': 2})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.client.get('/api/cart', headers=self.headers).json[0]['quantity'], 2)
        response = self.order()
        self.assertEqual(response.status_code, 201, response.json)
        code = response.json['order_code']
        self.assertEqual(response.json['total_amount'], 200000)
        with backend.app.app_context():
            self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 3)
        for _ in range(2):
            r = self.client.put('/api/orders/' + code + '/cancel', headers=self.headers)
            self.assertEqual(r.status_code, 200, r.json)
            with backend.app.app_context():
                self.assertEqual(backend.Order.query.one().status, 'cancelled')
                self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 5)

    def test_other_buyer_cannot_access_order(self):
        code = self.order().json['order_code']
        self.register('other')
        other_headers = self.login('other')
        self.assertEqual(self.client.get('/api/orders/' + code, headers=other_headers).status_code, 404)
        self.assertEqual(self.client.put('/api/orders/' + code + '/cancel', headers=other_headers).status_code, 404)

    def test_order_rejects_insufficient_stock(self):
        self.assertEqual(self.order().status_code, 201)
        self.assertEqual(self.order().status_code, 201)
        self.assertEqual(self.order().status_code, 409)
        with backend.app.app_context():
            self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 1)

    def test_confirm_does_not_trust_browser_success(self):
        self.pending_payment()
        sdk = SimpleNamespace(payment_requests=SimpleNamespace(get=lambda ref: SimpleNamespace(
            order_code=ref, amount=200000, amount_paid=0, status='PENDING')))
        with patch.object(backend, 'payos_client', sdk):
            r = self.client.post('/api/payment/confirm', headers=self.headers,
                                 json={'payment_ref': '123456', 'result': 'success'})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(self.payment_state(), ('pending', 'processing'))

    def test_confirm_checks_amount_and_persists_success(self):
        order_code = self.pending_payment()
        verified = SimpleNamespace(order_code=123456, amount=1, amount_paid=1, status='PAID')
        sdk = SimpleNamespace(payment_requests=SimpleNamespace(get=lambda ref: verified))
        with patch.object(backend, 'payos_client', sdk):
            r = self.client.post('/api/payment/confirm', headers=self.headers, json={'payment_ref': '123456'})
            self.assertEqual(r.status_code, 409)
            self.assertEqual(self.payment_state()[0], 'pending')
            verified.amount = verified.amount_paid = 200000
            r = self.client.post('/api/payment/confirm', headers=self.headers, json={'payment_ref': '123456'})
            self.assertEqual(r.status_code, 200, r.json)
            self.assertEqual(r.json['order_code'], order_code)
        self.assertEqual(self.payment_state(), ('success', 'processing'))

    def test_signed_webhook_and_replay(self):
        self.pending_payment()
        sdk = PayOS(client_id='test', api_key='test', checksum_key='test-checksum')
        data = WebhookData(order_code=123456, amount=200000, description='Test', account_number='123',
            reference='ref', transaction_date_time='2026-10-23 10:00:00', currency='VND',
            payment_link_id='link', code='00', desc='success').model_dump_camel_case()
        signature = sdk.crypto.create_signature_from_object(data, sdk.checksum_key)
        payload = {'code': '00', 'desc': 'success', 'success': True, 'data': data, 'signature': signature}
        with patch.object(backend, 'payos_client', sdk):
            invalid = dict(payload, signature='invalid')
            self.assertEqual(self.client.post('/payment/webhook', json=invalid).status_code, 400)
            self.assertEqual(self.payment_state()[0], 'pending')
            mismatched = dict(data, amount=1)
            wrong_amount = dict(payload, data=mismatched,
                signature=sdk.crypto.create_signature_from_object(mismatched, sdk.checksum_key))
            self.assertEqual(self.client.post('/payment/webhook', json=wrong_amount).status_code, 409)
            self.assertEqual(self.payment_state()[0], 'pending')
            for _ in range(2):
                r = self.client.post('/payment/webhook', json=payload)
                self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(self.payment_state(), ('success', 'processing'))

    def test_admin_status_is_persisted(self):
        code = self.order().json['order_code']
        with backend.app.app_context():
            buyer = backend.User.query.filter_by(username='buyer').one()
            buyer.role = 'admin'
            backend.db.session.commit()
        r = self.client.get('/admin/dashboard/stats', headers=self.headers)
        self.assertEqual(r.status_code, 200, r.json)
        url = '/admin/orders/' + code + '/status'
        for status in ('shipping', 'completed'):
            r = self.client.put(url, headers=self.headers, json={'status': status})
            self.assertEqual(r.status_code, 200, r.json)
            with backend.app.app_context():
                self.assertEqual(backend.Order.query.one().status, status)
        r = self.client.get('/api/orders/' + code + '/invoice.pdf', headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.startswith(b'%PDF'))

    def test_unconfigured_payment_is_rejected(self):
        self.pending_payment()
        with patch.object(backend, 'payos_client', None):
            self.assertEqual(self.client.post('/payment/webhook', json={'status': 'PAID'}).status_code, 503)
            self.assertEqual(self.client.post('/api/payment/confirm', headers=self.headers,
                json={'payment_ref': '123456', 'result': 'success'}).status_code, 503)
        self.assertEqual(self.payment_state(), ('pending', 'processing'))

    def test_payment_creation_rejects_non_processing_orders(self):
        code = self.order().json['order_code']
        for status in ('cancelled', 'shipping', 'completed'):
            with self.subTest(status=status):
                with backend.app.app_context():
                    backend.Order.query.one().status = status
                    backend.db.session.commit()
                r = self.client.post('/api/payment/create', headers=self.headers,
                                     json={'order_code': code, 'provider': 'cod'})
                self.assertEqual(r.status_code, 409, r.json)
                with backend.app.app_context():
                    self.assertEqual(backend.Payment.query.count(), 0)

    def test_payment_creation_rejects_paid_order(self):
        code = self.pending_payment()
        with backend.app.app_context():
            backend.Payment.query.one().status = 'success'
            backend.db.session.commit()
        r = self.client.post('/api/payment/create', headers=self.headers,
                             json={'order_code': code, 'provider': 'payos'})
        self.assertEqual(r.status_code, 409, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.Payment.query.count(), 1)
            self.assertEqual(backend.Payment.query.one().status, 'success')

    def test_payment_creation_rejects_method_switch(self):
        code = self.pending_payment()
        r = self.client.post('/api/payment/create', headers=self.headers,
                             json={'order_code': code, 'provider': 'cod'})
        self.assertEqual(r.status_code, 409, r.json)
        self.assertEqual(self.payment_state(), ('pending', 'processing'))

    def test_payment_creation_reuses_pending_cod(self):
        code = self.order().json['order_code']
        payload = {'order_code': code, 'provider': 'cod'}
        first = self.client.post('/api/payment/create', headers=self.headers, json=payload)
        second = self.client.post('/api/payment/create', headers=self.headers, json=payload)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(second.status_code, 200, second.json)
        self.assertEqual(first.json['payment_ref'], second.json['payment_ref'])
        with backend.app.app_context():
            self.assertEqual(backend.Payment.query.count(), 1)

    def test_payment_creation_rejects_other_buyer(self):
        code = self.order().json['order_code']
        self.register('other')
        r = self.client.post('/api/payment/create', headers=self.login('other'),
                             json={'order_code': code, 'provider': 'cod'})
        self.assertEqual(r.status_code, 404, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.Payment.query.count(), 0)

    def test_payment_creation_validates_input(self):
        for body in ([], {}, {'order_code': 1}, {'order_code': 'ORD', 'provider': 1},
                     {'order_code': 'ORD', 'provider': 'unknown'}):
            with self.subTest(body=body):
                r = self.client.post('/api/payment/create', headers=self.headers, json=body)
                self.assertEqual(r.status_code, 400, r.json)

    def test_password_unchanged_when_email_fails(self):
        with patch.object(backend, '_send_email_if_configured', return_value=(False, 'test_failure')):
            r = self.client.post('/api/forgot-password', json={'email': 'buyer@example.com'})
        self.assertEqual(r.status_code, 200)
        with backend.app.app_context():
            self.assertEqual(backend.PasswordResetToken.query.count(), 0)
        self.login('buyer')

    def test_profile_rejects_locked_user(self):
        with backend.app.app_context():
            backend.User.query.filter_by(username='buyer').one().is_locked = True
            backend.db.session.commit()
        self.assertEqual(self.client.get('/api/profile', headers=self.headers).status_code, 403)
        r = self.client.put('/api/profile/update', headers=self.headers, json={'phone': '0900000000'})
        self.assertEqual(r.status_code, 403)

    def test_profile_rejects_deleted_user(self):
        with backend.app.app_context():
            backend.User.query.filter_by(username='buyer').delete()
            backend.db.session.commit()
        self.assertEqual(self.client.get('/api/profile', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.put('/api/profile/update', headers=self.headers, json={}).status_code, 404)

    def test_profile_validates_input(self):
        for body in ([], {'phone': {}}, {'address': 123}, {'phone': '1' * 16},
                     {'address': 'a' * 1001}, {'new_password': 123},
                     {'new_password': 'short'}, {'new_password': 'a' * 73},
                     {'new_password': 'correct-length', 'old_password': []}):
            with self.subTest(body=body):
                r = self.client.put('/api/profile/update', headers=self.headers, json=body)
                self.assertEqual(r.status_code, 400, r.json)

    def test_failed_password_change_preserves_profile(self):
        r = self.client.put('/api/profile/update', headers=self.headers, json={
            'phone': '0900000000', 'address': 'Changed',
            'old_password': 'wrong-password', 'new_password': 'new-test-password'})
        self.assertEqual(r.status_code, 400)
        profile = self.client.get('/api/profile', headers=self.headers).json
        self.assertIsNone(profile['phone'])
        self.assertEqual(profile['address'], '')
        self.login('buyer')

    def test_password_only_update_preserves_contact(self):
        r = self.client.put('/api/profile/update', headers=self.headers,
                            json={'phone': '0900000000', 'address': 'Test Address'})
        self.assertEqual(r.status_code, 200, r.json)
        new_password = secrets.token_urlsafe(16)
        r = self.client.put('/api/profile/update', headers=self.headers,
                            json={'old_password': self.password, 'new_password': new_password})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertTrue(r.json['password_changed'])
        self.assertEqual(self.client.get('/api/profile', headers=self.headers).status_code, 401)
        with backend.app.app_context():
            user = backend.User.query.filter_by(username='buyer').one()
            self.assertEqual(user.phone, '0900000000')
            self.assertEqual(user.address, 'Test Address')
        r = self.client.post('/login', json={'username': 'buyer', 'password': self.password, 'required_role': 'user'})
        self.assertEqual(r.status_code, 401)
        self.password = new_password
        self.login('buyer')

    def test_missing_secret_blocks_startup(self):
        env = dict(os.environ, JWT_SECRET_KEY='')
        r = subprocess.run([sys.executable, '-c', 'import app'], cwd=ROOT / 'backend', env=env,
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('JWT_SECRET_KEY', r.stderr)

    def test_hidden_product_is_private_and_cannot_be_ordered(self):
        with backend.app.app_context():
            backend.db.session.get(backend.Product, 1).is_hidden = True
            backend.User.query.filter_by(username='buyer').one().role = 'admin'
            backend.db.session.commit()
        self.assertEqual(self.client.get('/api/public/products').json, {})
        self.assertEqual(len(self.client.get('/admin/products', headers=self.headers).json), 1)
        self.assertEqual(self.client.post('/api/cart', headers=self.headers,
                         json={'product_id': 1, 'quantity': 1}).status_code, 404)
        self.assertEqual(self.order().status_code, 404)
        with backend.app.app_context():
            self.assertEqual(backend.Order.query.count(), 0)
            self.assertEqual(backend.CartItem.query.count(), 0)
            self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 5)

    def test_cart_add_checks_combined_quantity(self):
        payload = {'product_id': 1, 'quantity': 3}
        self.assertEqual(self.client.post('/api/cart', headers=self.headers, json=payload).status_code, 201)
        self.assertEqual(self.client.post('/api/cart', headers=self.headers, json=payload).status_code, 409)
        self.assertEqual(self.client.get('/api/cart', headers=self.headers).json[0]['quantity'], 3)

    def test_cart_update_checks_stock_and_hidden_product(self):
        r = self.client.post('/api/cart', headers=self.headers, json={'product_id': 1, 'quantity': 2})
        url = '/api/cart/' + str(r.json['cart_item_id'])
        self.assertEqual(self.client.put(url, headers=self.headers, json={'quantity': 6}).status_code, 409)
        self.assertEqual(self.client.get('/api/cart', headers=self.headers).json[0]['quantity'], 2)
        with backend.app.app_context():
            backend.db.session.get(backend.Product, 1).is_hidden = True
            backend.db.session.commit()
        self.assertEqual(self.client.put(url, headers=self.headers, json={'quantity': 1}).status_code, 404)

    def test_cart_and_checkout_reject_fractional_or_boolean_quantities(self):
        for quantity in (True, 1.5, 0, -1, '1.5', None):
            with self.subTest(quantity=quantity):
                r = self.client.post('/api/cart', headers=self.headers,
                                     json={'product_id': 1, 'quantity': quantity})
                self.assertEqual(r.status_code, 400)
                r = self.client.post('/api/orders', headers=self.headers,
                                     json={'items': [{'product_id': 1, 'quantity': quantity}]})
                self.assertEqual(r.status_code, 400)

    def test_hidden_product_in_existing_cart_cannot_be_checked_out(self):
        self.client.post('/api/cart', headers=self.headers, json={'product_id': 1, 'quantity': 1})
        with backend.app.app_context():
            backend.db.session.get(backend.Product, 1).is_hidden = True
            backend.db.session.commit()
        r = self.client.post('/api/orders', headers=self.headers, json={
            'customer': {'name': 'Buyer', 'phone': '0900000000', 'address': 'Test'}})
        self.assertEqual(r.status_code, 404, r.json)
        self.assertEqual(len(self.client.get('/api/cart', headers=self.headers).json), 1)

    def test_cart_rejects_malformed_json_shape(self):
        r = self.client.post('/api/cart', headers=self.headers, json=[])
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/orders', headers=self.headers, json=[])
        self.assertEqual(r.status_code, 400)

    def test_reviews_update_average_and_count(self):
        for rating in (5, 2):
            r = self.client.post('/api/reviews/add', headers=self.headers,
                json={'product_id': 1, 'rating': rating, 'content': '  Good product  '})
            self.assertEqual(r.status_code, 201, r.json)
        with backend.app.app_context():
            product = backend.db.session.get(backend.Product, 1)
            self.assertEqual(product.rating, 3.5)
            self.assertEqual(product.review_count, 2)
        reviews = self.client.get('/api/reviews/1').json
        self.assertEqual(len(reviews), 2)
        self.assertEqual(reviews[0]['content'], 'Good product')
        self.assertEqual(reviews[0]['username'], 'buyer')

    def test_reviews_reject_invalid_rating_and_content(self):
        invalid = [[], {}, {'product_id': False, 'rating': 5, 'content': 'Test'}]
        invalid += [{'product_id': 1, 'rating': rating, 'content': 'Test'}
                    for rating in (0, 6, -1, True, 3.5, None)]
        invalid += [{'product_id': 1, 'rating': 5, 'content': content}
                    for content in ('', '   ', None, {}, 'x' * 5001)]
        for body in invalid:
            with self.subTest(body_type=type(body).__name__):
                r = self.client.post('/api/reviews/add', headers=self.headers, json=body)
                self.assertEqual(r.status_code, 400, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.Review.query.count(), 0)
            self.assertEqual(backend.db.session.get(backend.Product, 1).review_count, 0)

    def test_reviews_reject_missing_and_hidden_products(self):
        for product_id in (999, 1):
            with backend.app.app_context():
                backend.db.session.get(backend.Product, 1).is_hidden = True
                backend.db.session.commit()
            r = self.client.post('/api/reviews/add', headers=self.headers,
                json={'product_id': product_id, 'rating': 5, 'content': 'Test'})
            self.assertEqual(r.status_code, 404, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.Review.query.count(), 0)

    def test_reviews_reject_locked_or_deleted_account(self):
        payload = {'product_id': 1, 'rating': 5, 'content': 'Test'}
        with backend.app.app_context():
            backend.User.query.filter_by(username='buyer').one().is_locked = True
            backend.db.session.commit()
        self.assertEqual(self.client.post('/api/reviews/add', headers=self.headers, json=payload).status_code, 403)
        with backend.app.app_context():
            backend.User.query.filter_by(username='buyer').delete()
            backend.db.session.commit()
        self.assertEqual(self.client.post('/api/reviews/add', headers=self.headers, json=payload).status_code, 404)

    def test_registration_rejects_invalid_fields(self):
        valid = {'username': 'new', 'email': 'new@example.com', 'password': 'valid-test-password'}
        invalid = [[], {}, dict(valid, password='short'), dict(valid, password='a' * 73),
                   dict(valid, password='ể' * 30), dict(valid, phone=123), dict(valid, email='bad'),
                   dict(valid, username='x' * 81), dict(valid, phone='x' * 16)]
        for body in invalid:
            self.assertEqual(self.client.post('/register', json=body).status_code, 400)
        with backend.app.app_context():
            self.assertEqual(backend.User.query.count(), 1)

    def test_public_registration_cannot_assign_admin(self):
        r = self.client.post('/register', json={'username': 'new', 'email': 'new@example.com',
                            'password': 'valid-test-password', 'role': 'admin'})
        self.assertEqual(r.status_code, 201, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.User.query.filter_by(username='new').one().role, 'user')

    def test_admin_creation_requires_explicit_valid_password(self):
        self.make_admin()
        payload = {'username': 'new', 'email': 'new@example.com'}
        self.assertEqual(self.client.post('/admin/users/add', headers=self.headers, json=payload).status_code, 400)
        payload['password'] = 'valid-test-password'
        r = self.client.post('/admin/users/add', headers=self.headers, json=payload)
        self.assertEqual(r.status_code, 201, r.json)

    def test_long_login_password_is_validation_error(self):
        r = self.client.post('/login', json={'username': 'buyer', 'password': 'x' * 73, 'required_role': 'user'})
        self.assertEqual(r.status_code, 400)

    def test_last_admin_cannot_be_demoted_or_locked(self):
        admin_id = self.make_admin()
        for body in ({'role': 'user'}, {'is_locked': True}, {'role': 'user', 'is_locked': True}):
            r = self.client.put(f'/admin/users/update/{admin_id}', headers=self.headers, json=body)
            self.assertEqual(r.status_code, 400, r.json)
            with backend.app.app_context():
                admin = backend.db.session.get(backend.User, admin_id)
                self.assertEqual(admin.role, 'admin')
                self.assertFalse(admin.is_locked)

    def test_admin_can_be_demoted_when_another_active_admin_exists(self):
        admin_id = self.make_admin()
        self.register('second')
        with backend.app.app_context():
            backend.User.query.filter_by(username='second').one().role = 'admin'
            backend.db.session.commit()
        r = self.client.put(f'/admin/users/update/{admin_id}', headers=self.headers, json={'role': 'user'})
        self.assertEqual(r.status_code, 200, r.json)

    def test_admin_user_validation_does_not_partially_update(self):
        admin_id = self.make_admin()
        for body in ({'username': 'changed', 'email': 'invalid'}, {'is_locked': 'false'},
                     {'role': 'superadmin'}, {'phone': 123}, []):
            r = self.client.put(f'/admin/users/update/{admin_id}', headers=self.headers, json=body)
            self.assertEqual(r.status_code, 400, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.db.session.get(backend.User, admin_id).username, 'buyer')

    def test_admin_product_rejects_invalid_data(self):
        self.make_admin()
        valid = {'name': 'New', 'category': 'laptop', 'price': 1, 'stock': 2, 'img': 'test.png', 'specs': {}}
        for body in ([], {}, dict(valid, price=-1), dict(valid, stock=1.5), dict(valid, price=True),
                     dict(valid, stock=2147483648), dict(valid, name='x' * 201), dict(valid, specs=[])):
            r = self.client.post('/admin/products/add', headers=self.headers, json=body)
            self.assertEqual(r.status_code, 400, r.json)
        with backend.app.app_context():
            self.assertEqual(backend.Product.query.count(), 1)

    def test_admin_product_partial_update_preserves_fields(self):
        self.make_admin()
        r = self.client.put('/admin/products/update/1', headers=self.headers, json={'price': 120000})
        self.assertEqual(r.status_code, 200, r.json)
        r = self.client.put('/admin/products/update/1', headers=self.headers, json={'name': 'Changed', 'stock': -1})
        self.assertEqual(r.status_code, 400)
        with backend.app.app_context():
            product = backend.db.session.get(backend.Product, 1)
            self.assertEqual(product.name, 'Test laptop')
            self.assertEqual(product.price, 120000)
            self.assertEqual(product.stock, 5)
        self.assertEqual(self.client.put('/admin/products/update/999', headers=self.headers, json={}).status_code, 404)

    def test_product_deletion_preserves_order_history(self):
        self.assertEqual(self.order().status_code, 201)
        self.make_admin()
        self.assertEqual(self.client.delete('/admin/products/delete/1', headers=self.headers).status_code, 409)
        with backend.app.app_context():
            self.assertEqual(backend.OrderItem.query.count(), 1)
            self.assertIsNotNone(backend.db.session.get(backend.Product, 1))

    def test_unused_product_deletion_removes_cart_references(self):
        self.client.post('/api/cart', headers=self.headers, json={'product_id': 1, 'quantity': 1})
        self.make_admin()
        self.assertEqual(self.client.delete('/admin/products/delete/1', headers=self.headers).status_code, 200)
        with backend.app.app_context():
            self.assertEqual(backend.CartItem.query.count(), 0)
            self.assertEqual(backend.Product.query.count(), 0)

    def test_inventory_validates_integer_stock(self):
        self.make_admin()
        for body in ([], {}, {'stock': None}, {'stock': True}, {'stock': 1.5}, {'stock': -1}):
            self.assertEqual(self.client.put('/admin/inventory/update/1', headers=self.headers, json=body).status_code, 400)
        self.assertEqual(self.client.put('/admin/inventory/update/1', headers=self.headers, json={'stock': 0}).status_code, 200)

    def test_upload_rejects_non_images_and_oversized_files(self):
        self.make_admin()
        with tempfile.TemporaryDirectory() as directory, patch.dict(backend.app.config, UPLOAD_FOLDER=directory):
            for content in (b'<script>alert(1)</script>', b'<svg onload="alert(1)"/>', b'\x89PNG\r\n\x1a\n'):
                r = self.client.post('/admin/upload', headers=self.headers, data={'file': (BytesIO(content), 'image.png')})
                self.assertEqual(r.status_code, 400, r.json)
            r = self.client.post('/admin/upload', headers=self.headers,
                data={'file': (BytesIO(b'x' * (5 * 1024 * 1024 + 1)), 'large.png')})
            self.assertEqual(r.status_code, 413, r.json)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_upload_uses_content_type_and_unique_names(self):
        self.make_admin()
        source = BytesIO()
        backend.PillowImage.new('RGB', (2, 2), 'red').save(source, format='PNG')
        urls = []
        with tempfile.TemporaryDirectory() as directory, patch.dict(backend.app.config, UPLOAD_FOLDER=directory):
            for _ in range(2):
                r = self.client.post('/admin/upload', headers=self.headers,
                    data={'file': (BytesIO(source.getvalue() + b'<script>bad</script>'), '../../logo.jpg')})
                self.assertEqual(r.status_code, 200, r.json)
                urls.append(r.json['url'])
            self.assertNotEqual(urls[0], urls[1])
            for file in Path(directory).iterdir():
                self.assertEqual(file.suffix, '.png')
                self.assertNotIn(b'<script>', file.read_bytes())
                with backend.PillowImage.open(file) as image:
                    self.assertEqual(image.size, (2, 2))

    def test_upload_requires_admin(self):
        r = self.client.post('/admin/upload', headers=self.headers, data={'file': (BytesIO(b'fake'), 'x.png')})
        self.assertEqual(r.status_code, 403)

    def test_file_email_mode_never_uses_smtp_even_when_configured(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'EMAIL_MODE': 'file', 'EMAIL_FILE_DIR': directory, 'SMTP_HOST': 'smtp.example.com',
            'SMTP_USER': 'sender@example.com', 'SMTP_PASS': 'test-only', 'SMTP_FROM': 'sender@example.com',
        }), patch.object(backend.smtplib, 'SMTP') as smtp, patch.object(backend.smtplib, 'SMTP_SSL') as smtp_ssl:
            sent, error = backend._send_email_if_configured('recipient@example.com', 'Kiểm tra', 'Nội dung tiếng Việt')
            self.assertTrue(sent)
            self.assertIsNone(error)
            smtp.assert_not_called()
            smtp_ssl.assert_not_called()
            files = list(Path(directory).glob('*.eml'))
            self.assertEqual(len(files), 1)
            message = BytesParser(policy=email_policy).parsebytes(files[0].read_bytes())
            self.assertEqual(message['To'], 'recipient@example.com')
            self.assertIn('Nội dung tiếng Việt', message.get_content())

    def test_smtp_transport_uses_tls_and_correct_recipient(self):
        with patch.dict(os.environ, {'EMAIL_MODE': 'smtp', 'SMTP_HOST': 'smtp.example.com',
            'SMTP_USER': 'sender@example.com', 'SMTP_PASS': 'test-only', 'SMTP_FROM': 'sender@example.com',
            'SMTP_ENVELOPE_FROM': 'sender@example.com', 'SMTP_TLS': '1', 'SMTP_SSL': '0', 'SMTP_PORT': '587',
        }), patch.object(backend.smtplib, 'SMTP') as smtp:
            sent, error = backend._send_email_if_configured('recipient@example.com', 'Test', 'Message')
            self.assertTrue(sent)
            self.assertIsNone(error)
            server = smtp.return_value.__enter__.return_value
            server.starttls.assert_called_once()
            server.login.assert_called_once_with('sender@example.com', 'test-only')
            self.assertEqual(server.send_message.call_args.kwargs['to_addrs'], ['recipient@example.com'])

    def test_database_reset_guard_rejects_application_database(self):
        env = dict(os.environ, TECHSTORE_TEST_DATABASE_URI='mysql+pymysql://test:test@127.0.0.1/production',
                   TECHSTORE_ALLOW_DATABASE_RESET='1')
        result = subprocess.run([sys.executable, '-c', 'import test_backend'], cwd=ROOT / 'tests',
                                env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Tests may reset only', result.stderr)

    def test_contact_validates_before_sending(self):
        valid = {'name': 'Test Buyer', 'email': 'buyer@example.com', 'message': 'Please contact me'}
        with patch.object(backend, '_send_email_if_configured') as send:
            for body in ([], {}, dict(valid, name=123), dict(valid, name='Bad\nBcc: other@example.com'),
                         dict(valid, email='bad'), dict(valid, message='x' * 5001)):
                r = self.client.post('/api/public/contact', json=body)
                self.assertEqual(r.status_code, 400, r.json)
            send.assert_not_called()

    def test_contact_delivery_and_error_responses(self):
        payload = {'name': 'Test Buyer', 'email': 'buyer@example.com', 'message': 'First line\nSecond line'}
        with patch.dict(os.environ, CONTACT_TO_EMAIL='support@example.com'), \
                patch.object(backend, '_send_email_if_configured', return_value=(True, None)) as send:
            self.assertEqual(self.client.post('/api/public/contact', json=payload).status_code, 200)
            self.assertEqual(send.call_args.args[0], 'support@example.com')
            self.assertEqual(send.call_args.kwargs['reply_to_override'], 'buyer@example.com')
            send.return_value = (False, 'test_failure')
            self.assertEqual(self.client.post('/api/public/contact', json=payload).status_code, 502)

    def refund_payload(self, code):
        return {'order_code': code, 'name': 'Buyer', 'phone': '0900000000', 'email': 'buyer@example.com',
                'bank_name': 'Test Bank', 'account_number': '123456', 'account_holder': 'Test Buyer'}

    def test_refund_requires_owner_and_successful_online_payment(self):
        code = self.pending_payment()
        payload = self.refund_payload(code)
        self.assertEqual(self.client.post('/api/public/refund-request', json=payload).status_code, 401)
        self.assertEqual(self.client.post('/api/public/refund-request', headers=self.headers, json=payload).status_code, 409)
        self.register('other')
        self.assertEqual(self.client.post('/api/public/refund-request', headers=self.login('other'), json=payload).status_code, 404)

    def test_refund_request_does_not_cancel_or_restock_order(self):
        code = self.pending_payment()
        with backend.app.app_context():
            backend.Payment.query.one().status = 'success'
            backend.db.session.commit()
        payload = dict(self.refund_payload(code), payment_method='forged-provider')
        with patch.dict(os.environ, CONTACT_TO_EMAIL='support@example.com'), \
                patch.object(backend, '_send_email_if_configured', return_value=(True, None)) as send:
            r = self.client.post('/api/public/refund-request', headers=self.headers, json=payload)
            self.assertEqual(r.status_code, 200, r.json)
            self.assertIn('PAYOS', send.call_args.args[1])
            self.assertNotIn('forged-provider', send.call_args.args[2])
        self.assertEqual(self.payment_state(), ('success', 'processing'))
        with backend.app.app_context():
            self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 3)

    def test_refund_rejects_invalid_input_before_email(self):
        with patch.object(backend, '_send_email_if_configured') as send:
            for body in ([], {}, dict(self.refund_payload('ORD'), name=123),
                         dict(self.refund_payload('ORD'), order_code='ORD\nBcc: victim@example.com')):
                self.assertEqual(self.client.post('/api/public/refund-request', headers=self.headers, json=body).status_code, 400)
            send.assert_not_called()

    def test_refund_delivery_failure_keeps_payment_and_order(self):
        code = self.pending_payment()
        with backend.app.app_context():
            backend.Payment.query.one().status = 'success'
            backend.db.session.commit()
        with patch.dict(os.environ, CONTACT_TO_EMAIL='support@example.com'), \
                patch.object(backend, '_send_email_if_configured', return_value=(False, 'test_failure')):
            r = self.client.post('/api/public/refund-request', headers=self.headers, json=self.refund_payload(code))
            self.assertEqual(r.status_code, 502, r.json)
        self.assertEqual(self.payment_state(), ('success', 'processing'))

    def test_paid_online_order_requires_refund_before_cancellation(self):
        code = self.pending_payment()
        with backend.app.app_context():
            backend.Payment.query.one().status = 'success'
            backend.db.session.commit()
        detail = self.client.get('/api/orders/' + code, headers=self.headers)
        self.assertTrue(detail.json['requires_refund'])
        r = self.client.put('/api/orders/' + code + '/cancel', headers=self.headers)
        self.assertEqual(r.status_code, 409, r.json)
        self.assertTrue(r.json['requires_refund'])
        self.assertEqual(self.payment_state(), ('success', 'processing'))
        with backend.app.app_context():
            self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 3)

    def test_unpaid_online_order_can_be_cancelled_without_refund(self):
        code = self.pending_payment()
        self.assertFalse(self.client.get('/api/orders/' + code, headers=self.headers).json['requires_refund'])
        r = self.client.put('/api/orders/' + code + '/cancel', headers=self.headers)
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(self.payment_state(), ('failed', 'cancelled'))

    def request_reset_token(self):
        with patch.dict(os.environ, PUBLIC_BASE_URL='https://shop.example.com'), \
                patch.object(backend, '_send_email_if_configured', return_value=(True, None)) as send:
            response = self.client.post('/api/forgot-password', json={'email': 'buyer@example.com'},
                                        headers={'Host': 'untrusted.example.com'})
            self.assertEqual(response.status_code, 200, response.json)
            body = send.call_args.args[2]
            self.assertIn('https://shop.example.com/pages/reset-password.html?token=', body)
            self.assertNotIn('untrusted.example.com', body)
            return re.search(r'token=([A-Za-z0-9_-]+)', body).group(1)

    def test_reset_request_keeps_password_and_stores_only_token_hash(self):
        token = self.request_reset_token()
        self.login('buyer')
        with backend.app.app_context():
            record = backend.PasswordResetToken.query.one()
            self.assertNotEqual(record.token_hash, token)
            self.assertEqual(record.token_hash, backend.hashlib.sha256(token.encode()).hexdigest())
            self.assertIsNone(record.used_at)

    def test_reset_unknown_email_uses_generic_response(self):
        with patch.object(backend, '_send_email_if_configured', return_value=(True, None)) as send:
            known = self.client.post('/api/forgot-password', json={'email': 'buyer@example.com'})
            send.reset_mock()
            unknown = self.client.post('/api/forgot-password', json={'email': 'unknown@example.com'})
            self.assertEqual(known.json, unknown.json)
            self.assertEqual(unknown.status_code, 200)
            send.assert_not_called()

    def test_reset_token_expires_and_can_only_be_used_once(self):
        token = self.request_reset_token()
        new_password = secrets.token_urlsafe(16)
        with backend.app.app_context():
            backend.PasswordResetToken.query.one().expires_at = backend.datetime.now() - backend.timedelta(seconds=1)
            backend.db.session.commit()
        body = {'token': token, 'new_password': new_password}
        self.assertEqual(self.client.post('/api/reset-password', json=body).status_code, 400)
        with backend.app.app_context():
            backend.PasswordResetToken.query.one().expires_at = backend.datetime.now() + backend.timedelta(minutes=1)
            backend.db.session.commit()
        self.assertEqual(self.client.post('/api/reset-password', json=body).status_code, 200)
        self.assertEqual(self.client.get('/api/cart', headers=self.headers).status_code, 401)
        self.assertEqual(self.client.post('/api/reset-password', json=body).status_code, 400)
        r = self.client.post('/login', json={'username': 'buyer', 'password': self.password, 'required_role': 'user'})
        self.assertEqual(r.status_code, 401)
        self.password = new_password
        self.login('buyer')

    def test_reset_request_has_per_account_cooldown(self):
        self.request_reset_token()
        with patch.object(backend, '_send_email_if_configured') as send:
            r = self.client.post('/api/forgot-password', json={'email': 'buyer@example.com'})
            self.assertEqual(r.status_code, 200)
            send.assert_not_called()
        with backend.app.app_context():
            self.assertEqual(backend.PasswordResetToken.query.count(), 1)

    def test_new_reset_link_replaces_previous_link(self):
        old_token = self.request_reset_token()
        with backend.app.app_context():
            backend.PasswordResetToken.query.one().created_at -= backend.timedelta(seconds=61)
            backend.db.session.commit()
        new_token = self.request_reset_token()
        self.assertNotEqual(old_token, new_token)
        r = self.client.post('/api/reset-password', json={'token': old_token, 'new_password': 'new-test-password'})
        self.assertEqual(r.status_code, 400)

    def test_reset_invalid_input_does_not_consume_token(self):
        token = self.request_reset_token()
        for body in ([], {}, {'token': token, 'new_password': 'short'},
                     {'token': token, 'new_password': 'x' * 73}, {'token': 'invalid', 'new_password': 'valid-password'}):
            self.assertEqual(self.client.post('/api/reset-password', json=body).status_code, 400)
        with backend.app.app_context():
            self.assertIsNone(backend.PasswordResetToken.query.one().used_at)

    def test_locked_account_cannot_reset_password(self):
        token = self.request_reset_token()
        with backend.app.app_context():
            backend.User.query.filter_by(username='buyer').one().is_locked = True
            backend.db.session.commit()
        r = self.client.post('/api/reset-password', json={'token': token, 'new_password': 'new-test-password'})
        self.assertEqual(r.status_code, 400)
        with patch.object(backend, '_send_email_if_configured') as send:
            self.assertEqual(self.client.post('/api/forgot-password', json={'email': 'buyer@example.com'}).status_code, 200)
            send.assert_not_called()

    def test_reset_request_rejects_malformed_input(self):
        for body in ([], {}, {'email': 123}, {'email': 'invalid'}, {'email': 'x' * 121}):
            self.assertEqual(self.client.post('/api/forgot-password', json=body).status_code, 400)

    def test_user_deletion_preserves_order_history(self):
        self.make_admin()
        self.register('other')
        other_headers = self.login('other')
        self.assertEqual(self.order(headers=other_headers).status_code, 201)
        with backend.app.app_context():
            other_id = backend.User.query.filter_by(username='other').one().id
        r = self.client.delete(f'/admin/users/delete/{other_id}', headers=self.headers)
        self.assertEqual(r.status_code, 409, r.json)
        with backend.app.app_context():
            self.assertIsNotNone(backend.db.session.get(backend.User, other_id))
            self.assertEqual(backend.Order.query.count(), 1)

    def test_unused_user_deletion_cleans_cart_reset_and_retry_records(self):
        self.make_admin()
        self.register('other')
        other_headers = self.login('other')
        self.client.post('/api/cart', headers=other_headers, json={'product_id': 1, 'quantity': 1})
        with patch.object(backend, '_send_email_if_configured', return_value=(True, None)):
            self.client.post('/api/forgot-password', json={'email': 'other@example.com'})
        with backend.app.app_context():
            other_id = backend.User.query.filter_by(username='other').one().id
            backend.db.session.add(backend.OrderIdempotency(user_id=other_id, key='test-key', request_hash='test-hash'))
            backend.db.session.commit()
        r = self.client.delete(f'/admin/users/delete/{other_id}', headers=self.headers)
        self.assertEqual(r.status_code, 200, r.json)
        with backend.app.app_context():
            self.assertIsNone(backend.db.session.get(backend.User, other_id))
            self.assertEqual(backend.CartItem.query.count(), 0)
            self.assertEqual(backend.PasswordResetToken.query.count(), 0)
            self.assertEqual(backend.OrderIdempotency.query.count(), 0)

    def test_deleted_order_retains_idempotency_tombstone(self):
        headers = dict(self.headers, **{'Idempotency-Key': 'delete-order-test'})
        r = self.order(headers=headers)
        self.assertEqual(r.status_code, 201, r.json)
        code = r.json['order_code']
        self.assertEqual(self.client.put('/api/orders/' + code + '/cancel', headers=self.headers).status_code, 200)
        self.make_admin()
        r = self.client.delete('/admin/orders/' + code, headers=self.headers)
        self.assertEqual(r.status_code, 200, r.json)
        with backend.app.app_context():
            self.assertIsNone(backend.OrderIdempotency.query.one().order_id)
            self.assertEqual(backend.Order.query.count(), 0)
        replay = self.order(headers=headers)
        self.assertEqual(replay.status_code, 409, replay.json)
        with backend.app.app_context():
            self.assertEqual(backend.Order.query.count(), 0)
            self.assertEqual(backend.db.session.get(backend.Product, 1).stock, 5)

    def test_contact_only_profile_update_keeps_existing_session(self):
        r = self.client.put('/api/profile/update', headers=self.headers, json={'phone': '0900000000'})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json['password_changed'])
        self.assertEqual(self.client.get('/api/cart', headers=self.headers).status_code, 200)


if __name__ == '__main__':
    unittest.main()
