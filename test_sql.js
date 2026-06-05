const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('sugar.db');
const type = 'info';
const category = '친절한 부동산';
const viewer_role = 'tenant';
const v_id = 1;

let query = `
    SELECT a.*, 
        u.nickname as owner_name, u.login_id as owner_login_id, u.id as owner_id,
        CASE 
            WHEN a.related_table = 'room' THEN b.name 
            WHEN a.related_table = 'contract' THEN bc.name
            WHEN a.related_table = 'item' THEN b_item.name
            ELSE NULL 
        END as building,
        CASE 
            WHEN a.related_table = 'room' THEN b.name 
            WHEN a.related_table = 'contract' THEN bc.name
            WHEN a.related_table = 'item' THEN b_item.name
            ELSE NULL 
        END as building_name,
        COALESCE(r.room_number, rc.room_number) as room_number,
        COALESCE(r.deposit, c.deposit) as deposit,
        COALESCE(r.rent, c.monthly_rent) as rent,
        COALESCE(r.management_fee, c.maintenance_fee) as management_fee,
        c.cleaning_fee as cleaning_fee,
        COALESCE(r.available_date, CAST(c.contract_start_date AS TEXT)) as available_date,
        COALESCE(r.building_id, rc.building_id) as building_id,
        (SELECT image_url FROM images WHERE related_id = a.id AND related_table = 'advertisements' LIMIT 1) as main_image
    FROM advertisements a
    LEFT JOIN users u ON a.created_by = u.id
    LEFT JOIN rooms r ON a.related_id = r.id AND a.related_table = 'room'
    LEFT JOIN buildings b ON r.building_id = b.id
    LEFT JOIN contracts c ON a.related_id = c.id AND a.related_table = 'contract'
    LEFT JOIN rooms rc ON c.room_id = rc.id
    LEFT JOIN buildings bc ON rc.building_id = bc.id
    LEFT JOIN items i ON a.related_id = i.id AND a.related_table = 'item'
    LEFT JOIN buildings b_item ON i.building_id = b_item.id
`;

let params = [];
let whereClauses = [];

if (type) {
    whereClauses.push("a.related_table = ? ");
    params.push(type);
}
if (category) {
    whereClauses.push("a.category = ? ");
    params.push(category);
}

// Mimic visibility logic for tenant
whereClauses.push("(a.target_id IS NULL OR a.target_id = (SELECT r.building_id FROM rooms r JOIN room_tenant rt ON r.id = rt.room_id WHERE rt.tenant_id = ? LIMIT 1))");
params.push(v_id);

if (whereClauses.length > 0) {
    query += " WHERE " + whereClauses.join(" AND ");
}

db.all(query, params, (err, rows) => {
    if (err) {
        console.error("SQL Error:", err);
    } else {
        console.log("Success, rows found:", rows.length);
    }
    db.close();
});
