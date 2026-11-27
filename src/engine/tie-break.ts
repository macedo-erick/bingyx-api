import { randomInt } from 'node:crypto';

import type { Random } from '../cards/card-grid';

export interface TieBreak<T> {
  readonly winners: T[];
  readonly losers: T[];
  readonly drawn: boolean;
}

// Everyone wins while there are enough prizes; otherwise the prizes left are drawn among them.
export function settle<T>(
  candidates: readonly T[],
  slots: number,
  random: Random = randomInt,
): TieBreak<T> {
  if (slots <= 0) {
    return { winners: [], losers: [...candidates], drawn: false };
  }

  if (candidates.length <= slots) {
    return { winners: [...candidates], losers: [], drawn: false };
  }

  const pool = [...candidates];

  for (let i = 0; i < slots; i++) {
    const j = i + random(pool.length - i);
    const picked = pool[j] as T;

    pool[j] = pool[i] as T;
    pool[i] = picked;
  }

  return { winners: pool.slice(0, slots), losers: pool.slice(slots), drawn: true };
}
