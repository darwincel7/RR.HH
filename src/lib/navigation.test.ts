import { describe, it, expect } from 'vitest';
import { parentPath } from './navigation';

describe('parentPath', () => {
  it.each([
    ['/candidates/abc123', '/candidates'],
    ['/candidates/abc123/', '/candidates'],
    ['/vacancies/v1/kanban', '/vacancies'],
    ['/vacancies/v1/ranking', '/vacancies/v1/kanban'],
    ['/forms/tests/abc123', '/forms?seccion=tests'],
    ['/forms/tests/new', '/forms?seccion=tests'],
    ['/forms', '/'],
    ['/candidates', '/'],
    ['/vacancies', '/'],
    ['/settings', '/'],
    ['/', '/'],
  ])('%s → %s', (from, to) => {
    expect(parentPath(from)).toBe(to);
  });
});
