const db = require('./db.js');

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

console.log('Current month:', currentMonth);

db.run(`
    DELETE FROM invoices 
    WHERE billing_month > ? AND type = 'monthly_rent' AND status = '정산대기'
    AND id NOT IN (SELECT invoice_id FROM payment_allocation)
`, [currentMonth], function (err) {
    if (err) {
        console.error('Error deleting future invoices:', err.message);
    } else {
        console.log(`Deleted ${this.changes} future invoices.`);
    }
});
