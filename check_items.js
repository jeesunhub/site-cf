const db = require('./db');
db.all("PRAGMA table_info(items)", [], (err, rows) => {
    if (err) console.error(err);
    else {
        console.log('--- Items table columns ---');
        rows.forEach(r => console.log(r.name));
    }
    process.exit();
});
