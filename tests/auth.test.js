import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import User from '../src/models/User.js';

describe('Authentication & Security Integration Tests', () => {
  before(async () => {
    // Clear test database records
    await User.deleteMany({ email: 'test_operator@ctf.io' });
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully with standard values', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({
          username: 'testoperator',
          email: 'test_operator@ctf.io',
          password: 'secure_password_1337',
          name: 'Test',
          surname: 'Operator',
          age: 25,
          country: 'WW'
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
    });

    it('should fail registration when email format is invalid', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({
          username: 'testoperator2',
          email: 'invalid_email_format',
          password: 'secure_password_1337'
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.id, 'SYSTEM_001'); // Validation failure Joi
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should authenticate user and return access and refresh tokens', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({
          usernameOrEmail: 'test_operator@ctf.io',
          password: 'secure_password_1337',
          deviceName: 'Mocha Integration Test Pod'
        });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.accessToken);
      assert.ok(res.body.data.refreshToken);
      assert.strictEqual(res.body.data.user.username, 'testoperator');
    });

    it('should reject authentication attempts with invalid password', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({
          usernameOrEmail: 'test_operator@ctf.io',
          password: 'incorrect_password_123'
        });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error.id, 'AUTH_001');
    });
  });
});
