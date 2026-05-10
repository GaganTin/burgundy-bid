import fs from 'fs';
import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const sql = fs.readFileSync(path.resolve(process.cwd(), 'migrations', 'create_tables.sql'), 'utf8');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Please set DATABASE_URL in your .env file');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });

async function run() {
  try {
    await client.connect();
    console.log('Connected to database, running migrations...');
    await client.query(sql);
    console.log('Migrations applied.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
