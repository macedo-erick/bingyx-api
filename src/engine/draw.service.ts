import { randomInt } from 'node:crypto';

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { BALL_COUNT, letterOf } from '../cards/card-grid';
import { DATABASE, type Database } from '../database/db';
import type { GameStatus } from '../database/schema';
import { ClaimService } from './claim.service';
import type { DrawResponse } from './dto';
import { EngineRepository } from './engine.repository';
import { GameEvents } from './game-events';

@Injectable()
export class DrawService {
  private readonly logger = new Logger(DrawService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly engine: EngineRepository,
    private readonly claims: ClaimService,
    private readonly events: GameEvents,
  ) {}

  async start(ownerId: string, gameId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = await this.engine.lockOwned(tx, ownerId, gameId);

      if (locked === undefined) {
        throw new NotFoundException(`Game not found: ${gameId}`);
      }

      if (locked.status !== 'open') {
        throw new ConflictException('Only a game open for registration can start');
      }

      if ((await this.engine.countCards(tx, gameId)) === 0) {
        throw new ConflictException('Nobody has a card yet');
      }

      await this.engine.setStatus(tx, gameId, { status: 'running', startedAt: new Date() });
    });

    this.logger.log({ event: 'game.started', gameId });
    this.events.emit({ kind: 'status', gameId, status: 'running' });
  }

  async draw(ownerId: string, gameId: string): Promise<DrawResponse> {
    // A window whose time is up must settle before another ball can change who completed what.
    await this.claims.resolveDue(gameId);

    const drawn = await this.db.transaction(async (tx) => {
      const locked = await this.engine.lockOwned(tx, ownerId, gameId);

      if (locked === undefined) {
        throw new NotFoundException(`Game not found: ${gameId}`);
      }

      if (locked.status === 'checking') {
        throw new ConflictException('A BINGO is being checked; wait for it to settle');
      }

      if (locked.status !== 'running') {
        throw new ConflictException('The draw is not running');
      }

      const previous = new Set(await this.engine.drawn(tx, gameId));
      const left = Array.from({ length: BALL_COUNT }, (_, index) => index + 1).filter(
        (ball) => !previous.has(ball),
      );
      if (left.length === 0) {
        throw new ConflictException('Every ball has been drawn');
      }

      const ball = left[randomInt(left.length)] ?? 0;

      const seq = previous.size + 1;

      await this.engine.insertDraw(tx, gameId, seq, ball);

      return { seq, ball, letter: letterOf(ball) };
    });

    this.logger.log({ event: 'game.ball_drawn', gameId, seq: drawn.seq, ball: drawn.ball });
    this.events.emit({ kind: 'ball', gameId, seq: drawn.seq, ball: drawn.ball });

    return drawn;
  }

  async finish(ownerId: string, gameId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = await this.engine.lockOwned(tx, ownerId, gameId);

      if (locked === undefined) {
        throw new NotFoundException(`Game not found: ${gameId}`);
      }

      const finishable: readonly GameStatus[] = ['open', 'running'];

      if (!finishable.includes(locked.status)) {
        throw new ConflictException(
          locked.status === 'checking'
            ? 'A BINGO is being checked; wait for it to settle'
            : 'The game cannot be finished now',
        );
      }

      await this.engine.setStatus(tx, gameId, {
        status: 'finished',
        finishedAt: new Date(),
        registrationOpen: false,
      });
    });

    this.logger.log({ event: 'game.finished', gameId });
    this.events.emit({ kind: 'status', gameId, status: 'finished' });
  }
}
