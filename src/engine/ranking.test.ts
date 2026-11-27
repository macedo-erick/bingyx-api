import { describe, expect, it } from 'vitest';

import { FREE } from '../cards/card-grid';
import type { PrizeType } from '../database/schema';
import { type OpenPrize, type RankableCard, rank } from './ranking';

// prettier-ignore
const A_GRID = [
  1, 16, 31, 46, 61,
  2, 17, 32, 47, 62,
  3, 18, FREE, 48, 63,
  4, 19, 34, 49, 64,
  5, 20, 35, 50, 65,
];
// prettier-ignore
const B_GRID = [
  6, 21, 36, 51, 66,
  7, 22, 37, 52, 67,
  8, 23, FREE, 53, 68,
  9, 24, 39, 54, 69,
  10, 25, 40, 55, 70,
];

const ana: RankableCard = { id: 'a', number: 1, name: 'Ana Souza', grid: A_GRID };
const beto: RankableCard = { id: 'b', number: 2, name: 'Beto Lima', grid: B_GRID };

const prizes = (...entries: [PrizeType, number][]): OpenPrize[] =>
  entries.map(([type, remaining]) => ({ type, remaining }));

describe('the ranking', () => {
  it('puts the card closest to a prize first, by name and number', () => {
    const ranked = rank(
      [ana, beto],
      new Set([2, 17, 32, 47, 7]),
      prizes(['line', 1], ['full', 1]),
      new Map(),
    );

    expect(ranked).toEqual([
      { cardNumber: 1, name: 'Ana Souza', missing: 1, prizeType: 'line' },
      { cardNumber: 2, name: 'Beto Lima', missing: 4, prizeType: 'line' },
    ]);
  });

  it('shows zero missing for a card that has closed a prize and not claimed it yet', () => {
    const [first] = rank([ana], new Set([1, 2, 3, 4, 5]), prizes(['column', 1]), new Map());

    expect(first?.missing).toBe(0);
  });

  it('measures a card against the prizes still on offer, skipping those given out', () => {
    const ranked = rank(
      [ana],
      new Set([1, 2, 3, 4]),
      prizes(['column', 0], ['line', 1]),
      new Map(),
    );

    expect(ranked[0]?.prizeType).toBe('line');
  });

  it('skips a prize the card has already won', () => {
    const ranked = rank(
      [ana],
      new Set([1, 2, 3, 4, 5]),
      prizes(['column', 2], ['full', 1]),
      new Map([['a', new Set<PrizeType>(['column'])]]),
    );

    expect(ranked[0]).toMatchObject({ prizeType: 'full', missing: 19 });
  });

  it('leaves out a card with nothing left to win', () => {
    const ranked = rank(
      [ana, beto],
      new Set(),
      prizes(['line', 1]),
      new Map([['a', new Set<PrizeType>(['line'])]]),
    );

    expect(ranked.map((entry) => entry.cardNumber)).toEqual([2]);
  });

  it('breaks a tie by the order of the prizes, then by card number', () => {
    const ranked = rank([beto, ana], new Set(), prizes(['line', 1], ['column', 1]), new Map());

    expect(ranked.map((entry) => [entry.cardNumber, entry.prizeType])).toEqual([
      [1, 'line'],
      [2, 'line'],
    ]);
  });
});
