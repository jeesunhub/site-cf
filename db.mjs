import { Pool } from '@neondatabase/serverless';

let pool;
let dbInstance;

function convertSqlToPg(sql) {
    let pIdx = 1;
    let newSql = sql.replace(/\?/g, () => `$${pIdx++}`);
    newSql = newSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    newSql = newSql.replace(/date\('now'\)/gi, 'CURRENT_DATE');
    newSql = newSql.replace(/REPLACE\((.*?),\s*' ',\s*''\)/gi, "REGEXP_REPLACE($1, '\\\\s+', '', 'g')");

    if (newSql.includes("date(bill_month || '-01'") || newSql.includes("date(billing_month || '-01'")) {
        newSql = newSql.replace(
            /date\((billing?_month) \|\| '-01', '(-?\d+) month'\)/g,
            "($1 || '-01')::date + interval '$2 month'"
        );
    }
    newSql = newSql.replace(/GROUP_CONCAT\s*\(\s*DISTINCT\s*DATE\s*\(\s*([^)]+)\s*\)\s*\)/gi, "STRING_AGG(DISTINCT TO_CHAR($1, 'YYYY-MM-DD'), ',')");
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
                row[key] = `${y}-${m}-${day}`;
            } else {
                row[key] = d.toISOString();
            }
        } else if (typeof row[key] === 'object' && row[key] !== null) {
            processRow(row[key]);
        }
    }
    return row;
}

export function initDb(databaseUrl) {
    if (dbInstance) return dbInstance;

    pool = new Pool({ connectionString: databaseUrl });

    dbInstance = {
        pool,
        serialize: (fn) => fn(),
        get: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            sql = convertSqlToPg(sql);
            pool.query(sql, params).then(res => {
                const row = res.rows[0] || null;
                cb && cb(null, processRow(row));
            }).catch(err => {
                console.error('PG SQL Error (get):', err.message, '| SQL:', sql);
                cb ? cb(err) : null;
            });
        },
        all: (sql, params, cb) => {
            if (typeof params === 'function') { cb = params; params = []; }
            sql = convertSqlToPg(sql);
            pool.query(sql, params).then(res => {
                const rows = res.rows || [];
                rows.forEach(processRow);
                cb && cb(null, rows);
            }).catch(err => {
                console.error('PG SQL Error (all):', err.message, '| SQL:', sql);
                cb ? cb(err) : null;
            });
        },
        run: function (sql, params, cb) {
            if (typeof params === 'function') { cb = params; params = []; }
            let isInsert = /^\\s*insert/i.test(sql);
            sql = convertSqlToPg(sql);
            if (isInsert && !/returning/i.test(sql)) {
                sql += ' RETURNING id';
            }
            pool.query(sql, params).then(res => {
                const context = { lastID: 0, changes: res.rowCount };
                if (isInsert && res.rows.length > 0) {
                    context.lastID = res.rows[0].id; // Assign to lastID
                }
                if (cb) cb.call(context, null);
            }).catch(err => {
                console.error('PG SQL Error (run):', err.message, '| SQL:', sql);
                if (cb) cb.call({ lastID: 0, changes: 0 }, err);
            });
        },
        exec: (sql, cb) => {
            pool.query(sql).then(() => cb && cb(null)).catch(err => cb && cb(err));
        }
    };
    return dbInstance;
}

export default dbInstance;
