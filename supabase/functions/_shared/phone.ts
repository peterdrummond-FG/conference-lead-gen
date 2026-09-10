// Normalizes a rep-entered phone number (any US-style formatting) to the
// same E.164 shape Twilio's own `From` field arrives in (see
// twilio-webhook/index.ts), so a reps.phone_number row set from the Setup
// page's plain "(936) 218-1311"-style input still matches a texted-in
// card's sender phone later. Returns null for anything that isn't a
// plausible 10 or 11-digit US number.
export function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
