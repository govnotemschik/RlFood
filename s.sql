// RNL Food Database Schema
// Database for Richelieu Lyceum Food Service

// Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    fullname TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    balance REAL DEFAULT 0.00,
    age INTEGER,
    parents TEXT,
    grade TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

// Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    category TEXT,
    calories INTEGER DEFAULT 0,
    image TEXT,
    allergens TEXT,
    rating REAL DEFAULT 0,
    is_new BOOLEAN DEFAULT FALSE,
    is_popular BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

// Orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number TEXT,
    user_id INTEGER NOT NULL,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

// Promo codes table
CREATE TABLE IF NOT EXISTS promo_codes (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    discount REAL NOT NULL,
    expires_at TIMESTAMP,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

// Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

// User sessions/devices table
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    device_name TEXT,
    device_type TEXT DEFAULT 'unknown',
    browser TEXT,
    os TEXT,
    ip_address TEXT,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

// Favorites table (user favorites for menu items)
CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, menu_item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

// Support staff table
CREATE TABLE IF NOT EXISTS support_staff (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'support',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

// Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    staff_id INTEGER,
    message TEXT NOT NULL,
    sender_type TEXT DEFAULT 'user',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES support_staff(id) ON DELETE SET NULL
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_menu_item_id ON favorites(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_menu_item_id ON reviews(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);

-- Insert default menu items
INSERT INTO menu_items (name, description, price, category, calories, allergens, rating, is_new, is_popular) VALUES
('Куриный суп', 'Вкусный куриный суп с овощами', 25, 'Горячее', 180, '', 4.5, FALSE, TRUE),
('Борщ', 'Традиционный украинский борщ', 30, 'Горячее', 250, '', 4.7, FALSE, TRUE),
('Пельмени', 'Домашние пельмени со сметаной', 35, 'Горячее', 350, 'milk,gluten', 4.3, FALSE, FALSE),
('Макароны по-флотски', 'Макароны с мясным фаршем', 28, 'Горячее', 420, 'gluten', 4.2, FALSE, TRUE),
('Котлета с пюре', 'Куриная котлета с картофельным пюре', 32, 'Горячее', 380, 'gluten', 4.8, FALSE, TRUE),
('Салат Цезарь', 'Свежий салат с курицей и соусом', 40, 'Салаты', 180, 'milk,eggs', 4.6, FALSE, FALSE),
('Оливье', 'Классический салат оливье', 30, 'Салаты', 220, 'eggs', 4.4, FALSE, TRUE),
('Винегрет', 'Овощной винегрет', 25, 'Салаты', 150, '', 4.1, FALSE, FALSE),
('Чай черный', 'Ароматный черный чай', 10, 'Напитки', 0, '', 4.5, FALSE, TRUE),
('Чай зеленый', 'Зеленый чай с лимоном', 12, 'Напитки', 5, '', 4.3, FALSE, FALSE),
('Кофе', 'Свежесваренный кофе', 20, 'Напитки', 5, '', 4.7, FALSE, TRUE),
('Компот', 'Домашний компот', 15, 'Напитки', 60, '', 4.2, FALSE, FALSE),
('Сок яблочный', 'Свежий яблочный сок', 18, 'Напитки', 45, '', 4.4, FALSE, FALSE),
('Напсик', 'Газированный напиток', 15, 'Напитки', 40, '', 4.0, FALSE, FALSE),
('Шоколадный торт', 'Шоколадный торт с кремом', 35, 'Десерты', 350, 'milk,eggs,gluten', 4.9, TRUE, TRUE),
('Чизкейк', 'Нежный чизкейк', 38, 'Десерты', 320, 'milk,eggs', 4.8, TRUE, FALSE),
('Пирожное Картошка', 'Пирожное картошка', 20, 'Десерты', 250, 'milk,gluten', 4.6, FALSE, TRUE),
('Пончик', 'Сладкий пончик с сахаром', 15, 'Десерты', 280, 'milk,eggs,gluten', 4.3, FALSE, FALSE),
('Пирог с яблоками', 'Домашний яблочный пирог', 25, 'Десерты', 220, 'gluten', 4.5, FALSE, FALSE),
('Мороженое', 'Ванильное мороженое', 20, 'Десерты', 150, 'milk', 4.7, FALSE, TRUE);

-- Insert default promo codes
INSERT INTO promo_codes (code, discount, expires_at) VALUES
('WELCOME10', 10, '2026-12-31'),
('FIRSTORDER', 15, '2026-06-30'),
('LYCEUM20', 20, '2026-12-31'),
('STUDENT5', 5, '2026-12-31');

-- Insert default admin user (username: admin, password: admin123)
INSERT INTO users (username, password, fullname, role, balance) VALUES
('admin', '$2a$10$rVnKJ5QK7u7Q7f7K5Q7K7O5K7K7K7K7K7K7K7K7K7K7K7K7K7K7K', 'Администратор', 'admin', 0.00);
