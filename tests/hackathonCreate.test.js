import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import User from '../src/models/User.js';
import Hackathon from '../src/models/Hackathon.js';
import { generateAccessToken } from '../src/utils/token.js';

describe('Hackathon Creation Test', () => {
  let adminToken;

  before(async () => {
    // Find or create an admin user
    let admin = await User.findOne({ roles: 'admin' });
    if (!admin) {
      admin = new User({
        username: 'admin_test',
        email: 'admin_test@ctf.io',
        passwordHash: 'hashed_pw_here',
        name: 'Admin',
        surname: 'Test',
        roles: ['admin', 'team_member']
      });
      await admin.save();
    }
    adminToken = generateAccessToken(admin);

    // Delete existing hackathon with test name
    await Hackathon.deleteMany({ name: 'Test Hackathon Creation Bug' });
  });

  it('should attempt to create a hackathon and log errors', async () => {
    const res = await request(server)
      .post('/api/v1/admin/hackathons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Hackathon Creation Bug',
        description: 'Testing the creation flow.',
        hackathonStart: new Date(Date.now() + 10000).toISOString(),
        hackathonEnd: new Date(Date.now() + 86400000).toISOString(),
        maxTeams: 10,
        coverImage: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=800',
        banner: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=800',
        challenges: []
      });

    console.log('STATUS:', res.status);
    console.log('BODY:', JSON.stringify(res.body, null, 2));
    
    assert.strictEqual(res.status, 201);
  });
});
