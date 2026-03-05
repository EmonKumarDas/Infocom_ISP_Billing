// ============ STATE ============
let currentUser = null;
let selectedRouterId = null;
let usersData = [];
let routersData = [];

// ============ DOM ============
const $ = id => document.getElementById(id);
const showLoading = () => $('loading-overlay').classList.remove('hidden');
const hideLoading = () => $('loading-overlay').classList.add('hidden');

// ============ AUTH CHECK ============
(async () => {
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        currentUser = data.user;
        initUI();
    } catch {
        window.location.href = '/login.html';
    }
})();

function initUI() {
    $('user-display').textContent = currentUser.username;
    $('user-role-display').textContent = currentUser.role;
    $('user-avatar').textContent = currentUser.username.charAt(0).toUpperCase();
    if (currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
    // Set date filter to today
    const today = new Date().toISOString().slice(0, 10);
    $('stats-date-filter').value = today;

    loadRouters();
    loadDashboardStats();
    loadRouterStats();
}

// ============ TOAST ============
function showToast(msg, type = 'success') {
    const t = $('toast'), m = $('toast-message'), i = $('toast-icon');
    m.textContent = msg;
    const ok = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    const err = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    i.innerHTML = type === 'success' ? ok : err;
    i.className = type === 'success' ? 'text-green-400' : 'text-red-400';
    t.classList.remove('translate-x-full', 'opacity-0');
    setTimeout(() => t.classList.add('translate-x-full', 'opacity-0'), 4000);
}

// ============ SIDEBAR & NAVIGATION ============
function toggleSidebar() {
    const sb = $('sidebar'), ov = $('sidebar-overlay');
    sb.classList.toggle('-translate-x-full');
    ov.classList.toggle('hidden');
}
$('mobile-toggle').addEventListener('click', toggleSidebar);

function showSection(name) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active-section'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    $('sec-' + name).classList.add('active-section');
    $('nav-' + name).classList.add('active');
    const titles = { dashboard: 'Dashboard', clients: 'PPPoE Clients', routers: 'MikroTik Routers', 'system-users': 'System Users' };
    $('page-title').textContent = titles[name] || 'Dashboard';
    if (name === 'routers') loadRoutersList();
    if (name === 'system-users') loadSystemUsers();
    if (name === 'clients' && selectedRouterId) fetchPPPoEUsers();
    if (window.innerWidth < 1024) toggleSidebar();
}

// ============ MODALS ============
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

async function openAddUserModal() {
    if (!selectedRouterId) { showToast('Select a router first', 'error'); return; }
    $('form-add-user').reset();
    const today = new Date().toISOString().slice(0, 10);
    $('au-handover').value = today;
    $('au-paydate').value = today;
    await loadProfilesDropdown('au-profile');
    openModal('modal-add-user');
}

async function loadProfilesDropdown(selectId) {
    const sel = $(selectId);
    sel.innerHTML = '<option value="">Loading...</option>';
    try {
        const res = await fetch(`/api/profiles?router_id=${selectedRouterId}`, { credentials: 'include' });
        if (!res.ok) throw new Error();
        const profiles = await res.json();
        sel.innerHTML = profiles.map(p => `<option value="${p}">${p}</option>`).join('');
        if (profiles.length === 0) sel.innerHTML = '<option value="default">default</option>';
    } catch {
        sel.innerHTML = '<option value="default">default</option>';
    }
}

function openRouterModal(router) {
    $('form-router').reset();
    if (router) {
        $('router-modal-title').textContent = 'Edit Router';
        $('rt-id').value = router.id;
        $('rt-name').value = router.name;
        $('rt-host').value = router.host;
        $('rt-user').value = router.username;
        $('rt-port').value = router.api_port;
        $('rt-pass').placeholder = 'Leave blank to keep existing';
    } else {
        $('router-modal-title').textContent = 'Add Router';
        $('rt-id').value = '';
        $('rt-pass').placeholder = 'Password';
        $('rt-pass').required = true;
    }
    openModal('modal-router');
}

