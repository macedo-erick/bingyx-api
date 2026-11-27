import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FREE } from '../cards/card-grid';
import type { GameResponse } from '../games/dto';
import type { PlayerStateResponse, SeatResponse } from '../players/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import { ClaimService } from './claim.service';
import type { ClaimResponse, ControlView, DrawResponse, LiveSnapshot } from './dto';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

interface Player {
  readonly token: string;
  readonly cardNumber: number;
  readonly grid: number[];
}

interface Table {
  readonly owner: string;
  readonly game: GameResponse;
  readonly players: Player[];
}

type Prizes = Partial<Record<'line' | 'column' | 'diagonal' | 'full', number>>;

async function table(
  playerCount: number,
  prizes: Prizes = { line: 1, column: 1, full: 1 },
  start = true,
): Promise<Table> {
  const owner = harness.newOwner();
  const game = (await call<GameResponse>(harness, owner, 'POST', '/api/games', { name: 'Natal' }))
    .body;

  await call(harness, owner, 'PUT', `/api/games/${game.id}/prizes`, {
    prizes: (['line', 'column', 'diagonal', 'full'] as const).map((type) => ({
      type,
      enabled: prizes[type] !== undefined,
      quantity: prizes[type] ?? 1,
      description: type === 'line' ? 'Panetone' : null,
    })),
  });
  await call(harness, owner, 'POST', `/api/games/${game.id}/open`);

  const players: Player[] = [];

  for (let i = 0; i < playerCount; i++) {
    const seat = await post<SeatResponse>(`/api/join/${game.code}`, {
      firstName: `Pessoa${String(i + 1)}`,
      lastName: 'Silva',
    });
    const state = await asPlayer<PlayerStateResponse>(seat.body.playerToken, 'GET', '/api/player');

    players.push({
      token: seat.body.playerToken,
      cardNumber: seat.body.cardNumber,
      grid: [...state.body.card.grid],
    });
  }

  if (start) {
    await call(harness, owner, 'POST', `/api/games/${game.id}/start`);
  }

  return { owner, game, players };
}

interface Reply<T> {
  readonly status: number;
  readonly body: T;
}

async function post<T>(path: string, body: unknown): Promise<Reply<T>> {
  const response = await fetch(`${harness.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: (await response.json()) as T };
}

async function asPlayer<T>(token: string, method: string, path: string): Promise<Reply<T>> {
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();

  return { status: response.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
}

// Draws chosen balls directly, so a test can decide who completes what.
async function drawBalls(gameId: string, balls: readonly number[]): Promise<void> {
  const rows = await harness.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM draw WHERE game_id = ${gameId}`,
  );
  let seq = rows[0]?.count ?? 0;

  for (const ball of balls) {
    seq++;
    await harness.db.execute(
      sql`INSERT INTO draw (id, game_id, seq, ball) VALUES (gen_random_uuid(), ${gameId}, ${seq}, ${ball})
          ON CONFLICT DO NOTHING`,
    );
  }
}

function row(grid: readonly number[], index: number): number[] {
  return grid.slice(index * 5, index * 5 + 5).filter((value) => value !== FREE);
}

function column(grid: readonly number[], index: number): number[] {
  return [0, 1, 2, 3, 4].map((r) => grid[r * 5 + index] ?? FREE).filter((value) => value !== FREE);
}

const claim = (player: Player) =>
  asPlayer<ClaimResponse>(player.token, 'POST', '/api/player/claims');

async function settleWindows(gameId: string): Promise<void> {
  await harness.app.get(ClaimService).resolveDue(gameId, new Date(Date.now() + 120_000));
}

async function live(code: string): Promise<LiveSnapshot> {
  return (await fetch(`${harness.url}/api/public/games/${code}`)).json() as Promise<LiveSnapshot>;
}

