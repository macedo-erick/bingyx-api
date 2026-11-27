import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { DATABASE, type Database, type Executor } from '../database/db';
import type { PrizeType } from '../database/schema';
import type { ControlView, LiveSnapshot, PlayerView, PrizeProgress } from './dto';
import { type CardRow, EngineRepository, type PrizeRow, type WinRow } from './engine.repository';
import type { WinnerView } from './game-events';
import { type OpenPrize, type RankEntry, rank } from './ranking';

const PUBLIC_RANKING_SIZE = 10;
const CLAIM_LOG_SIZE = 20;

interface Loaded {
  readonly snapshot: LiveSnapshot;
  readonly fullRanking: RankEntry[];
  readonly cards: CardRow[];
  readonly wins: WinRow[];
}

export function remainingByType(
  prizes: readonly PrizeRow[],
  wins: readonly Pick<WinRow, 'prizeRuleId'>[],
): OpenPrize[] {
  return prizes.map((prize) => ({
    type: prize.type,
    remaining: prize.quantity - wins.filter((won) => won.prizeRuleId === prize.id).length,
  }));
}

export function wonByCard(wins: readonly WinRow[]): Map<string, Set<PrizeType>> {
  const byCard = new Map<string, Set<PrizeType>>();

  for (const won of wins) {
    byCard.set(won.cardId, (byCard.get(won.cardId) ?? new Set()).add(won.prizeType));
  }

  return byCard;
}

export function winnerView(won: WinRow): WinnerView {
  return {
    prizeType: won.prizeType,
    description: won.description,
    cardNumber: won.cardNumber,
    name: won.name,
    tieBreak: won.tieBreak,
    atSeq: won.atSeq,
  };
}

@Injectable()
export class LiveService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly engine: EngineRepository,
  ) {}

  async byCode(code: string): Promise<LiveSnapshot> {
    const gameId = await this.engine.findGameIdByCode(this.db, code);

    if (gameId === undefined) {
      throw new NotFoundException(`Game not found: ${code}`);
    }

    return (await this.load(this.db, gameId)).snapshot;
  }

  async byId(gameId: string): Promise<LiveSnapshot> {
    return (await this.load(this.db, gameId)).snapshot;
  }

  async gameIdByCode(code: string): Promise<string | undefined> {
    return this.engine.findGameIdByCode(this.db, code);
  }

  async forOwner(ownerId: string, gameId: string): Promise<ControlView> {
    if (!(await this.engine.isOwner(this.db, ownerId, gameId))) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }

    const { snapshot } = await this.load(this.db, gameId);
    const claims = await this.engine.recentClaims(this.db, gameId, CLAIM_LOG_SIZE);

    return {
      ...snapshot,
      id: gameId,
      claims: claims.map((entry) => ({
        cardNumber: entry.cardNumber,
        name: entry.name,
        prizeType: entry.prizeType,
        valid: entry.valid,
        atSeq: entry.atSeq,
        at: entry.createdAt.toISOString(),
      })),
    };
  }

  async forPlayer(gameId: string, participantId: string): Promise<PlayerView> {
    const loaded = await this.load(this.db, gameId);
    const mine = loaded.cards.find((entry) => entry.participantId === participantId);
    const position = loaded.fullRanking.findIndex((entry) => entry.cardNumber === mine?.number);
    const entry = loaded.fullRanking[position];
    const window = await this.engine.openWindow(this.db, gameId);
    const pending =
      window === undefined || mine === undefined
        ? []
        : (await this.engine.windowClaims(this.db, window.id))
            .filter((claimed) => claimed.cardId === mine.id)
            .flatMap((claimed): PrizeType[] =>
              claimed.prizeType === null ? [] : [claimed.prizeType],
            );

    return {
      live: loaded.snapshot,
      me: {
        rank:
          entry === undefined
            ? null
            : { position: position + 1, missing: entry.missing, prizeType: entry.prizeType },
        wins: loaded.wins.filter((won) => won.cardId === mine?.id).map((won) => won.prizeType),
        pending,
      },
    };
  }

  private async load(ex: Executor, gameId: string): Promise<Loaded> {
    const [found, draws, prizes, wins, cards, window] = await Promise.all([
      this.engine.findGame(ex, gameId),
      this.engine.drawn(ex, gameId),
      this.engine.prizes(ex, gameId),
      this.engine.wins(ex, gameId),
      this.engine.cards(ex, gameId),
      this.engine.openWindow(ex, gameId),
    ]);

    if (found === undefined) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }

    const fullRanking =
      found.status === 'draft' || found.status === 'finished'
        ? []
        : rank(cards, new Set(draws), remainingByType(prizes, wins), wonByCard(wins));
    const claimants = window === undefined ? [] : await this.engine.windowClaims(ex, window.id);
    const progress: PrizeProgress[] = prizes.map((prize) => ({
      type: prize.type,
      quantity: prize.quantity,
      description: prize.description,
      won: wins.filter((won) => won.prizeRuleId === prize.id).length,
    }));

    return {
      cards,
      wins,
      fullRanking,
      snapshot: {
        code: found.code,
        name: found.name,
        status: found.status,
        scheduledAt: found.scheduledAt?.toISOString() ?? null,
        registrationOpen: found.registrationOpen,
        participantCount: cards.length,
        draws,
        prizes: progress,
        ranking: fullRanking.slice(0, PUBLIC_RANKING_SIZE),
        winners: wins.map(winnerView),
        window:
          window === undefined
            ? null
            : {
                closesAt: window.closesAt.toISOString(),
                claimants: claimants.flatMap((claimed) =>
                  claimed.prizeType === null
                    ? []
                    : [
                        {
                          cardNumber: claimed.cardNumber,
                          name: claimed.name,
                          prizeType: claimed.prizeType,
                        },
                      ],
                ),
              },
      },
    };
  }
}
