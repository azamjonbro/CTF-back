import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import User from '../src/models/User.js';
import Question from '../src/models/Question.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Admin Database Management Integration Tests', () => {
  let superadminToken;
  let regularadminToken;
  let regularuserToken;
  let superadminUser;
  let regularadminUser;
  let regularUser;

  before(async () => {
    // Clear users and questions
    await User.deleteMany({});
    await Question.deleteMany({});

    // Create superadmin user (username: 'superadmin')
    superadminUser = new User({
      username: 'superadmin',
      email: 'superadmin@ctf.com',
      passwordHash: 'SuperAdminSecurePassword2026!',
      roles: ['admin']
    });
    await superadminUser.save();
    superadminToken = generateAccessToken(superadminUser);

    // Create regular admin user
    regularadminUser = new User({
      username: 'regularadmin',
      email: 'regularadmin@ctf.com',
      passwordHash: 'hashedpassword',
      roles: ['admin']
    });
    await regularadminUser.save();
    regularadminToken = generateAccessToken(regularadminUser);

    // Create regular user
    regularUser = new User({
      username: 'regularuser',
      email: 'regularuser@ctf.com',
      passwordHash: 'hashedpassword',
      roles: ['team_member']
    });
    await regularUser.save();
    regularuserToken = generateAccessToken(regularUser);
  });

  after(async () => {
    // Clean up
    await User.deleteMany({});
    await Question.deleteMany({});
  });

  describe('Access Control Restrictions', () => {
    it('should block regular users from retrieving counts', async () => {
      const res = await request(server)
        .get('/api/v1/admin/db/counts')
        .set('Authorization', `Bearer ${regularuserToken}`);
      
      assert.strictEqual(res.status, 403);
    });

    it('should block regular admins (not superadmin) from retrieving counts', async () => {
      const res = await request(server)
        .get('/api/v1/admin/db/counts')
        .set('Authorization', `Bearer ${regularadminToken}`);
      
      assert.strictEqual(res.status, 403);
    });

    it('should block regular users from deleting collections', async () => {
      const res = await request(server)
        .post('/api/v1/admin/db/delete')
        .set('Authorization', `Bearer ${regularuserToken}`)
        .send({ collectionName: 'questions' });
      
      assert.strictEqual(res.status, 403);
    });

    it('should block regular admins from deleting collections', async () => {
      const res = await request(server)
        .post('/api/v1/admin/db/delete')
        .set('Authorization', `Bearer ${regularadminToken}`)
        .send({ collectionName: 'questions' });
      
      assert.strictEqual(res.status, 403);
    });
  });

  describe('Super Admin Operations', () => {
    it('should allow superadmin to fetch collection counts', async () => {
      // Seed some test data
      const q = new Question({
        title: 'Test Question',
        correctAnswer: 'ans',
        points: 20
      });
      await q.save();

      const res = await request(server)
        .get('/api/v1/admin/db/counts')
        .set('Authorization', `Bearer ${superadminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.users, 3); // superadmin, regularadmin, regularuser
      assert.strictEqual(res.body.data.questions, 1);
    });

    it('should reject delete request with invalid collection name', async () => {
      const res = await request(server)
        .post('/api/v1/admin/db/delete')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ collectionName: 'hackathons' });

      assert.strictEqual(res.status, 400);
    });

    it('should allow superadmin to delete all questions permanently', async () => {
      const res = await request(server)
        .post('/api/v1/admin/db/delete')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ collectionName: 'questions' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const count = await Question.countDocuments({});
      assert.strictEqual(count, 0);
    });

    it('should allow superadmin to delete all users and automatically re-seed superadmin', async () => {
      const res = await request(server)
        .post('/api/v1/admin/db/delete')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ collectionName: 'users' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const count = await User.countDocuments({});
      // Only the re-seeded superadmin user should exist
      assert.strictEqual(count, 1);

      const seededAdmin = await User.findOne({ username: 'superadmin' });
      assert.ok(seededAdmin);
      assert.strictEqual(seededAdmin.email, 'superadmin@ctf.com');
      assert.deepStrictEqual(seededAdmin.roles, ['admin']);
    });
  });
});
