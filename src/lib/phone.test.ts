import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone';

/**
 * normalizePhone is the single canonical phone form in the whole app. It decides whether
 * an inbound WhatsApp reply gets linked to its candidate, and whether /api/apply spots a
 * duplicate application. A silent change here breaks both — and neither failure is loud:
 * replies just stop appearing and duplicates just pile up.
 */
describe('normalizePhone', () => {
  it('strips every non-digit character a recruiter might type', () => {
    // The same Dominican number, written the six ways it actually appears in the CVs.
    const forms = ['8091234567', '809-123-4567', '(809) 123 4567', '809.123.4567', '+1 809 123 4567', ' 1-809-123-4567 '];
    for (const form of forms) {
      expect(normalizePhone(form)).toBe('18091234567');
    }
  });

  it('adds the +1 country code to a bare 10-digit local number', () => {
    // 809 / 829 / 849 are the Dominican Republic's three area codes.
    expect(normalizePhone('8091234567')).toBe('18091234567');
    expect(normalizePhone('8291234567')).toBe('18291234567');
    expect(normalizePhone('8491234567')).toBe('18491234567');
  });

  it('leaves an already-prefixed number alone (no double country code)', () => {
    expect(normalizePhone('18091234567')).toBe('18091234567');
    expect(normalizePhone('+18091234567')).toBe('18091234567');
  });

  it('does not assume +1 for numbers that are not 10 digits', () => {
    // A foreign candidate's number must survive untouched; prefixing it with 1 would
    // send the WhatsApp message to a different country.
    expect(normalizePhone('+34600123456')).toBe('34600123456');   // España, 11 dígitos
    expect(normalizePhone('+52 55 1234 5678')).toBe('525512345678'); // México, 12 dígitos
  });

  it('returns an empty string for missing or digit-free input', () => {
    // Callers rely on '' (not a crash, not 'undefined') to mean "no usable phone".
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('sin teléfono')).toBe('');
  });

  it('accepts a number that arrived as a number, not a string', () => {
    // Firestore hands back whatever was written; an old doc may hold a numeric phone.
    expect(normalizePhone(8091234567)).toBe('18091234567');
  });

  it('is idempotent — normalizing an already-normalized number changes nothing', () => {
    // Candidate records get re-normalized on edits; a second pass must be a no-op or
    // the stored value would drift a digit at a time.
    const once = normalizePhone('809-123-4567');
    expect(normalizePhone(once)).toBe(once);
  });
});
