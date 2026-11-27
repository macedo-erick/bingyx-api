import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { GameResponse, GameSummaryResponse, PrizeResponse } from './dto';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function createGame(owner: string, body: object = { name: 'Ceia de Natal' }) {
  const created = await call<GameResponse>(harness, owner, 'POST', '/api/games', body);

  expect(created.status).toBe(201);

  return created.body;
}

function prizes(overrides: Partial<Record<PrizeResponse['type'], Partial<PrizeResponse>>> = {}) {
  return (['line', 'column', 'diagonal', 'full'] as const).map((type) => ({
    type,
    enabled: true,
    quantity: 1,
    description: null,
    ...overrides[type],
  }));
}

async function setStatus(gameId: string, status: string): Promise<void> {
  await harness.db.execute(sql`UPDATE game SET status = ${status} WHERE id = ${gameId}`);
}

describe('creating a game', () => {
  it('starts as a draft with a short code and the default prizes', async () => {
    const game = await createGame(harness.newOwner(), {
      name: '  Ceia da Família  ',
      scheduledAt: '2026-12-24T21:00:00-03:00',
    });

    expect(game.name).toBe('Ceia da Família');
    expect(game.status).toBe('draft');
    expect(game.registrationOpen).toBe(false);
    expect(game.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(new Date(game.scheduledAt ?? '').toISOString()).toBe('2026-12-25T00:00:00.000Z');
    expect(game.freeCenter).toBe(true);
    expect(game.claimWindowSeconds).toBe(10);
    expect(game.prizes).toEqual([
      { type: 'line', enabled: true, quantity: 1, description: null },
      { type: 'column', enabled: true, quantity: 1, description: null },
      { type: 'diagonal', enabled: false, quantity: 1, description: null },
      { type: 'full', enabled: true, quantity: 1, description: null },
    ]);
    expect(game.prizeCount).toBe(3);
    expect(game.participantCount).toBe(0);
  });

  it('gives every game its own code', async () => {
    const owner = harness.newOwner();
    const codes = new Set<string>();

    for (let i = 0; i < 10; i++) {
      codes.add((await createGame(owner)).code);
    }

    expect(codes.size).toBe(10);
  });

  it('refuses a game without a name, or with settings out of range', async () => {
    const owner = harness.newOwner();

    expect((await call(harness, owner, 'POST', '/api/games', { name: '  ' })).status).toBe(400);
    expect(
      (await call(harness, owner, 'POST', '/api/games', { name: 'X', claimWindowSeconds: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await call(harness, owner, 'POST', '/api/games', { name: 'X', scheduledAt: 'amanhã' }))
        .status,
    ).toBe(400);
  });
});

describe('listing games', () => {
  it('shows only the caller’s games, newest first', async () => {
    const owner = harness.newOwner();

    await createGame(owner, { name: 'Primeiro' });
    await createGame(owner, { name: 'Segundo' });
    await createGame(harness.newOwner(), { name: 'De outra pessoa' });

    const listed = await call<GameSummaryResponse[]>(harness, owner, 'GET', '/api/games');

    expect(listed.status).toBe(200);
    expect(listed.body.map((game) => game.name)).toEqual(['Segundo', 'Primeiro']);
  });

  it('answers 404 for someone else’s game rather than admitting it exists', async () => {
    const game = await createGame(harness.newOwner());

    const peeked = await call(harness, harness.newOwner(), 'GET', `/api/games/${game.id}`);

    expect(peeked.status).toBe(404);
  });
});

describe('editing a game', () => {
  it('changes only the fields it is given', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    const updated = await call<GameResponse>(harness, owner, 'PATCH', `/api/games/${game.id}`, {
      name: 'Réveillon',
      freeCenter: false,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Réveillon');
    expect(updated.body.freeCenter).toBe(false);
    expect(updated.body.claimWindowSeconds).toBe(10);
  });

  it('clears the date when it is sent as null', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner, { name: 'X', scheduledAt: '2026-12-31T22:00:00Z' });

    const updated = await call<GameResponse>(harness, owner, 'PATCH', `/api/games/${game.id}`, {
      scheduledAt: null,
    });

    expect(updated.body.scheduledAt).toBeNull();
  });

  it('refuses once the draw has begun', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    await setStatus(game.id, 'running');

    const refused = await call(harness, owner, 'PATCH', `/api/games/${game.id}`, { name: 'Y' });

    expect(refused.status).toBe(409);
  });
});

describe('configuring prizes', () => {
  it('saves which prizes are on, how many of each and what they are', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    const configured = await call<GameResponse>(
      harness,
      owner,
      'PUT',
      `/api/games/${game.id}/prizes`,
      {
        prizes: prizes({
          line: { quantity: 2, description: 'Panetone' },
          column: { quantity: 3, description: '  ' },
          diagonal: { enabled: false },
          full: { description: 'Vale-presente R$ 100' },
        }),
      },
    );

    expect(configured.status).toBe(200);
    expect(configured.body.prizes).toEqual([
      { type: 'line', enabled: true, quantity: 2, description: 'Panetone' },
      { type: 'column', enabled: true, quantity: 3, description: null },
      { type: 'diagonal', enabled: false, quantity: 1, description: null },
      { type: 'full', enabled: true, quantity: 1, description: 'Vale-presente R$ 100' },
    ]);
    expect(configured.body.prizeCount).toBe(6);
  });

  it('keeps the order the organiser gave', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    const configured = await call<GameResponse>(
      harness,
      owner,
      'PUT',
      `/api/games/${game.id}/prizes`,
      { prizes: prizes().reverse() },
    );

    expect(configured.body.prizes.map((prize) => prize.type)).toEqual([
      'full',
      'diagonal',
      'column',
      'line',
    ]);
  });

  it('refuses a set with every prize off, a type missing or repeated, or a bad quantity', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);
    const put = (body: unknown) =>
      call(harness, owner, 'PUT', `/api/games/${game.id}/prizes`, body);

    const allOff = prizes({
      line: { enabled: false },
      column: { enabled: false },
      diagonal: { enabled: false },
      full: { enabled: false },
    });
    const repeated = [...prizes().slice(0, 3), { ...prizes()[0] }];

    expect((await put({ prizes: allOff })).status).toBe(400);
    expect((await put({ prizes: prizes().slice(0, 3) })).status).toBe(400);
    expect((await put({ prizes: repeated })).status).toBe(400);
    expect((await put({ prizes: prizes({ line: { quantity: 0 } }) })).status).toBe(400);
    expect((await put({ prizes: prizes({ line: { quantity: 21 } }) })).status).toBe(400);
  });

  it('refuses once the draw has begun', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    await setStatus(game.id, 'checking');

    const refused = await call(harness, owner, 'PUT', `/api/games/${game.id}/prizes`, {
      prizes: prizes(),
    });

    expect(refused.status).toBe(409);
  });
});

