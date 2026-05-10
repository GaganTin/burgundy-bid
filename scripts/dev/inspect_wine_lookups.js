import { Pool } from 'pg';
import fs from 'fs';

const env = fs.existsSync('.env') ? fs.readFileSync('.env','utf8') : '';
let m = env.match(/DATABASE_URL=(.*)/);
const DATABASE_URL = (m && m[1]) || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/winetracker';
const connectionString = DATABASE_URL.replace(/^postgresql\+psycopg2:\/\//,'postgres://');
const pool = new Pool({ connectionString });

(async () => {
  try {
    const r = await pool.query('SELECT batch_id, user_id, wine_name, vintage, size, status, created_date FROM wine_lookups ORDER BY created_date DESC LIMIT 200');
    console.log('Found rows:', r.rowCount);
    if (r.rowCount > 0) console.table(r.rows.slice(0,50));
    await pool.end();
  } catch (e) {
    console.error('DB error', e);
    await pool.end();
    process.exitCode = 1;
  }
})();