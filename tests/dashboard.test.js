import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import User from '../src/models/User.js';

describe('Dashboard Statistics Integration Tests', () => {
  let accessToken;

  before(async () => {
    // Clear test records and register/login user
    await User.deleteMany({ email: 'test_dashboard@ctf.io' });

    await request(server)
      .post('/api/v1/auth/register')
      .send({
        username: 'testdashoperator',
        email: 'test_dashboard@ctf.io',
        password: 'secure_password_1337',
        name: 'Dashboard',
        surname: 'Operator',
        age: 25,
        country: 'WW'
      });

    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({
        usernameOrEmail: 'test_dashboard@ctf.io',
        password: 'secure_password_1337',
        deviceName: 'Mocha Dashboard Test Node'
      });

    accessToken = loginRes.body.data.accessToken;
  });

  describe('GET /api/v1/users/dashboard-stats', () => {
    it('should return successfully with authenticated session', async () => {
      const res = await request(server)
        .get('/api/v1/users/dashboard-stats')
        .set('Authorization', `Bearer ${accessToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.strictEqual(res.body.data.username, 'testdashoperator');
      assert.strictEqual(res.body.data.points, 0);
      assert.strictEqual(res.body.data.stars, 0);
      assert.strictEqual(res.body.data.solves, 0);
      assert.strictEqual(typeof res.body.data.ranking, 'number');
      assert.strictEqual(res.body.data.teamName, 'No Team');
      assert.ok(res.body.data.skillsProfile);
      assert.strictEqual(res.body.data.skillsProfile['Web Exploitation'], 0);
    });

    it('should fail request when token is missing', async () => {
      const res = await request(server)
        .get('/api/v1/users/dashboard-stats');

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('GET /api/v1/users/profile/:username', () => {
    it('should return profile with ctfHistory and hackathonHistory', async () => {
      const res = await request(server)
        .get('/api/v1/users/profile/testdashoperator');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.ctfHistory);
      assert.ok(res.body.data.hackathonHistory);
      assert.ok(Array.isArray(res.body.data.ctfHistory));
      assert.ok(Array.isArray(res.body.data.hackathonHistory));
    });
  });

  describe('GET /api/v1/users/activity-calendar', () => {
    it('should return activity calendar for authenticated user without username', async () => {
      const res = await request(server)
        .get('/api/v1/users/activity-calendar')
        .set('Authorization', `Bearer ${accessToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    });

    it('should return activity calendar for public view with username query', async () => {
      const res = await request(server)
        .get('/api/v1/users/activity-calendar?username=testdashoperator');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    });

    it('should fail if no token and no username is specified', async () => {
      const res = await request(server)
        .get('/api/v1/users/activity-calendar');

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('Input Validation & Payload Security Tests', () => {
    it('should reject answer submission with invalid payload structure (e.g. missing or overly long answer)', async () => {
      const res = await request(server)
        .post('/api/v1/ctfs/60f72365a12f34567890abcd/questions/60f72365a12f345678901234/submit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ wrongField: 'hello' }); // Missing answer field

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.message.includes('validation'));
    });

    it('should reject admin roles update if body has invalid inputs or parameter injection attempt', async () => {
      const res = await request(server)
        .post('/api/v1/admin/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          targetUserId: '60f72365a12f34567890abcd',
          action: 'inject', // Invalid action
          role: 'hacker_role' // Invalid role
        });

      // Admin routes require admin role, but even if checked first or validation checks, it should either be blocked by authentication/authorization (401/403) or validation (400)
      assert.ok([400, 401, 403].includes(res.status));
    });
  });
});
