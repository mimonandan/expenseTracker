import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidClockTime, normalizeClockTime, stepClockTime } from './clock.ts';

test('clock values accept 00:00 and 23:59 and reject out-of-range values', () => {
  assert.equal(isValidClockTime('00:00'), true);
  assert.equal(isValidClockTime('23:59'), true);
  assert.equal(isValidClockTime('24:00'), false);
  assert.equal(isValidClockTime('12:60'), false);
  assert.equal(isValidClockTime('9:05'), false);
  assert.equal(isValidClockTime(null), false);
});

test('clock controls wrap hours and minutes independently across boundaries', () => {
  assert.equal(stepClockTime('23:59', 'hour', 1), '00:59');
  assert.equal(stepClockTime('00:59', 'hour', -1), '23:59');
  assert.equal(stepClockTime('23:59', 'minute', 1), '23:00');
  assert.equal(stepClockTime('00:00', 'minute', -1), '00:59');
  assert.equal(stepClockTime('invalid', 'hour', 1), '09:00');
});

test('invalid saved clock values recover to safe defaults', () => {
  assert.equal(normalizeClockTime('24:30', '07:00'), '07:00');
  assert.equal(normalizeClockTime('21:05', '07:00'), '21:05');
  assert.equal(normalizeClockTime('08:30', 'invalid'), '08:30');
  assert.equal(normalizeClockTime(null, 'invalid'), '08:00');
});
