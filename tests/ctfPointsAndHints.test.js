import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import User from '../src/models/User.js';
import CTF from '../src/models/CTF.js';
import Team from '../src/models/Team.js';
import ChallengeSession from '../src/models/ChallengeSession.js';
import { generateAccessToken } from '../src/utils/token.js';
import bcrypt from 'bcryptjs';

describe('CTF Points, Penalties, and Task Count Integration Tests', () => {
  let userToken;
  let testUser;
  let testTeam;
  let testCtf;
  let flagBcrypt;
  let answerBcrypt;

  before(async () => {
    // Generate bcrypt hashes
    const salt = await bcrypt.genSalt(10);
    flagBcrypt = await bcrypt.hash('FLAG{correct_flag}', salt);
    answerBcrypt = await bcrypt.hash('correct_answer', salt);

    // Create user
    testUser = new User({
      username: 'pointstestuser',
      email: 'pointstest@ctf.io',
      passwordHash: 'hashedpassword',
      name: 'Points',
      surname: 'Test',
      roles: ['team_member']
    });
    await testUser.save();
    userToken = generateAccessToken(testUser);

    // Create team (required by requireTeam middleware)
    testTeam = new Team({
      name: 'Points Test Team',
      leaderId: testUser._id,
      members: [testUser._id]
    });
    await testTeam.save();

    // Create a CTF challenge
    // We create questions. Some points default to 10 (omitted points), some explicitly 10.
    testCtf = new CTF({
      title: 'Points Test Challenge',
      shortDescription: 'Testing default points and penalties.',
      longDescription: 'Detailed description.',
      difficulty: 'easy',
      stars: 3,
      category: 'Crypto',
      author: testUser._id,
      status: 'active',
      timerMinutes: 30,
      image: '',
      attachments: [],
      hint: 'Challenge-level hint context.',
      flags: [{ flag: flagBcrypt, points: 100 }],
      questions: [
        { title: 'Q1', description: 'Desc 1', answer: answerBcrypt, hint: 'Hint Q1' },
        { title: 'Q2', description: 'Desc 2', answer: answerBcrypt, hint: 'Hint Q2' },
        { title: 'Q3', description: 'Desc 3', answer: answerBcrypt, hint: 'Hint Q3' },
        { title: 'Q4', description: 'Desc 4', answer: answerBcrypt, hint: 'Hint Q4' },
        { title: 'Q5', description: 'Desc 5', answer: answerBcrypt, hint: 'Hint Q5' }
      ]
    });
    await testCtf.save();
  });

  after(async () => {
    await ChallengeSession.deleteMany({ userId: testUser._id });
    await Team.deleteOne({ _id: testTeam._id });
    await User.deleteOne({ _id: testUser._id });
    await CTF.deleteOne({ _id: testCtf._id });
  });

  it('should test correct defaults and hint unlock functionality', async () => {
    // 1. Question points should default to 10, CTF points should default to 100
    assert.strictEqual(testCtf.points, 100);
    assert.strictEqual(testCtf.questions[0].points, 10);

    // 2. Start challenge session
    const sessionRes = await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/session`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Verify session loaded correctly
    assert.strictEqual(sessionRes.body.data.hasActiveSession, true);
    // Verify hints are hidden initially
    const question = sessionRes.body.data.questions[0];
    assert.strictEqual(question.hintUnlocked, false);
    assert.strictEqual(question.hint, '');

    // 3. Unlock a question hint
    const unlockRes = await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/questions/${question.id}/hint/unlock`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    assert.strictEqual(unlockRes.body.data.hint, 'Hint Q1');

    // 4. Solve the unlocked question (should award 8 points: 10 * 0.8)
    const solveQ1Res = await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/questions/${question.id}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ answer: 'correct_answer' })
      .expect(200);

    assert.strictEqual(solveQ1Res.body.data.pointsAwarded, 8);

    // 5. Solve another question without hint (should award 10 points)
    const question2 = sessionRes.body.data.questions[1];
    const solveQ2Res = await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/questions/${question2.id}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ answer: 'correct_answer' })
      .expect(200);

    assert.strictEqual(solveQ2Res.body.data.pointsAwarded, 10);

    // Check user total solved before completing challenge
    const userMid = await User.findById(testUser._id);
    assert.strictEqual(userMid.totalSolved, 2);

    // 6. Unlock the challenge-level hint
    await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/hint/unlock`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // 7. Complete the challenge (solve flag)
    const flagRes = await request(server)
      .post(`/api/v1/ctfs/${testCtf._id}/flags/0/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ flag: 'FLAG{correct_flag}' })
      .expect(200);

    assert.strictEqual(flagRes.body.data.fullyCompleted, true);

    // Check user stats after completion:
    // - totalSolved should be exactly 3 (2 questions + 1 flag)
    // - points should include Q1 (6) + Q2 (8) + Flag (50) = 64 points
    const userFinal = await User.findById(testUser._id);
    assert.strictEqual(userFinal.totalSolved, 3);
    assert.strictEqual(userFinal.points, 64);
  });
});
