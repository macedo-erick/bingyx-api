import { randomUUID } from 'node:crypto';

import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { isUniqueViolation } from '../common/postgres-error';
import { DATABASE, type Database } from '../database/db';
import { type GameStatus, PRIZE_TYPES, type PrizeType, game, prizeRule } from '../database/schema';
import type {
  ConfigurePrizesRequest,
  CreateGameRequest,
  GameResponse,
  GameSummaryResponse,
  UpdateGameRequest,
} from './dto';
import { newGameCode } from './game-code';
import { GameRepository } from './game.repository';

const EDITABLE: readonly GameStatus[] = ['draft', 'open'];
const IN_PLAY: readonly GameStatus[] = ['running', 'checking'];
const CODE_ATTEMPTS = 5;

const DEFAULT_PRIZES: Record<PrizeType, { enabled: boolean; quantity: number }> = {
  line: { enabled: true, quantity: 1 },
  column: { enabled: true, quantity: 1 },
  diagonal: { enabled: false, quantity: 1 },
  full: { enabled: true, quantity: 1 },
};

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly games: GameRepository,
  ) {}

  findAll(ownerId: string): Promise<GameSummaryResponse[]> {
    return this.games.findSummaries(ownerId);
  }

  async findOne(ownerId: string, gameId: string): Promise<GameResponse> {
    const summary = await this.games.findSummary(ownerId, gameId);
    const settings = summary === undefined ? undefined : await this.games.findSettings(gameId);

    if (summary === undefined || settings === undefined) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }

    return { ...summary, ...settings, prizes: await this.games.findPrizes(gameId) };
  }

  async create(ownerId: string, request: CreateGameRequest): Promise<GameResponse> {
    const gameId = randomUUID();

    for (let attempt = 1; ; attempt++) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(game).values({
            id: gameId,
            code: newGameCode(),
            ownerId,
            name: request.name,
            scheduledAt: toDate(request.scheduledAt),
            ...(request.freeCenter !== undefined ? { freeCenter: request.freeCenter } : {}),
            ...(request.claimWindowSeconds !== undefined
              ? { claimWindowSeconds: request.claimWindowSeconds }
              : {}),
          });
          await tx.insert(prizeRule).values(
            PRIZE_TYPES.map((type, sortOrder) => ({
              id: randomUUID(),
              gameId,
              type,
              sortOrder,
              ...DEFAULT_PRIZES[type],
            })),
          );
        });

        break;
      } catch (error) {
        if (attempt >= CODE_ATTEMPTS || !isUniqueViolation(error, 'game_code_unique')) {
          throw error;
        }
      }
    }

    this.logger.log({ event: 'game.created', gameId });

    return this.findOne(ownerId, gameId);
  }

  async update(ownerId: string, gameId: string, request: UpdateGameRequest): Promise<GameResponse> {
    await this.requireEditable(ownerId, gameId);

    await this.games.update(ownerId, gameId, {
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.scheduledAt !== undefined ? { scheduledAt: toDate(request.scheduledAt) } : {}),
      ...(request.freeCenter !== undefined ? { freeCenter: request.freeCenter } : {}),
      ...(request.claimWindowSeconds !== undefined
        ? { claimWindowSeconds: request.claimWindowSeconds }
        : {}),
    });

    this.logger.log({ event: 'game.updated', gameId, fields: Object.keys(request) });

    return this.findOne(ownerId, gameId);
  }

  async configurePrizes(
    ownerId: string,
    gameId: string,
    request: ConfigurePrizesRequest,
  ): Promise<GameResponse> {
    await this.requireEditable(ownerId, gameId);
    await this.games.replacePrizes(gameId, request.prizes);

    this.logger.log({
      event: 'game.prizes_configured',
      gameId,
      enabled: request.prizes.filter((prize) => prize.enabled).map((prize) => prize.type),
    });

    return this.findOne(ownerId, gameId);
  }

  async open(ownerId: string, gameId: string): Promise<GameResponse> {
    const status = await this.requireGame(ownerId, gameId);

    if (status !== 'draft') {
      throw new ConflictException('Only a draft game can be opened');
    }

    await this.games.update(ownerId, gameId, { status: 'open', registrationOpen: true });
    this.logger.log({ event: 'game.opened', gameId });

    return this.findOne(ownerId, gameId);
  }

  async remove(ownerId: string, gameId: string): Promise<void> {
    const status = await this.requireGame(ownerId, gameId);

    if (IN_PLAY.includes(status)) {
      throw new ConflictException('A game being drawn cannot be deleted');
    }

    await this.games.delete(ownerId, gameId);
    this.logger.log({ event: 'game.deleted', gameId });
  }

  private async requireGame(ownerId: string, gameId: string): Promise<GameStatus> {
    const status = await this.games.findStatus(ownerId, gameId);

    if (status === undefined) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }

    return status;
  }

  private async requireEditable(ownerId: string, gameId: string): Promise<void> {
    if (!EDITABLE.includes(await this.requireGame(ownerId, gameId))) {
      throw new ConflictException('The game has started and can no longer be changed');
    }
  }
}

function toDate(value: string | null | undefined): Date | null {
  return value === undefined || value === null ? null : new Date(value);
}
