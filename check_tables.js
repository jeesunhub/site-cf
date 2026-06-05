const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');
db.all('SELECT DISTINCT related_table FROM images', [], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(JSON.stringify(rows, null, 2));
    db.close();
});
