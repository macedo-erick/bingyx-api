import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BALLS_PER_COLUMN, FREE } from '../cards/card-grid';
import type { GameResponse } from '../games/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type {
  InvitationResponse,
  ParticipantResponse,
  PlayerStateResponse,
  SeatResponse,
} from './dto';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function openGame(owner: string, open = true): Promise<GameResponse> {
  const game = await call<GameResponse>(harness, owner, 'POST', '/api/games', { name: 'Ceia' });

  if (open) {
    await call(harness, owner, 'POST', `/api/games/${game.body.id}/open`);
  }

  return game.body;
}

async function join(code: string, firstName = 'Ana', lastName = 'Souza') {
  const response = await fetch(`${harness.url}/api/join/${code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName, lastName }),
  });

  return { status: response.status, body: (await response.json()) as SeatResponse };
}

async function asPlayer(token: string) {
  const response = await fetch(`${harness.url}/api/player`, {
    headers: { authorization: `Bearer ${token}` },
  });

  return { status: response.status, body: (await response.json()) as PlayerStateResponse };
}

async function setStatus(gameId: string, status: string): Promise<void> {
  await harness.db.execute(sql`UPDATE game SET status = ${status} WHERE id = ${gameId}`);
}

describe('reading an invitation', () => {
  it('shows the game and its enabled prizes to anyone holding the code', async () => {
    const game = await openGame(harness.newOwner());
    const response = await fetch(`${harness.url}/api/join/${game.code.toLowerCase()}`);
    const body = (await response.json()) as InvitationResponse;

    expect(response.status).toBe(200);
    expect(body.name).toBe('Ceia');
    expect(body.registrationOpen).toBe(true);
    expect(body.prizes.map((prize) => prize.type)).toEqual(['line', 'column', 'full']);
  });

  it('answers 404 for a code no game has', async () => {
    expect((await fetch(`${harness.url}/api/join/ZZZZZZ`)).status).toBe(404);
  });

  it('refuses something that is not a code at all', async () => {
    expect((await fetch(`${harness.url}/api/join/a%20b`)).status).toBe(400);
  });
});

describe('joining through the link', () => {
  it('hands out a numbered card and a token to see it with', async () => {
    const game = await openGame(harness.newOwner());

    const first = await join(game.code, 'Ana Paula', 'Souza');
    const second = await join(game.code, 'Carlos', 'Mendes');

    expect(first.status).toBe(201);
    expect(first.body.cardNumber).toBe(1);
    expect(second.body.cardNumber).toBe(2);

    const state = await asPlayer(first.body.playerToken);

    expect(state.status).toBe(200);
    expect(state.body.game.name).toBe('Ceia');
    expect(state.body.player).toEqual({ firstName: 'Ana Paula', lastName: 'Souza' });
    expect(state.body.card.number).toBe(1);
    expect(state.body.card.marked).toEqual([]);
  });

  it('deals a proper bingo card, free centre included', async () => {
    const game = await openGame(harness.newOwner());
    const seat = await join(game.code);
    const { grid } = (await asPlayer(seat.body.playerToken)).body.card;

    expect(grid).toHaveLength(25);
    expect(grid[12]).toBe(FREE);

    grid.forEach((value, index) => {
      if (index === 12) {
        return;
      }

      const low = (index % 5) * BALLS_PER_COLUMN + 1;

      expect(value).toBeGreaterThanOrEqual(low);
      expect(value).toBeLessThan(low + BALLS_PER_COLUMN);
    });
  });

  it('never deals the same card twice in one game, even when everyone joins at once', async () => {
    const game = await openGame(harness.newOwner());

    const seats = await Promise.all(
      Array.from({ length: 12 }, (_, index) => join(game.code, `Pessoa ${String(index)}`, 'X')),
    );
    const numbers = seats.map((seat) => seat.body.cardNumber).sort((a, b) => a - b);

    expect(numbers).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));

    const grids = await harness.db.execute<{ grid: number[] }>(
      sql`SELECT grid FROM card c JOIN game g ON g.id = c.game_id WHERE g.code = ${game.code}`,
    );

    expect(new Set(grids.map((row) => row.grid.join(','))).size).toBe(12);
  });

  it('wants both a first and a last name', async () => {
    const game = await openGame(harness.newOwner());

    expect((await join(game.code, 'Ana', '  ')).status).toBe(400);
    expect((await join(game.code, '', 'Souza')).status).toBe(400);
  });

  it('is refused while the game is still a draft, or once registration closes', async () => {
    const owner = harness.newOwner();
    const draft = await openGame(owner, false);
    const open = await openGame(owner);

    await call(harness, owner, 'PATCH', `/api/games/${open.id}/registration`, { open: false });

    expect((await join(draft.code)).status).toBe(409);
    expect((await join(open.code)).status).toBe(409);
  });

  it('lets latecomers in during the draw if the organiser leaves registration open', async () => {
    const game = await openGame(harness.newOwner());

    await setStatus(game.id, 'running');

    expect((await join(game.code)).status).toBe(201);
  });
});

describe('the player token', () => {
  it('is required, and must be one the API signed', async () => {
    expect((await fetch(`${harness.url}/api/player`)).status).toBe(401);
    expect((await asPlayer('not.a.token')).status).toBe(401);
  });

  it('is not accepted where the organiser signs in', async () => {
    const game = await openGame(harness.newOwner());
    const seat = await join(game.code);

    const response = await fetch(`${harness.url}/api/games`, {
      headers: { authorization: `Bearer ${seat.body.playerToken}` },
    });

    expect(response.status).not.toBe(200);
  });
});

describe('the organiser', () => {
  it('sees who joined, by card number', async () => {
    const owner = harness.newOwner();
    const game = await openGame(owner);

    await join(game.code, 'Ana', 'Souza');
    await join(game.code, 'Carlos', 'Mendes');

    const roster = await call<ParticipantResponse[]>(
      harness,
      owner,
      'GET',
      `/api/games/${game.id}/participants`,
    );

    expect(roster.body.map((p) => [p.cardNumber, p.firstName, p.isOrganiser])).toEqual([
      [1, 'Ana', false],
      [2, 'Carlos', false],
    ]);
  });

  it('cannot see someone else’s roster', async () => {
    const game = await openGame(harness.newOwner());

    expect(
      (await call(harness, harness.newOwner(), 'GET', `/api/games/${game.id}/participants`)).status,
    ).toBe(404);
  });

  it('can reopen registration after closing it', async () => {
    const owner = harness.newOwner();
    const game = await openGame(owner);

    await call(harness, owner, 'PATCH', `/api/games/${game.id}/registration`, { open: false });
    await call(harness, owner, 'PATCH', `/api/games/${game.id}/registration`, { open: true });

    expect((await join(game.code)).status).toBe(201);
  });

  it('cannot toggle registration on a draft or a finished game', async () => {
    const owner = harness.newOwner();
    const draft = await openGame(owner, false);
    const done = await openGame(owner);

    await setStatus(done.id, 'finished');

    for (const game of [draft, done]) {
      const response = await call(harness, owner, 'PATCH', `/api/games/${game.id}/registration`, {
        open: true,
      });

      expect(response.status).toBe(409);
    }
  });

  it('can take a card in their own game, under their own name, even with registration closed', async () => {
    const owner = harness.newOwner();
    const game = await openGame(owner);

    await join(game.code);
    await call(harness, owner, 'PATCH', `/api/games/${game.id}/registration`, { open: false });

    const seat = await call<SeatResponse>(harness, owner, 'POST', `/api/games/${game.id}/play`);
    const state = await asPlayer(seat.body.playerToken);

    expect(seat.status).toBe(200);
    expect(seat.body.cardNumber).toBe(2);
    expect(state.body.player).toEqual({ firstName: 'Organizador', lastName: 'Teste' });
  });

  it('gets the same card back on asking twice', async () => {
    const owner = harness.newOwner();
    const game = await openGame(owner, false);

    const first = await call<SeatResponse>(harness, owner, 'POST', `/api/games/${game.id}/play`);
    const again = await call<SeatResponse>(harness, owner, 'POST', `/api/games/${game.id}/play`);
    const roster = await call<ParticipantResponse[]>(
      harness,
      owner,
      'GET',
      `/api/games/${game.id}/participants`,
    );

    expect(again.body.cardNumber).toBe(first.body.cardNumber);
    expect(roster.body).toHaveLength(1);
    expect(roster.body[0]?.isOrganiser).toBe(true);
  });

  it('cannot take a card in someone else’s game', async () => {
    const game = await openGame(harness.newOwner());

    expect(
      (await call(harness, harness.newOwner(), 'POST', `/api/games/${game.id}/play`)).status,
    ).toBe(404);
  });
});
