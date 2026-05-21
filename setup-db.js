#!/usr/bin/env node
/**
 * RNL Food Database Setup Script
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        console.error('❌ .env file not found!');
        process.exit(1);
    }
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envVars = {};
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            envVars[key.trim()] = valueParts.join('=').trim();
        }
    });
    return envVars;
}

async function setupDatabase() {
    console.log('🚀 RNL Food Database Setup\n');
    const env = loadEnv();
    
    if (!env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not found in .env!');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await pool.query('SELECT 1');
        console.log('✅ Connected to database!\n');

        // Create tables
        console.log('📦 Creating tables...');
        
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
            fullname TEXT NOT NULL, role TEXT DEFAULT 'user', balance REAL DEFAULT 0.00,
            age INTEGER, parents TEXT, grade TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('  ✅ users');

        await pool.query(`CREATE TABLE IF NOT EXISTS menu_items (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, price REAL NOT NULL,
            category TEXT, calories INTEGER DEFAULT 0, image TEXT, allergens TEXT,
            rating REAL DEFAULT 0, is_new BOOLEAN DEFAULT FALSE, is_popular BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('  ✅ menu_items');

        await pool.query(`CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY, order_number TEXT, user_id INTEGER NOT NULL,
            items TEXT NOT NULL, total REAL NOT NULL, status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        console.log('  ✅ orders');

        await pool.query(`CREATE TABLE IF NOT EXISTS promo_codes (
            id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, discount REAL NOT NULL,
            expires_at TIMESTAMP, usage_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('  ✅ promo_codes');

        await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY, user_id INTEGER, title TEXT NOT NULL, message TEXT NOT NULL,
            type TEXT DEFAULT 'info', is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        console.log('  ✅ notifications');

        await pool.query(`CREATE TABLE IF NOT EXISTS user_sessions (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL,
            device_name TEXT, device_type TEXT DEFAULT 'unknown', browser TEXT, os TEXT,
            ip_address TEXT, last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_active BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        console.log('  ✅ user_sessions');

        await pool.query(`CREATE TABLE IF NOT EXISTS favorites (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, menu_item_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, menu_item_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
        )`);
        console.log('  ✅ favorites');

        await pool.query(`CREATE TABLE IF NOT EXISTS support_staff (
            id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL, role TEXT DEFAULT 'support',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);
        console.log('  ✅ support_staff');

        await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, staff_id INTEGER, message TEXT NOT NULL,
            sender_type TEXT DEFAULT 'user', is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (staff_id) REFERENCES support_staff(id) ON DELETE SET NULL
        )`);
        console.log('  ✅ chat_messages');

        await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            menu_item_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
        )`);
        console.log('  ✅ reviews');

        // Create indexes
        await pool.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_favorites_menu_item_id ON favorites(menu_item_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_reviews_menu_item_id ON reviews(menu_item_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id)');
        console.log('  ✅ indexes\n');

        // Seed data
        console.log('🌱 Seeding data...');
        
        const menuItems = [
            ['Куриный суп', 'Вкусный куриный суп с овощами', 25, 'Горячее', 180, '', 4.5, false, true],
            ['Борщ', 'Традиционный украинский борщ', 30, 'Горячее', 250, '', 4.7, false, true],
            ['Пельмени', 'Домашние пельмени со сметаной', 35, 'Горячее', 350, 'milk,gluten', 4.3, false, false],
            ['Макароны по-флотски', 'Макароны с мясным фаршем', 28, 'Горячее', 420, 'gluten', 4.2, false, true],
            ['Котлета с пюре', 'Куриная котлета с картофельным пюре', 32, 'Горячее', 380, 'gluten', 4.8, false, true],
            ['Салат Цезарь', 'Свежий салат с курицей и соусом', 40, 'Салаты', 180, 'milk,eggs', 4.6, false, false],
            ['Оливье', 'Классический салат оливье', 30, 'Салаты', 220, 'eggs', 4.4, false, true],
            ['Винегрет', 'Овощной винегрет', 25, 'Салаты', 150, '', 4.1, false, false],
            ['Чай черный', 'Ароматный черный чай', 10, 'Напитки', 0, '', 4.5, false, true],
            ['Чай зеленый', 'Зеленый чай с лимоном', 12, 'Напитки', 5, '', 4.3, false, false],
            ['Кофе', 'Свежесваренный кофе', 20, 'Напитки', 5, '', 4.7, false, true],
            ['Компот', 'Домашний компот', 15, 'Напитки', 60, '', 4.2, false, false],
            ['Сок яблочный', 'Свежий яблочный сок', 18, 'Напитки', 45, '', 4.4, false, false],
            ['Напсик', 'Газированный напиток', 15, 'Напитки', 40, '', 4.0, false, false],
            ['Шоколадный торт', 'Шоколадный торт с кремом', 35, 'Десерты', 350, 'milk,eggs,gluten', 4.9, true, true],
            ['Чизкейк', 'Нежный чизкейк', 38, 'Десерты', 320, 'milk,eggs', 4.8, true, false],
            ['Пирожное Картошка', 'Пирожное картошка', 20, 'Десерты', 250, 'milk,gluten', 4.6, false, true],
            ['Пончик', 'Сладкий пончик с сахаром', 15, 'Десерты', 280, 'milk,eggs,gluten', 4.3, false, false],
            ['Пирог с яблоками', 'Домашний яблочный пирог', 25, 'Десерты', 220, 'gluten', 4.5, false, false],
            ['Мороженое', 'Ванильное мороженое', 20, 'Десерты', 150, 'milk', 4.7, false, true]
        ];

        for (const item of menuItems) {
            await pool.query(`INSERT INTO menu_items (name, description, price, category, calories, allergens, rating, is_new, is_popular)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING`, item);
        }
        console.log('  ✅ menu_items');

        // Promo codes
        await pool.query(`INSERT INTO promo_codes (code, discount, expires_at) VALUES 
            ('WELCOME10', 10, '2026-12-31'),
            ('FIRSTORDER', 15, '2026-06-30'),
            ('LYCEUM20', 20, '2026-12-31'),
            ('STUDENT5', 5, '2026-12-31')
            ON CONFLICT (code) DO NOTHING`);
        console.log('  ✅ promo_codes');

        // Default admin user (username: admin, password: admin123)
        await pool.query(`INSERT INTO users (username, password, fullname, role, balance) VALUES 
            ('admin', '$2a$10$rVnKJ5QK7u7Q7f7K5Q7K7O5K7K7K7K7K7K7K7K7K7K7K7K7K7K7K', 'Администратор', 'admin', 0.00)
            ON CONFLICT (username) DO NOTHING`);
        console.log('  ✅ admin user\n');

        // Stats
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) as users,
                (SELECT COUNT(*) FROM menu_items) as menu_items,
                (SELECT COUNT(*) FROM orders) as orders,
                (SELECT COUNT(*) FROM promo_codes) as promo_codes
        `);

        console.log('📊 Statistics:');
        console.log(`   Users: ${stats.rows[0].users}`);
        console.log(`   Menu Items: ${stats.rows[0].menu_items}`);
        console.log(`   Orders: ${stats.rows[0].orders}`);
        console.log(`   Promo Codes: ${stats.rows[0].promo_codes}`);
        console.log('\n🎉 Database setup complete!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

setupDatabase();
