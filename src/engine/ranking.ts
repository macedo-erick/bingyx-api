import { missingFor } from '../cards/patterns';
import type { PrizeType } from '../database/schema';

export interface RankableCard {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly grid: readonly number[];
}

export interface OpenPrize {
  readonly type: PrizeType;
  readonly remaining: number;
}

export interface RankEntry {
  readonly cardNumber: number;
  readonly name: string;
  readonly missing: number;
  readonly prizeType: PrizeType;
}

// Each card is ranked by how close it is to the nearest prize it can still win; ties go to the
// prize the organiser listed first, then to the lower card number so the order is stable.
export function rank(
  cards: readonly RankableCard[],
  drawn: ReadonlySet<number>,
  prizes: readonly OpenPrize[],
  wonByCard: ReadonlyMap<string, ReadonlySet<PrizeType>>,
): RankEntry[] {
  const order = new Map(prizes.map((prize, index) => [prize.type, index]));
  const entries: RankEntry[] = [];

  for (const card of cards) {
    const won = wonByCard.get(card.id);
    let best: RankEntry | undefined;

    for (const prize of prizes) {
      if (prize.remaining <= 0 || won?.has(prize.type) === true) {
        continue;
      }

      const missing = missingFor(card.grid, drawn, prize.type);

      if (best === undefined || missing < best.missing) {
        best = { cardNumber: card.number, name: card.name, missing, prizeType: prize.type };
      }
    }

    if (best !== undefined) {
      entries.push(best);
    }
  }

  return entries.sort(
    (a, b) =>
      a.missing - b.missing ||
      (order.get(a.prizeType) ?? 0) - (order.get(b.prizeType) ?? 0) ||
      a.cardNumber - b.cardNumber,
  );
}
