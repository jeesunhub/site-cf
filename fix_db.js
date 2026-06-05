const db = require('./db');
db.serialize(() => {
    db.run("UPDATE invoices SET billing_month = REPLACE(billing_month, ' ', ''), due_date = REPLACE(due_date, ' ', '')", function (err) {
        if (err) console.error(err);
        else console.log('Fixed', this.changes, 'rows');
    });
});
setTimeout(() => process.exit(), 1000);
