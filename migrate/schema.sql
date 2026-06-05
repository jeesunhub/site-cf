-- SQLite Schema for Tenant and Landlord Management System

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login_id TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,

    nickname TEXT,
    color TEXT,
    photo_path TEXT,

    role TEXT NOT NULL CHECK (role IN ('tenant', 'landlord', 'admin')),

    birth_date TEXT,
    phone_number TEXT,
    noti INTEGER DEFAULT 0,
    approved INTEGER DEFAULT 0,
    status TEXT DEFAULT '신청' CHECK (status IN ('임시', '신청', '승인', '종료')),

    title TEXT,
    description TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_box (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER,
    message_id INTEGER, -- Points to messages.id
    target TEXT CHECK(target IN ('direct', 'to_all', 'to_building', 'to_landlords')),
    category TEXT CHECK(category IN ('가입신청', '방있어요', '물품공유', '시스템')),
    related_id INTEGER,
    related_table TEXT,
    title TEXT,
    confirmed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_recipient (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES message_box(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    memo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS building_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS landlord_buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    landlord_id INTEGER NOT NULL,
    building_id INTEGER NOT NULL,
    FOREIGN KEY (landlord_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL,
    room_number TEXT NOT NULL,
    memo TEXT,
    building TEXT,
    floor INTEGER,
    unit TEXT,
    status INTEGER DEFAULT 0,
    deposit INTEGER,
    rent INTEGER,
    management_fee INTEGER,
    available_date TEXT,
    FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'open', -- 'open', 'closed', 'completed'
    building_id INTEGER,
    belongs_to INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
    FOREIGN KEY (belongs_to) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    start_date DATE,
    end_date DATE,
    status TEXT DEFAULT '사용중' CHECK (status IN ('사용중', '폐기')),
    memo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_tenant (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE,

    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    room_id INTEGER NOT NULL,
    tenant_id INTEGER,

    payment_type TEXT NOT NULL CHECK (payment_type IN ('prepaid', 'postpaid')),
    
    contract_start_date DATE,
    contract_end_date DATE,
    move_out_date DATE,

    deposit INTEGER NOT NULL,
    monthly_rent INTEGER NOT NULL,
    maintenance_fee INTEGER NOT NULL,
    cleaning_fee INTEGER DEFAULT 0,
    extra_fee INTEGER DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    keyword TEXT,
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- deposit, monthly_rent, maintenance_fee, cleaning_fee, extra_fee
    billing_month TEXT,
    due_date DATE,
    amount INTEGER NOT NULL,
    status TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    contract_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    paid_at DATETIME NOT NULL,
    type TEXT NOT NULL, -- deposit, monthly_rent, maintenance_fee, cleaning_fee, extra_fee
    raw_text TEXT,
    memo TEXT,

    FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_allocation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    payment_id INTEGER NOT NULL,
    invoice_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,

    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    event_date DATE NOT NULL,
    memo TEXT,
    photo TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS advertisements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    related_id INTEGER,
    related_table TEXT, -- 'item' or 'room'/'contract'
    title TEXT,
    description TEXT,
    price INTEGER,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT, -- 'advertising', 'drawing', 'completed'
    target_id INTEGER,
    category TEXT,
    is_anonymous INTEGER DEFAULT 0,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    advertisement_id INTEGER NOT NULL,
    status TEXT, -- 'applying', 'won', 'lost'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    related_id INTEGER,
    image_url TEXT,
    is_main INTEGER DEFAULT 0,
    related_table TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    related_table TEXT,
    related_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    memo TEXT
);
