require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { RouterOSAPI } = require('node-routeros');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// --- ENCRYPTION HELPERS ---
const ENC_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!';
const ENC_IV_LEN = 16;

function encrypt(text) {
    const iv = crypto.randomBytes(ENC_IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENC_KEY, 'utf8').slice(0, 32), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    try {
        const parts = text.split(':');
        if (parts.length < 2) return text; // Not encrypted (legacy)
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts.slice(1).join(':');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENC_KEY, 'utf8').slice(0, 32), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch { return text; }
}

// --- MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const SESSION_SECRET = process.env.SESSION_SECRET || 'isp-billing-super-secret-change-me-' + crypto.randomBytes(16).toString('hex');
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Rate limit for login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false
});

// --- DATABASE SETUP ---
const dbPath = path.resolve(__dirname, 'billing.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) return console.error('SQLite Error:', err.message);
    console.log('✅ Connected to SQLite Database.');

    db.run('PRAGMA foreign_keys = ON');

    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS dashboard_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'staff'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS mikrotiks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            api_port INTEGER NOT NULL DEFAULT 8728
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            router_id INTEGER NOT NULL,
            full_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            location TEXT DEFAULT '',
            user_id TEXT DEFAULT '',
            bw_type TEXT DEFAULT 'shared',
            total_bw TEXT DEFAULT '',
            email TEXT DEFAULT '',
            handover_date TEXT,
            payment_date TEXT,
            expiry_date TEXT,
            monthly_price REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(username, router_id),
            FOREIGN KEY (router_id) REFERENCES mikrotiks(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_db_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_date TEXT NOT NULL,
            new_expiry TEXT,
            notes TEXT DEFAULT '',
            created_by TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_db_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Seed default admin
        db.get(`SELECT COUNT(*) as count FROM dashboard_users`, [], (err, row) => {
            if (err) return;
            if (row.count === 0) {
                const hash = bcrypt.hashSync('admin123', 10);
                db.run(`INSERT INTO dashboard_users (username, password, role) VALUES (?, ?, ?)`,
                    ['admin', hash, 'admin']);
                console.log('🔑 Default admin created: admin / admin123');
            }
        });
    });
});

// Helper: promisify db methods
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
});

// --- AUTH MIDDLEWARE ---
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// --- MIKROTIK CONNECTION HELPER ---
async function getMTClient(routerId) {
    const router = await dbGet(`SELECT * FROM mikrotiks WHERE id = ?`, [routerId]);
    if (!router) throw new Error('Router not found in database');

    const decryptedPass = decrypt(router.password);

    const api = new RouterOSAPI({
        host: router.host,
        user: router.username,
        password: decryptedPass,
        port: router.api_port,
        timeout: 10
    });

    try {
        await api.connect();
        return api;
    } catch (err) {
        console.error(`❌ MikroTik Login Failed (${router.name}):`, err.message);
        throw err;
    }
}

