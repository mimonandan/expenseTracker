export type ClockUnit = 'hour' | 'minute';

export function isValidClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function normalizeClockTime(value: unknown, fallback: string): string {
  return isValidClockTime(value) ? value : (isValidClockTime(fallback) ? fallback : '08:00');
}

export function stepClockTime(value: string, unit: ClockUnit, delta: number): string {
  const [rawHour, rawMinute] = normalizeClockTime(value, '08:00').split(':').map(Number);
  const steps = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  const hour = unit === 'hour' ? (rawHour + steps % 24 + 24) % 24 : rawHour;
  const minute = unit === 'minute' ? (rawMinute + steps % 60 + 60) % 60 : rawMinute;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
