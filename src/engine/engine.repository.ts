import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';

import type { Executor, Transaction } from '../database/db';
import {
  type GameStatus,
  type PrizeType,
  card,
  claim,
  claimWindow,
  draw,
  game,
  participant,
  prizeRule,
  win,
} from '../database/schema';

export interface LockedGame {
  readonly id: string;
  readonly code: string;
  readonly ownerId: string;
  readonly status: GameStatus;
  readonly claimWindowSeconds: number;
}

export interface PrizeRow {
  readonly id: string;
  readonly type: PrizeType;
  readonly quantity: number;
  readonly description: string | null;
}

export interface WinRow {
  readonly prizeRuleId: string;
  readonly prizeType: PrizeType;
  readonly description: string | null;
  readonly cardId: string;
  readonly cardNumber: number;
  readonly name: string;
  readonly tieBreak: boolean;
  readonly atSeq: number;
}

export interface CardRow {
  readonly id: string;
  readonly participantId: string;
  readonly number: number;
  readonly name: string;
  readonly grid: number[];
  readonly marked: number[];
}

export interface OpenWindow {
  readonly id: string;
  readonly gameId: string;
  readonly closesAt: Date;
}

export interface ClaimRow {
  readonly id: string;
  readonly cardId: string;
  readonly cardNumber: number;
  readonly name: string;
  readonly prizeType: PrizeType | null;
  readonly valid: boolean;
  readonly atSeq: number;
  readonly createdAt: Date;
}

const fullName = sql<string>`btrim(${participant.firstName} || ' ' || ${participant.lastName})`;

const lockedColumns = {
  id: game.id,
  code: game.code,
  ownerId: game.ownerId,
  status: game.status,
  claimWindowSeconds: game.claimWindowSeconds,
};

