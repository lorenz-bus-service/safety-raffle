import { expect, it } from 'vitest';

// Deliberately failing, to confirm that the "protect main" rule blocks a merge. Never merge this.
it('fails on purpose', () => {
  expect(1).toBe(2);
});
