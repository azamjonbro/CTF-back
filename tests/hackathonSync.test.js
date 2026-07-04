import assert from 'assert';
import request from 'supertest';
import server from '../src/app.js';
import Hackathon from '../src/models/Hackathon.js';

describe('Hackathon Dynamic Status Synchronization Integration Tests', () => {
  beforeEach(async () => {
    // Clean up any test hackathons before each test
    await Hackathon.deleteMany({ name: { $regex: /^Test Sync/ } });
  });

  after(async () => {
    await Hackathon.deleteMany({ name: { $regex: /^Test Sync/ } });
  });

  it('should dynamically transition hackathon status from upcoming to active when start time is in the past', async () => {
    // Create a hackathon with start time in the past and end time in the future
    const startPast = new Date(Date.now() - 5000); // 5 seconds ago
    const endFuture = new Date(Date.now() + 86400000); // 1 day in future

    const hackathon = new Hackathon({
      name: 'Test Sync - Upcoming to Active',
      description: 'Testing dynamic status transition to active.',
      hackathonStart: startPast,
      hackathonEnd: endFuture,
      maxTeams: 5,
      status: 'upcoming',
      challenges: []
    });
    await hackathon.save();

    // Verify initial database status is 'upcoming'
    const initialDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(initialDb.status, 'upcoming');

    // Make an API request to list hackathons (which runs the sync middleware)
    const res = await request(server)
      .get('/api/v1/hackathons')
      .expect(200);

    // Verify that the response contains the hackathon with status 'active'
    const returnedHackathon = res.body.data.find(h => h._id === hackathon._id.toString());
    assert.ok(returnedHackathon);
    assert.strictEqual(returnedHackathon.status, 'active');

    // Verify database status is now 'active'
    const finalDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(finalDb.status, 'active');
  });

  it('should dynamically transition hackathon status from active to finished when end time is in the past', async () => {
    // Create a hackathon with start and end times both in the past
    const startPast = new Date(Date.now() - 10000); // 10 seconds ago
    const endPast = new Date(Date.now() - 2000); // 2 seconds ago

    const hackathon = new Hackathon({
      name: 'Test Sync - Active to Finished',
      description: 'Testing dynamic status transition to finished.',
      hackathonStart: startPast,
      hackathonEnd: endPast,
      maxTeams: 5,
      status: 'active',
      challenges: []
    });
    await hackathon.save();

    // Verify initial database status is 'active'
    const initialDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(initialDb.status, 'active');

    // Make an API request to list hackathons (which runs the sync middleware)
    const res = await request(server)
      .get('/api/v1/hackathons')
      .expect(200);

    // Verify that the response contains the hackathon with status 'finished'
    const returnedHackathon = res.body.data.find(h => h._id === hackathon._id.toString());
    assert.ok(returnedHackathon);
    assert.strictEqual(returnedHackathon.status, 'finished');

    // Verify database status is now 'finished'
    const finalDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(finalDb.status, 'finished');
  });
});