describe('starting the draw', () => {
  it('turns an open game with players into a running one', async () => {
    const { owner, game } = await table(1, undefined, false);

    const started = await call(harness, owner, 'POST', `/api/games/${game.id}/start`);

    expect(started.status).toBe(204);
    expect((await live(game.code)).status).toBe('running');
  });

  it('refuses a draft, or a game nobody has joined', async () => {
    const owner = harness.newOwner();
    const draft = (await call<GameResponse>(harness, owner, 'POST', '/api/games', { name: 'X' }))
      .body;
    const empty = (await call<GameResponse>(harness, owner, 'POST', '/api/games', { name: 'Y' }))
      .body;

    await call(harness, owner, 'POST', `/api/games/${empty.id}/open`);

    expect((await call(harness, owner, 'POST', `/api/games/${draft.id}/start`)).status).toBe(409);
    expect((await call(harness, owner, 'POST', `/api/games/${empty.id}/start`)).status).toBe(409);
  });
});

describe('drawing balls', () => {
  it('draws each of the seventy-five balls exactly once, then stops', async () => {
    const { owner, game } = await table(1, { full: 1 });
    const balls: number[] = [];

    for (let i = 0; i < 75; i++) {
      const drawn = await call<DrawResponse>(harness, owner, 'POST', `/api/games/${game.id}/draw`);

      expect(drawn.status).toBe(201);
      expect(drawn.body.seq).toBe(i + 1);
      balls.push(drawn.body.ball);
    }

    expect([...balls].sort((a, b) => a - b)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
    expect((await call(harness, owner, 'POST', `/api/games/${game.id}/draw`)).status).toBe(409);
    expect((await live(game.code)).draws).toEqual(balls);
  });

  it('names the letter of the ball it drew', async () => {
    const { owner, game } = await table(1);
    const drawn = await call<DrawResponse>(harness, owner, 'POST', `/api/games/${game.id}/draw`);

    expect(drawn.body.letter).toBe('BINGO'.charAt(Math.floor((drawn.body.ball - 1) / 15)));
  });

  it('refuses before the draw starts and after it finishes', async () => {
    const { owner, game } = await table(1, undefined, false);

    expect((await call(harness, owner, 'POST', `/api/games/${game.id}/draw`)).status).toBe(409);

    await call(harness, owner, 'POST', `/api/games/${game.id}/finish`);

    expect((await call(harness, owner, 'POST', `/api/games/${game.id}/draw`)).status).toBe(409);
  });

  it('belongs to the organiser alone', async () => {
    const { game } = await table(1);

    expect(
      (await call(harness, harness.newOwner(), 'POST', `/api/games/${game.id}/draw`)).status,
    ).toBe(404);
  });
});

describe('marking a card', () => {
  it('lets the player mark any number on their card, drawn or not, and take it back', async () => {
    const { players } = await table(1);
    const [player] = players;
    const number = player!.grid[0]!;

    const marked = await asPlayer<number[]>(
      player!.token,
      'PUT',
      `/api/player/marks/${String(number)}`,
    );
    const again = await asPlayer<number[]>(
      player!.token,
      'PUT',
      `/api/player/marks/${String(number)}`,
    );
    const state = await asPlayer<PlayerStateResponse>(player!.token, 'GET', '/api/player');
    const unmarked = await asPlayer<number[]>(
      player!.token,
      'DELETE',
      `/api/player/marks/${String(number)}`,
    );

    expect(marked.body).toEqual([number]);
    expect(again.body).toEqual([number]);
    expect(state.body.card.marked).toEqual([number]);
    expect(unmarked.body).toEqual([]);
  });

  it('refuses a number that is not on the card', async () => {
    const { players } = await table(1);
    const absent = Array.from({ length: 75 }, (_, i) => i + 1).find(
      (n) => !players[0]!.grid.includes(n),
    )!;

    expect(
      (await asPlayer(players[0]!.token, 'PUT', `/api/player/marks/${String(absent)}`)).status,
    ).toBe(400);
    expect((await asPlayer(players[0]!.token, 'PUT', '/api/player/marks/99')).status).toBe(400);
  });
});

describe('claiming BINGO', () => {
  it('is turned down when nothing on the card is complete, and the draw carries on', async () => {
    const { owner, game, players } = await table(1);

    const claimed = await claim(players[0]!);
    const view = await call<ControlView>(harness, owner, 'GET', `/api/games/${game.id}/live`);

    expect(claimed.body).toEqual({ valid: false, prizeTypes: [] });
    expect(view.body.status).toBe('running');
    expect(view.body.claims[0]).toMatchObject({ cardNumber: 1, valid: false, prizeType: null });
  });

  it('is judged by the balls drawn, never by what the player marked', async () => {
    const { players } = await table(1);
    const [player] = players;

    for (const number of row(player!.grid, 0)) {
      await asPlayer(player!.token, 'PUT', `/api/player/marks/${String(number)}`);
    }

    expect((await claim(player!)).body.valid).toBe(false);
  });

  it('opens a checking window on a good claim, holding the draw until it settles', async () => {
    const { owner, game, players } = await table(2);
    const [ana] = players;

    await drawBalls(game.id, row(ana!.grid, 0));

    const claimed = await claim(ana!);
    const checking = await live(game.code);
    const blocked = await call(harness, owner, 'POST', `/api/games/${game.id}/draw`);

    expect(claimed.body).toEqual({ valid: true, prizeTypes: ['line'] });
    expect(checking.status).toBe('checking');
    expect(checking.window?.claimants).toEqual([
      { cardNumber: 1, name: 'Pessoa1 Silva', prizeType: 'line' },
    ]);
    expect(blocked.status).toBe(409);

    await settleWindows(game.id);

    const settled = await live(game.code);

    expect(settled.status).toBe('running');
    expect(settled.window).toBeNull();
    expect(settled.winners).toEqual([
      {
        prizeType: 'line',
        description: 'Panetone',
        cardNumber: 1,
        name: 'Pessoa1 Silva',
        tieBreak: false,
        atSeq: row(ana!.grid, 0).length,
      },
    ]);
    expect((await call(harness, owner, 'POST', `/api/games/${game.id}/draw`)).status).toBe(201);
  });

  it('claims every prize the card has completed at once', async () => {
    const { game, players } = await table(1, { line: 1, column: 1 });
    const [ana] = players;

    await drawBalls(game.id, [...row(ana!.grid, 0), ...column(ana!.grid, 4)]);

    expect((await claim(ana!)).body.prizeTypes).toEqual(['line', 'column']);

    await settleWindows(game.id);

    expect((await live(game.code)).winners.map((winner) => winner.prizeType)).toEqual([
      'line',
      'column',
    ]);
  });

  it('gives each card at most one prize of each kind', async () => {
    const { game, players } = await table(1, { line: 3, full: 1 });
    const [ana] = players;

    await drawBalls(game.id, row(ana!.grid, 0));
    await claim(ana!);
    await settleWindows(game.id);
    await drawBalls(game.id, row(ana!.grid, 4));

    expect((await claim(ana!)).body.valid).toBe(false);
  });

  it('does not count the same claim twice when the button is pressed again', async () => {
    const { owner, game, players } = await table(1, { line: 2, full: 1 });
    const [ana] = players;

    await drawBalls(game.id, row(ana!.grid, 0));
    await claim(ana!);
    await claim(ana!);
    await settleWindows(game.id);

    const view = await call<ControlView>(harness, owner, 'GET', `/api/games/${game.id}/live`);

    expect(view.body.winners).toHaveLength(1);
    expect(view.body.claims.filter((entry) => entry.valid)).toHaveLength(1);
  });

  it('settles a tie by drawing among everyone who claimed in the same window', async () => {
    const { game, players } = await table(3, { line: 2, full: 1 });

    await drawBalls(
      game.id,
      players.flatMap((player) => row(player.grid, 0)),
    );

    for (const player of players) {
      expect((await claim(player)).body.valid).toBe(true);
    }

    await settleWindows(game.id);

    const { winners } = await live(game.code);

    expect(winners).toHaveLength(2);
    expect(winners.every((winner) => winner.tieBreak)).toBe(true);
    expect(new Set(winners.map((winner) => winner.cardNumber)).size).toBe(2);
  });

  it('turns away a late claim once the prize is gone', async () => {
    const { game, players } = await table(2, { line: 1, full: 1 });
    const [ana, beto] = players;

    await drawBalls(game.id, [...row(ana!.grid, 0), ...row(beto!.grid, 0)]);
    await claim(ana!);
    await settleWindows(game.id);

    expect((await claim(beto!)).body).toEqual({ valid: false, prizeTypes: [] });
  });

  it('ends the game when the full card is won', async () => {
    const { game, players } = await table(1, { line: 1, full: 1 });
    const [ana] = players;

    await drawBalls(
      game.id,
      ana!.grid.filter((value) => value !== FREE),
    );

    expect((await claim(ana!)).body.prizeTypes).toEqual(['line', 'full']);

    await settleWindows(game.id);

    const ended = await live(game.code);

    expect(ended.status).toBe('finished');
    expect(ended.registrationOpen).toBe(false);
    expect((await claim(ana!)).status).toBe(409);
  });

  it('ends the game when the last prize goes, if there is no full card prize', async () => {
    const { game, players } = await table(1, { line: 1 });

    await drawBalls(game.id, row(players[0]!.grid, 0));
    await claim(players[0]!);
    await settleWindows(game.id);

    expect((await live(game.code)).status).toBe('finished');
  });

  it('is refused before the draw starts', async () => {
    const { players } = await table(1, undefined, false);

    expect((await claim(players[0]!)).status).toBe(409);
  });
});

describe('the ranking', () => {
  it('lists cards by name and how close each is, the one that can claim first', async () => {
    const { game, players } = await table(3, { line: 1, full: 1 });
    const [ana, beto] = players;

    await drawBalls(game.id, [...row(ana!.grid, 0), ...row(beto!.grid, 0).slice(0, 3)]);

    const { ranking } = await live(game.code);

    expect(ranking[0]).toEqual({
      cardNumber: 1,
      name: 'Pessoa1 Silva',
      missing: 0,
      prizeType: 'line',
    });
    expect(ranking[1]).toMatchObject({ cardNumber: 2, missing: 2 });
    expect(ranking).toHaveLength(3);
  });

  it('shows each player where they stand', async () => {
    const { game, players } = await table(2, { line: 1, full: 1 });
    const [, beto] = players;

    await drawBalls(game.id, row(beto!.grid, 0));

    const state = await asPlayer<PlayerStateResponse>(beto!.token, 'GET', '/api/player');

    expect(state.body.me.rank).toEqual({ position: 1, missing: 0, prizeType: 'line' });
    expect(state.body.live.draws).toHaveLength(row(beto!.grid, 0).length);
  });

  it('tells the player about their own claim while it is being checked, and their wins after', async () => {
    const { game, players } = await table(1, { line: 1, full: 1 });
    const [ana] = players;

    await drawBalls(game.id, row(ana!.grid, 0));
    await claim(ana!);

    const pending = await asPlayer<PlayerStateResponse>(ana!.token, 'GET', '/api/player');

    await settleWindows(game.id);

    const after = await asPlayer<PlayerStateResponse>(ana!.token, 'GET', '/api/player');

    expect(pending.body.me.pending).toEqual(['line']);
    expect(after.body.me).toMatchObject({ pending: [], wins: ['line'] });
    expect(after.body.me.rank?.prizeType).toBe('full');
  });
});

describe('the public draw screen', () => {
  it('is readable by anyone with the code, and 404 for an unknown one', async () => {
    const { game } = await table(1);

    expect((await fetch(`${harness.url}/api/public/games/${game.code}`)).status).toBe(200);
    expect((await fetch(`${harness.url}/api/public/games/ZZZZZZ`)).status).toBe(404);
  });

  it('shows the prizes and how many of each are gone', async () => {
    const { game, players } = await table(1, { line: 2, full: 1 });

    await drawBalls(game.id, row(players[0]!.grid, 0));
    await claim(players[0]!);
    await settleWindows(game.id);

    expect((await live(game.code)).prizes).toEqual([
      { type: 'line', quantity: 2, description: 'Panetone', won: 1 },
      { type: 'full', quantity: 1, description: null, won: 0 },
    ]);
  });
});

describe('finishing by hand', () => {
  it('closes the game and its registration', async () => {
    const { owner, game } = await table(1);

    expect((await call(harness, owner, 'POST', `/api/games/${game.id}/finish`)).status).toBe(204);

    const ended = await live(game.code);

    expect(ended.status).toBe('finished');
    expect(ended.registrationOpen).toBe(false);
  });

  it('waits for a BINGO being checked', async () => {
    const { owner, game, players } = await table(1);

    await drawBalls(game.id, row(players[0]!.grid, 0));
    await claim(players[0]!);

    expect((await call(harness, owner, 'POST', `/api/games/${game.id}/finish`)).status).toBe(409);
  });
});
