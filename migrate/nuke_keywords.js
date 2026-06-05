const db = require('../db');

db.run("DELETE FROM contract_keywords", [], (err) => {
    if (err) console.error(err);
    else console.log("All keywords deleted.");
    process.exit();
});
