import { describe, expect, it } from 'vitest';

import { settle } from './tie-break';

describe('settling a claim window', () => {
  it('gives every claimant a prize while there are enough', () => {
    expect(settle(['a', 'b'], 2)).toEqual({ winners: ['a', 'b'], losers: [], drawn: false });
    expect(settle(['a'], 3)).toEqual({ winners: ['a'], losers: [], drawn: false });
  });

  it('draws among the claimants when there are more of them than prizes', () => {
    const result = settle(['a', 'b', 'c'], 2, () => 0);

    expect(result.drawn).toBe(true);
    expect(result.winners).toHaveLength(2);
    expect(result.losers).toHaveLength(1);
    expect(new Set([...result.winners, ...result.losers])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('follows the random source, so each claimant can be the one left out', () => {
    const lastPicked = settle(['a', 'b', 'c'], 1, (max) => max - 1);
    const firstPicked = settle(['a', 'b', 'c'], 1, () => 0);

    expect(lastPicked.winners).toEqual(['c']);
    expect(firstPicked.winners).toEqual(['a']);
  });

  it('gives everyone a fair chance over many draws', () => {
    const wins = new Map<string, number>();

    for (let run = 0; run < 3000; run++) {
      const [winner] = settle(['a', 'b', 'c'], 1).winners;

      wins.set(winner ?? '', (wins.get(winner ?? '') ?? 0) + 1);
    }

    for (const name of ['a', 'b', 'c']) {
      expect(wins.get(name)).toBeGreaterThan(800);
    }
  });

  it('gives nothing when no prize is left', () => {
    expect(settle(['a', 'b'], 0)).toEqual({ winners: [], losers: ['a', 'b'], drawn: false });
  });
});
