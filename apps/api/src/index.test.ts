import { afterAll, describe, expect, it } from 'vitest';
import { app } from './index.js';

describe('api health', () => {
  it('returns service status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      ok: boolean;
      service: string;
      krxSymbolCount: number;
    };

    expect(body.ok).toBe(true);
    expect(body.service).toBe('tradingservice-api');
    expect(typeof body.krxSymbolCount).toBe('number');
  });
});

afterAll(async () => {
  await app.close();
});