describe('opening registration', () => {
  it('moves a draft to open and lets players in', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    const opened = await call<GameResponse>(harness, owner, 'POST', `/api/games/${game.id}/open`);

    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('open');
    expect(opened.body.registrationOpen).toBe(true);
  });

  it('cannot open the same game twice', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    await call(harness, owner, 'POST', `/api/games/${game.id}/open`);
    const again = await call(harness, owner, 'POST', `/api/games/${game.id}/open`);

    expect(again.status).toBe(409);
  });

  it('still allows the prizes to be adjusted while players are joining', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    await call(harness, owner, 'POST', `/api/games/${game.id}/open`);
    const adjusted = await call(harness, owner, 'PUT', `/api/games/${game.id}/prizes`, {
      prizes: prizes({ line: { quantity: 2 } }),
    });

    expect(adjusted.status).toBe(200);
  });
});

describe('deleting a game', () => {
  it('removes it and its prizes', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    const deleted = await call(harness, owner, 'DELETE', `/api/games/${game.id}`);
    const after = await call(harness, owner, 'GET', `/api/games/${game.id}`);

    expect(deleted.status).toBe(204);
    expect(after.status).toBe(404);
  });

  it('is refused while the draw is in progress', async () => {
    const owner = harness.newOwner();
    const game = await createGame(owner);

    await setStatus(game.id, 'running');

    expect((await call(harness, owner, 'DELETE', `/api/games/${game.id}`)).status).toBe(409);
  });

  it('cannot touch someone else’s game', async () => {
    const game = await createGame(harness.newOwner());

    expect(
      (await call(harness, harness.newOwner(), 'DELETE', `/api/games/${game.id}`)).status,
    ).toBe(404);
  });
});
