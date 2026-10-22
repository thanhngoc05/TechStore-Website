"""API regression tests with an isolated in-memory database and no external calls."""
import os
from pathlib import Path
import secrets
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
os.environ['JWT_SECRET_KEY'] = secrets.token_urlsafe(48)
os.environ['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
os.environ['USE_SQLITE'] = '1'
for key in ('ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'PAYOS_CLIENT_ID',
            'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'):
    os.environ[key] = ''
sys.path.insert(0, str(ROOT / 'backend'))
import app as backend
from payos import PayOS
from payos.types.webhooks import WebhookData


class BackendTests(unittest.TestCase):
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
        self.pending_payment()
        verified = SimpleNamespace(order_code=123456, amount=1, amount_paid=1, status='PAID')
        sdk = SimpleNamespace(payment_requests=SimpleNamespace(get=lambda ref: verified))
        with patch.object(backend, 'payos_client', sdk):
            r = self.client.post('/api/payment/confirm', headers=self.headers, json={'payment_ref': '123456'})
            self.assertEqual(r.status_code, 409)
            self.assertEqual(self.payment_state()[0], 'pending')
            verified.amount = verified.amount_paid = 200000
            r = self.client.post('/api/payment/confirm', headers=self.headers, json={'payment_ref': '123456'})
            self.assertEqual(r.status_code, 200, r.json)
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

    def test_password_unchanged_when_email_fails(self):
        with patch.object(backend, '_send_email_if_configured', return_value=(False, 'test_failure')):
            r = self.client.post('/api/forgot-password', json={'email': 'buyer@example.com'})
        self.assertEqual(r.status_code, 502)
        self.login('buyer')

    def test_missing_secret_blocks_startup(self):
        env = dict(os.environ, JWT_SECRET_KEY='')
        r = subprocess.run([sys.executable, '-c', 'import app'], cwd=ROOT / 'backend', env=env,
                           capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('JWT_SECRET_KEY', r.stderr)


if __name__ == '__main__':
    unittest.main()
