import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import User from '../src/models/User.js';
import CTF from '../src/models/CTF.js';
import Team from '../src/models/Team.js';
import Hackathon from '../src/models/Hackathon.js';
import ChallengeSession from '../src/models/ChallengeSession.js';
import TeamChallenge from '../src/models/TeamChallenge.js';
import { generateAccessToken } from '../src/utils/token.js';
import bcrypt from 'bcryptjs';

describe('New Features & Manual Finish Integration Tests', () => {
  let adminToken;
  let userToken;
  let testAdmin;
  let testUser;
  let testTeam;
  let testCtf;
  let testHackathon;

  before(async () => {
    // Create admin user
    testAdmin = new User({
      username: 'adminfinishuser',
      email: 'adminfinish@ctf.io',
      passwordHash: 'hashedpassword',
      roles: ['admin']
    });
    await testAdmin.save();
    adminToken = generateAccessToken(testAdmin);

    // Create standard user
    testUser = new User({
      username: 'userfinishuser',
      email: 'userfinish@ctf.io',
      passwordHash: 'hashedpassword',
      roles: ['team_member']
    });
    await testUser.save();
    userToken = generateAccessToken(testUser);

    // Create team
    testTeam = new Team({
      name: 'Finish Test Team',
      leaderId: testUser._id,
      members: [testUser._id]
    });
    await testTeam.save();

    // Create challenge
    const salt = await bcrypt.genSalt(10);
    const flagBcrypt = await bcrypt.hash('FLAG{test_finish_flag}', salt);
    testCtf = new CTF({
      title: 'Finish Test Challenge',
      shortDescription: '', // optional description test
      longDescription: '',
      difficulty: 'easy',
      stars: 2,
      category: 'Web',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 30,
      flags: [{ flag: flagBcrypt, points: 100 }],
      questions: [
        { title: 'Q1', description: '', answer: await bcrypt.hash('ans1', salt), hint: 'Hint Q1' },
        { title: 'Q2', description: '', answer: await bcrypt.hash('ans2', salt), hint: 'Hint Q2' },
        { title: 'Q3', description: '', answer: await bcrypt.hash('ans3', salt), hint: 'Hint Q3' },
        { title: 'Q4', description: '', answer: await bcrypt.hash('ans4', salt), hint: 'Hint Q4' },
        { title: 'Q5', description: '', answer: await bcrypt.hash('ans5', salt), hint: 'Hint Q5' }
      ]
    });
    await testCtf.save();

    // Create hackathon
    testHackathon = new Hackathon({
      name: 'Finish Test Hackathon',
      description: 'Hackathon description',
      hackathonStart: new Date(),
      hackathonEnd: new Date(Date.now() + 3600000),
      maxTeams: 10,
      status: 'active',
      challenges: [testCtf._id]
    });
    await testHackathon.save();

    // Register team to hackathon
    testTeam.hackathonsJoined.push(testHackathon._id);
    await testTeam.save();
  });

  after(async () => {
    if (testUser) await ChallengeSession.deleteMany({ userId: testUser._id });
    if (testTeam) {
      await TeamChallenge.deleteMany({ teamId: testTeam._id });
      await Team.deleteOne({ _id: testTeam._id });
    }
    if (testAdmin) {
      await User.deleteMany({ _id: { $in: [testAdmin._id, testUser ? testUser._id : null].filter(Boolean) } });
    }
    if (testCtf) await CTF.deleteOne({ _id: testCtf._id });
    if (testHackathon) await Hackathon.deleteOne({ _id: testHackathon._id });
  });

  it('should verify optional question and challenge descriptions work', () => {
    assert.strictEqual(testCtf.shortDescription, '');
    assert.strictEqual(testCtf.longDescription, '');
    assert.strictEqual(testCtf.questions[0].description, '');
  });

  it('should manually finish challenge as admin and expire sessions', async () => {
    // Start session
    await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/session`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Call admin manual finish challenge
    await request(server)
      .post('/api/v1/challenge/finish')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ challengeId: testCtf._id })
      .expect(200);

    // Verify challenge status is finished
    const updatedCtf = await CTF.findById(testCtf._id);
    assert.strictEqual(updatedCtf.status, 'finished');
    assert.ok(updatedCtf.endTime);

    // Verify session status is expired
    const session = await TeamChallenge.findOne({ teamId: testTeam._id, challengeId: testCtf._id });
    assert.strictEqual(session.status, 'expired');

    // Attempt to submit flag after finished should fail
    await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/flags/0/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ flag: 'FLAG{test_finish_flag}' })
      .expect(400); // 400 Bad Request because challenge is finished
  });

  it('should test hint/open endpoint correctly calculates penalty and newScore', async () => {
    // Create new challenge to test hint open
    const ctfHint = new CTF({
      title: 'Hint Test Challenge',
      shortDescription: 'desc',
      longDescription: 'desc',
      difficulty: 'easy',
      stars: 1,
      category: 'Crypto',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 30,
      flags: [{ flag: 'flag', points: 100 }],
      questions: [
        { title: 'Q1', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q2', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q3', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q4', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q5', description: 'd', answer: 'a', hint: 'h' }
      ]
    });
    await ctfHint.save();

    await request(server)
      .post(`/api/v1/ctfs/${ctfHint._id}/session`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Post to hint/open
    const res = await request(server)
      .post('/api/v1/hint/open')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ challengeId: ctfHint._id })
      .expect(200);

    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.penalty, 0); // 0 because no questions solved yet
    
    // Clean up
    await CTF.deleteOne({ _id: ctfHint._id });
  });
});
