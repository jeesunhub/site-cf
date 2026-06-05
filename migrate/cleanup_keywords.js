const db = require('../db');

db.serialize(() => {
    // Delete rows where keyword looks like junk or is null
    db.run("DELETE FROM contract_keywords WHERE keyword IS NULL OR keyword = 'null' OR keyword = 'undefined' OR keyword LIKE '[%]'");
    console.log("Cleanup completed.");
    process.exit();
});
