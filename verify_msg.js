const db = require('./db');
db.get("SELECT * FROM message_box WHERE related_id = 18 AND related_table = 'advertisements'", [], (err, row) => {
    if (err) console.error(err);
    else {
        console.log('Message Box Entry:', row);
        if (row) {
            db.all("SELECT * FROM message_recipient WHERE message_id = ?", [row.id], (err2, rows) => {
                if (err2) console.error(err2);
                else console.log('Recipients Count:', rows.length);
                process.exit();
            });
        } else {
            process.exit();
        }
    }
});
