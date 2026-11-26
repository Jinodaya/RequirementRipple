import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { getDb, resetDbForTests } from '../db/database.ts';
import { createApp } from '../app.ts';

describe('RequirementRipple API Integration & Security Isolation', () => {
  let app: ReturnType<typeof createApp>;
  let ownerToken: string;
  let orgId: string;
  let projectId: string;
  let outsiderToken: string;

  beforeAll(() => {
    const memDb = new DatabaseSync(':memory:');
    // Trigger schema init via getDb on :memory:
    resetDbForTests(memDb);
    const initialized = getDb(':memory:');
    resetDbForTests(initialized);
    app = createApp();
  });

  it('registers user + organization, seeds reference project, and enforces cross-org isolation', async () => {
    const regRes = await request(app).post('/api/auth/register').send({
      name: 'Alice Architect',
      email: 'alice@example.com',
      password: 'StrongPassword123!',
      organizationName: 'Acme Engineering',
    });
    expect(regRes.status).toBe(201);
    expect(regRes.body.accessToken).toBeTruthy();
    ownerToken = regRes.body.accessToken;
    orgId = regRes.body.organizations[0].id;

    // Seed reference FinPay project
    const seedRes = await request(app)
      .post(`/api/orgs/${orgId}/projects/seed-reference`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(seedRes.status).toBe(201);
    projectId = seedRes.body.projectId;

    // Register a second user in a different org and verify 403 cross-org isolation
    const reg2 = await request(app).post('/api/auth/register').send({
      name: 'Bob Outsider',
      email: 'bob@other.com',
      password: 'StrongPassword123!',
      organizationName: 'Other Org',
    });
    outsiderToken = reg2.body.accessToken;

    const forbidden = await request(app)
      .get(`/api/projects/${projectId}/requirements`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('creates requirement with versioning, runs change impact analysis, simulates scenario, and records approval', async () => {
    const reqCreate = await request(app)
      .post(`/api/projects/${projectId}/requirements`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Rate limit checkout API',
        description: 'Checkout API must limit merchant bursts to 100 requests per second per key and return HTTP 429 on excess.',
        category: 'Security',
        priority: 'high',
        acceptanceCriteria: ['Exceeding 100 req/s returns HTTP 429 with Retry-After header.'],
      });
    expect(reqCreate.status).toBe(201);
    const reqId = reqCreate.body.requirement.id;

    // Submit Change Request
    const crRes = await request(app)
      .post(`/api/projects/${projectId}/changes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        requirementId: reqId,
        changeCategory: 'Modification',
        title: 'Tighten rate limit to 40 req/s',
        reason: 'Mitigate credential stuffing traffic',
        proposedTitle: 'Rate limit checkout API to 40 req/s',
        proposedDescription: 'Reduce checkout API limit to 40 requests per second per merchant key and return HTTP 429.',
        proposedAcceptanceCriteria: ['Exceeding 40 req/s returns HTTP 429.'],
        priority: 'high',
      });
    expect(crRes.status).toBe(201);
    expect(typeof crRes.body.impactScore).toBe('number');

    // Run What-If Scenario Simulation
    const graphRes = await request(app)
      .get(`/api/projects/${projectId}/graph`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const firstNodeId = graphRes.body.nodes[0].id;

    const simRes = await request(app)
      .post(`/api/projects/${projectId}/scenarios`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Remove Auth Gateway',
        description: 'Hypothetical removal',
        mutations: [{ type: 'remove_node', nodeId: firstNodeId }],
      });
    expect(simRes.status).toBe(201);
    expect(simRes.body.scenario.affectedNodes).toBeDefined();

    // Approve CR with mandatory reason
    const approveRes = await request(app)
      .post(`/api/projects/${projectId}/changes/${crRes.body.id}/decision`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ decision: 'approved', reason: 'Reviewed impact report and test coverage.' });
    expect(approveRes.status).toBe(200);
  });
});