@Injectable()
export class EngineRepository {
  async lock(tx: Transaction, gameId: string): Promise<LockedGame | undefined> {
    const rows = await tx.select(lockedColumns).from(game).where(eq(game.id, gameId)).for('update');

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

  async findGame(ex: Executor, gameId: string) {
    const rows = await ex
      .select({
        id: game.id,
        code: game.code,
        name: game.name,
        status: game.status,
        scheduledAt: game.scheduledAt,
        registrationOpen: game.registrationOpen,
      })
      .from(game)
      .where(eq(game.id, gameId));

    return rows[0];
  }

  async isOwner(ex: Executor, ownerId: string, gameId: string): Promise<boolean> {
    const rows = await ex
      .select({ id: game.id })
      .from(game)
      .where(and(eq(game.ownerId, ownerId), eq(game.id, gameId)));

    return rows.length > 0;
  }

  async findGameIdByCode(ex: Executor, code: string): Promise<string | undefined> {
    const rows = await ex.select({ id: game.id }).from(game).where(eq(game.code, code));

    return rows[0]?.id;
  }

  async setStatus(
    ex: Executor,
    gameId: string,
    values: Partial<{
      status: GameStatus;
      startedAt: Date;
      finishedAt: Date;
      registrationOpen: boolean;
    }>,
  ): Promise<void> {
    await ex.update(game).set(values).where(eq(game.id, gameId));
  }

  async drawn(ex: Executor, gameId: string): Promise<number[]> {
    const rows = await ex
      .select({ ball: draw.ball })
      .from(draw)
      .where(eq(draw.gameId, gameId))
      .orderBy(asc(draw.seq));

    return rows.map((row) => row.ball);
  }

  async insertDraw(tx: Transaction, gameId: string, seq: number, ball: number): Promise<void> {
    await tx.insert(draw).values({ id: randomUUID(), gameId, seq, ball });
  }

  async prizes(ex: Executor, gameId: string): Promise<PrizeRow[]> {
    return ex
      .select({
        id: prizeRule.id,
        type: prizeRule.type,
        quantity: prizeRule.quantity,
        description: prizeRule.description,
      })
      .from(prizeRule)
      .where(and(eq(prizeRule.gameId, gameId), eq(prizeRule.enabled, true)))
      .orderBy(asc(prizeRule.sortOrder));
  }

  async wins(ex: Executor, gameId: string): Promise<WinRow[]> {
    return ex
      .select({
        prizeRuleId: win.prizeRuleId,
        prizeType: prizeRule.type,
        description: prizeRule.description,
        cardId: win.cardId,
        cardNumber: card.number,
        name: fullName,
        tieBreak: win.tieBreak,
        atSeq: claim.atSeq,
      })
      .from(win)
      .innerJoin(prizeRule, eq(prizeRule.id, win.prizeRuleId))
      .innerJoin(card, eq(card.id, win.cardId))
      .innerJoin(participant, eq(participant.id, card.participantId))
      .innerJoin(claim, eq(claim.id, win.claimId))
      .where(eq(win.gameId, gameId))
      .orderBy(asc(win.createdAt), asc(card.number));
  }

  async cards(ex: Executor, gameId: string): Promise<CardRow[]> {
    return ex
      .select({
        id: card.id,
        participantId: card.participantId,
        number: card.number,
        name: fullName,
        grid: card.grid,
        marked: card.marked,
      })
      .from(card)
      .innerJoin(participant, eq(participant.id, card.participantId))
      .where(eq(card.gameId, gameId))
      .orderBy(asc(card.number));
  }

  async cardOf(ex: Executor, participantId: string): Promise<CardRow | undefined> {
    const rows = await ex
      .select({
        id: card.id,
        participantId: card.participantId,
        number: card.number,
        name: fullName,
        grid: card.grid,
        marked: card.marked,
      })
      .from(card)
      .innerJoin(participant, eq(participant.id, card.participantId))
      .where(eq(card.participantId, participantId));

    return rows[0];
  }

  async countCards(ex: Executor, gameId: string): Promise<number> {
    const rows = await ex
      .select({ count: sql<number>`count(*)::int` })
      .from(card)
      .where(eq(card.gameId, gameId));

    return rows[0]?.count ?? 0;
  }

  async setMark(
    ex: Executor,
    participantId: string,
    ball: number,
    on: boolean,
  ): Promise<number[] | undefined> {
    const marked = on
      ? sql`CASE WHEN ${ball} = ANY(${card.marked}) THEN ${card.marked} ELSE array_append(${card.marked}, ${ball}::smallint) END`
      : sql`array_remove(${card.marked}, ${ball}::smallint)`;
    const rows = await ex
      .update(card)
      .set({ marked })
      .where(and(eq(card.participantId, participantId), sql`${ball} = ANY(${card.grid})`))
      .returning({ marked: card.marked });

    return rows[0]?.marked;
  }

  async openWindow(ex: Executor, gameId: string): Promise<OpenWindow | undefined> {
    const rows = await ex
      .select({ id: claimWindow.id, gameId: claimWindow.gameId, closesAt: claimWindow.closesAt })
      .from(claimWindow)
      .where(and(eq(claimWindow.gameId, gameId), isNull(claimWindow.closedAt)));

    return rows[0];
  }

  async windowsDue(ex: Executor, now: Date, gameId?: string): Promise<OpenWindow[]> {
    return ex
      .select({ id: claimWindow.id, gameId: claimWindow.gameId, closesAt: claimWindow.closesAt })
      .from(claimWindow)
      .where(
        and(
          isNull(claimWindow.closedAt),
          lte(claimWindow.closesAt, now),
          gameId === undefined ? undefined : eq(claimWindow.gameId, gameId),
        ),
      );
  }

  async allOpenWindows(ex: Executor): Promise<OpenWindow[]> {
    return ex
      .select({ id: claimWindow.id, gameId: claimWindow.gameId, closesAt: claimWindow.closesAt })
      .from(claimWindow)
      .where(isNull(claimWindow.closedAt));
  }

  async insertWindow(
    tx: Transaction,
    gameId: string,
    openedAtSeq: number,
    closesAt: Date,
  ): Promise<OpenWindow> {
    const id = randomUUID();

    await tx.insert(claimWindow).values({ id, gameId, openedAtSeq, closesAt });

    return { id, gameId, closesAt };
  }

  async closeWindow(tx: Transaction, windowId: string): Promise<void> {
    await tx.update(claimWindow).set({ closedAt: new Date() }).where(eq(claimWindow.id, windowId));
  }

  async insertClaims(
    tx: Transaction,
    values: {
      gameId: string;
      cardId: string;
      windowId: string | null;
      prizeType: PrizeType | null;
      valid: boolean;
      atSeq: number;
    }[],
  ): Promise<void> {
    await tx.insert(claim).values(values.map((value) => ({ id: randomUUID(), ...value })));
  }

  async windowClaims(ex: Executor, windowId: string): Promise<ClaimRow[]> {
    return this.claimsWhere(ex, and(eq(claim.windowId, windowId), eq(claim.valid, true)), 'asc');
  }

  async recentClaims(ex: Executor, gameId: string, limit: number): Promise<ClaimRow[]> {
    const rows = await this.claimsWhere(ex, eq(claim.gameId, gameId), 'desc');

    return rows.slice(0, limit);
  }

  async insertWins(
    tx: Transaction,
    values: {
      gameId: string;
      prizeRuleId: string;
      cardId: string;
      claimId: string;
      tieBreak: boolean;
    }[],
  ): Promise<void> {
    if (values.length > 0) {
      await tx.insert(win).values(values.map((value) => ({ id: randomUUID(), ...value })));
    }
  }

  private claimsWhere(ex: Executor, where: ReturnType<typeof and>, order: 'asc' | 'desc') {
    return ex
      .select({
        id: claim.id,
        cardId: claim.cardId,
        cardNumber: card.number,
        name: fullName,
        prizeType: claim.prizeType,
        valid: claim.valid,
        atSeq: claim.atSeq,
        createdAt: claim.createdAt,
      })
      .from(claim)
      .innerJoin(card, eq(card.id, claim.cardId))
      .innerJoin(participant, eq(participant.id, card.participantId))
      .where(where)
      .orderBy(order === 'asc' ? asc(claim.createdAt) : desc(claim.createdAt));
  }
}
