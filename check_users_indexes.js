const db = require('./db');
db.all('PRAGMA index_list(users)', [], (err, rows) => {
    if (err) return console.error(err);
    console.log('users indexes:', rows);
    if (!rows) return;
    rows.forEach(r => {
        db.all(`PRAGMA index_info(${r.name})`, [], (e, i) => {
            if (e) return console.error(e);
            console.log(`index info for ${r.name}:`, i);
        });
    });
});
