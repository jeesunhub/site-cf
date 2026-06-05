const db = require('../db');

db.all("SELECT id, login_id, role, status FROM users", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.table(rows);
});
