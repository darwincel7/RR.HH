import { describe, it, expect } from 'vitest';
import {
  expandVariations, countVariations, variationProblem, renderMessage, messageSeed, seededRandom, hashSeed,
} from './messageVariation';
import { DEFAULT_WA_TEMPLATES } from './whatsappTemplates';

/**
 * Variation is an anti-ban measure: a bulk move must NOT send the same text to everyone.
 * But it must stay deterministic per recipient — the outbox dedupes "identical message
 * already queued for this phone", and a random re-roll on retry would double-send.
 */

const first = () => 0;
const last = () => 0.9999;

describe('expandVariations', () => {
  it('picks one option per group', () => {
    expect(expandVariations('{Hola|Buenas} María', first)).toBe('Hola María');
    expect(expandVariations('{Hola|Buenas} María', last)).toBe('Buenas María');
  });

  it('never touches {{variables}}, even inside an option', () => {
    expect(expandVariations('{Hola {{primer_nombre}}|Buenas} — {{empresa}}', first)).toBe('Hola {{primer_nombre}} — {{empresa}}');
    expect(expandVariations('Hola {{nombre}}', first)).toBe('Hola {{nombre}}');
  });

  it('supports nested groups and empty options', () => {
    expect(expandVariations('{a|{b|c}}', last)).toBe('c');
    expect(expandVariations('Gracias{!| 🙂}', first)).toBe('Gracias!');
    expect(expandVariations('Gracias{| 🙂}', first)).toBe('Gracias');
  });

  it('leaves plain text and links alone', () => {
    const t = 'Completa el formulario: https://app.test/eval/abc?x=1';
    expect(expandVariations(t, first)).toBe(t);
  });
});

describe('countVariations', () => {
  it('multiplies independent groups and adds nested options', () => {
    expect(countVariations('sin variaciones')).toBe(1);
    expect(countVariations('{a|b} {c|d|e}')).toBe(6);
    expect(countVariations('{a|{b|c}}')).toBe(3);
    expect(countVariations('{a|a}')).toBe(1); // identical options are one text
  });

  it('every default template actually varies a lot', () => {
    for (const [stage, tpl] of Object.entries(DEFAULT_WA_TEMPLATES)) {
      expect(countVariations(tpl), stage).toBeGreaterThanOrEqual(16);
      expect(variationProblem(tpl), stage).toBeNull();
    }
  });
});

describe('variationProblem', () => {
  it('flags a brace that would reach the candidate verbatim', () => {
    expect(variationProblem('{Hola|Buenas {{nombre}}')).not.toBeNull();
    expect(variationProblem('Hola {{nombre}')).not.toBeNull();
    expect(variationProblem('Hola {{nombre}} {a|b}')).toBeNull();
  });
});

describe('renderMessage', () => {
  const vars = { nombre: 'MARIA DE LOS ANGELES PEREZ', vacante: 'Vendedor(a)', empresa: 'Darwin Cell' };

  it('fills variables and writes names like a person would', () => {
    expect(renderMessage('{Hola} {{primer_nombre}}, de {{empresa}} por {{vacante}}', vars, first))
      .toBe('{Hola} Maria, de Darwin Cell por Vendedor(a)'); // "{Hola}" has no "|": literal
    expect(renderMessage('{{nombre}}', vars, first)).toBe('Maria de los Angeles Perez');
  });

  it('never greets with the "Procesando: cv.pdf" placeholder and leaves no " ," behind', () => {
    expect(renderMessage('Hola {{primer_nombre}}, te escribimos', { nombre: 'Procesando: cv.pdf' }, first)).toBe('Hola, te escribimos');
  });

  it('keeps unknown placeholders visible instead of silently dropping them', () => {
    expect(renderMessage('Hola {{apodo}}', vars, first)).toBe('Hola {{apodo}}');
  });

  it('defaults an empty vacancy to "la vacante", as before', () => {
    expect(renderMessage('para {{vacante}}', {}, first)).toBe('para la vacante');
  });
});

describe('deterministic per recipient', () => {
  const tpl = DEFAULT_WA_TEMPLATES['Formulario etapa 2 enviado'];
  const vars = { nombre: 'Ana', vacante: 'Cajera', empresa: 'Darwin Cell', link: 'https://x/eval/1', fecha: 'jueves 15 de octubre' };

  it('the same recipient and notification always render the same text (retries dedupe)', () => {
    const a = renderMessage(tpl, vars, seededRandom(messageSeed('18095551234', 'Formulario etapa 2 enviado', vars)));
    const b = renderMessage(tpl, vars, seededRandom(messageSeed('18095551234', 'Formulario etapa 2 enviado', vars)));
    expect(a).toBe(b);
  });

  it('a bulk move of 20 candidates does not send 20 identical texts', () => {
    const texts = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const phone = `1809555${String(1000 + i)}`;
      texts.add(renderMessage(tpl, vars, seededRandom(messageSeed(phone, 'Formulario etapa 2 enviado', vars))));
    }
    expect(texts.size).toBeGreaterThanOrEqual(15);
  });

  it('hashSeed is stable and spreads nearby inputs', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('18095551000')).not.toBe(hashSeed('18095551001'));
  });
});
