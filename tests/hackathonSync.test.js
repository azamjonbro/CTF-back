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

  it('should dynamically transition hackathon status from open to running when start time is in the past', async () => {
    // Create a hackathon with start time in the past and end time in the future
    const startPast = new Date(Date.now() - 5000); // 5 seconds ago
    const endFuture = new Date(Date.now() + 86400000); // 1 day in future

    const hackathon = new Hackathon({
      name: 'Test Sync - Open to Running',
      description: 'Testing dynamic status transition to running.',
      hackathonStart: startPast,
      hackathonEnd: endFuture,
      maxTeams: 5,
      status: 'open',
      challenges: []
    });
    await hackathon.save();

    // Verify initial database status is 'open'
    const initialDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(initialDb.status, 'open');

    // Make an API request to list hackathons (which runs the sync middleware)
    const res = await request(server)
      .get('/api/v1/hackathons')
      .expect(200);

    // Verify that the response contains the hackathon with status 'running'
    const returnedHackathon = res.body.data.find(h => h._id === hackathon._id.toString());
    assert.ok(returnedHackathon);
    assert.strictEqual(returnedHackathon.status, 'running');

    // Verify database status is now 'running'
    const finalDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(finalDb.status, 'running');
  });

  it('should dynamically transition hackathon status from running to finished when end time is in the past', async () => {
    // Create a hackathon with start and end times both in the past
    const startPast = new Date(Date.now() - 10000); // 10 seconds ago
    const endPast = new Date(Date.now() - 2000); // 2 seconds ago

    const hackathon = new Hackathon({
      name: 'Test Sync - Running to Finished',
      description: 'Testing dynamic status transition to finished.',
      hackathonStart: startPast,
      hackathonEnd: endPast,
      maxTeams: 5,
      status: 'running',
      challenges: []
    });
    await hackathon.save();

    // Verify initial database status is 'running'
    const initialDb = await Hackathon.findById(hackathon._id);
    assert.strictEqual(initialDb.status, 'running');

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
