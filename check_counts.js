const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');
const tables = ['users', 'buildings', 'rooms', 'advertisements', 'images'];

async function check() {
    for (const table of tables) {
        try {
            const row = await new Promise((resolve, reject) => {
                db.get(`SELECT count(*) as count FROM ${table}`, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            console.log(`${table}: ${row.count}`);
        } catch (e) {
            console.log(`${table}: Error (${e.message})`);
        }
    }
    db.close();
}
check();
