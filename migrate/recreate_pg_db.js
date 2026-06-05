const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
});

async function recreateDatabase() {
    try {
        console.log('Connecting to PostgreSQL...');
        const client = await pool.connect();

        try {
            console.log('Dropping all existing tables in public schema...');
            // This query generates DROP TABLE statements for all tables in the public schema
            const dropQuery = `
                DO $$ DECLARE
                    r RECORD;
                BEGIN
                    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                        EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                    END LOOP;
                END $$;
            `;
            await client.query(dropQuery);
            console.log('All tables dropped.');

            console.log('Reading schema_pg.sql...');
            const schemaSql = fs.readFileSync(path.join(__dirname, 'schema_pg.sql'), 'utf8');

            console.log('Applying new schema...');
            await client.query(schemaSql);
            console.log('Schema applied successfully.');

            console.log('Seeding admin user...');
            const colors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            const seedSql = `INSERT INTO users (login_id, password, nickname, role, approved, status, color) VALUES ('admin', 'admin', 'admin', 'admin', 1, '승인', '${randomColor}')`;
            await client.query(seedSql);
            console.log('Default admin user created.');

        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error during database recreation:', err);
    } finally {
        await pool.end();
    }
}

recreateDatabase();
