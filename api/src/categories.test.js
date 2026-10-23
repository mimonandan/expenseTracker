import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCategory, inferCategory } from './categories.js';

test('dynamic categories use merchant and description evidence', () => {
  assert.equal(inferCategory('Weekly shop', 'Auto-detect', 'Zepto'), 'Groceries');
  assert.equal(inferCategory('Subscription renewal', 'Auto-detect', 'Cult.fit'), 'Health & fitness');
  assert.equal(inferCategory('Ride completed', 'Auto-detect', 'Rapido'), 'Transport');
});

test('unknown merchant and description safely fall back to Other', () => {
  assert.equal(inferCategory('Payment completed', 'Auto-detect', 'Acme Widgets'), 'Other');
});

test('AI or user-provided categories can be merchant-specific and are sanitized', () => {
  assert.equal(inferCategory('Payment completed', 'Pet care', 'Paw House'), 'Pet care');
  assert.equal(cleanCategory('  Local\u0000   Services  '), 'Local Services');
  assert.equal(cleanCategory('x'.repeat(41)), null);
  assert.equal(cleanCategory('  '), null);
  assert.equal(cleanCategory('---'), null);
});
