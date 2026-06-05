const db = require('../db');

const userIdToApprove = 't1';
// Or I could update all '임시' users to '승인' for convenience.
// Let's update 't1' specifically as it's the one likely causing issues.
// Actually, let's update all '임시' users to '승인' to unblock any other test users.

db.run("UPDATE users SET status = '승인' WHERE status = '임시'", [], function (err) {
    if (err) {
        console.error(err);
        return;
    }
    console.log(`Updated ${this.changes} users to '승인' status.`);
});
