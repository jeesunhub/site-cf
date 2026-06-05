const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');

const query = `
    SELECT a.*, 
    CASE 
        WHEN a.related_table = 'room' THEN r.building_id 
        WHEN a.related_table = 'contract' THEN rc.building_id
        ELSE NULL
    END as room_building_id
    FROM advertisements a
    LEFT JOIN rooms r ON a.related_id = r.id AND a.related_table = 'room'
    LEFT JOIN contracts c ON a.related_id = c.id AND a.related_table = 'contract'
    LEFT JOIN rooms rc ON c.room_id = rc.id
    LIMIT 5
`;

db.all(query, [], (err, rows) => {
    if (err) console.error(err);
    console.log(JSON.stringify(rows, null, 2));
    db.close();
});
