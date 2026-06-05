const db = require('../db');

db.all("SELECT * FROM contract_keywords", [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Current keywords in DB:", JSON.stringify(rows, null, 2));
    }
    process.exit();
});
