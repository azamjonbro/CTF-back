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
import { LeaderboardService } from '../src/services/leaderboardService.js';
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

  it('should test admin reset progress info and reset functionality', async () => {
    // Create a new challenge to reset
    const ctfReset = new CTF({
      title: 'Reset Target Challenge ' + Date.now(),
      shortDescription: 'desc',
      longDescription: 'desc',
      difficulty: 'easy',
      stars: 1,
      category: 'Crypto',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 30,
      flags: [{ flag: 'FLAG{reset}', points: 100 }],
      questions: [
        { title: 'Q1', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q2', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q3', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q4', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q5', description: 'd', answer: 'a', hint: 'h' }
      ]
    });
    await ctfReset.save();

    // Start user session
    await request(server)
      .post(`/api/v1/ctfs/${ctfReset._id}/session`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Verify reset info returns active session count = 1
    const infoRes = await request(server)
      .get(`/api/v1/admin/reset/info?type=challenge&targetId=${ctfReset._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.strictEqual(infoRes.body.success, true);
    assert.strictEqual(infoRes.body.data.details.activeSessions, 1);

    // Call performReset
    const resetRes = await request(server)
      .post('/api/v1/admin/reset')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'challenge', targetId: ctfReset._id })
      .expect(200);

    assert.strictEqual(resetRes.body.success, true);

    // Verify session was deleted
    const sessionCount = await ChallengeSession.countDocuments({ challengeId: ctfReset._id });
    assert.strictEqual(sessionCount, 0);

    // Clean up
    await CTF.deleteOne({ _id: ctfReset._id });
  });

  it('should restrict challenge details and submit/hints APIs before starting the CTF', async () => {
    // Create new challenge to test pre-start restrictions
    const ctfRestrict = new CTF({
      title: 'Restricted Challenge ' + Date.now(),
      shortDescription: 'short description text',
      longDescription: 'long instructions rules',
      difficulty: 'medium',
      stars: 3,
      category: 'Web',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 45,
      flags: [{ flag: 'FLAG{test}', points: 100 }],
      questions: [
        { title: 'Q1', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q2', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q3', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q4', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q5', description: 'd', answer: 'a', hint: 'h' }
      ]
    });
    await ctfRestrict.save();

    // 1. Get challenge details before starting
    const detailsRes = await request(server)
      .get(`/api/v1/ctfs/${ctfRestrict._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    assert.strictEqual(detailsRes.body.success, true);
    assert.strictEqual(detailsRes.body.data.hasActiveSession, false);
    
    // Check that permitted metadata is present
    const cObj = detailsRes.body.data.challenge;
    assert.ok(cObj);
    assert.strictEqual(cObj.title, ctfRestrict.title);
    assert.strictEqual(cObj.shortDescription, ctfRestrict.shortDescription);
    assert.strictEqual(cObj.longDescription, ctfRestrict.longDescription);
    assert.strictEqual(cObj.timerMinutes, ctfRestrict.timerMinutes);
    assert.strictEqual(cObj.participantCount, 0);
    assert.ok(cObj.startTime);

    // Check that restricted challenge data is completely missing/undefined
    assert.strictEqual(cObj.difficulty, undefined);
    assert.strictEqual(cObj.stars, undefined);
    assert.strictEqual(cObj.category, undefined);
    assert.strictEqual(cObj.questionsCount, undefined);
    assert.strictEqual(cObj.flagsCount, undefined);
    assert.strictEqual(cObj.flags, undefined);
    assert.strictEqual(cObj.questions, undefined);
    assert.strictEqual(cObj.attachments, undefined);

    // 2. Try to submit answer before starting (should fail with 403)
    const submitAnsRes = await request(server)
      .post(`/api/v1/ctfs/${ctfRestrict._id}/questions/60f72365a12f345678901234/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ answer: 'test' })
      .expect(403);

    assert.strictEqual(submitAnsRes.body.success, false);
    assert.strictEqual(submitAnsRes.body.message, "You must start the CTF before accessing challenges.");

    // 3. Try to submit flag before starting (should fail with 403)
    const submitFlagRes = await request(server)
      .post(`/api/v1/ctfs/${ctfRestrict._id}/flags/0/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ flag: 'test' })
      .expect(403);

    assert.strictEqual(submitFlagRes.body.success, false);
    assert.strictEqual(submitFlagRes.body.message, "You must start the CTF before accessing challenges.");

    // 4. Try to unlock question hint before starting (should fail with 403)
    const unlockHintRes = await request(server)
      .post(`/api/v1/ctfs/${ctfRestrict._id}/questions/60f72365a12f345678901234/hints/unlock`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    assert.strictEqual(unlockHintRes.body.success, false);
    assert.strictEqual(unlockHintRes.body.message, "You must start the CTF before accessing challenges.");

    // 5. Clean up
    await CTF.deleteOne({ _id: ctfRestrict._id });
  });

  it('should allow individual users without a team to play practice mode challenges, but block them for hackathon mode', async () => {
    // Create new user NOT in any team
    const standaloneUser = new User({
      username: 'standaloneuser_' + Date.now(),
      email: 'standalone_' + Date.now() + '@ctf.io',
      passwordHash: 'hashedpassword',
      roles: ['team_member']
    });
    await standaloneUser.save();
    const standaloneToken = generateAccessToken(standaloneUser);

    // Create a practice mode challenge (not associated with any active/upcoming hackathon)
    const practiceCtf = new CTF({
      title: 'Practice Challenge ' + Date.now(),
      shortDescription: 'desc',
      longDescription: 'desc',
      difficulty: 'easy',
      stars: 1,
      category: 'Web',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 30,
      flags: [{ flag: 'FLAG{practice}', points: 100 }],
      questions: [
        { title: 'Q1', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q2', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q3', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q4', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q5', description: 'd', answer: 'a', hint: 'h' }
      ]
    });
    await practiceCtf.save();

    // 1. Standalone user starts the session successfully in practice mode
    await request(server)
      .post(`/api/v1/ctfs/${practiceCtf._id}/session`)
      .set('Authorization', `Bearer ${standaloneToken}`)
      .expect(200);

    // 2. Standalone user gets challenge details successfully
    const detailsRes = await request(server)
      .get(`/api/v1/ctfs/${practiceCtf._id}`)
      .set('Authorization', `Bearer ${standaloneToken}`)
      .expect(200);
    assert.strictEqual(detailsRes.body.success, true);
    assert.strictEqual(detailsRes.body.data.hasActiveSession, true);

    // Create a hackathon challenge (bound to an active hackathon)
    const hackathonCtf = new CTF({
      title: 'Hackathon Challenge ' + Date.now(),
      shortDescription: 'desc',
      longDescription: 'desc',
      difficulty: 'medium',
      stars: 3,
      category: 'Pwn',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 60,
      flags: [{ flag: 'FLAG{hackathon}', points: 100 }],
      questions: [
        { title: 'Q1', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q2', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q3', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q4', description: 'd', answer: 'a', hint: 'h' },
        { title: 'Q5', description: 'd', answer: 'a', hint: 'h' }
      ]
    });
    await hackathonCtf.save();

    const hackathon = new Hackathon({
      name: 'Active Test Hackathon ' + Date.now(),
      description: 'desc',
      hackathonStart: new Date(Date.now() - 3600000), // started 1h ago
      hackathonEnd: new Date(Date.now() + 3600000), // ends in 1h
      maxTeams: 10,
      status: 'active',
      challenges: [hackathonCtf._id]
    });
    await hackathon.save();

    // 3. Attempting to start session for hackathon challenge without team should fail
    const startHackathonRes = await request(server)
      .post(`/api/v1/ctfs/${hackathonCtf._id}/session`)
      .set('Authorization', `Bearer ${standaloneToken}`)
      .expect(403); // Forbidden because user is not in a team

    assert.strictEqual(startHackathonRes.body.success, false);

    // Clean up
    await User.deleteOne({ _id: standaloneUser._id });
    await CTF.deleteOne({ _id: practiceCtf._id });
    await CTF.deleteOne({ _id: hackathonCtf._id });
    await Hackathon.deleteOne({ _id: hackathon._id });
  });

  it('should verify optional questions, multiple choice, and deduplicated scoring logic', async () => {
    // 1. Verify CTF with 0 questions is allowed
    const ctfEmpty = new CTF({
      title: 'Empty Questions Challenge ' + Date.now(),
      difficulty: 'easy',
      stars: 1,
      category: 'Misc',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 10,
      flags: [{ flag: 'FLAG{empty}', points: 100 }],
      questions: []
    });
    await ctfEmpty.save();
    assert.strictEqual(ctfEmpty.questions.length, 0);

    // 2. Verify CTF with multiple-choice questions works
    const salt = await bcrypt.genSalt(10);
    const ctfMc = new CTF({
      title: 'MC Challenge ' + Date.now(),
      difficulty: 'easy',
      stars: 1,
      category: 'Misc',
      author: testAdmin._id,
      status: 'active',
      timerMinutes: 10,
      flags: [{ flag: 'FLAG{mc}', points: 100 }],
      questions: [
        {
          title: 'MC Q1',
          description: 'Pick choice',
          type: 'multiple-choice',
          options: ['Option A', 'Option B', 'Option C'],
          correctAnswer: await bcrypt.hash('Option B', salt),
          points: 15
        }
      ]
    });
    await ctfMc.save();

    // 3. Start practice session and verify type/options are returned
    await request(server)
      .post(`/api/v1/ctfs/${ctfMc._id}/session`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const details = await request(server)
      .get(`/api/v1/ctfs/${ctfMc._id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const qProj = details.body.data.questions[0];
    assert.strictEqual(qProj.type, 'multiple-choice');
    assert.deepStrictEqual(qProj.options, ['Option A', 'Option B', 'Option C']);
    assert.strictEqual(qProj.points, 15);

    // 4. Solve question in practice session
    const solveMcRes = await request(server)
      .post(`/api/v1/ctfs/${ctfMc._id}/questions/${qProj.id}/submit`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ answer: 'Option B' })
      .expect(200);
    assert.strictEqual(solveMcRes.body.data.pointsAwarded, 15);

    // 5. Verify user profile displays score = 15
    const profileRes = await request(server)
      .get('/api/v1/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    assert.strictEqual(profileRes.body.data.points, 15);

    // 6. Simulate duplicate solve: Create a team session for same challenge and solve Q1 again
    const teamSession = new TeamChallenge({
      teamId: testTeam._id,
      challengeId: ctfMc._id,
      expiresAt: new Date(Date.now() + 600000),
      solvedQuestions: [
        {
          questionId: qProj.id,
          pointsAwarded: 15,
          solvedAt: new Date()
        }
      ]
    });
    await teamSession.save();

    // Recalculate rankings
    await LeaderboardService.recalculateUserRankings();

    // 7. Verify user profile score is still 15 (deduplicated) rather than 30!
    const profileDeduplicatedRes = await request(server)
      .get('/api/v1/users/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    assert.strictEqual(profileDeduplicatedRes.body.data.points, 15);

    // Clean up
    await CTF.deleteOne({ _id: ctfEmpty._id });
    await CTF.deleteOne({ _id: ctfMc._id });
    await TeamChallenge.deleteOne({ _id: teamSession._id });
  });
});
