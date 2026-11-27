import { type Socket, io } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { LiveSnapshot } from '../engine/dto';
import type { GameResponse } from '../games/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { BroadcastEvent } from './game.gateway';

let harness: TestHarness;
const sockets: Socket[] = [];

beforeAll(async () => {
  harness = await startTestApp();
});

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
});

afterAll(async () => {
  await harness.close();
});

async function connect(): Promise<Socket> {
  const socket = io(harness.url, { path: '/api/socket.io', transports: ['websocket'] });

  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return socket;
}

function next<T>(
  socket: Socket,
  event: string,
  where: (value: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no ${event} arrived`));
    }, 5000);
    const listener = (value: T) => {
      if (where(value)) {
        clearTimeout(timer);
        socket.off(event, listener);
        resolve(value);
      }
    };

    socket.on(event, listener);
  });
}

async function runningGame(): Promise<{ owner: string; game: GameResponse }> {
  const owner = harness.newOwner();
  const game = (await call<GameResponse>(harness, owner, 'POST', '/api/games', { name: 'Ao vivo' }))
    .body;

  await call(harness, owner, 'POST', `/api/games/${game.id}/open`);
  await fetch(`${harness.url}/api/join/${game.code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'Ana', lastName: 'Souza' }),
  });
  await call(harness, owner, 'POST', `/api/games/${game.id}/start`);

  return { owner, game };
}

describe('following a game live', () => {
  it('sends the current snapshot as soon as someone subscribes with the code', async () => {
    const { game } = await runningGame();
    const socket = await connect();
    const snapshot = next<LiveSnapshot>(socket, 'snapshot');

    const ack = (await socket.emitWithAck('subscribe', { code: game.code.toLowerCase() })) as {
      ok: boolean;
    };

    expect(ack.ok).toBe(true);
    expect((await snapshot).status).toBe('running');
    expect((await snapshot).participantCount).toBe(1);
  });

  it('turns away a code no game has', async () => {
    const socket = await connect();

    expect(await socket.emitWithAck('subscribe', { code: 'ZZZZZZ' })).toEqual({ ok: false });
    expect(await socket.emitWithAck('subscribe', 'nonsense')).toEqual({ ok: false });
  });

  it('announces each ball, then pushes the snapshot that includes it', async () => {
    const { owner, game } = await runningGame();
    const socket = await connect();

    await socket.emitWithAck('subscribe', { code: game.code });

    const announced = next<BroadcastEvent>(socket, 'game-event', (event) => event.kind === 'ball');
    const updated = next<LiveSnapshot>(
      socket,
      'snapshot',
      (snapshot) => snapshot.draws.length === 1,
    );
    const drawn = await call<{ ball: number }>(
      harness,
      owner,
      'POST',
      `/api/games/${game.id}/draw`,
    );

    expect(await announced).toEqual({ kind: 'ball', seq: 1, ball: drawn.body.ball });
    expect((await updated).draws).toEqual([drawn.body.ball]);
  });

  it('keeps games apart: a watcher of one hears nothing of another', async () => {
    const first = await runningGame();
    const second = await runningGame();
    const socket = await connect();
    const heard: BroadcastEvent[] = [];

    await socket.emitWithAck('subscribe', { code: first.game.code });
    socket.on('game-event', (event: BroadcastEvent) => heard.push(event));

    await call(harness, second.owner, 'POST', `/api/games/${second.game.id}/draw`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(heard).toEqual([]);
  });

  it('follows only the latest game a socket subscribed to', async () => {
    const first = await runningGame();
    const second = await runningGame();
    const socket = await connect();
    const heard: BroadcastEvent[] = [];

    await socket.emitWithAck('subscribe', { code: first.game.code });
    await socket.emitWithAck('subscribe', { code: second.game.code });
    socket.on('game-event', (event: BroadcastEvent) => heard.push(event));

    await call(harness, first.owner, 'POST', `/api/games/${first.game.id}/draw`);
    await call(harness, second.owner, 'POST', `/api/games/${second.game.id}/draw`);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(heard).toHaveLength(1);
  });

  it('tells watchers when a game starts, so waiting screens can wake up', async () => {
    const owner = harness.newOwner();
    const game = (await call<GameResponse>(harness, owner, 'POST', '/api/games', { name: 'X' }))
      .body;

    await call(harness, owner, 'POST', `/api/games/${game.id}/open`);
    await fetch(`${harness.url}/api/join/${game.code}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Ana', lastName: 'Souza' }),
    });

    const socket = await connect();

    await socket.emitWithAck('subscribe', { code: game.code });

    const started = next<BroadcastEvent>(socket, 'game-event', (event) => event.kind === 'status');

    await call(harness, owner, 'POST', `/api/games/${game.id}/start`);

    expect(await started).toEqual({ kind: 'status', status: 'running' });
  });
});
