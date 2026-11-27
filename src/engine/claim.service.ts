import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import type { PlayerIdentity } from '../auth/player-token.service';
import { completes } from '../cards/patterns';
import { DATABASE, type Database } from '../database/db';
import type { GameStatus, PrizeType } from '../database/schema';
import type { ClaimResponse } from './dto';
import { EngineRepository, type OpenWindow } from './engine.repository';
import { GameEvents, type WinnerView } from './game-events';
import { remainingByType, winnerView, wonByCard } from './live.service';
import { settle } from './tie-break';

const IN_PLAY: readonly GameStatus[] = ['running', 'checking'];

@Injectable()
export class ClaimService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ClaimService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly engine: EngineRepository,
    private readonly events: GameEvents,
  ) {}

  // A window left open by a restart closes on its own schedule, or at once if that has passed.
  async onApplicationBootstrap(): Promise<void> {
    for (const window of await this.engine.allOpenWindows(this.db)) {
      this.schedule(window);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  async claim(player: PlayerIdentity): Promise<ClaimResponse> {
    const outcome = await this.db.transaction(async (tx) => {
      const locked = await this.engine.lock(tx, player.gameId);

      if (locked === undefined) {
        throw new NotFoundException('Game not found');
      }

      if (!IN_PLAY.includes(locked.status)) {
        throw new ConflictException('There is no draw in progress');
      }

      const mine = await this.engine.cardOf(tx, player.participantId);

      if (mine === undefined) {
        throw new NotFoundException('Card not found');
      }

      const [draws, prizes, wins, window] = await Promise.all([
        this.engine.drawn(tx, locked.id),
        this.engine.prizes(tx, locked.id),
        this.engine.wins(tx, locked.id),
        this.engine.openWindow(tx, locked.id),
      ]);
      const drawn = new Set(draws);
      const alreadyWon = wonByCard(wins).get(mine.id) ?? new Set<PrizeType>();
      const valid = remainingByType(prizes, wins)
        .filter((prize) => prize.remaining > 0 && !alreadyWon.has(prize.type))
        .filter((prize) => completes(mine.grid, drawn, prize.type))
        .map((prize) => prize.type);

      if (valid.length === 0) {
        await this.engine.insertClaims(tx, [
          {
            gameId: locked.id,
            cardId: mine.id,
            windowId: window?.id ?? null,
            prizeType: null,
            valid: false,
            atSeq: draws.length,
          },
        ]);

        return { valid, opened: undefined, gameId: locked.id, cardNumber: mine.number };
      }

      const current =
        window ??
        (await this.engine.insertWindow(
          tx,
          locked.id,
          draws.length,
          new Date(Date.now() + locked.claimWindowSeconds * 1000),
        ));
      const claimedHere = new Set(
        (await this.engine.windowClaims(tx, current.id))
          .filter((claimed) => claimed.cardId === mine.id)
          .map((claimed) => claimed.prizeType),
      );
      const fresh = valid.filter((type) => !claimedHere.has(type));

      if (fresh.length > 0) {
        await this.engine.insertClaims(
          tx,
          fresh.map((prizeType) => ({
            gameId: locked.id,
            cardId: mine.id,
            windowId: current.id,
            prizeType,
            valid: true,
            atSeq: draws.length,
          })),
        );
      }

      if (window === undefined) {
        await this.engine.setStatus(tx, locked.id, { status: 'checking' });
      }

      return {
        valid,
        opened: window === undefined ? current : undefined,
        gameId: locked.id,
        cardNumber: mine.number,
      };
    });

    this.logger.log({
      event: 'claim.submitted',
      gameId: outcome.gameId,
      cardNumber: outcome.cardNumber,
      valid: outcome.valid.length > 0,
      prizeTypes: outcome.valid,
    });

    if (outcome.opened !== undefined) {
      this.schedule(outcome.opened);
      this.events.emit({ kind: 'status', gameId: outcome.gameId, status: 'checking' });
      this.events.emit({
        kind: 'window-opened',
        gameId: outcome.gameId,
        closesAt: outcome.opened.closesAt.toISOString(),
      });
    }

    this.events.emit({
      kind: 'claim',
      gameId: outcome.gameId,
      participantId: player.participantId,
      valid: outcome.valid.length > 0,
    });

    return { valid: outcome.valid.length > 0, prizeTypes: outcome.valid };
  }

  async resolveDue(gameId?: string, now = new Date()): Promise<void> {
    for (const window of await this.engine.windowsDue(this.db, now, gameId)) {
      await this.resolve(window.id, window.gameId);
    }
  }

  async resolve(windowId: string, gameId: string): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const locked = await this.engine.lock(tx, gameId);
      const window = await this.engine.openWindow(tx, gameId);

      if (locked === undefined || window?.id !== windowId) {
        return undefined;
      }

      const [claims, prizes, wins] = await Promise.all([
        this.engine.windowClaims(tx, windowId),
        this.engine.prizes(tx, gameId),
        this.engine.wins(tx, gameId),
      ]);
      const alreadyWon = wonByCard(wins);
      const remaining = new Map(
        remainingByType(prizes, wins).map((prize) => [prize.type, prize.remaining]),
      );
      const awarded: { prizeRuleId: string; cardId: string; claimId: string; tieBreak: boolean }[] =
        [];
      const tieBreakAmong: { prizeType: PrizeType; cardNumbers: number[] }[] = [];

      for (const prize of prizes) {
        const candidates = [
          ...new Map(
            claims
              .filter((claimed) => claimed.prizeType === prize.type)
              .filter((claimed) => alreadyWon.get(claimed.cardId)?.has(prize.type) !== true)
              .map((claimed) => [claimed.cardId, claimed]),
          ).values(),
        ];
        const result = settle(candidates, remaining.get(prize.type) ?? 0);

        if (result.drawn) {
          tieBreakAmong.push({
            prizeType: prize.type,
            cardNumbers: candidates.map((candidate) => candidate.cardNumber),
          });
        }

        for (const winner of result.winners) {
          awarded.push({
            prizeRuleId: prize.id,
            cardId: winner.cardId,
            claimId: winner.id,
            tieBreak: result.drawn,
          });
        }
      }

      await this.engine.insertWins(
        tx,
        awarded.map((entry) => ({ gameId, ...entry })),
      );
      await this.engine.closeWindow(tx, windowId);

      const after = remainingByType(prizes, [...wins, ...awarded]);
      const full = after.find((prize) => prize.type === 'full');
      const over =
        full === undefined ? after.every((prize) => prize.remaining <= 0) : full.remaining <= 0;
      const status: GameStatus = over ? 'finished' : 'running';

      await this.engine.setStatus(
        tx,
        gameId,
        over ? { status, finishedAt: new Date(), registrationOpen: false } : { status },
      );

      const isNew = (won: { cardId: string; prizeRuleId: string }) =>
        awarded.some(
          (entry) => entry.cardId === won.cardId && entry.prizeRuleId === won.prizeRuleId,
        );
      const winners: WinnerView[] = (await this.engine.wins(tx, gameId))
        .filter(isNew)
        .map(winnerView);

      return { winners, tieBreakAmong, status };
    });

    this.clearTimer(windowId);

    if (outcome === undefined) {
      return;
    }

    for (const winner of outcome.winners) {
      this.logger.log({
        event: 'prize.won',
        gameId,
        prizeType: winner.prizeType,
        cardNumber: winner.cardNumber,
        tieBreak: winner.tieBreak,
      });
    }

    if (outcome.status === 'finished') {
      this.logger.log({ event: 'game.finished', gameId });
    }

    this.events.emit({
      kind: 'window-closed',
      gameId,
      winners: outcome.winners,
      tieBreakAmong: outcome.tieBreakAmong,
    });
    this.events.emit({ kind: 'status', gameId, status: outcome.status });
  }

  private schedule(window: OpenWindow): void {
    this.clearTimer(window.id);

    const delay = Math.max(0, window.closesAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(window.id);
      this.resolve(window.id, window.gameId).catch((error: unknown) => {
        this.logger.error({ event: 'claim_window.resolve_failed', windowId: window.id, error });
      });
    }, delay);

    timer.unref();
    this.timers.set(window.id, timer);
  }

  private clearTimer(windowId: string): void {
    const timer = this.timers.get(windowId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(windowId);
    }
  }
}
