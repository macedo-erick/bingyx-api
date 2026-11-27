import { describe, expect, it } from 'vitest';

import { FREE } from './card-grid';
import { completes, missingFor } from './patterns';

// Rows read B I N G O:
//   1 16 31 46 61
//   2 17 32 47 62
//   3 18  · 48 63
//   4 19 34 49 64
//   5 20 35 50 65
// prettier-ignore
const GRID = [
  1, 16, 31, 46, 61,
  2, 17, 32, 47, 62,
  3, 18, FREE, 48, 63,
  4, 19, 34, 49, 64,
  5, 20, 35, 50, 65,
];

const drawn = (...balls: number[]) => new Set(balls);

describe('a line', () => {
  it('closes when every number of one row is drawn', () => {
    expect(completes(GRID, drawn(2, 17, 32, 47, 62), 'line')).toBe(true);
  });

  it('counts the free centre as already drawn', () => {
    expect(completes(GRID, drawn(3, 18, 48, 63), 'line')).toBe(true);
  });

  it('stays open while any number of every row is missing', () => {
    expect(completes(GRID, drawn(2, 17, 32, 47), 'line')).toBe(false);
    expect(missingFor(GRID, drawn(2, 17, 32, 47), 'line')).toBe(1);
  });

  it('is not made of numbers spread over different rows', () => {
    expect(completes(GRID, drawn(1, 17, 48, 64, 65), 'line')).toBe(false);
  });
});

describe('a column', () => {
  it('closes when one letter is fully drawn', () => {
    expect(completes(GRID, drawn(1, 2, 3, 4, 5), 'column')).toBe(true);
  });

  it('needs only four balls in the N column, around the free centre', () => {
    expect(completes(GRID, drawn(31, 32, 34, 35), 'column')).toBe(true);
  });

  it('is not a line', () => {
    expect(completes(GRID, drawn(1, 2, 3, 4, 5), 'line')).toBe(false);
  });
});

describe('a diagonal', () => {
  it('closes corner to corner either way', () => {
    expect(completes(GRID, drawn(1, 17, 49, 65), 'diagonal')).toBe(true);
    expect(completes(GRID, drawn(61, 47, 19, 5), 'diagonal')).toBe(true);
  });

  it('stays open with a corner missing', () => {
    expect(missingFor(GRID, drawn(1, 17, 49), 'diagonal')).toBe(1);
  });
});

describe('a full card', () => {
  it('needs all twenty-four numbers', () => {
    const all = GRID.filter((value) => value !== FREE);

    expect(completes(GRID, new Set(all), 'full')).toBe(true);
    expect(missingFor(GRID, new Set(all.slice(1)), 'full')).toBe(1);
  });

  it('does not count balls that are not on the card', () => {
    expect(missingFor(GRID, drawn(70, 71, 72), 'full')).toBe(24);
  });
});

describe('a card without a free centre', () => {
  it('needs the centre number too', () => {
    const grid = [...GRID];

    grid[12] = 33;

    expect(completes(grid, drawn(3, 18, 48, 63), 'line')).toBe(false);
    expect(completes(grid, drawn(3, 18, 33, 48, 63), 'line')).toBe(true);
  });
});
