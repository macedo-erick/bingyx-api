import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { type GameStatus, game, prizeRule } from '../database/schema';
import type { GameResponse, GameSummaryResponse, PrizeResponse } from './dto';

type Settings = Omit<GameResponse, keyof GameSummaryResponse | 'prizes'>;

@Injectable()
export class GameRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private readonly summarySelect = sql`
      g.id,
      g.code,
      g.name,
      g.status,
      (to_jsonb(g.scheduled_at) #>> '{}') AS "scheduledAt",
      g.registration_open AS "registrationOpen",
      (to_jsonb(g.created_at) #>> '{}') AS "createdAt",
      (SELECT COUNT(*) FROM participant p WHERE p.game_id = g.id)::int AS "participantCount",
      (SELECT COUNT(*) FROM draw d WHERE d.game_id = g.id)::int AS "drawnCount",
      (SELECT COALESCE(SUM(r.quantity), 0) FROM prize_rule r WHERE r.game_id = g.id AND r.enabled)::int
        AS "prizeCount",
      (SELECT COUNT(*) FROM win w WHERE w.game_id = g.id)::int AS "winCount"
  `;

  async findSummaries(ownerId: string): Promise<GameSummaryResponse[]> {
    const rows = await this.db.execute<GameSummaryResponse>(sql`
      SELECT ${this.summarySelect}
      FROM game g
      WHERE g.owner_id = ${ownerId}
      ORDER BY g.created_at DESC
    `);

    return [...rows];
  }

  async findSummary(ownerId: string, gameId: string): Promise<GameSummaryResponse | undefined> {
    const rows = await this.db.execute<GameSummaryResponse>(sql`
      SELECT ${this.summarySelect}
      FROM game g
      WHERE g.owner_id = ${ownerId} AND g.id = ${gameId}
    `);

    return rows[0];
  }

  async findSettings(gameId: string): Promise<Settings | undefined> {
    const rows = await this.db
      .select({ freeCenter: game.freeCenter, claimWindowSeconds: game.claimWindowSeconds })
      .from(game)
      .where(eq(game.id, gameId));

    return rows[0];
  }

  async findPrizes(gameId: string): Promise<PrizeResponse[]> {
    return this.db
      .select({
        type: prizeRule.type,
        enabled: prizeRule.enabled,
        quantity: prizeRule.quantity,
        description: prizeRule.description,
      })
      .from(prizeRule)
      .where(eq(prizeRule.gameId, gameId))
      .orderBy(prizeRule.sortOrder);
  }

  async findStatus(ownerId: string, gameId: string): Promise<GameStatus | undefined> {
    const rows = await this.db
      .select({ status: game.status })
      .from(game)
      .where(and(eq(game.ownerId, ownerId), eq(game.id, gameId)));

    return rows[0]?.status;
  }

  async update(
    ownerId: string,
    gameId: string,
    values: Partial<{
      name: string;
      scheduledAt: Date | null;
      freeCenter: boolean;
      claimWindowSeconds: number;
      status: GameStatus;
      registrationOpen: boolean;
    }>,
  ): Promise<boolean> {
    const updated = await this.db
      .update(game)
      .set(values)
      .where(and(eq(game.ownerId, ownerId), eq(game.id, gameId)))
      .returning({ id: game.id });

    return updated.length > 0;
  }

  async replacePrizes(gameId: string, prizes: readonly PrizeResponse[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [sortOrder, prize] of prizes.entries()) {
        await tx
          .update(prizeRule)
          .set({
            enabled: prize.enabled,
            quantity: prize.quantity,
            description: prize.description,
            sortOrder,
          })
          .where(and(eq(prizeRule.gameId, gameId), eq(prizeRule.type, prize.type)));
      }
    });
  }

  async delete(ownerId: string, gameId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(game)
      .where(and(eq(game.ownerId, ownerId), eq(game.id, gameId)))
      .returning({ id: game.id });

    return deleted.length > 0;
  }
}
