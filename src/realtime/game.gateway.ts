import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';

import { gameCodeSchema } from '../players/dto';
import { type GameEvent, GameEvents } from '../engine/game-events';
import { LiveService } from '../engine/live.service';

// Several events often follow one action (a claim opens a window and changes the status), so
// each game's snapshot is rebuilt once per short burst rather than once per event.
const COALESCE_MS = 40;

export function gameRoom(gameId: string): string {
  return `game:${gameId}`;
}

export type BroadcastEvent =
  | { readonly kind: 'ball'; readonly seq: number; readonly ball: number }
  | { readonly kind: 'window-opened'; readonly closesAt: string }
  | Extract<GameEvent, { kind: 'window-closed' }>
  | { readonly kind: 'status'; readonly status: string };

// Everything sent here is what the public draw screen already shows, so a room is joined with
// the game's code alone. Personal views (a player's card, the organiser's log) stay on REST and
// are refetched when a snapshot arrives.
@Injectable()
@WebSocketGateway({ path: '/api/socket.io' })
export class GameGateway implements OnGatewayInit, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameGateway.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private subscription?: Subscription;

  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly events: GameEvents,
    private readonly live: LiveService,
  ) {}

  afterInit(): void {
    this.logger.log('Realtime gateway ready');
  }

  onModuleInit(): void {
    this.subscription = this.events.events$.subscribe((event) => {
      this.relay(event);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();

    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }

    this.pending.clear();
  }

  @SubscribeMessage('subscribe')
  async subscribe(client: Socket, payload: unknown): Promise<{ ok: boolean }> {
    const parsed = gameCodeSchema.safeParse(
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)['code']
        : undefined,
    );
    const gameId = parsed.success ? await this.live.gameIdByCode(parsed.data) : undefined;

    if (gameId === undefined) {
      return { ok: false };
    }

    for (const room of client.rooms) {
      if (room.startsWith('game:')) {
        await client.leave(room);
      }
    }

    await client.join(gameRoom(gameId));
    client.emit('snapshot', await this.live.byId(gameId));

    return { ok: true };
  }

  private relay(event: GameEvent): void {
    const broadcast = toBroadcast(event);

    if (broadcast !== undefined) {
      this.server?.to(gameRoom(event.gameId)).emit('game-event', broadcast);
    }

    if (event.kind !== 'marks' && event.kind !== 'claim') {
      this.scheduleSnapshot(event.gameId);
    }
  }

  private scheduleSnapshot(gameId: string): void {
    if (this.pending.has(gameId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.pending.delete(gameId);
      this.live
        .byId(gameId)
        .then((snapshot) => this.server?.to(gameRoom(gameId)).emit('snapshot', snapshot))
        .catch((error: unknown) => {
          this.logger.warn({ event: 'realtime.snapshot_failed', gameId, error });
        });
    }, COALESCE_MS);

    this.pending.set(gameId, timer);
  }
}

function toBroadcast(event: GameEvent): BroadcastEvent | undefined {
  switch (event.kind) {
    case 'ball':
      return { kind: 'ball', seq: event.seq, ball: event.ball };
    case 'window-opened':
      return { kind: 'window-opened', closesAt: event.closesAt };
    case 'window-closed':
      return event;
    case 'status':
      return { kind: 'status', status: event.status };
    default:
      return undefined;
  }
}
