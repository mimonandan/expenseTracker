import { readFile } from 'node:fs/promises';
import { pool } from './db.js';

try {
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  const migration = await readFile(new URL('../migrations/001_user_scoping.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  const transactionTypes = await readFile(new URL('../migrations/005_transaction_types.sql', import.meta.url), 'utf8');
  await pool.query(transactionTypes);
  console.log('Database schema is ready.');
} catch (error) {
  console.error('Could not set up the database:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
