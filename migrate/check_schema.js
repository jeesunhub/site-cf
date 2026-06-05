const db = require('../db');
db.all("PRAGMA table_info(contract_keywords)", [], (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
    process.exit();
});
