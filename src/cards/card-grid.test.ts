import { describe, expect, it } from 'vitest';

import {
  BALLS_PER_COLUMN,
  CardSpaceExhaustedError,
  FREE,
  type Random,
  generateGrid,
  generateUniqueGrid,
  gridKey,
  letterOf,
} from './card-grid';

function column(grid: readonly number[], index: number): number[] {
  return [0, 1, 2, 3, 4].map((row) => grid[row * 5 + index] ?? -1);
}

const alwaysFirst: Random = () => 0;

describe('a generated card', () => {
  it('has twenty-five cells', () => {
    expect(generateGrid(true)).toHaveLength(25);
    expect(generateGrid(false)).toHaveLength(25);
  });

  it('keeps every column inside its own letter, B 1-15 through O 61-75', () => {
    for (let run = 0; run < 200; run++) {
      const grid = generateGrid(false);

      for (let index = 0; index < 5; index++) {
        const low = index * BALLS_PER_COLUMN + 1;

        for (const value of column(grid, index)) {
          expect(value).toBeGreaterThanOrEqual(low);
          expect(value).toBeLessThanOrEqual(low + BALLS_PER_COLUMN - 1);
        }
      }
    }
  });

  it('never repeats a number', () => {
    for (let run = 0; run < 200; run++) {
      const numbers = generateGrid(true).filter((value) => value !== FREE);

      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });

  it('reads each column top to bottom in ascending order, like a printed card', () => {
    for (let run = 0; run < 50; run++) {
      const grid = generateGrid(false);

      for (let index = 0; index < 5; index++) {
        const values = column(grid, index);

        expect(values).toEqual([...values].sort((a, b) => a - b));
      }
    }
  });

  it('marks the centre as free when the game says so, and only the centre', () => {
    const grid = generateGrid(true);

    expect(grid[12]).toBe(FREE);
    expect(grid.filter((value) => value === FREE)).toHaveLength(1);
    expect(column(grid, 2).filter((value) => value !== FREE)).toEqual(
      [...column(grid, 2).filter((value) => value !== FREE)].sort((a, b) => a - b),
    );
  });

  it('puts a number in the centre when the game has no free space', () => {
    for (let run = 0; run < 50; run++) {
      expect(generateGrid(false)).not.toContain(FREE);
    }
  });

  it('follows the random source it is given', () => {
    expect(column(generateGrid(false, alwaysFirst), 0)).toEqual([1, 2, 3, 4, 5]);
    expect(column(generateGrid(true, alwaysFirst), 2)).toEqual([31, 32, FREE, 33, 34]);
  });
});

describe('a card unique within its game', () => {
  it('is drawn again until it differs from every card already handed out', () => {
    const taken = new Set([gridKey(generateGrid(false, alwaysFirst))]);
    let calls = 0;
    const firstThenRandom: Random = (max) => (calls++ < 25 ? 0 : Math.floor(Math.random() * max));

    const grid = generateUniqueGrid(false, taken, firstThenRandom);

    expect(taken.has(gridKey(grid))).toBe(false);
  });

  it('gives up rather than loop forever when no new card can be found', () => {
    const taken = new Set([gridKey(generateGrid(false, alwaysFirst))]);

    expect(() => generateUniqueGrid(false, taken, alwaysFirst, 3)).toThrow(CardSpaceExhaustedError);
  });
});

describe('the letter of a ball', () => {
  it('follows the columns of the card', () => {
    expect(letterOf(1)).toBe('B');
    expect(letterOf(15)).toBe('B');
    expect(letterOf(16)).toBe('I');
    expect(letterOf(45)).toBe('N');
    expect(letterOf(60)).toBe('G');
    expect(letterOf(75)).toBe('O');
  });

  it('refuses a number that is not a ball', () => {
    expect(() => letterOf(0)).toThrow(RangeError);
    expect(() => letterOf(76)).toThrow(RangeError);
  });
});
