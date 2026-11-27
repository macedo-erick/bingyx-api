import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { PlayerIdentity } from '../auth/player-token.service';
import { DATABASE, type Database } from '../database/db';
import { EngineRepository } from './engine.repository';
import { GameEvents } from './game-events';

// Marks are the player's own notes: any number on the card, drawn or not, and never what a
// claim is judged by.
@Injectable()
export class MarkService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly engine: EngineRepository,
    private readonly events: GameEvents,
  ) {}

  async set(player: PlayerIdentity, ball: number, on: boolean): Promise<number[]> {
    const found = await this.engine.findGame(this.db, player.gameId);

    if (found === undefined) {
      throw new NotFoundException('Game not found');
    }

    if (found.status === 'finished') {
      throw new ConflictException('The game has finished');
    }

    const marked = await this.engine.setMark(this.db, player.participantId, ball, on);

    if (marked === undefined) {
      throw new BadRequestException(`${String(ball)} is not on this card`);
    }

    this.events.emit({ kind: 'marks', gameId: player.gameId, participantId: player.participantId });

    return marked;
  }
}
