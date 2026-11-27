import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestHarness, startTestApp } from '../test-app.fixture';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function text(path: string): Promise<string> {
  const response = await fetch(`${harness.url}${path}`);

  expect(response.status).toBe(200);

  return response.text();
}

describe('health', () => {
  it('reports the database it can reach', async () => {
    const response = await fetch(`${harness.url}/health`);
    const body = (await response.json()) as {
      status: string;
      info: Record<string, { status: string }>;
      error: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info['database']?.status).toBe('up');
    expect(body.error).toEqual({});
  });

  it('sits outside the api prefix', async () => {
    const prefixed = await fetch(`${harness.url}/api/health`);

    expect(prefixed.status).toBe(404);
  });
});

describe('metrics', () => {
  it('exposes request timings, labelled with the app name', async () => {
    await fetch(`${harness.url}/api/me`);

    const body = await text('/metrics');

    expect(body).toContain('http_request_duration_seconds');
    expect(body).toContain('app="bingyx-api"');
  });

  it('leaves its own endpoint and health uncounted', async () => {
    await text('/health');
    await text('/metrics');

    const body = await text('/metrics');
    const counted = body
      .split('\n')
      .filter((line) => line.startsWith('http_request_duration_seconds_count'));

    expect(counted.some((line) => line.includes('route="/health"'))).toBe(false);
    expect(counted.some((line) => line.includes('route="/metrics"'))).toBe(false);
  });
});
