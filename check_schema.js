const db = require('./db');
db.all("PRAGMA table_info(advertisements)", [], (err, rows) => {
    if (err) console.error(err);
    else console.log('Advertisements table info:', rows);
});
db.all("PRAGMA table_info(items)", [], (err, rows) => {
    if (err) console.error(err);
    else console.log('Items table info:', rows);
});
db.all("PRAGMA table_info(message_box)", [], (err, rows) => {
    if (err) console.error(err);
    else console.log('Message_box table info:', rows);
});
