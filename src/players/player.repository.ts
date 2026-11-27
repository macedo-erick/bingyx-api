import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { generateUniqueGrid, gridKey } from '../cards/card-grid';
import { DATABASE, type Database, type Transaction } from '../database/db';
import { card, game, participant, prizeRule } from '../database/schema';
import type { PlayerView } from '../engine/dto';
import type { InvitationResponse, ParticipantResponse, PlayerStateResponse } from './dto';

export interface LockedGame {
  readonly id: string;
  readonly status: (typeof game.$inferSelect)['status'];
  readonly registrationOpen: boolean;
  readonly freeCenter: boolean;
}

export interface Person {
  readonly firstName: string;
  readonly lastName: string;
  readonly ownerId: string | null;
}

export interface Seat {
  readonly participantId: string;
  readonly cardNumber: number;
}

const lockedColumns = {
  id: game.id,
  status: game.status,
  registrationOpen: game.registrationOpen,
  freeCenter: game.freeCenter,
};

@Injectable()
export class PlayerRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findInvitation(code: string): Promise<InvitationResponse | undefined> {
    const rows = await this.db
      .select({
        id: game.id,
        code: game.code,
        name: game.name,
        status: game.status,
        scheduledAt: game.scheduledAt,
        registrationOpen: game.registrationOpen,
      })
      .from(game)
      .where(eq(game.code, code));
    const found = rows[0];

    if (found === undefined) {
      return undefined;
    }

    const prizes = await this.db
      .select({
        type: prizeRule.type,
        quantity: prizeRule.quantity,
        description: prizeRule.description,
      })
      .from(prizeRule)
      .where(and(eq(prizeRule.gameId, found.id), eq(prizeRule.enabled, true)))
      .orderBy(prizeRule.sortOrder);

    return {
      code: found.code,
      name: found.name,
      status: found.status,
      scheduledAt: found.scheduledAt?.toISOString() ?? null,
      registrationOpen: found.registrationOpen,
      prizes,
    };
  }

  async lockByCode(tx: Transaction, code: string): Promise<LockedGame | undefined> {
    const rows = await tx.select(lockedColumns).from(game).where(eq(game.code, code)).for('update');

    return rows[0];
  }

  async lockOwned(
    tx: Transaction,
    ownerId: string,
    gameId: string,
  ): Promise<LockedGame | undefined> {
    const rows = await tx
      .select(lockedColumns)
      .from(game)
      .where(and(eq(game.ownerId, ownerId), eq(game.id, gameId)))
      .for('update');

    return rows[0];
  }

  async findOwnerSeat(tx: Transaction, gameId: string, ownerId: string): Promise<Seat | undefined> {
    const rows = await tx
      .select({ participantId: participant.id, cardNumber: card.number })
      .from(participant)
      .innerJoin(card, eq(card.participantId, participant.id))
      .where(and(eq(participant.gameId, gameId), eq(participant.ownerId, ownerId)));

    return rows[0];
  }

  // The caller holds the game row's lock, so numbering and uniqueness cannot race.
  async seat(tx: Transaction, locked: LockedGame, person: Person): Promise<Seat> {
    const existing = await tx
      .select({ number: card.number, grid: card.grid })
      .from(card)
      .where(eq(card.gameId, locked.id));
    const taken = new Set(existing.map((row) => gridKey(row.grid)));
    const cardNumber = existing.reduce((highest, row) => Math.max(highest, row.number), 0) + 1;
    const participantId = randomUUID();

    await tx.insert(participant).values({
      id: participantId,
      gameId: locked.id,
      firstName: person.firstName,
      lastName: person.lastName,
      ownerId: person.ownerId,
    });
    await tx.insert(card).values({
      id: randomUUID(),
      gameId: locked.id,
      participantId,
      number: cardNumber,
      grid: generateUniqueGrid(locked.freeCenter, taken),
    });

    return { participantId, cardNumber };
  }

  async setRegistration(gameId: string, open: boolean): Promise<void> {
    await this.db.update(game).set({ registrationOpen: open }).where(eq(game.id, gameId));
  }

  async findParticipants(gameId: string): Promise<ParticipantResponse[]> {
    const rows = await this.db.execute<ParticipantResponse>(sql`
      SELECT
        c.number AS "cardNumber",
        p.first_name AS "firstName",
        p.last_name AS "lastName",
        (p.owner_id IS NOT NULL) AS "isOrganiser",
        (to_jsonb(p.created_at) #>> '{}') AS "joinedAt"
      FROM participant p
      JOIN card c ON c.participant_id = p.id
      WHERE p.game_id = ${gameId}
      ORDER BY c.number
    `);

    return [...rows];
  }

  async findPlayerState(
    participantId: string,
    gameId: string,
  ): Promise<Omit<PlayerStateResponse, keyof PlayerView> | undefined> {
    const rows = await this.db
      .select({
        code: game.code,
        name: game.name,
        status: game.status,
        scheduledAt: game.scheduledAt,
        firstName: participant.firstName,
        lastName: participant.lastName,
        number: card.number,
        grid: card.grid,
        marked: card.marked,
      })
      .from(participant)
      .innerJoin(game, eq(game.id, participant.gameId))
      .innerJoin(card, eq(card.participantId, participant.id))
      .where(and(eq(participant.id, participantId), eq(participant.gameId, gameId)));
    const row = rows[0];

    if (row === undefined) {
      return undefined;
    }

    return {
      game: {
        code: row.code,
        name: row.name,
        status: row.status,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
      },
      player: { firstName: row.firstName, lastName: row.lastName },
      card: { number: row.number, grid: row.grid, marked: row.marked },
    };
  }
}