function openSysUserModal() {
    $('form-sys-user').reset();
    openModal('modal-sys-user');
}

// ============ LOGOUT ============
async function logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
}

// ============ LOAD ROUTERS ============
async function loadRouters() {
    try {
        const res = await fetch('/api/routers', { credentials: 'include' });
        routersData = await res.json();
        const sel = $('router-select');
        sel.innerHTML = '<option value="">— Select Router —</option>';
        routersData.forEach(r => {
            sel.innerHTML += `<option value="${r.id}">${r.name} (${r.host})</option>`;
        });
    } catch (e) { console.error(e); }
}

$('router-select').addEventListener('change', (e) => {
    selectedRouterId = e.target.value || null;
    if (selectedRouterId) fetchPPPoEUsers();
    else {
        usersData = [];
        renderUsersTable();
    }
});

// ============ DASHBOARD STATS (Task 4) ============
async function loadDashboardStats() {
    try {
        const filterDate = $('stats-date-filter').value || new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/dashboard-stats?date=${filterDate}`, { credentials: 'include' });
        const d = await res.json();
        $('stat-revenue').textContent = '৳' + (d.totalRevenue || 0).toLocaleString();
        $('stat-active').textContent = d.totalActive || 0;
        $('stat-expired').textContent = d.totalExpired || 0;
        $('stat-routers').textContent = d.totalRouters || 0;
        $('stat-new-clients').textContent = d.newClients || 0;
    } catch (e) { console.error(e); }
}

// Router-based stats (Task 6)
async function loadRouterStats() {
    try {
        const filterDate = $('stats-date-filter').value || new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/router-stats?date=${filterDate}`, { credentials: 'include' });
        const stats = await res.json();
        const grid = $('router-stats-grid');

        if (!stats.length) {
            grid.innerHTML = '<div class="col-span-full text-center text-gray-500 text-sm py-6">No routers configured yet.</div>';
            return;
        }

        grid.innerHTML = stats.map(s => `
            <div class="glass rounded-2xl p-5 stat-card">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-semibold text-white text-sm">${s.routerName}</h4>
                    <span class="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-lg">ID: ${s.routerId}</span>
                </div>
                <div class="grid grid-cols-3 gap-3 text-center">
                    <div>
                        <p class="text-lg font-bold text-emerald-400">৳${(s.revenue || 0).toLocaleString()}</p>
                        <p class="text-[10px] text-gray-500 uppercase">Revenue</p>
                    </div>
                    <div>
                        <p class="text-lg font-bold text-brand-400">${s.active}</p>
                        <p class="text-[10px] text-gray-500 uppercase">Active</p>
                    </div>
                    <div>
                        <p class="text-lg font-bold text-red-400">${s.expired}</p>
                        <p class="text-[10px] text-gray-500 uppercase">Expired</p>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

// Date filter change
$('stats-date-filter').addEventListener('change', () => {
    loadDashboardStats();
    loadRouterStats();
});

// ============ PPPoE USERS ============
async function fetchPPPoEUsers() {
    if (!selectedRouterId) return;
    showLoading();
    try {
        const res = await fetch(`/api/users?router_id=${selectedRouterId}`, { credentials: 'include' });
        if (!res.ok) { const d = await res.json(); throw new Error(d.details || d.error); }
        usersData = await res.json();
        renderUsersTable();
    } catch (e) {
        usersData = [];
        $('users-table-body').innerHTML = `<tr><td colspan="9" class="px-5 py-8 text-center text-red-400 text-sm">${e.message}</td></tr>`;
    } finally { hideLoading(); }
}

$('search-input').addEventListener('input', () => renderUsersTable());

function renderUsersTable() {
    const tb = $('users-table-body');
    const term = ($('search-input').value || '').toLowerCase();
    const filtered = usersData.filter(u =>
        u.name.toLowerCase().includes(term) ||
        (u.full_name || '').toLowerCase().includes(term) ||
        (u.phone || '').toLowerCase().includes(term)
    );

    if (!selectedRouterId) {
        tb.innerHTML = '<tr><td colspan="9" class="px-5 py-10 text-center text-gray-500 text-sm">Select a router to view PPPoE users</td></tr>';
        return;
    }
    if (filtered.length === 0) {
        tb.innerHTML = '<tr><td colspan="9" class="px-5 py-10 text-center text-gray-500 text-sm">No users found</td></tr>';
        return;
    }

    tb.innerHTML = filtered.map(u => {
        const active = !u.disabled;
        const badge = active
            ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><span class="w-1.5 h-1.5 mr-1 bg-emerald-500 rounded-full animate-pulse"></span>Active</span>'
            : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20"><span class="w-1.5 h-1.5 mr-1 bg-red-500 rounded-full"></span>Disabled</span>';
        const payDate = formatDate(u.payment_date);
        const expiry = formatDate(u.expiry_date);
        const hasDbRecord = u.id !== null;

        // Actions
        let actions = `<button onclick="toggleUser('${u.name}',${u.disabled})" class="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg transition-colors text-xs" title="${active ? 'Disable' : 'Enable'}">${active ? '⏸' : '▶'}</button>`;
        if (hasDbRecord) {
            actions += ` <button onclick="openViewUserModal(${u.id})" class="text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 px-2 py-1 rounded-lg transition-colors text-xs" title="View">👁</button>`;
            actions += ` <button onclick="openEditUserModal(${u.id}, '${u.name}', '${u.profile}')" class="text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded-lg transition-colors text-xs" title="Edit">✏️</button>`;
            actions += ` <button onclick="openPayModal(${u.id}, '${u.name}', ${u.price})" class="text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded-lg transition-colors text-xs" title="Pay">💰</button>`;
            actions += ` <button onclick="openPaymentHistory(${u.id}, '${u.name}')" class="text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 px-2 py-1 rounded-lg transition-colors text-xs" title="History">📋</button>`;
            actions += ` <button onclick="deleteUser(${u.id}, '${u.name}')" class="text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2 py-1 rounded-lg transition-colors text-xs" title="Delete">🗑</button>`;
        }

        return `<tr class="hover:bg-gray-800/30 transition-colors border-b border-gray-800/40">
            <td class="px-4 py-3"><div class="flex items-center"><div class="h-7 w-7 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-xs font-bold text-white mr-2">${u.name.charAt(0).toUpperCase()}</div><span class="text-sm font-medium">${u.name}</span></div></td>
            <td class="px-4 py-3 text-sm text-gray-300">${u.full_name || '<span class="text-gray-600 italic">—</span>'}</td>
            <td class="px-4 py-3 text-sm text-gray-300">${u.phone || '<span class="text-gray-600 italic">—</span>'}</td>
            <td class="px-4 py-3 text-sm text-gray-300">${u.profile}</td>
            <td class="px-4 py-3">${badge}</td>
            <td class="px-4 py-3 text-sm">${payDate}</td>
            <td class="px-4 py-3 text-sm">${expiry}</td>
            <td class="px-4 py-3 text-sm text-gray-300">৳${u.price || 0}</td>
            <td class="px-4 py-3 text-right text-sm space-x-1">${actions}</td>
        </tr>`;
    }).join('');
}

function formatDate(ds) {
    if (!ds) return '<span class="text-gray-500 italic text-xs">—</span>';
    const d = new Date(ds), expired = d < new Date();
    return `<span class="${expired ? 'text-red-400 font-semibold' : 'text-gray-300'} text-xs">${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>`;
}

// Toggle user status
async function toggleUser(username, currentDisabled) {
    showLoading();
    try {
        const res = await fetch('/api/toggle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ username, targetStatus: !currentDisabled, router_id: selectedRouterId })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast(`${username} ${!currentDisabled ? 'disabled' : 'enabled'}`);
        await fetchPPPoEUsers();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
}

// ============ ADD USER (Task 2) ============
$('form-add-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const res = await fetch('/api/add-user', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({
                username: $('au-name').value,
                password: $('au-pass').value,
                profile: $('au-profile').value,
                price: parseFloat($('au-price').value) || 0,
                router_id: selectedRouterId,
                full_name: $('au-fullname').value,
                phone: $('au-phone').value,
                location: $('au-location').value,
                user_id: $('au-userid').value,
                bw_type: $('au-bwtype').value,
                total_bw: $('au-totalbw').value,
                email: $('au-email').value,
                handover_date: $('au-handover').value,
                payment_date: $('au-paydate').value
            })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast('User created successfully');
        closeModal('modal-add-user');
        await fetchPPPoEUsers();
        loadDashboardStats();
        loadRouterStats();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
});

// ============ EDIT USER (Task 3) ============
async function openEditUserModal(dbId, username, currentProfile) {
    $('eu-dbid').value = dbId;
    $('eu-name').value = username;
    $('eu-username-hidden').value = username;
    $('eu-pass').value = '';

    // Load profiles
    await loadProfilesDropdown('eu-profile');

    // Load current user data
    try {
        const res = await fetch(`/api/users/${dbId}`, { credentials: 'include' });
        const u = await res.json();
        $('eu-fullname').value = u.full_name || '';
        $('eu-phone').value = u.phone || '';
        $('eu-userid').value = u.user_id || '';
        $('eu-email').value = u.email || '';
        $('eu-location').value = u.location || '';
        $('eu-bwtype').value = u.bw_type || 'shared';
        $('eu-totalbw').value = u.total_bw || '';
        $('eu-price').value = u.monthly_price || 0;
        // Set profile
        if ($('eu-profile').querySelector(`option[value="${currentProfile}"]`)) {
            $('eu-profile').value = currentProfile;
        }
    } catch (e) { console.error(e); }

    openModal('modal-edit-user');
}

$('form-edit-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const id = $('eu-dbid').value;
        const body = {
            full_name: $('eu-fullname').value,
            phone: $('eu-phone').value,
            location: $('eu-location').value,
            user_id: $('eu-userid').value,
            bw_type: $('eu-bwtype').value,
            total_bw: $('eu-totalbw').value,
            email: $('eu-email').value,
            monthly_price: parseFloat($('eu-price').value) || 0,
            profile: $('eu-profile').value
        };
        const pass = $('eu-pass').value;
        if (pass) body.password = pass;

        const res = await fetch(`/api/users/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(body)
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast('Client updated');
        closeModal('modal-edit-user');
        await fetchPPPoEUsers();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
});

// ============ VIEW USER DETAIL ============
async function openViewUserModal(dbId) {
    try {
        const res = await fetch(`/api/users/${dbId}`, { credentials: 'include' });
        const u = await res.json();
        const html = `
            <div class="grid grid-cols-2 gap-3 text-sm">
                <div><span class="text-gray-500">Username:</span><p class="font-medium">${u.username}</p></div>
                <div><span class="text-gray-500">Full Name:</span><p class="font-medium">${u.full_name || '—'}</p></div>
                <div><span class="text-gray-500">Phone:</span><p class="font-medium">${u.phone || '—'}</p></div>
                <div><span class="text-gray-500">Email:</span><p class="font-medium">${u.email || '—'}</p></div>
                <div><span class="text-gray-500">Location:</span><p class="font-medium">${u.location || '—'}</p></div>
                <div><span class="text-gray-500">User ID:</span><p class="font-medium">${u.user_id || '—'}</p></div>
                <div><span class="text-gray-500">BW Type:</span><p class="font-medium capitalize">${u.bw_type || '—'}</p></div>
                <div><span class="text-gray-500">Total BW:</span><p class="font-medium">${u.total_bw || '—'}</p></div>
                <div><span class="text-gray-500">Price:</span><p class="font-medium text-emerald-400">৳${u.monthly_price || 0}</p></div>
                <div><span class="text-gray-500">Handover Date:</span><p class="font-medium">${u.handover_date ? new Date(u.handover_date).toLocaleDateString() : '—'}</p></div>
                <div><span class="text-gray-500">Payment Date:</span><p class="font-medium">${u.payment_date ? new Date(u.payment_date).toLocaleDateString() : '—'}</p></div>
                <div><span class="text-gray-500">Expiry Date:</span><p class="font-medium ${u.expiry_date && new Date(u.expiry_date) < new Date() ? 'text-red-400' : 'text-emerald-400'}">${u.expiry_date ? new Date(u.expiry_date).toLocaleDateString() : '—'}</p></div>
                <div><span class="text-gray-500">Created At:</span><p class="font-medium">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</p></div>
            </div>`;
        $('view-user-content').innerHTML = html;
        openModal('modal-view-user');
    } catch (e) { showToast('Failed to load user details', 'error'); }
}

// ============ DELETE USER (Task 3) ============
async function deleteUser(dbId, username) {
    if (!confirm(`Delete "${username}" from both MikroTik and database? This cannot be undone.`)) return;
    showLoading();
    try {
        const res = await fetch(`/api/users/${dbId}`, { method: 'DELETE', credentials: 'include' });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast(`${username} deleted`);
        await fetchPPPoEUsers();
        loadDashboardStats();
        loadRouterStats();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
}

// ============ PAYMENT (Task 3) ============
function openPayModal(dbId, username, price) {
    $('pay-user-id').value = dbId;
    $('pay-username').value = username;
    $('pay-amount').value = price || 0;
    $('pay-notes').value = 'Monthly payment';
    openModal('modal-pay');
}

$('form-pay').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const id = $('pay-user-id').value;
        const res = await fetch(`/api/users/${id}/pay`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({
                amount: parseFloat($('pay-amount').value) || 0,
                notes: $('pay-notes').value
            })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast('Payment recorded — user auto-activated');
        closeModal('modal-pay');
        await fetchPPPoEUsers();
        loadDashboardStats();
        loadRouterStats();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
});

// ============ PAYMENT HISTORY (Task 3) ============
async function openPaymentHistory(dbId, username) {
    $('history-username').textContent = username;
    $('history-table-body').innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-500">Loading...</td></tr>';
    openModal('modal-history');

    try {
        const res = await fetch(`/api/users/${dbId}/payments`, { credentials: 'include' });
        const payments = await res.json();

        if (!payments.length) {
            $('history-table-body').innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-500">No payment records found</td></tr>';
            return;
        }

        $('history-table-body').innerHTML = payments.map((p, i) => `
            <tr class="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                <td class="px-4 py-2 text-gray-400">${i + 1}</td>
                <td class="px-4 py-2">${new Date(p.payment_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                <td class="px-4 py-2 text-emerald-400 font-medium">৳${p.amount}</td>
                <td class="px-4 py-2 text-xs">${p.new_expiry ? new Date(p.new_expiry).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                <td class="px-4 py-2 text-gray-400">${p.notes || '—'}</td>
                <td class="px-4 py-2 text-gray-400">${p.created_by || '—'}</td>
            </tr>
        `).join('');
    } catch (e) {
        $('history-table-body').innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-red-400">Failed to load history</td></tr>';
    }
}

// ============ ROUTERS CRUD ============
async function loadRoutersList() {
    try {
        const res = await fetch('/api/routers', { credentials: 'include' });
        const list = await res.json();
        const c = $('routers-list');
        if (list.length === 0) {
            c.innerHTML = '<div class="col-span-full text-center text-gray-500 py-12">No routers configured. Add one to get started.</div>';
            return;
        }
        c.innerHTML = list.map(r => `
            <div class="glass rounded-2xl p-5 flex flex-col">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-semibold text-white">${r.name}</h4>
                    <span class="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-lg">ID: ${r.id}</span>
                </div>
                <p class="text-sm text-gray-400 mb-1"><span class="text-gray-500">Host:</span> ${r.host}</p>
                <p class="text-sm text-gray-400 mb-1"><span class="text-gray-500">User:</span> ${r.username}</p>
                <p class="text-sm text-gray-400 mb-3"><span class="text-gray-500">Port:</span> ${r.api_port}</p>
                <div class="flex gap-2 mt-auto">
                    <button onclick='openRouterModal(${JSON.stringify(r)})' class="flex-1 text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors">Edit</button>
                    <button onclick="deleteRouter(${r.id})" class="flex-1 text-xs px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

$('form-router').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    const id = $('rt-id').value;
    const body = {
        name: $('rt-name').value, host: $('rt-host').value,
        username: $('rt-user').value, api_port: parseInt($('rt-port').value) || 8728
    };
    const pass = $('rt-pass').value;
    if (pass) body.password = pass;

    try {
        const url = id ? `/api/routers/${id}` : '/api/routers';
        const method = id ? 'PUT' : 'POST';
        if (!id && !pass) { showToast('Password is required', 'error'); hideLoading(); return; }
        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(body)
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast(id ? 'Router updated' : 'Router added');
        closeModal('modal-router');
        loadRoutersList();
        loadRouters();
        loadDashboardStats();
        loadRouterStats();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
});

async function deleteRouter(id) {
    if (!confirm('Delete this router and all its billing data?')) return;
    showLoading();
    try {
        const res = await fetch(`/api/routers/${id}`, { method: 'DELETE', credentials: 'include' });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast('Router deleted');
        if (selectedRouterId == id) { selectedRouterId = null; $('router-select').value = ''; usersData = []; renderUsersTable(); }
        loadRoutersList();
        loadRouters();
        loadDashboardStats();
        loadRouterStats();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
}

// ============ SYSTEM USERS ============
async function loadSystemUsers() {
    try {
        const res = await fetch('/api/system-users', { credentials: 'include' });
        const list = await res.json();
        const tb = $('sys-users-body');
        if (list.length === 0) {
            tb.innerHTML = '<tr><td colspan="3" class="px-5 py-10 text-center text-gray-500 text-sm">No users</td></tr>';
            return;
        }
        tb.innerHTML = list.map(u => `<tr class="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
            <td class="px-5 py-3 text-sm font-medium">${u.username}</td>
            <td class="px-5 py-3"><span class="text-xs px-2 py-0.5 rounded-full ${u.role === 'admin' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-brand-500/10 text-brand-400 border border-brand-500/20'} font-medium">${u.role}</span></td>
            <td class="px-5 py-3 text-right">${u.id !== currentUser.id ? `<button onclick="deleteSysUser(${u.id})" class="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 rounded-lg transition-colors">Delete</button>` : '<span class="text-xs text-gray-600">You</span>'}</td>
        </tr>`).join('');
    } catch (e) { console.error(e); }
}

$('form-sys-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const res = await fetch('/api/system-users', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ username: $('su-name').value, password: $('su-pass').value, role: $('su-role').value })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast('Dashboard user created');
        closeModal('modal-sys-user');
        loadSystemUsers();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
});

async function deleteSysUser(id) {
    if (!confirm('Delete this dashboard user?')) return;
    showLoading();
    try {
        const res = await fetch(`/api/system-users/${id}`, { method: 'DELETE', credentials: 'include' });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        showToast('User deleted');
        loadSystemUsers();
    } catch (e) { showToast(e.message, 'error'); }
    finally { hideLoading(); }
}
