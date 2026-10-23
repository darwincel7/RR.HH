import { describe, it, expect } from 'vitest';
import { isPastedInsert, formatDuration, readIntegrity, MAX_TYPED_INSERT } from './testIntegrity';

describe('isPastedInsert', () => {
  it('lets typing through, a swiped word included', () => {
    expect(isPastedInsert('Atendería', 'Atendería al')).toBe(false);
    expect(isPastedInsert('Las ', 'Las responsabilidades ')).toBe(false);
    expect(isPastedInsert('texto largo', '')).toBe(false);
  });

  it('catches a block of text arriving at once', () => {
    const pasted = 'Le explicaría al cliente con calma cuál es la política de cambios.';
    expect(isPastedInsert('', pasted)).toBe(true);
    expect(isPastedInsert('Hola', 'Hola' + 'x'.repeat(MAX_TYPED_INSERT + 1))).toBe(true);
  });
});

describe('formatDuration', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(0)).toBe('menos de 1 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(130_000)).toBe('2 min 10 s');
    expect(formatDuration(18 * 60_000)).toBe('18 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min');
    expect(formatDuration(NaN)).toBe('menos de 1 s');
  });
});

describe('readIntegrity', () => {
  it('has nothing to say about tests taken before the record existed', () => {
    expect(readIntegrity(undefined)).toBeNull();
    expect(readIntegrity('x')).toBeNull();
  });

  it('reports a clean test with its duration', () => {
    expect(readIntegrity({ exits: 0, awayMs: 0, pasteBlocked: 0, durationMs: 18 * 60_000 }))
      .toEqual({ clean: true, lines: [], duration: 'Duración: 18 min' });
  });

  it('spells out exits and paste attempts', () => {
    const r = readIntegrity({ exits: 3, awayMs: 130_000, pasteBlocked: 1, durationMs: 0 });
    expect(r?.clean).toBe(false);
    expect(r?.lines).toEqual([
      'Salió de la pantalla del test 3 veces (2 min 10 s fuera en total).',
      'Intentó pegar o dictar texto 1 vez (bloqueado).',
    ]);
    expect(r?.duration).toBe('');
  });

  it('ignores junk counters instead of showing them', () => {
    expect(readIntegrity({ exits: -4, awayMs: 'mucho', pasteBlocked: null })?.clean).toBe(true);
  });
});
