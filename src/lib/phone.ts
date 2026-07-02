/**
 * Canonical phone form used to reliably match an inbound WhatsApp message (whose
 * JID is digits like "18091234567") with a stored candidate phone that may have
 * been typed as "809-123-4567", "(809) 123 4567", "8091234567", etc.
 *
 * Rule: strip everything non-digit; a bare 10-digit number is assumed Dominican
 * Republic / NANP and gets a leading "1". This mirrors the server's
 * formatWhatsAppNumber (minus the "@s.whatsapp.net" suffix).
 */
export function normalizePhone(raw: string | number | undefined | null): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '1' + digits;
  return digits;
}
