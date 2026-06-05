const fs = require('fs');
const file = 'server.js';
let content = fs.readFileSync(file, 'utf8');

// Use a regex that is less sensitive to whitespace
const targetPart = /\/\/ Check duplicate user \(phone \+ DOB\)\s+db\.get\('SELECT id FROM users WHERE phone_number = \? AND birth_date = \?', \[cleanPhone, birth_date\], \(err, row\) => \{/g;

const replacementPart = `// Check duplicate user (phone + DOB)
        db.get('SELECT id, status FROM users WHERE phone_number = ? AND birth_date = ?', [cleanPhone, birth_date], (err, row) => {`;

if (content.match(targetPart)) {
    content = content.replace(targetPart, replacementPart);

    // Now replace the dupe check
    content = content.replace(/if \(row\) return res\.status\(400\)\.json\(\{ error: 'USER_EXISTS' \}\);/,
        "if (row && row.status === '승인') return res.status(400).json({ error: 'USER_EXISTS' });");

    // Replace the Insert with a check
    const insertPattern = /db\.run\(`INSERT INTO users\(login_id, password, nickname, birth_date, phone_number, role, approved, status, color\) VALUES\(\?, \?, \?, \?, \?, \?, 0, '신청', \?\)`,\s+\[login_id, password, nickname, birth_date, cleanPhone, role, randomColor\],\s+async function \(err\) \{/;

    const insertReplacement = `const finalSignup = (userId) => {
                const newUserId = userId;
                const callback = async function(err) {`;

    // This is getting complicated with logic flow. Let's just rewrite the whole block carefully.
}

// Second attempt: Rewrite the whole block from 928 to 1018
const startMarker = "// Check duplicate user (phone + DOB)";
const endMarker = "res.json({ message: 'Signup successful', userId: newUserId });";

// I'll use a simpler script to just replace the lines I want.
