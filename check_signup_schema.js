const db = require('./db');
const tables = ['users', 'message_box', 'messages', 'message_recipient', 'room_tenant', 'landlord_buildings'];
tables.forEach(table => {
    db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
        if (err) console.error(err);
        else console.log(`${table} schema:`, rows);
    });
});
