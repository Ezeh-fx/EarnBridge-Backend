import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';

describe('GET /', () => {
  it('returns the welcome message in the data envelope', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ message: 'Welcome to EarnBridge 🎉🎉' });
  });

  it('rejects unsupported methods before reaching the handler', async () => {
    const res = await request(app).post('/');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
