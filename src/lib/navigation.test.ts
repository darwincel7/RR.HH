import { describe, it, expect } from 'vitest';
import { parentPath } from './navigation';

describe('parentPath', () => {
  it.each([
    ['/candidates/abc123', '/candidates'],
    ['/candidates/abc123/', '/candidates'],
    ['/vacancies/v1/kanban', '/vacancies'],
    ['/vacancies/v1/ranking', '/vacancies/v1/kanban'],
    ['/candidates', '/'],
    ['/vacancies', '/'],
    ['/settings', '/'],
    ['/', '/'],
  ])('%s → %s', (from, to) => {
    expect(parentPath(from)).toBe(to);
  });
});
