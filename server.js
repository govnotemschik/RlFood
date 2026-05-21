/**
 * RNL Food Backend Server
 * Optimized version with compression, caching, performance improvements
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import path from 'path';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import crypto from 'crypto';
import compression from 'compression';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

const CONFIG = {
    jwtExpiry: '24h',
    bcryptRounds: 10,
    rateLimitWindow: 15 * 60 * 1000,
    rateLimitMax: 1000,
    maxLoginAttempts: 5,
    lockoutTime: 15 * 60 * 1000,
    minPasswordLength: 6,
    maxUsernameLength: 30,
    minUsernameLength: 3
};

// Optimized DB Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
    keepAliveInitialDelay: 10000
});

pool.on('error', (err) => console.error('Unexpected database error:', err));

// Compression middleware
app.use(compression({ threshold: 512 }));

// CORS
app.use(cors({ origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'] }));

app.use(cookieParser());

// Static files with caching
app.use(express.static(path.join(__dirname), { maxAge: '1d', etag: true, lastModified: true }));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Rate limiter
const rateLimiter = new Map();
const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    if (!rateLimiter.has(ip)) { rateLimiter.set(ip, { count: 1, resetTime: now + CONFIG.rateLimitWindow }); return next(); }
    const record = rateLimiter.get(ip);
    if (now > record.resetTime) { rateLimiter.set(ip, { count: 1, resetTime: now + CONFIG.rateLimitWindow }); return next(); }
    if (record.count >= CONFIG.rateLimitMax) return res.status(429).json({ error: 'Слишком много запросов' });
    record.count++;
    next();
};

const loginAttempts = new Map();
const checkLoginAttempts = (username) => {
    const record = loginAttempts.get(username);
    if (!record) return true;
    if (Date.now() > record.lockoutUntil) { loginAttempts.delete(username); return true; }
    return false;
};
const recordFailedLogin = (username) => {
    const record = loginAttempts.get(username) || { attempts: 0 };
    record.attempts++;
    if (record.attempts >= CONFIG.maxLoginAttempts) record.lockoutUntil = Date.now() + CONFIG.lockoutTime;
    loginAttempts.set(username, record);
};
const recordSuccessfulLogin = (username) => loginAttempts.delete(username);

const detectDevice = (userAgent) => {
    if (!userAgent) return { type: 'unknown', browser: 'Unknown', os: 'Unknown' };
    const ua = userAgent.toLowerCase();
    let type = 'desktop', browser = 'Unknown', os = 'Unknown';
    if (/mobile|android|iphone|ipad|tablet/i.test(ua)) type = /tablet|ipad/i.test(ua) ? 'tablet' : 'mobile';
    if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
    else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
    else if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('edg')) browser = 'Edge';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('mac os') || ua.includes('macos')) os = 'macOS';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
    else if (ua.includes('linux')) os = 'Linux';
    return { type, browser, os };
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const cookieToken = req.cookies.token;
    const finalToken = token || cookieToken;
    if (!finalToken) return res.status(401).json({ error: 'Токен отсутствует' });
    jwt.verify(finalToken, JWT_SECRET, async (err, user) => {
        if (err) return res.status(403).json({ error: 'Неверный токен' });
        const tokenHash = crypto.createHash('sha256').update(finalToken).digest('hex');
        
        // Check if session is active in database
        try {
            const sessionResult = await pool.query(
                'SELECT is_active FROM user_sessions WHERE token_hash = $1 AND user_id = $2',
                [tokenHash, user.userId]
            );
            if (sessionResult.rows.length === 0) {
                // Сессия не найдена - создаём новую (для обратной совместимости)
                const device = detectDevice(req.headers['user-agent']);
                await pool.query(
                    `INSERT INTO user_sessions (user_id, token_hash, device_name, device_type, browser, os, is_active) VALUES ($1, $2, $3, $4, $5, $6, true)`,
                    [user.userId, tokenHash, `${device.browser} на ${device.os}`, device.type, device.browser, device.os]
                );
            } else if (!sessionResult.rows[0].is_active) {
                return res.status(403).json({ error: 'Сессия завершена. Войдите снова.' });
            } else {
                await pool.query('UPDATE user_sessions SET last_active = NOW() WHERE token_hash = $1 AND user_id = $2', [tokenHash, user.userId]);
            }
        } catch (e) {
            console.error('Session check error:', e);
            return res.status(500).json({ error: 'Ошибка проверки сессии' });
        }
        
        req.user = user;
        req.token = finalToken;
        req.tokenHash = tokenHash;
        next();
    });
};

const requireAdmin = (req, res, next) => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещен' }); next(); };
const sanitizeInput = (input) => typeof input === 'string' ? input.trim().replace(/[<>]/g, '') : input;

// ==================== AUTH ====================
app.post('/api/register', rateLimitMiddleware, async (req, res) => {
    try {
        const { username, password, full_name, class_name, age } = req.body;
        if (!username || !password || !full_name) return res.status(400).json({ error: 'Заполните обязательные поля' });
        const cleanUsername = sanitizeInput(username);
        if (cleanUsername.length < 3 || cleanUsername.length > 30) return res.status(400).json({ error: 'Логин 3-30 символов' });
        if (password.length < 6) return res.status(400).json({ error: 'Пароль мин. 6 символов' });
        
        const userExists = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
        if (userExists.rows.length > 0) return res.status(400).json({ error: 'Пользователь существует' });
        
        const hashedPassword = await bcrypt.hash(password, CONFIG.bcryptRounds);
        const userResult = await pool.query(`INSERT INTO users (username, password, fullname, role, balance, grade) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, fullname, role, balance`,
            [cleanUsername, hashedPassword, sanitizeInput(full_name), 'user', 0.00, sanitizeInput(class_name || '')]);
        const user = userResult.rows[0];
        const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: CONFIG.jwtExpiry });
        
        res.status(201).json({ success: true, token, user: { id: user.id, username: user.username, full_name: user.fullname, class_name: class_name, balance: parseFloat(user.balance) || 0, role: user.role } });
    } catch (error) { console.error('Registration error:', error); res.status(500).json({ error: 'Ошибка регистрации' }); }
});

app.post('/api/login', rateLimitMiddleware, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Заполните поля' });
        const cleanUsername = sanitizeInput(username);
        if (!checkLoginAttempts(cleanUsername)) return res.status(429).json({ error: 'Подождите 15 минут' });
        
        const userResult = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [cleanUsername]);
        if (userResult.rows.length === 0) { recordFailedLogin(cleanUsername); return res.status(401).json({ error: 'Неверные данные' }); }
        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) { recordFailedLogin(cleanUsername); return res.status(401).json({ error: 'Неверные данные' }); }
        recordSuccessfulLogin(cleanUsername);
        
        const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: CONFIG.jwtExpiry });
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const device = detectDevice(req.headers['user-agent']);
        
        await pool.query(`INSERT INTO user_sessions (user_id, token_hash, device_name, device_type, browser, os) VALUES ($1, $2, $3, $4, $5, $6)`,
            [user.id, tokenHash, `${device.browser} на ${device.os}`, device.type, device.browser, device.os]);
        
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
        res.json({ success: true, token, user: { id: user.id, username: user.username, full_name: user.fullname, class_name: user.grade, balance: parseFloat(user.balance) || 0, role: user.role } });
    } catch (error) { console.error('Login error:', error); res.status(500).json({ error: 'Ошибка входа' }); }
});

app.post('/api/logout', authenticateToken, async (req, res) => {
    try { await pool.query('UPDATE user_sessions SET is_active = false WHERE token_hash = $1', [req.tokenHash]); } catch {}
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    res.json({ success: true });
});

app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, fullname, role, balance, grade FROM users WHERE id = $1', [req.user.userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        const user = result.rows[0];
        res.json({ id: user.id, username: user.username, full_name: user.fullname, class_name: user.grade, balance: parseFloat(user.balance) || 0, role: user.role });
    } catch (error) { console.error('Get user error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== MENU ====================
let menuCache = null, menuCacheTime = 0;

app.get('/api/menu', async (req, res) => {
    try {
        const { search, category } = req.query;
        const now = Date.now();
        
        // Используем кэш только без фильтров
        if (!search && !category && menuCache && (now - menuCacheTime) < 5 * 60 * 1000) {
            return res.json(menuCache);
        }
        
        let query = 'SELECT * FROM menu_items WHERE 1=1';
        const params = [];
        
        // Поиск по названию
        if (search) {
            params.push(`%${search.toLowerCase()}%`);
            query += ` AND LOWER(name) LIKE $${params.length}`;
        }
        
        // Фильтр по категории
        if (category && category !== 'all') {
            params.push(category);
            query += ` AND category = $${params.length}`;
        }
        
        query += ' ORDER BY category, name';
        
        const result = await pool.query(query, params);
        const menu = result.rows.map(item => ({
            id: item.id, name: item.name, price: parseFloat(item.price), 
            category: item.category, description: item.description, 
            calories: item.calories, 
            allergens: item.allergens ? item.allergens.split(',').filter(a => a) : [], 
            rating: parseFloat(item.rating) || 0, 
            is_new: item.is_new, is_popular: item.is_popular
        }));
        
        // Кэшируем только полный список
        if (!search && !category) {
            menuCache = menu;
            menuCacheTime = now;
        }
        
        res.json(menu);
    } catch (error) { console.error('Get menu error:', error); res.status(500).json({ error: 'Ошибка загрузки меню' }); }
});

// ==================== PROMO ====================
app.post('/api/validate-promo', authenticateToken, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Введите промокод' });
        const cleanCode = sanitizeInput(code).toUpperCase();
        const result = await pool.query('SELECT * FROM promo_codes WHERE code = $1 AND (expires_at IS NULL OR expires_at > NOW())', [cleanCode]);
        if (result.rows.length === 0) return res.json({ valid: false, message: 'Промокод не найден' });
        const promo = result.rows[0];
        res.json({ valid: true, promo: { id: promo.id, code: promo.code, discount: promo.discount } });
    } catch (error) { console.error('Validate promo error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== ORDERS ====================
app.post('/api/orders', authenticateToken, rateLimitMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { items, total, promo_id } = req.body;
        const user_id = req.user.userId;
        if (!items || !Array.isArray(items) || items.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Заказ пуст' }); }
        
        const calculatedTotal = items.reduce((sum, item) => sum + (parseFloat(item.unit_price) * parseInt(item.quantity)), 0);
        if (Math.abs(calculatedTotal - parseFloat(total)) > 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Неверная сумма' }); }
        
        const userResult = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user_id]);
        if (userResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Пользователь не найден' }); }
        const userBalance = parseFloat(userResult.rows[0].balance) || 0;
        if (userBalance < calculatedTotal) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Недостаточно средств` }); }
        
        const orderResult = await client.query('INSERT INTO orders (order_number, user_id, items, total, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [`ORD-${Date.now().toString(36).toUpperCase()}`, user_id, JSON.stringify(items), calculatedTotal, 'pending']);
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [calculatedTotal, user_id]);
        await client.query('COMMIT');
        
        res.status(201).json({ success: true, order: { id: orderResult.rows[0].id, total: parseFloat(orderResult.rows[0].total), status: orderResult.rows[0].status }, new_balance: userBalance - calculatedTotal });
    } catch (error) { await client.query('ROLLBACK'); console.error('Create order error:', error); res.status(500).json({ error: 'Ошибка создания заказа' }); }
    finally { client.release(); }
});

app.get('/api/orders/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.userId]);
        res.json({ orders: result.rows.map(o => ({ ...o, items: o.items ? JSON.parse(o.items) : [], total: parseFloat(o.total) })) });
    } catch (error) { console.error('Get orders error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.put('/api/orders/:id/cancel', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [parseInt(req.params.id), req.user.userId]);
        if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Заказ не найден' }); }
        const order = result.rows[0];
        if (['cancelled', 'completed', 'ready'].includes(order.status)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Невозможно отменить' }); }
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [parseFloat(order.total), req.user.userId]);
        await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', parseInt(req.params.id)]);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Заказ отменён' });
    } catch (error) { await client.query('ROLLBACK'); console.error('Cancel order error:', error); res.status(500).json({ error: 'Ошибка' }); }
    finally { client.release(); }
});

// ==================== SCHEDULED ORDERS ====================
app.post('/api/scheduled-orders', authenticateToken, rateLimitMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { items, total, scheduled_date } = req.body;
        const user_id = req.user.userId;
        
        if (!items || !Array.isArray(items) || items.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Заказ пуст' }); }
        if (!scheduled_date) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Укажите дату' }); }
        
        const scheduleDate = new Date(scheduled_date);
        if (isNaN(scheduleDate.getTime()) || scheduleDate < new Date()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Некорректная дата' }); }
        
        const calculatedTotal = items.reduce((sum, item) => sum + (parseFloat(item.unit_price) * parseInt(item.quantity)), 0);
        if (Math.abs(calculatedTotal - parseFloat(total)) > 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Неверная сумма' }); }
        
        const userResult = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user_id]);
        if (userResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Пользователь не найден' }); }
        const userBalance = parseFloat(userResult.rows[0].balance) || 0;
        if (userBalance < calculatedTotal) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Недостаточно средств' }); }
        
        const orderResult = await client.query(
            'INSERT INTO orders (order_number, user_id, items, total, status, scheduled_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [`ORD-${Date.now().toString(36).toUpperCase()}`, user_id, JSON.stringify(items), calculatedTotal, 'scheduled', scheduleDate]
        );
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [calculatedTotal, user_id]);
        await client.query('COMMIT');
        
        res.status(201).json({ success: true, order: { id: orderResult.rows[0].id, total: parseFloat(orderResult.rows[0].total), status: orderResult.rows[0].status, scheduled_date: orderResult.rows[0].scheduled_date }, new_balance: userBalance - calculatedTotal });
    } catch (error) { await client.query('ROLLBACK'); console.error('Scheduled order error:', error); res.status(500).json({ error: 'Ошибка' }); }
    finally { client.release(); }
});

app.get('/api/scheduled-orders', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 AND status = $2 ORDER BY scheduled_date ASC', [req.user.userId, 'scheduled']);
        res.json({ orders: result.rows.map(o => ({ ...o, items: o.items ? JSON.parse(o.items) : [], total: parseFloat(o.total) })) });
    } catch (error) { console.error('Get scheduled error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/scheduled-orders/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [parseInt(req.params.id), req.user.userId]);
        if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Заказ не найден' }); }
        if (result.rows[0].status !== 'scheduled') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Невозможно отменить' }); }
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [parseFloat(result.rows[0].total), req.user.userId]);
        await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', parseInt(req.params.id)]);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Заказ отменён' });
    } catch (error) { await client.query('ROLLBACK'); console.error('Cancel scheduled error:', error); res.status(500).json({ error: 'Ошибка' }); }
    finally { client.release(); }
});

// Cron: активация запланированных заказов
const activateScheduledOrders = async () => {
    try {
        const result = await pool.query(`UPDATE orders SET status = 'pending' WHERE status = 'scheduled' AND scheduled_date <= NOW() RETURNING id, user_id`);
        for (const order of result.rows) {
            await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)', 
                [order.user_id, 'Заказ активирован', 'Ваш заказ теперь в очереди!', 'success']);
        }
        if (result.rows.length > 0) console.log(`Activated ${result.rows.length} scheduled orders`);
    } catch (error) { console.error('Activate error:', error); }
};
setInterval(activateScheduledOrders, 5 * 60 * 1000);

// ==================== KITCHEN ====================
app.get('/api/kitchen/orders', authenticateToken, async (req, res) => {
    if (!['admin', 'kitchen', 'staff'].includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const result = await pool.query(`SELECT o.*, u.username, u.fullname, u.grade as class_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status IN ('pending', 'confirmed', 'preparing') ORDER BY o.created_at ASC`);
        res.json({ orders: result.rows.map(o => ({ ...o, items: o.items ? JSON.parse(o.items) : [], total: parseFloat(o.total) })) });
    } catch (error) { console.error('Kitchen orders error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.put('/api/kitchen/orders/:id/status', authenticateToken, async (req, res) => {
    if (!['admin', 'kitchen', 'staff'].includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Неверный статус' });
        const result = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [status, parseInt(req.params.id)]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
        await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)', 
            [result.rows[0].user_id, 'Статус заказа', `Ваш заказ: ${status}`, 'info']);
        res.json({ success: true });
    } catch (error) { console.error('Kitchen status error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== TOPUP ====================
app.post('/api/topup', authenticateToken, rateLimitMiddleware, async (req, res) => {
    try {
        const { amount, method = 'card' } = req.body;
        const amountNum = parseFloat(amount);
        if (!amountNum || amountNum < 10) return res.status(400).json({ error: 'Мин. 10₴' });
        if (amountNum > 10000) return res.status(400).json({ error: 'Макс. 10000₴' });
        let finalAmount = amountNum, fee = 0;
        if (method === 'card') { fee = amountNum * 0.025; finalAmount = amountNum - fee; }
        else if (method === 'crypto') { fee = amountNum * 0.01; finalAmount = amountNum - fee; }
        await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [finalAmount, req.user.userId]);
        const balanceResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.userId]);
        res.json({ success: true, new_balance: parseFloat(balanceResult.rows[0].balance), deposited: finalAmount });
    } catch (error) { console.error('Topup error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== ADMIN ====================
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [users, orders, revenue] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM orders'),
            pool.query('SELECT COALESCE(SUM(total), 0) as revenue FROM orders')
        ]);
        res.json({ users: parseInt(users.rows[0].count), orders: parseInt(orders.rows[0].count), revenue: parseFloat(revenue.rows[0].revenue) });
    } catch (error) { console.error('Admin stats error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/orders', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT o.*, u.username, u.fullname, u.grade as class_name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 100');
        res.json({ orders: result.rows.map(o => ({ ...o, items: o.items ? JSON.parse(o.items) : [], total: parseFloat(o.total) })) });
    } catch (error) { console.error('Admin orders error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.put('/api/admin/orders/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        const result = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', [status, parseInt(req.params.id)]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
        await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)', [result.rows[0].user_id, 'Статус обновлён', `Ваш заказ: ${status}`, 'info']);
        res.json({ success: true });
    } catch (error) { console.error('Update status error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/notifications/broadcast', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await pool.query("SELECT id FROM users WHERE role != 'admin'");
        for (const user of users.rows) await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)', [user.id, sanitizeInput(req.body.title), sanitizeInput(req.body.message), 'info']);
        res.json({ success: true, sent: users.rows.length });
    } catch (error) { console.error('Broadcast error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== SESSIONS ====================
app.get('/api/sessions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, device_name, device_type, browser, os, last_active, is_active, token_hash FROM user_sessions WHERE user_id = $1 AND is_active = true ORDER BY last_active DESC',
            [req.user.userId]
        );
        const sessions = result.rows.map(s => ({
            id: s.id,
            device_name: s.device_name,
            device_type: s.device_type,
            browser: s.browser,
            os: s.os,
            last_active: s.last_active,
            is_current: s.token_hash === req.tokenHash
        }));
        res.json({ sessions });
    } catch (error) { console.error('Get sessions error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/sessions/:id', authenticateToken, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        if (isNaN(sessionId)) return res.status(400).json({ error: 'Неверный ID сессии' });
        await pool.query('UPDATE user_sessions SET is_active = false WHERE id = $1 AND user_id = $2', [sessionId, req.user.userId]);
        res.json({ success: true });
    } catch (error) { console.error('Delete session error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/sessions/all', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND token_hash != $2', [req.user.userId, req.tokenHash]);
        res.json({ success: true });
    } catch (error) { console.error('Delete all sessions error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== ADMIN - Extended ====================

// Получить всех пользователей
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.fullname, u.grade, u.role, u.balance, u.created_at,
                   (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
                   (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id) as total_spent
            FROM users u 
            ORDER BY u.created_at DESC
        `);
        res.json({ users: result.rows.map(u => ({
            ...u,
            balance: parseFloat(u.balance),
            order_count: parseInt(u.order_count),
            total_spent: parseFloat(u.total_spent)
        }))});
    } catch (error) { console.error('Admin users error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Обновить пользователя
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { fullname, grade, role, balance } = req.body;
        const userId = parseInt(req.params.id);
        
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (fullname !== undefined) { updates.push(`fullname = $${paramCount++}`); values.push(sanitizeInput(fullname)); }
        if (grade !== undefined) { updates.push(`grade = $${paramCount++}`); values.push(sanitizeInput(grade)); }
        if (role !== undefined) { updates.push(`role = $${paramCount++}`); values.push(sanitizeInput(role)); }
        if (balance !== undefined) { updates.push(`balance = $${paramCount++}`); values.push(parseFloat(balance)); }
        
        if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });
        
        values.push(userId);
        const result = await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, fullname, grade, role, balance`,
            values
        );
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        
        res.json({ success: true, user: { ...result.rows[0], balance: parseFloat(result.rows[0].balance) } });
    } catch (error) { console.error('Update user error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Удалить пользователя
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = parseInt(req.params.id);
        
        // Нельзя удалить админа
        const userCheck = await client.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Пользователь не найден' }); }
        if (userCheck.rows[0].role === 'admin') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Нельзя удалить админа' }); }
        
        // Удаляем сессии и заказы
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM orders WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) { await client.query('ROLLBACK'); console.error('Delete user error:', error); res.status(500).json({ error: 'Ошибка' }); }
    finally { client.release(); }
});

// Получить все позиции меню
app.get('/api/admin/menu', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM menu_items ORDER BY category, name');
        res.json({ items: result.rows.map(item => ({
            ...item,
            price: parseFloat(item.price),
            calories: parseInt(item.calories) || 0,
            rating: parseFloat(item.rating) || 0
        }))});
    } catch (error) { console.error('Admin menu error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Добавить позицию меню
app.post('/api/admin/menu', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, price, category, description, calories, allergens, rating, is_new, is_popular } = req.body;
        if (!name || !price || !category) return res.status(400).json({ error: 'Заполните обязательные поля' });
        
        const result = await pool.query(`
            INSERT INTO menu_items (name, price, category, description, calories, allergens, rating, is_new, is_popular)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            sanitizeInput(name),
            parseFloat(price),
            sanitizeInput(category),
            sanitizeInput(description || ''),
            parseInt(calories) || 0,
            sanitizeInput(allergens || ''),
            parseFloat(rating) || 4.0,
            is_new || false,
            is_popular || false
        ]);
        
        // Сброс кэша меню
        menuCache = null;
        
        res.status(201).json({ success: true, item: result.rows[0] });
    } catch (error) { console.error('Add menu item error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Обновить позицию меню
app.put('/api/admin/menu/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, price, category, description, calories, allergens, rating, is_new, is_popular } = req.body;
        const itemId = parseInt(req.params.id);
        
        const result = await pool.query(`
            UPDATE menu_items SET 
                name = COALESCE($1, name),
                price = COALESCE($2, price),
                category = COALESCE($3, category),
                description = COALESCE($4, description),
                calories = COALESCE($5, calories),
                allergens = COALESCE($6, allergens),
                rating = COALESCE($7, rating),
                is_new = COALESCE($8, is_new),
                is_popular = COALESCE($9, is_popular)
            WHERE id = $10
            RETURNING *
        `, [
            name ? sanitizeInput(name) : null,
            price ? parseFloat(price) : null,
            category ? sanitizeInput(category) : null,
            description !== undefined ? sanitizeInput(description) : null,
            calories !== undefined ? parseInt(calories) : null,
            allergens !== undefined ? sanitizeInput(allergens) : null,
            rating !== undefined ? parseFloat(rating) : null,
            is_new !== undefined ? is_new : null,
            is_popular !== undefined ? is_popular : null,
            itemId
        ]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Позиция не найдена' });
        
        // Сброс кэша меню
        menuCache = null;
        
        res.json({ success: true, item: result.rows[0] });
    } catch (error) { console.error('Update menu item error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Удалить позицию меню
app.delete('/api/admin/menu/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM menu_items WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Позиция не найдена' });
        
        // Сброс кэша меню
        menuCache = null;
        
        res.json({ success: true });
    } catch (error) { console.error('Delete menu item error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Получить расширенную статистику
app.get('/api/admin/analytics', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const today = new Date();
        const weekAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today - 30 * 24 * 60 * 60 * 1000);
        
        const [
            stats,
            todayOrders,
            weekOrders,
            popularItems,
            categoryStats,
            recentOrders
        ] = await Promise.all([
            pool.query('SELECT COUNT(*) as total_users FROM users'),
            pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue FROM orders WHERE created_at >= $1`, [today.toISOString().split('T')[0]]),
            pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue FROM orders WHERE created_at >= $1`, [weekAgo.toISOString()]),
            pool.query(`
                SELECT mi.name, mi.category, COUNT(oi.id) as order_count
                FROM menu_items mi
                LEFT JOIN (
                    SELECT json_array_elements_text(items::json -> 'meal_id') as meal_id FROM orders
                ) oi ON oi.meal_id = mi.id::text
                GROUP BY mi.id, mi.name, mi.category
                ORDER BY order_count DESC
                LIMIT 10
            `),
            pool.query(`
                SELECT category, COUNT(*) as count, COALESCE(SUM(price), 0) as revenue
                FROM menu_items
                GROUP BY category
            `),
            pool.query(`
                SELECT o.id, o.total, o.status, o.created_at, u.username, u.fullname
                FROM orders o
                JOIN users u ON o.user_id = u.id
                ORDER BY o.created_at DESC
                LIMIT 20
            `)
        ]);
        
        res.json({
            total_users: parseInt(stats.rows[0].total_users),
            today: {
                orders: parseInt(todayOrders.rows[0].count),
                revenue: parseFloat(todayOrders.rows[0].revenue)
            },
            week: {
                orders: parseInt(weekOrders.rows[0].count),
                revenue: parseFloat(weekOrders.rows[0].revenue)
            },
            popular_items: popularItems.rows,
            category_stats: categoryStats.rows.map(c => ({
                ...c,
                count: parseInt(c.count),
                revenue: parseFloat(c.revenue)
            })),
            recent_orders: recentOrders.rows.map(o => ({
                ...o,
                total: parseFloat(o.total)
            }))
        });
    } catch (error) { console.error('Analytics error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== KITCHEN - Extended ====================

// Получить заказы для кухни с фильтрами
app.get('/api/kitchen/orders', authenticateToken, async (req, res) => {
    if (!['admin', 'kitchen', 'staff'].includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const { status, limit } = req.query;
        let query = `
            SELECT o.*, u.username, u.fullname, u.grade as class_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE 1=1
        `;
        const params = [];
        
        if (status && status !== 'all') {
            query += ` AND o.status = $${params.length + 1}`;
            params.push(status);
        }
        
        query += ` ORDER BY o.created_at ASC`;
        
        if (limit) {
            query += ` LIMIT $${params.length + 1}`;
            params.push(parseInt(limit));
        }
        
        const result = await pool.query(query, params);
        
        // Группируем по статусу
        const orders = result.rows.map(o => ({
            ...o,
            items: o.items ? JSON.parse(o.items) : [],
            total: parseFloat(o.total)
        }));
        
        const grouped = {
            pending: orders.filter(o => o.status === 'pending'),
            confirmed: orders.filter(o => o.status === 'confirmed'),
            preparing: orders.filter(o => o.status === 'preparing'),
            ready: orders.filter(o => o.status === 'ready'),
            all: orders
        };
        
        res.json({ orders, grouped, stats: {
            pending: grouped.pending.length,
            confirmed: grouped.confirmed.length,
            preparing: grouped.preparing.length,
            ready: grouped.ready.length
        }});
    } catch (error) { console.error('Kitchen orders error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Обновить статус заказа (кухня)
app.put('/api/kitchen/orders/:id/status', authenticateToken, async (req, res) => {
    if (!['admin', 'kitchen', 'staff'].includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Неверный статус' });
        
        const result = await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, parseInt(req.params.id)]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
        
        // Отправляем уведомление пользователю
        await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)', 
            [result.rows[0].user_id, 'Обновление заказа', `Статус заказа: ${status}`, status === 'ready' ? 'success' : 'info']);
        
        res.json({ success: true, order: { ...result.rows[0], total: parseFloat(result.rows[0].total) } });
    } catch (error) { console.error('Kitchen status error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Печать заказа (для кухни)
app.get('/api/kitchen/orders/:id/print', authenticateToken, async (req, res) => {
    if (!['admin', 'kitchen', 'staff'].includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const result = await pool.query(`
            SELECT o.*, u.username, u.fullname, u.grade as class_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.id = $1
        `, [parseInt(req.params.id)]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: 'Заказ не найден' });
        
        const order = result.rows[0];
        res.json({
            order: {
                ...order,
                items: order.items ? JSON.parse(order.items) : [],
                total: parseFloat(order.total)
            }
        });
    } catch (error) { console.error('Print order error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Звуковое уведомление для новых заказов
app.get('/api/kitchen/notifications', authenticateToken, async (req, res) => {
    if (!['admin', 'kitchen', 'staff'].includes(req.user.role)) return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const { since } = req.query;
        let query = `
            SELECT o.id, o.status, o.created_at, u.username, u.fullname
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.status IN ('pending', 'confirmed')
        `;
        const params = [];
        
        if (since) {
            query += ` AND o.created_at > $${params.length + 1}`;
            params.push(since);
        }
        
        query += ` ORDER BY o.created_at DESC LIMIT 10`;
        
        const result = await pool.query(query, params);
        res.json({ notifications: result.rows });
    } catch (error) { console.error('Kitchen notifications error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== REVIEWS ====================
// Получить отзывы для блюда
app.get('/api/reviews/:menuItemId', async (req, res) => {
    try {
        const menuItemId = parseInt(req.params.menuItemId);
        const result = await pool.query(`
            SELECT r.id, r.rating, r.comment, r.created_at, u.username, u.fullname
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.menu_item_id = $1
            ORDER BY r.created_at DESC
        `, [menuItemId]);
        
        const reviews = result.rows.map(r => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            date: r.created_at,
            user: r.username,
            user_fullname: r.fullname
        }));
        
        // Вычисляем средний рейтинг
        const avgRating = reviews.length > 0 
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
            : 0;
        
        res.json({ reviews, avgRating: parseFloat(avgRating.toFixed(1)), count: reviews.length });
    } catch (error) { console.error('Get reviews error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// Добавить отзыв
app.post('/api/reviews', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const { menu_item_id, rating, comment } = req.body;
        const user_id = req.user.userId;
        
        if (!menu_item_id || !rating) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'ID блюда и оценка обязательны' });
        }
        
        const ratingNum = parseInt(rating);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
        }
        
        const menuItemIdNum = parseInt(menu_item_id);
        
        // Проверяем, существует ли блюдо
        const menuCheck = await client.query('SELECT id FROM menu_items WHERE id = $1', [menuItemIdNum]);
        if (menuCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Блюдо не найдено' });
        }
        
        // Проверяем, не оставлял ли пользователь уже отзыв на это блюдо
        const existing = await client.query(
            'SELECT id FROM reviews WHERE user_id = $1 AND menu_item_id = $2',
            [user_id, menuItemIdNum]
        );
        
        if (existing.rows.length > 0) {
            // Обновляем существующий отзыв
            await client.query(
                'UPDATE reviews SET rating = $1, comment = $2, created_at = CURRENT_TIMESTAMP WHERE id = $3',
                [ratingNum, comment || null, existing.rows[0].id]
            );
        } else {
            // Создаём новый отзыв
            await client.query(
                'INSERT INTO reviews (user_id, menu_item_id, rating, comment) VALUES ($1, $2, $3, $4)',
                [user_id, menuItemIdNum, ratingNum, comment || null]
            );
        }
        
        // Обновляем рейтинг блюда
        const ratingResult = await client.query(
            'SELECT AVG(rating)::numeric(2,1) as avg_rating FROM reviews WHERE menu_item_id = $1',
            [menuItemIdNum]
        );
        
        const newRating = ratingResult.rows[0].avg_rating || 0;
        
        await client.query(
            'UPDATE menu_items SET rating = $1 WHERE id = $2',
            [newRating, menuItemIdNum]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Отзыв сохранён', newRating });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Add review error:', error);
        res.status(500).json({ error: 'Ошибка сохранения отзыва' });
    } finally {
        client.release();
    }
});

// Удалить отзыв
app.delete('/api/reviews/:id', authenticateToken, async (req, res) => {
    try {
        const reviewId = parseInt(req.params.id);
        const user_id = req.user.userId;
        
        // Проверяем, принадлежит ли отзыв пользователю или это админ
        const result = await pool.query('SELECT * FROM reviews WHERE id = $1', [reviewId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Отзыв не найден' });
        }
        
        if (result.rows[0].user_id !== user_id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет прав для удаления' });
        }
        
        const menuItemId = result.rows[0].menu_item_id;
        
        await pool.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
        
        // Обновляем рейтинг блюда
        const ratingResult = await pool.query(
            'SELECT AVG(rating) as avg_rating FROM reviews WHERE menu_item_id = $1',
            [menuItemId]
        );
        
        const newRating = ratingResult.rows[0].avg_rating 
            ? parseFloat(ratingResult.rows[0].avg_rating).toFixed(1) 
            : 0;
        
        await pool.query(
            'UPDATE menu_items SET rating = $1 WHERE id = $2',
            [newRating, menuItemId]
        );
        
        res.json({ success: true, message: 'Отзыв удалён' });
    } catch (error) { console.error('Delete review error:', error); res.status(500).json({ error: 'Ошибка' }); }
});

// ==================== HEALTH ====================
app.get('/api/health', async (req, res) => {
    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        res.json({ status: 'OK', database: 'connected', response_time_ms: Date.now() - start });
    } catch (error) { res.status(500).json({ status: 'ERROR', database: 'disconnected' }); }
});

// ==================== FALLBACK ====================
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => { 
    console.log('🚀 RNL Food Server v3.1'); 
    console.log(`   Port: ${PORT}`); 
    console.log(`   Kitchen: Enabled`); 
    console.log(`   Scheduled Orders: Enabled`); 
    console.log('   Ready! 🎉'); 
});