// =============================================
// AUTH API
// =============================================

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const user = await dbGet(`SELECT * FROM dashboard_users WHERE username = ?`, [username]);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = bcrypt.compareSync(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// =============================================
// SYSTEM USERS API (Admin only)
// =============================================

app.get('/api/system-users', requireAdmin, async (req, res) => {
    try {
        const users = await dbAll(`SELECT id, username, role FROM dashboard_users`);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/system-users', requireAdmin, async (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
        const validRole = role === 'admin' ? 'admin' : 'staff';
        const hash = bcrypt.hashSync(password, 10);
        await dbRun(`INSERT INTO dashboard_users (username, password, role) VALUES (?, ?, ?)`,
            [username, hash, validRole]);
        res.json({ success: true });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/system-users/:id', requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (req.session.user.id === id) return res.status(400).json({ error: 'Cannot delete yourself' });
        await dbRun(`DELETE FROM dashboard_users WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================
// ROUTERS API
// =============================================

app.get('/api/routers', requireAuth, async (req, res) => {
    try {
        // Never send password to frontend
        const routers = await dbAll(`SELECT id, name, host, username, api_port FROM mikrotiks`);
        res.json(routers);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/routers', requireAdmin, async (req, res) => {
    try {
        const { name, host, username, password, api_port } = req.body;
        if (!name || !host || !username || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        const encryptedPass = encrypt(password);
        const result = await dbRun(
            `INSERT INTO mikrotiks (name, host, username, password, api_port) VALUES (?, ?, ?, ?, ?)`,
            [name, host, username, encryptedPass, api_port || 8728]
        );
        res.json({ success: true, id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/routers/:id', requireAdmin, async (req, res) => {
    try {
        const { name, host, username, password, api_port } = req.body;
        const id = parseInt(req.params.id);
        if (password) {
            const encryptedPass = encrypt(password);
            await dbRun(
                `UPDATE mikrotiks SET name=?, host=?, username=?, password=?, api_port=? WHERE id=?`,
                [name, host, username, encryptedPass, api_port || 8728, id]
            );
        } else {
            await dbRun(
                `UPDATE mikrotiks SET name=?, host=?, username=?, api_port=? WHERE id=?`,
                [name, host, username, api_port || 8728, id]
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/routers/:id', requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await dbRun(`DELETE FROM users WHERE router_id = ?`, [id]);
        await dbRun(`DELETE FROM mikrotiks WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================
// PROFILES API (Task 1)
// =============================================

app.get('/api/profiles', requireAuth, async (req, res) => {
    const routerId = req.query.router_id;
    if (!routerId) return res.status(400).json({ error: 'router_id is required' });

    let api;
    try {
        api = await getMTClient(routerId);
        const profiles = await api.write('/ppp/profile/print');
        const names = profiles.map(p => p.name).filter(n => n !== '*0' && n !== 'default-encryption');
        res.json(names);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch profiles', details: error.message });
    } finally {
        if (api) await api.close().catch(() => { });
    }
});

// =============================================
// PPPoE USERS API
// =============================================

// Dashboard stats (Task 4 — date filter)
app.get('/api/dashboard-stats', requireAuth, async (req, res) => {
    try {
        const filterDate = req.query.date || new Date().toISOString().slice(0, 10);
        const routers = await dbAll(`SELECT * FROM mikrotiks`);

        // Active = users whose expiry >= filterDate (not expired)
        const activeResult = await dbGet(
            `SELECT COUNT(*) as count FROM users WHERE expiry_date >= ? OR expiry_date IS NULL`,
            [filterDate + 'T00:00:00.000Z']
        );

        // Expired = users whose expiry < filterDate
        const expiredResult = await dbGet(
            `SELECT COUNT(*) as count FROM users WHERE expiry_date IS NOT NULL AND expiry_date < ?`,
            [filterDate + 'T00:00:00.000Z']
        );

        // Revenue = sum of payments on the selected date
        const revenueResult = await dbGet(
            `SELECT COALESCE(SUM(amount), 0) as total FROM payment_history WHERE DATE(payment_date) = ?`,
            [filterDate]
        );

        // New clients on this date
        const newClientsResult = await dbGet(
            `SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = ?`,
            [filterDate]
        );

        res.json({
            totalRevenue: revenueResult.total,
            totalActive: activeResult.count,
            totalExpired: expiredResult.count,
            totalRouters: routers.length,
            newClients: newClientsResult.count,
            filterDate
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Router-based stats (Task 6)
app.get('/api/router-stats', requireAuth, async (req, res) => {
    try {
        const filterDate = req.query.date || new Date().toISOString().slice(0, 10);
        const routers = await dbAll(`SELECT id, name FROM mikrotiks`);
        const stats = [];

        for (const router of routers) {
            const active = await dbGet(
                `SELECT COUNT(*) as count FROM users WHERE router_id = ? AND (expiry_date >= ? OR expiry_date IS NULL)`,
                [router.id, filterDate + 'T00:00:00.000Z']
            );
            const expired = await dbGet(
                `SELECT COUNT(*) as count FROM users WHERE router_id = ? AND expiry_date IS NOT NULL AND expiry_date < ?`,
                [router.id, filterDate + 'T00:00:00.000Z']
            );
            const revenue = await dbGet(
                `SELECT COALESCE(SUM(ph.amount), 0) as total FROM payment_history ph
                 JOIN users u ON ph.user_db_id = u.id
                 WHERE u.router_id = ? AND DATE(ph.payment_date) = ?`,
                [router.id, filterDate]
            );
            stats.push({
                routerId: router.id,
                routerName: router.name,
                active: active.count,
                expired: expired.count,
                revenue: revenue.total
            });
        }

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Fetch users from specific router
app.get('/api/users', requireAuth, async (req, res) => {
    const routerId = req.query.router_id;
    if (!routerId) return res.status(400).json({ error: 'router_id is required' });

    let api;
    try {
        api = await getMTClient(routerId);
        const secrets = await api.write('/ppp/secret/print');

        const rows = await dbAll(`SELECT * FROM users WHERE router_id = ?`, [routerId]);

        const combined = secrets.map(s => {
            const dbUser = (rows || []).find(r => r.username === s.name);
            return {
                id: dbUser ? dbUser.id : null,
                name: s.name,
                profile: s.profile,
                disabled: s.disabled === 'true',
                full_name: dbUser ? dbUser.full_name : '',
                phone: dbUser ? dbUser.phone : '',
                location: dbUser ? dbUser.location : '',
                user_id: dbUser ? dbUser.user_id : '',
                bw_type: dbUser ? dbUser.bw_type : 'shared',
                total_bw: dbUser ? dbUser.total_bw : '',
                email: dbUser ? dbUser.email : '',
                handover_date: dbUser ? dbUser.handover_date : null,
                payment_date: dbUser ? dbUser.payment_date : null,
                expiry_date: dbUser ? dbUser.expiry_date : null,
                price: dbUser ? dbUser.monthly_price : 0,
                created_at: dbUser ? dbUser.created_at : null
            };
        });
        res.json(combined);
    } catch (error) {
        res.status(500).json({ error: 'MikroTik connection failed', details: error.message });
    } finally {
        if (api) await api.close().catch(() => { });
    }
});

// Get single user detail
app.get('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [parseInt(req.params.id)]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Add new PPPoE user (Task 2 — extended fields)
app.post('/api/add-user', requireAuth, async (req, res) => {
    const { username, password, profile, price, router_id,
        full_name, phone, location, user_id, bw_type, total_bw, email,
        handover_date, payment_date } = req.body;
    if (!router_id) return res.status(400).json({ error: 'router_id is required' });
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    let api;
    try {
        api = await getMTClient(router_id);

        await api.write('/ppp/secret/add', [
            '=name=' + username,
            '=password=' + password,
            '=profile=' + (profile || 'default'),
            '=service=pppoe'
        ]);

        const today = new Date().toISOString().slice(0, 10);
        const pDate = payment_date || today;
        const hDate = handover_date || today;

        const expiry = new Date(pDate);
        expiry.setDate(expiry.getDate() + 30);

        const result = await dbRun(
            `INSERT OR REPLACE INTO users
            (username, router_id, full_name, phone, location, user_id, bw_type, total_bw, email, handover_date, payment_date, expiry_date, monthly_price)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, router_id, full_name || '', phone || '', location || '', user_id || '',
                bw_type || 'shared', total_bw || '', email || '', hDate, pDate,
                expiry.toISOString(), price || 0]
        );

        // Record initial payment
        if (price && price > 0) {
            const dbUser = await dbGet(`SELECT id FROM users WHERE username = ? AND router_id = ?`, [username, router_id]);
            if (dbUser) {
                await dbRun(
                    `INSERT INTO payment_history (user_db_id, amount, payment_date, new_expiry, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                    [dbUser.id, price, pDate, expiry.toISOString(), 'Initial payment', req.session.user.username]
                );
            }
        }

        // Auto-enable user on MikroTik after payment
        const found = await api.write('/ppp/secret/print', ['?name=' + username]);
        if (found.length) {
            await api.write('/ppp/secret/set', ['=.id=' + found[0]['.id'], '=disabled=no']);
        }

        res.json({ success: true, expiry: expiry.toISOString() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (api) await api.close().catch(() => { });
    }
});

// Update PPPoE user (Task 3 — CRUD)
app.put('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { full_name, phone, location, user_id, bw_type, total_bw, email,
            monthly_price, profile, password } = req.body;

        await dbRun(
            `UPDATE users SET full_name=?, phone=?, location=?, user_id=?, bw_type=?, total_bw=?, email=?, monthly_price=? WHERE id=?`,
            [full_name || '', phone || '', location || '', user_id || '', bw_type || 'shared',
            total_bw || '', email || '', monthly_price || 0, id]
        );

        // Update MikroTik if profile or password changed
        if (profile || password) {
            let api;
            try {
                api = await getMTClient(user.router_id);
                const found = await api.write('/ppp/secret/print', ['?name=' + user.username]);
                if (found.length) {
                    const updates = ['=.id=' + found[0]['.id']];
                    if (profile) updates.push('=profile=' + profile);
                    if (password) updates.push('=password=' + password);
                    await api.write('/ppp/secret/set', updates);
                }
            } finally {
                if (api) await api.close().catch(() => { });
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete PPPoE user (Task 3)
app.delete('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Delete from MikroTik
        let api;
        try {
            api = await getMTClient(user.router_id);
            const found = await api.write('/ppp/secret/print', ['?name=' + user.username]);
            if (found.length) {
                await api.write('/ppp/secret/remove', ['=.id=' + found[0]['.id']]);
            }
        } finally {
            if (api) await api.close().catch(() => { });
        }

        // Delete from DB (cascade deletes payment_history)
        await dbRun(`DELETE FROM users WHERE id = ?`, [id]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle user status
app.post('/api/toggle', requireAuth, async (req, res) => {
    const { username, targetStatus, router_id } = req.body;
    if (!router_id) return res.status(400).json({ error: 'router_id is required' });

    let api;
    try {
        api = await getMTClient(router_id);
        const disabledValue = targetStatus ? 'yes' : 'no';

        const found = await api.write('/ppp/secret/print', ['?name=' + username]);
        if (!found.length) return res.status(404).json({ error: 'User not found on router' });

        await api.write('/ppp/secret/set', [
            '=.id=' + found[0]['.id'],
            '=disabled=' + disabledValue
        ]);

        res.json({ success: true, message: `User ${username} status changed.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        if (api) await api.close().catch(() => { });
    }
});

// Pay / Renew user (Task 3 — Payment)
app.post('/api/users/:id/pay', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { amount, notes } = req.body;
        const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const paymentDate = new Date().toISOString().slice(0, 10);

        // Calculate new expiry: from current expiry or today, +30 days
        let baseDate = new Date();
        if (user.expiry_date && new Date(user.expiry_date) > baseDate) {
            baseDate = new Date(user.expiry_date);
        }
        baseDate.setDate(baseDate.getDate() + 30);
        const newExpiry = baseDate.toISOString();

        // Update user record
        await dbRun(
            `UPDATE users SET expiry_date = ?, payment_date = ? WHERE id = ?`,
            [newExpiry, paymentDate, id]
        );

        // Record payment
        await dbRun(
            `INSERT INTO payment_history (user_db_id, amount, payment_date, new_expiry, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, amount || user.monthly_price, paymentDate, newExpiry, notes || 'Monthly payment', req.session.user.username]
        );

        // Auto-enable on MikroTik
        let api;
        try {
            api = await getMTClient(user.router_id);
            const found = await api.write('/ppp/secret/print', ['?name=' + user.username]);
            if (found.length) {
                await api.write('/ppp/secret/set', ['=.id=' + found[0]['.id'], '=disabled=no']);
            }
        } finally {
            if (api) await api.close().catch(() => { });
        }

        res.json({ success: true, new_expiry: newExpiry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Payment history for a user (Task 3)
app.get('/api/users/:id/payments', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const payments = await dbAll(
            `SELECT * FROM payment_history WHERE user_db_id = ? ORDER BY created_at DESC`,
            [id]
        );
        res.json(payments);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================
// CRON JOB: Check expiry every 5 minutes + daily
// =============================================

async function runExpiryCheck() {
    console.log('Running expiry check...');
    try {
        const routers = await dbAll(`SELECT * FROM mikrotiks`);
        const now = new Date().toISOString();

        for (const router of routers) {
            const expiredUsers = await dbAll(
                `SELECT username FROM users WHERE router_id = ? AND expiry_date IS NOT NULL AND expiry_date < ?`,
                [router.id, now]
            );

            if (expiredUsers.length === 0) continue;

            let api;
            try {
                api = await getMTClient(router.id);
                for (const user of expiredUsers) {
                    const f = await api.write('/ppp/secret/print', ['?name=' + user.username]);
                    if (f.length && f[0].disabled !== 'true') {
                        await api.write('/ppp/secret/set', ['=.id=' + f[0]['.id'], '=disabled=yes']);
                        console.log(`  ⏰ Disabled expired user: ${user.username}`);
                    }
                }
            } catch (err) {
                console.error(`Cron error on router ${router.name}:`, err.message);
            } finally {
                if (api) await api.close().catch(() => { });
            }
        }
    } catch (err) {
        console.error('Cron job error:', err.message);
    }
}

// Run daily at midnight
cron.schedule('1 0 * * *', runExpiryCheck);
// Also run every 30 minutes for near-realtime expiry
cron.schedule('*/30 * * * *', runExpiryCheck);

// Catch-all: serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));