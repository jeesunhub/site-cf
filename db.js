const sqlite3 = require('sqlite3').verbose();
require('dotenv').config(); // Load environment variables from .env if present
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const isRender = !!process.env.RENDER;
const databaseUrl = process.env.DATABASE_URL;

let db;

// SQL Conversion Helper
function convertSqlToPg(sql) {
    let pIdx = 1;
    // Replace ? with $1, $2, ...
    let newSql = sql.replace(/\?/g, () => `$${pIdx++}`);

    // Replace SQLite specific functions
    newSql = newSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    newSql = newSql.replace(/date\('now'\)/gi, 'CURRENT_DATE');

    // Replace SQLite REPLACE(..., ' ', '') with Postgres REGEXP_REPLACE(..., '\s+', '', 'g')
    newSql = newSql.replace(/REPLACE\((.*?),\s*' ',\s*''\)/gi, "REGEXP_REPLACE($1, '\\s+', '', 'g')");

    // Handle shift logic from server.js: date(billing_month || '-01', '${direction} month')
    if (newSql.includes("date(bill_month || '-01'") || newSql.includes("date(billing_month || '-01'")) {
        newSql = newSql.replace(
            /date\((billing?_month) \|\| '-01', '(-?\d+) month'\)/g,
            "($1 || '-01')::date + interval '$2 month'"
        );
    }

    // Replace GROUP_CONCAT with STRING_AGG
    newSql = newSql.replace(/GROUP_CONCAT\s*\(\s*DISTINCT\s*DATE\s*\(\s*([^)]+)\s*\)\s*\)/gi, "STRING_AGG(DISTINCT TO_CHAR($1, 'YYYY-MM-DD'), ',')");
    // Handle GROUP_CONCAT(col, 'delimiter') -> STRING_AGG(col, 'delimiter')
    newSql = newSql.replace(/GROUP_CONCAT\(([^,]+),\s*(['"].*?['"])\)/gi, "STRING_AGG($1, $2)");
    newSql = newSql.replace(/GROUP_CONCAT\((.*?)\)/gi, "STRING_AGG($1, ',')");

    return newSql;
}

function processRow(row) {
    if (!row) return row;
    for (const key in row) {
        if (row[key] instanceof Date) {
            const d = row[key];
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');

            if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
                // Return YYYY-MM-DD for date-only values
                row[key] = `${y}-${m}-${day}`;
            } else {
                // Return ISO string for timestamps to preserve timezone
                row[key] = d.toISOString();
            }
        } else if (typeof row[key] === 'object' && row[key] !== null) {
            processRow(row[key]);
        }
    }
    return row;
}

if (databaseUrl) {
    // PostgreSQL Mode
    console.log('Using PostgreSQL database');
    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false }
    });

    // Test connection
    pool.query('SELECT NOW()', (err, res) => {
        if (err) console.error('PG Connection Error:', err);
        else console.log('Connected to PG:', res.rows[0]);
    });

    // Wrapper to mimic sqlite3 API
    db = {
        pool,
        serialize: (fn) => fn(),
        get: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            sql = convertSqlToPg(sql);
            pool.query(sql, params, (err, res) => {
                if (err) {
                    console.error('PG SQL Error (get):', err.message, '| SQL:', sql);
                    return cb ? cb(err) : null;
                }
                const row = res.rows[0] || null;
                cb && cb(null, processRow(row));
            });
        },
        all: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            sql = convertSqlToPg(sql);
            pool.query(sql, params, (err, res) => {
                if (err) {
                    console.error('PG SQL Error (all):', err.message, '| SQL:', sql);
                    return cb ? cb(err) : null;
                }
                const rows = res.rows || [];
                rows.forEach(processRow);
                cb && cb(null, rows);
            });
        },
        run: function (sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            let isInsert = /^\s*insert/i.test(sql);
            sql = convertSqlToPg(sql);

            if (isInsert && !/returning/i.test(sql)) {
                sql += ' RETURNING id';
            }

            pool.query(sql, params, (err, res) => {
                const context = { lastID: 0, changes: 0 };
                if (!err) {
                    if (isInsert && res.rows.length > 0) {
                        context.lastID = res.rows[0].id;
                    }
                    context.changes = res.rowCount;
                }
                if (cb) cb.call(context, err);
            });
        },
        exec: (sql, cb) => {
            pool.query(sql, (err) => cb && cb(err));
        }
    };

    // Init PG Schema
    const SCHEMA_PG_PATH = path.join(__dirname, 'migrate', 'schema_pg.sql');
    if (fs.existsSync(SCHEMA_PG_PATH)) {
        const schema = fs.readFileSync(SCHEMA_PG_PATH, 'utf8');
        pool.query(schema, (err) => {
            if (err) console.error('Error initializing PG schema:', err.message);
            else {
                console.log('PG Database schema initialized.');
                seedAdmin();
            }
        });
    }

} else {
    // SQLite Mode
    const DB_PATH = isRender
        ? "/data/sugar.db"
        : path.join(__dirname, "sugar.db");

    if (!isRender) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    const SCHEMA_PATH = path.join(__dirname, 'migrate', 'schema.sql');

    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
        } else {
            console.log('Connected to the SQLite database:', DB_PATH);
            db.run("PRAGMA foreign_keys = ON;"); // Enable foreign keys
            const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
            db.exec(schema, (err) => {
                if (err) console.error('Error initializing schema:', err.message);
                else {
                    console.log('Database schema initialized.');
                    seedAdmin();
                }
            });
        }
    });
}

// Helper to rename table if it exists
function renameTableIfExists(oldName, newName, callback) {
    if (databaseUrl) return callback && callback();
    db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [oldName], (err, row) => {
        if (!err && row) {
            console.log(`Renaming table '${oldName}' to '${newName}'...`);
            db.run(`ALTER TABLE ${oldName} RENAME TO ${newName}`, (alterErr) => {
                if (alterErr) console.error(`Failed to rename '${oldName}':`, alterErr.message);
                else console.log(`Renamed '${oldName}' to '${newName}'.`);
                if (callback) callback();
            });
        } else {
            if (callback) callback();
        }
    });
}

function ensureColumns() {
    if (databaseUrl) return; // Managed by schema_pg.sql in Postgres
    // Now ensure columns in the new/existing tables
    const columns = [
        { table: 'users', name: 'noti', type: 'INTEGER DEFAULT 0' },
        { table: 'users', name: 'approved', type: 'INTEGER DEFAULT 0' },
        { table: 'users', name: 'status', type: "TEXT DEFAULT '신청'" },
        { table: 'applicants', name: 'created_at', type: "DATETIME DEFAULT CURRENT_TIMESTAMP" },
        { table: 'advertisements', name: 'target_id', type: 'INTEGER' },
        { table: 'advertisements', name: 'category', type: 'TEXT' },
        { table: 'advertisements', name: 'is_anonymous', type: 'INTEGER DEFAULT 0' },
        { table: 'message_box', name: 'title', type: 'TEXT' },
        { table: 'message_box', name: 'message_id', type: 'INTEGER' },
        { table: 'messages', name: 'read_at', type: 'DATETIME' },
        { table: 'messages', name: 'sender_id', type: 'INTEGER' },
        { table: 'messages', name: 'message_box_id', type: 'INTEGER' },
        { table: 'room_events', name: 'photo', type: 'TEXT' },
    ];

    // Create item_users table if it doesn't exist (Legacy Fix)
    const createItemUsersSql = `
        CREATE TABLE IF NOT EXISTS item_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            start_date DATE,
            end_date DATE,
            memo TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `;
    db.run(createItemUsersSql);

    columns.forEach(col => {
        const testSql = `SELECT ${col.name} FROM ${col.table} LIMIT 1`;
        db.get(testSql, (err) => {
            if (err) {
                // console.log(`Column '${col.name}' missing in '${col.table}'. Attempting to add...`);
                // Suppressed log to avoid noise, or keep it if desired
                const alterSql = `ALTER TABLE ${col.table} ADD COLUMN ${col.name} ${col.type}`;
                db.run(alterSql, (alterErr) => {
                    if (alterErr) {
                        // console.error(`Failed to add '${col.name}' column to '${col.table}':`, alterErr.message);
                    } else {
                        console.log(`Added '${col.name}' column to ${col.table} table.`);
                        if (col.name === 'approved' && col.table === 'users') {
                            // Update admin to be approved by default
                            db.run("UPDATE users SET approved = 1 WHERE login_id = 'admin'");
                        }
                    }
                });
            }
        });
    });
}

function seedAdmin(cb) {
    // Check if admin exists
    const checkSql = "SELECT id FROM users WHERE login_id = ?";
    db.get(checkSql, ['admin'], (err, row) => {
        if (err) {
            console.error('Error checking admin user:', err.message);
            if (cb) cb(err);
            return;
        }
        if (!row) {
            console.log('Creating default admin user...');
            const colors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            const insertSql = "INSERT INTO users (login_id, password, nickname, role, approved, status, color) VALUES (?, ?, ?, ?, 1, '승인', ?)";
            db.run(insertSql, ['admin', 'admin', 'admin', 'admin', randomColor], (err) => {
                if (err) console.error('Error creating admin user:', err.message);
                else {
                    console.log('Default admin user created.');
                    ensureColumns();
                }
                if (cb) cb(err);
            });
        } else {
            ensureColumns();
            if (cb) cb(null);
        }
    });
}

db.resetDatabase = function (cb) {
    console.log('Resetting database...');
    if (databaseUrl) {
        // PG Reset
        const dropQuery = `
            DO $$ DECLARE
                r RECORD;
            BEGIN
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                    EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
                END LOOP;
            END $$;
        `;
        db.pool.query(dropQuery, (err) => {
            if (err) return cb && cb(err);
            const SCHEMA_PG_PATH = path.join(__dirname, 'migrate', 'schema_pg.sql');
            const schema = fs.readFileSync(SCHEMA_PG_PATH, 'utf8');
            db.pool.query(schema, (err2) => {
                if (err2) return cb && cb(err2);
                seedAdmin(cb);
            });
        });
    } else {
        // SQLite Reset
        db.serialize(() => {
            db.run("PRAGMA foreign_keys = OFF;");
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                if (err) return cb && cb(err);
                let dropCount = 0;
                const tablesToDrop = rows.filter(r => r.name !== 'sqlite_sequence');
                if (tablesToDrop.length === 0) {
                    const SCHEMA_PATH = path.join(__dirname, 'migrate', 'schema.sql');
                    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
                    db.exec(schema, (err) => {
                        seedAdmin(cb);
                    });
                    return;
                }
                tablesToDrop.forEach(row => {
                    db.run(`DROP TABLE IF EXISTS ${row.name}`, () => {
                        dropCount++;
                        if (dropCount === tablesToDrop.length) {
                            const SCHEMA_PATH = path.join(__dirname, 'migrate', 'schema.sql');
                            const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
                            db.exec(schema, (err) => {
                                db.run("PRAGMA foreign_keys = ON;");
                                seedAdmin(cb);
                            });
                        }
                    });
                });
            });
        });
    }
};

module.exports = db;

