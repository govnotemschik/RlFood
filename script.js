/**
 * RNL Food - Modern JavaScript
 * Complete application logic with Kitchen & Scheduled Orders
 */

// ==================== State ====================
const State = {
    user: null,
    token: localStorage.getItem('token'),
    cart: JSON.parse(localStorage.getItem('cart') || '{}'),
    favorites: new Set(JSON.parse(localStorage.getItem('favorites') || '[]')),
    products: [],
    orders: [],
    notifications: [],
    currentScreen: 'start',
    selectedAmount: 100,
    activePromo: null,
    isDark: localStorage.getItem('theme') === 'dark',
    colorScheme: localStorage.getItem('colorScheme') || 'emerald',
    mealPlan: JSON.parse(localStorage.getItem('mealPlan') || '{}'),
    productsLoaded: false,
    serverFavorites: new Set() // Избранное с сервера
};

// ==================== API ====================
const API = {
    base: window.location.origin,
    async request(endpoint, options = {}) {
        const config = {
            headers: { 'Content-Type': 'application/json', ...(State.token && { 'Authorization': `Bearer ${State.token}` }) },
            ...options
        };
        if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
        try {
            const res = await fetch(`${this.base}${endpoint}`, config);
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error('API Error: Invalid JSON response', text.substring(0, 200));
                throw new Error('Ошибка сервера: некорректный ответ');
            }
            if (!res.ok) throw new Error(data.error || `API Error: ${res.status}`);
            return data;
        } catch (e) { console.error('API Error:', e); throw e; }
    },
    get: (ep) => API.request(ep),
    post: (ep, body) => API.request(ep, { method: 'POST', body }),
    put: (ep, body) => API.request(ep, { method: 'PUT', body }),
    del: (ep) => API.request(ep, { method: 'DELETE' })
};

// ==================== Toast ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toasts') || createToastsContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.style.animation = 'toastOut 0.3s ease forwards', 3000);
    setTimeout(() => toast.remove(), 3300);
}
function createToastsContainer() {
    const div = document.createElement('div');
    div.id = 'toasts';
    document.body.appendChild(div);
    return div;
}

// ==================== Navigation ====================
function navigate(screen) {
    const authRequired = ['profile', 'order-history', 'payment', 'settings', 'meal-planner', 'kitchen'];
    if (authRequired.includes(screen) && !State.user) { showToast('Войдите для доступа', 'warning'); navigate('login'); return; }
    if (screen === 'admin' && State.user?.role !== 'admin') { showToast('Доступ запрещён', 'error'); return; }
    if (screen === 'kitchen' && !['admin', 'kitchen', 'staff'].includes(State.user?.role)) { showToast('Доступ запрещён', 'error'); return; }
    
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screen}`)?.classList.add('active');
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-link[data-screen="${screen}"]`)?.classList.add('active');
    State.currentScreen = screen;
    
    if (screen === 'assortment') {
        // Не перезагружаем если уже есть продукты
        if (!State.productsLoaded || State.products.length === 0) {
            loadProducts();
        } else {
            renderProducts();
        }
    }
    if (screen === 'profile') loadProfile();
    if (screen === 'order-history') loadOrders();
    if (screen === 'admin') loadAdminStats();
    if (screen === 'favorites') loadFavorites();
    if (screen === 'meal-planner') loadMealPlan();
    if (screen === 'kitchen') loadKitchenOrders();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== Auth ====================
async function handleLogin(e) {
    e.preventDefault();
    try {
        const data = await API.post('/api/login', { username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value });
        State.user = data.user;
        State.token = data.token;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        updateUserUI();
        showToast(`Добро пожаловать, ${data.user.username}!`, 'success');
        navigate('assortment');
    } catch (e) { showToast(e.message, 'error'); }
}

async function handleRegister(e) {
    e.preventDefault();
    try {
        const data = { username: document.getElementById('regUsername').value, password: document.getElementById('regPassword').value, full_name: document.getElementById('regFullname').value, class_name: document.getElementById('regGrade').value };
        const res = await API.post('/api/register', data);
        State.user = res.user;
        State.token = res.token;
        localStorage.setItem('token', res.token);
        localStorage.setItem('user', JSON.stringify(res.user));
        updateUserUI();
        showToast('Аккаунт создан!', 'success');
        navigate('assortment');
    } catch (e) { showToast(e.message, 'error'); }
}

async function logout() {
    try { await API.post('/api/logout'); } catch {}
    State.user = null; State.token = null;
    localStorage.removeItem('token'); localStorage.removeItem('user');
    updateUserUI();
    showToast('Вы вышли', 'info');
    navigate('start');
}

function updateUserUI() {
    const isLoggedIn = !!State.user;
    document.getElementById('loginBtn').style.display = isLoggedIn ? 'none' : 'flex';
    document.getElementById('logoutBtn').style.display = isLoggedIn ? 'flex' : 'none';
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = State.user?.role === 'admin' ? 'flex' : 'none');
    document.querySelectorAll('.kitchen-only').forEach(el => el.style.display = ['admin', 'kitchen', 'staff'].includes(State.user?.role) ? 'flex' : 'none');
    document.getElementById('dropdownName').textContent = State.user?.username || 'Гость';
    document.getElementById('dropdownRole').textContent = isLoggedIn ? (State.user.full_name || 'Пользователь') : 'Не авторизован';
    if (State.user) { document.getElementById('profileName').textContent = State.user.username; document.getElementById('balanceAmount').textContent = `${(State.user.balance || 0).toFixed(2)} ₴`; }
}

// ==================== Products ====================
async function loadProducts(forceReload = false) {
    // Не загружаем повторно если уже загружено (если не forceReload)
    if (!forceReload && State.productsLoaded && State.products.length > 0) {
        renderProducts();
        return;
    }
    
    // Очищаем перед загрузкой
    State.products = [];
    
    try {
        const data = await API.get('/api/menu');
        if (!Array.isArray(data)) {
            console.error('Invalid API response:', data);
            State.products = getFallbackProducts();
        } else {
            // Убираем дубликаты по ID и по имени (case-insensitive)
            const seenIds = new Set();
            const seenNames = new Set();
            State.products = data
                .filter(p => p && p.id != null && p.name) // Фильтруем невалидные
                .filter(p => {
                    // Пропускаем если уже видели этот ID
                    const idStr = String(p.id).trim();
                    if (seenIds.has(idStr)) return false;
                    
                    // Пропускаем если уже видели такое имя (case-insensitive)
                    const nameLower = (p.name || '').toLowerCase().trim();
                    if (seenNames.has(nameLower)) return false;
                    
                    seenIds.add(idStr);
                    seenNames.add(nameLower);
                    return true;
                })
                .map(p => ({ 
                    id: String(p.id).trim(), 
                    name: p.name.trim(), 
                    description: p.description || '',
                    price: parseFloat(p.price) || 0, 
                    category: p.category || 'Горячее', 
                    calories: parseInt(p.calories) || 0, 
                    rating: parseFloat(p.rating) || 4.0,
                    allergens: p.allergens || [], // Массив аллергенов
                    is_new: p.is_new || false,
                    is_popular: p.is_popular || false,
                    image: p.image || null
                }));
        }
        State.productsLoaded = true;
        renderProducts();
        console.log('Products loaded:', State.products.length, 'unique items');
    } catch (e) { 
        console.error('Load products error:', e);
        State.products = getFallbackProducts(); 
        State.productsLoaded = true;
        renderProducts(); 
    }
}

function getFallbackProducts() {
    return [
        { id: '1', name: 'Куриный суп', price: 25, category: 'Горячее', calories: 180, rating: 4.5 },
        { id: '2', name: 'Борщ', price: 30, category: 'Горячее', calories: 250, rating: 4.7 },
        { id: '3', name: 'Салат Оливье', price: 30, category: 'Салаты', calories: 220, rating: 4.4 },
        { id: '4', name: 'Чай', price: 10, category: 'Напитки', calories: 0, rating: 4.5 },
        { id: '5', name: 'Кофе', price: 20, category: 'Напитки', calories: 5, rating: 4.7 },
        { id: '6', name: 'Шоколадный торт', price: 35, category: 'Десерты', calories: 350, rating: 4.9 }
    ];
}

function renderProducts(filter = 'all', search = '') {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    let products = State.products;
    if (filter !== 'all') products = products.filter(p => p.category === filter);
    if (search) products = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (products.length === 0) { document.getElementById('emptyProducts').style.display = 'block'; return; }
    document.getElementById('emptyProducts').style.display = 'none';
    grid.innerHTML = products.map((p, i) => {
        const isFavorite = State.favorites.has(String(p.id));
        // Формируем бейджи для новинок и популярных
        const badges = [];
        if (p.is_new) badges.push('<span class="product-badge new-badge">NEW</span>');
        if (p.is_popular) badges.push('<span class="product-badge popular-badge"><i class="fas fa-fire"></i></span>');
        const badgesHtml = badges.length ? `<div class="pc-badges">${badges.join('')}</div>` : '';
        
        // Формируем аллергены
        let allergensHtml = '';
        if (p.allergens && p.allergens.length > 0) {
            const allergenList = Array.isArray(p.allergens) ? p.allergens : p.allergens.split(',');
            const allergenIcons = allergenList.map(a => getAllergenIcon(a.trim())).join('');
            allergensHtml = `<div class="pc-allergens" title="Аллергены: ${allergenList.join(', ')}">${allergenIcons}</div>`;
        }
        
        return `<div class="product-card ${isFavorite ? 'in-favorites' : ''}" onclick="showProductDetails('${p.id}')">
            <div class="pc-image">
                ${badgesHtml}
                <button class="pc-favorite ${isFavorite ? 'active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${p.id}')"><i class="fas fa-heart"></i></button>
                <i class="fas ${getCategoryIcon(p.category)}"></i>
            </div>
            <div class="pc-content">
                <div class="pc-category">${p.category}</div>
                <div class="pc-name">${p.name}</div>
                ${allergensHtml}
                <div class="pc-meta"><span><i class="fas fa-fire"></i> ${p.calories} ккал</span><span class="pc-rating"><i class="fas fa-star"></i> ${p.rating}</span></div>
                <div class="pc-footer">
                    <div class="pc-price">${p.price} ₴</div>
                    <div class="pc-actions">${State.cart[p.id] ? `<div class="pc-qty"><button onclick="event.stopPropagation(); updateCart('${p.id}', -1)"><i class="fas fa-minus"></i></button><span>${State.cart[p.id]}</span><button onclick="event.stopPropagation(); updateCart('${p.id}', 1)"><i class="fas fa-plus"></i></button></div>` : `<button class="pc-add" onclick="event.stopPropagation(); updateCart('${p.id}', 1)"><i class="fas fa-plus"></i></button>`}</div>
                </div>
            </div>
        </div>`;
    }).join('');
    updateCartBadge();
}

// Получить иконку для аллергена
function getAllergenIcon(allergen) {
    const icons = {
        'gluten': '<span class="allergen-icon" title="Глютен">🌾</span>',
        'milk': '<span class="allergen-icon" title="Молоко">🥛</span>',
        'eggs': '<span class="allergen-icon" title="Яйца">🥚</span>',
        'fish': '<span class="allergen-icon" title="Рыба">🐟</span>',
        'peanuts': '<span class="allergen-icon" title="Арахис">🥜</span>',
        'soy': '<span class="allergen-icon" title="Соя">🫘</span>',
        'wheat': '<span class="allergen-icon" title="Пшеница">🌾</span>',
        'lactose': '<span class="allergen-icon" title="Лактоза">🧀</span>',
        'nuts': '<span class="allergen-icon" title="Орехи">🌰</span>'
    };
    return icons[allergen.toLowerCase()] || `<span class="allergen-icon" title="${allergen}">⚠️</span>`;
}

// Показать детали продукта
function showProductDetails(productId) {
    const p = State.products.find(pr => String(pr.id) === String(productId));
    if (!p) return showToast('Товар не найден', 'error');
    
    // Формируем аллергены
    let allergensSection = '';
    if (p.allergens && p.allergens.length > 0) {
        const allergenList = Array.isArray(p.allergens) ? p.allergens : p.allergens.split(',');
        allergensSection = `
            <div style="margin-bottom:16px;padding:12px;background:var(--gray-50);border-radius:8px;">
                <div style="font-weight:500;margin-bottom:8px;color:var(--warning);"><i class="fas fa-exclamation-triangle"></i> Аллергены</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${allergenList.map(a => `<span style="background:white;padding:4px 12px;border-radius:20px;font-size:13px;border:1px solid var(--gray-200);">${getAllergenIcon(a.trim())} ${a.trim()}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    // Бейджи
    const badges = [];
    if (p.is_new) badges.push('<span class="product-badge new-badge" style="font-size:12px;">NEW - Новинка!</span>');
    if (p.is_popular) badges.push('<span class="product-badge popular-badge" style="font-size:12px;"><i class="fas fa-fire"></i> Популярное</span>');
    
    openModal(`
        <div style="max-height:70vh;overflow-y:auto;">
            <div style="text-align:center;margin-bottom:20px;">
                <div style="width:80px;height:80px;margin:0 auto 16px;background:var(--primary-alpha);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                    <i class="fas ${getCategoryIcon(p.category)} fa-2x" style="color:var(--primary);"></i>
                </div>
                <h2 style="margin-bottom:8px;">${p.name}</h2>
                ${badges.length ? `<div style="display:flex;gap:8px;justify-content:center;margin-bottom:8px;">${badges.join('')}</div>` : ''}
                <div style="color:var(--gray-500);font-size:14px;">${p.category}</div>
            </div>
            
            ${p.description ? `<p style="color:var(--gray-600);margin-bottom:16px;line-height:1.6;">${p.description}</p>` : ''}
            
            ${allergensSection}
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:var(--primary);">${p.calories}</div>
                    <div style="font-size:12px;color:var(--gray-500);">ккал</div>
                </div>
                <div style="background:var(--gray-50);padding:12px;border-radius:8px;text-align:center;">
                    <div style="font-size:24px;font-weight:700;color:#F59E0B;"><i class="fas fa-star"></i> ${p.rating}</div>
                    <div style="font-size:12px;color:var(--gray-500);">рейтинг</div>
                </div>
            </div>
            
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:linear-gradient(135deg,var(--primary),var(--secondary));border-radius:12px;color:white;margin-bottom:16px;">
                <div>
                    <div style="font-size:14px;opacity:0.9;">Цена</div>
                    <div style="font-size:28px;font-weight:700;">${p.price} ₴</div>
                </div>
                <button class="btn" style="background:white;color:var(--primary);padding:12px 24px;font-weight:600;" onclick="closeModal(); updateCart('${p.id}', 1);">
                    <i class="fas fa-cart-plus"></i> В корзину
                </button>
            </div>
            
            <button class="btn btn-secondary btn-block" onclick="showProductReviews('${p.id}')">
                <i class="fas fa-star"></i> Отзывы и рейтинг
            </button>
        </div>
    `);
}

let currentFilter = 'all';
let currentSearch = '';

function getCategoryIcon(cat) { return { 'Горячее': 'fa-utensils', 'Салаты': 'fa-leaf', 'Напитки': 'fa-coffee', 'Десерты': 'fa-ice-cream' }[cat] || 'fa-utensils'; }

function searchProducts() {
    currentSearch = document.getElementById('searchInput')?.value || '';
    currentFilter = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';
    renderProducts(currentFilter, currentSearch);
}

function filterCategory(cat) { 
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active')); 
    document.querySelector(`.filter-chip[data-filter="${cat}"]`)?.classList.add('active'); 
    currentFilter = cat;
    currentSearch = document.getElementById('searchInput')?.value || '';
    renderProducts(currentFilter, currentSearch); 
}

// ==================== Cart ====================
function updateCart(productId, change) {
    if (!State.user) { showToast('Войдите для заказа', 'warning'); navigate('login'); return; }
    State.cart[productId] = (State.cart[productId] || 0) + change;
    if (State.cart[productId] <= 0) delete State.cart[productId];
    localStorage.setItem('cart', JSON.stringify(State.cart));
    updateCartBadge(); renderProducts(); renderCart();
    if (change > 0) { const p = State.products.find(pr => String(pr.id) === String(productId)); showToast(`${p?.name || 'Товар'} добавлен`, 'success'); }
}
function updateCartBadge() { const total = Object.values(State.cart).reduce((a, b) => a + b, 0); document.getElementById('cartBadge').textContent = total; document.getElementById('mobileCartBadge').textContent = total; }
function toggleCart() { document.getElementById('cartSidebar').classList.toggle('open'); renderCart(); }

function renderCart() {
    const body = document.getElementById('cartBody'), footer = document.getElementById('cartFooter');
    const items = Object.entries(State.cart);
    if (items.length === 0) { body.innerHTML = '<div class="cart-empty"><i class="fas fa-shopping-bag"></i><p>Корзина пуста</p></div>'; footer.style.display = 'none'; return; }
    if (State.products.length === 0) { loadProducts().then(() => renderCart()); return; }
    footer.style.display = 'block';
    let subtotal = 0;
    body.innerHTML = items.map(([id, qty]) => {
        const p = State.products.find(pr => String(pr.id) === String(id));
        if (!p) return '';
        subtotal += p.price * qty;
        return `<div class="cart-item"><div class="ci-info"><div class="ci-name">${p.name}</div><div class="ci-price">${p.price} ₴ × ${qty}</div></div><div class="ci-qty"><button onclick="updateCart('${id}', -1)"><i class="fas fa-minus"></i></button><span>${qty}</span><button onclick="updateCart('${id}', 1)"><i class="fas fa-plus"></i></button></div></div>`;
    }).join('');
    document.getElementById('cartSubtotal').textContent = `${subtotal.toFixed(2)} ₴`;
    document.getElementById('cartTotal').textContent = `${subtotal.toFixed(2)} ₴`;
}

function clearCart() { State.cart = {}; localStorage.removeItem('cart'); updateCartBadge(); renderCart(); showToast('Корзина очищена', 'info'); }

async function checkout() {
    if (!State.user) return navigate('login');
    if (Object.keys(State.cart).length === 0) return showToast('Корзина пуста', 'warning');
    
    // Загружаем продукты если их нет
    if (!State.productsLoaded || State.products.length === 0) {
        showToast('Загрузка меню...', 'info');
        await loadProducts();
        // Ждём загрузки
        await new Promise(resolve => setTimeout(resolve, 500));
        if (State.products.length === 0) {
            showToast('Ошибка загрузки меню', 'error');
            return;
        }
    }
    
    const items = [];
    for (const [id, qty] of Object.entries(State.cart)) {
        // Ищем продукт по ID
        let p = State.products.find(pr => String(pr.id) === String(id));
        
        // Если не найден по ID, пробуем найти по имени
        if (!p) {
            p = State.products.find(pr => pr.name === id);
        }
        
        if (!p) {
            console.error('Product not found:', id, 'Available:', State.products.map(x => x.id));
            showToast(`Товар не найден: ${id}`, 'error');
            continue;
        }
        
        items.push({ 
            meal_id: String(p.id), 
            quantity: parseInt(qty) || 1, 
            unit_price: parseFloat(p.price) || 0, 
            total_price: (parseFloat(p.price) || 0) * (parseInt(qty) || 1),
            name: p.name
        });
    }
    
    if (items.length === 0) {
        showToast('Не удалось создать заказ', 'error');
        return;
    }
    
    const total = items.reduce((sum, i) => sum + i.total_price, 0);
    if (State.user.balance < total) { showToast('Недостаточно средств', 'error'); navigate('payment'); return; }
    
    try {
        await API.post('/api/orders', { items, total });
        State.user.balance -= total;
        localStorage.setItem('user', JSON.stringify(State.user));
        clearCart(); 
        showToast('Заказ оформлен!', 'success'); 
        triggerConfetti(); 
        navigate('success');
    } catch (e) { 
        showToast(e.message, 'error'); 
    }
}

// ==================== Favorites ====================
function toggleFavorite(productId) {
    if (State.favorites.has(productId)) State.favorites.delete(productId); else State.favorites.add(productId);
    localStorage.setItem('favorites', JSON.stringify([...State.favorites]));
    renderProducts();
    showToast(State.favorites.has(productId) ? 'Добавлено в избранное' : 'Удалено из избранного', 'info');
}

function loadFavorites() {
    const grid = document.getElementById('favoritesGrid');
    if (!grid) return;
    const favs = State.products.filter(p => State.favorites.has(String(p.id)));
    if (favs.length === 0) { grid.innerHTML = ''; document.getElementById('emptyFavorites').style.display = 'block'; return; }
    document.getElementById('emptyFavorites').style.display = 'none';
    grid.innerHTML = favs.map(p => `<div class="product-card"><div class="pc-image"><i class="fas ${getCategoryIcon(p.category)}"></i></div><div class="pc-content"><div class="pc-category">${p.category}</div><div class="pc-name">${p.name}</div><div class="pc-price">${p.price} ₴</div><button class="btn btn-primary btn-sm" onclick="updateCart('${p.id}', 1)"><i class="fas fa-cart-plus"></i> В корзину</button></div></div>`).join('');
}

// ==================== Meal Planner ====================
function loadMealPlan() {
    const container = document.getElementById('plannerWeek');
    if (!container) return;
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
    const meals = ['Завтрак', 'Обед', 'Ужин'];
    container.innerHTML = days.map(day => `<div class="meal-day"><h3>${day}</h3><div class="meals-grid">${meals.map(meal => {
        const key = `${day}_${meal}`;
        const planned = State.mealPlan[key];
        if (planned) {
            const p = State.products.find(pr => String(pr.id) === String(planned.productId));
            return `<div class="meal-slot filled" onclick="selectMeal('${day}', '${meal}')"><div class="meal-type">${meal}</div><div class="meal-selected"><i class="fas fa-check-circle"></i><span>${p?.name || 'Блюдо'}</span><span class="meal-price">${planned.price} ₴</span></div></div>`;
        }
        return `<div class="meal-slot" onclick="selectMeal('${day}', '${meal}')"><div class="meal-type">${meal}</div><div class="meal-placeholder"><i class="fas fa-plus"></i> Добавить</div></div>`;
    }).join('')}</div></div>`).join('');
    updateMealPlanStats();
}

function selectMeal(day, meal) {
    if (State.products.length === 0) { showToast('Загрузите меню', 'warning'); return; }
    openModal(`<h2>${meal} - ${day}</h2><div style="max-height:400px;overflow-y:auto;">${State.products.map(p => `<div onclick="addToMealPlan('${day}', '${meal}', '${p.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--gray-200);margin-bottom:8px;border-radius:8px;cursor:pointer;"><div><div style="font-weight:600">${p.name}</div><div style="font-size:12px;color:var(--gray-500)">${p.calories} ккал</div></div><div style="font-weight:600;color:var(--primary)">${p.price} ₴</div></div>`).join('')}</div>`);
}

function addToMealPlan(day, meal, productId) {
    const p = State.products.find(pr => String(pr.id) === String(productId));
    if (!p) return;
    const key = `${day}_${meal}`;
    State.mealPlan[key] = { productId: productId, name: p.name, price: p.price, calories: p.calories };
    localStorage.setItem('mealPlan', JSON.stringify(State.mealPlan));
    showToast(`Добавлено: ${p.name}`, 'success');
    closeModal(); loadMealPlan();
}

function generateMealPlan() {
    if (State.products.length === 0) { showToast('Загрузите меню', 'warning'); return; }
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
    const meals = ['Завтрак', 'Обед', 'Ужин'];
    State.mealPlan = {};
    days.forEach(day => {
        meals.forEach(meal => {
            const candidates = State.products[Math.floor(Math.random() * State.products.length)];
            const key = `${day}_${meal}`;
            State.mealPlan[key] = { productId: candidates.id, name: candidates.name, price: candidates.price, calories: candidates.calories };
        });
    });
    localStorage.setItem('mealPlan', JSON.stringify(State.mealPlan));
    loadMealPlan(); showToast('План сгенерирован!', 'success');
}

function clearMealPlan() { State.mealPlan = {}; localStorage.removeItem('mealPlan'); loadMealPlan(); showToast('План очищен', 'info'); }

function updateMealPlanStats() {
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
    const meals = ['Завтрак', 'Обед', 'Ужин'];
    let totalCal = 0, totalCost = 0, filledDays = new Set();
    days.forEach(day => {
        meals.forEach(meal => {
            const item = State.mealPlan[`${day}_${meal}`];
            if (item) { totalCal += item.calories || 0; totalCost += item.price || 0; filledDays.add(day); }
        });
    });
    document.getElementById('weekCalories').textContent = totalCal;
    document.getElementById('weekCost').textContent = totalCost + ' ₴';
    document.getElementById('weekDays').textContent = filledDays.size;
}

function orderMealPlan() {
    const entries = Object.entries(State.mealPlan);
    if (entries.length === 0) { showToast('План пуст', 'warning'); return; }
    openScheduleModal();
}

function openScheduleModal() {
    openModal(`<h2 style="margin-bottom:20px;"><i class="fas fa-calendar-alt"></i> Запланировать заказ</h2>
        <p style="color:var(--gray-500);margin-bottom:20px;">Выберите дату и время доставки</p>
        <div class="form-group" style="margin-bottom:20px;">
            <label style="display:block;margin-bottom:8px;font-weight:500;">Дата</label>
            <input type="date" id="scheduleDate" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:8px;" min="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-group" style="margin-bottom:20px;">
            <label style="display:block;margin-bottom:8px;font-weight:500;">Время</label>
            <select id="scheduleTime" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:8px;">
                <option value="09:00">09:00</option><option value="10:00">10:00</option><option value="11:00">11:00</option>
                <option value="12:00" selected>12:00</option><option value="13:00">13:00</option><option value="14:00">14:00</option><option value="15:00">15:00</option>
            </select>
        </div>
        <button class="btn btn-primary btn-block" onclick="confirmScheduledOrder()"><i class="fas fa-check"></i> Подтвердить</button>`);
}

async function confirmScheduledOrder() {
    const date = document.getElementById('scheduleDate').value, time = document.getElementById('scheduleTime').value;
    if (!date) { showToast('Выберите дату', 'warning'); return; }
    if (!State.user) { showToast('Войдите для заказа', 'warning'); navigate('login'); return; }
    const entries = Object.entries(State.mealPlan);
    if (entries.length === 0) { showToast('План пуст', 'warning'); return; }
    const items = entries.map(([key, item]) => ({ meal_id: item.productId, quantity: 1, unit_price: item.price, total_price: item.price }));
    const total = items.reduce((sum, i) => sum + i.total_price, 0);
    const scheduledDate = new Date(`${date}T${time}`);
    try {
        const data = await API.post('/api/scheduled-orders', { items, total, scheduled_date: scheduledDate.toISOString() });
        State.user.balance = data.new_balance;
        localStorage.setItem('user', JSON.stringify(State.user));
        updateUserUI(); showToast('Заказ запланирован!', 'success'); closeModal(); clearMealPlan(); navigate('order-history');
    } catch (e) { showToast(e.message || 'Ошибка', 'error'); }
}

async function loadScheduledOrders() {
    if (!State.user) return;
    try { const data = await API.get('/api/scheduled-orders'); renderScheduledOrders(data.orders || []); } catch (e) { console.error('Load scheduled error:', e); }
}

function renderScheduledOrders(orders) {
    const container = document.getElementById('scheduledOrdersList');
    if (!container) return;
    if (orders.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:20px;">Нет запланированных</p>'; return; }
    container.innerHTML = orders.map(o => `<div class="order-item" style="flex-direction:column;align-items:flex-start;">
        <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:8px;"><strong>${new Date(o.scheduled_date).toLocaleDateString('ru-RU')} ${new Date(o.scheduled_date).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</strong><span style="font-weight:600;">${o.total.toFixed(2)} ₴</span></div>
        <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">${(o.items || []).map(i => `${i.name || 'Блюдо'} × ${i.quantity}`).join(', ')}</div>
        <button class="btn btn-sm" style="background:var(--error);color:white;" onclick="cancelScheduledOrder(${o.id})"><i class="fas fa-times"></i> Отменить</button></div>`).join('');
}

async function cancelScheduledOrder(orderId) {
    if (!confirm('Отменить заказ?')) return;
    try {
        await API.del(`/api/scheduled-orders/${orderId}`);
        showToast('Заказ отменён', 'success'); loadScheduledOrders();
        if (State.user) { const me = await API.get('/api/me'); State.user.balance = me.balance; localStorage.setItem('user', JSON.stringify(State.user)); updateUserUI(); }
    } catch (e) { showToast('Ошибка', 'error'); }
}

// ==================== KITCHEN ====================
let kitchenRefreshInterval = null;

function startKitchenAutoRefresh() {
    if (kitchenRefreshInterval) clearInterval(kitchenRefreshInterval);
    kitchenRefreshInterval = setInterval(() => {
        if (State.currentScreen === 'kitchen') {
            loadKitchenOrders();
        }
    }, 10000); // 10 seconds
}

function stopKitchenAutoRefresh() {
    if (kitchenRefreshInterval) {
        clearInterval(kitchenRefreshInterval);
        kitchenRefreshInterval = null;
    }
}

async function loadKitchenOrders() {
    if (!State.user) return;
    
    // Start auto-refresh when entering kitchen screen
    if (State.currentScreen === 'kitchen') {
        startKitchenAutoRefresh();
    }
    try { const data = await API.get('/api/kitchen/orders'); renderKitchenOrders(data.orders || []); } catch (e) { console.error('Kitchen error:', e); }
}

function renderKitchenOrders(orders) {
    const container = document.getElementById('kitchenOrders');
    if (!container) return;
    if (orders.length === 0) { container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><h3>Все заказы выполнены!</h3></div>'; return; }
    container.innerHTML = orders.map(o => `<div class="kitchen-order ${o.status}">
        <div class="ko-header"><div class="ko-id">#${String(o.id).slice(-6)}</div><div class="ko-time">${getTimeAgo(o.created_at)}</div><div class="ko-status ${o.status}">${getStatusText(o.status)}</div></div>
        <div class="ko-user"><i class="fas fa-user"></i> ${o.fullname || o.username} ${o.class_name ? `(${o.class_name})` : ''}</div>
        <div class="ko-items">${(o.items || []).map(i => `<div class="ko-item"><span class="ko-qty">${i.quantity}×</span><span class="ko-name">${i.name || 'Блюдо'}</span></div>`).join('')}</div>
        <div class="ko-actions">${o.status === 'pending' ? `<button class="btn btn-sm" style="background:var(--info);color:white;" onclick="updateKitchenStatus(${o.id},'preparing')"><i class="fas fa-fire"></i> Готовить</button>` : ''}
        ${o.status === 'preparing' ? `<button class="btn btn-sm" style="background:var(--success);color:white;" onclick="updateKitchenStatus(${o.id},'ready')"><i class="fas fa-check"></i> Готов</button>` : ''}</div>
    </div>`).join('');
}

async function updateKitchenStatus(orderId, status) {
    try { await API.put(`/api/kitchen/orders/${orderId}/status`, { status }); showToast('Статус обновлён', 'success'); loadKitchenOrders(); } catch (e) { showToast('Ошибка', 'error'); }
}

function getTimeAgo(dateStr) { const diff = Date.now() - new Date(dateStr).getTime(); const mins = Math.floor(diff / 60000); if (mins < 1) return 'только что'; if (mins < 60) return `${mins} мин назад`; return `${Math.floor(mins / 60)} ч назад`; }

// ==================== Profile & Orders ====================
function loadProfile() {
    if (!State.user) return;
    document.getElementById('profileName').textContent = State.user.username;
    document.getElementById('profileRole').textContent = State.user.full_name || 'Пользователь';
    document.getElementById('balanceAmount').textContent = `${(State.user.balance || 0).toFixed(2)} ₴`;
    document.getElementById('infoFullname').textContent = State.user.full_name || '-';
    document.getElementById('infoGrade').textContent = State.user.class_name || '-';
    document.getElementById('profileInfoSection').style.display = 'block';
    loadRecentOrders(); loadScheduledOrders();
}

async function loadRecentOrders() {
    try {
        const data = await API.get('/api/orders/history');
        const list = document.getElementById('recentOrders');
        if (!data.orders?.length) { list.innerHTML = '<p style="color:var(--gray-500);text-align:center;padding:20px;">Заказов пока нет</p>'; return; }
        list.innerHTML = data.orders.slice(0, 3).map(o => `<div class="order-item"><div class="order-info"><div class="order-items">Заказ #${String(o.id).slice(-6)}</div><div class="order-date">${new Date(o.created_at).toLocaleDateString('ru-RU')}</div></div><div class="order-status ${o.status}">${getStatusText(o.status)}</div></div>`).join('');
    } catch (e) { console.error('Load orders error:', e); }
}

function getStatusText(status) { return { pending: 'Ожидание', confirmed: 'Подтверждён', preparing: 'Готовится', ready: 'Готов', completed: 'Завершён', cancelled: 'Отменён', scheduled: 'Запланирован' }[status] || status; }

async function loadOrders() {
    try {
        const data = await API.get('/api/orders/history');
        const container = document.getElementById('ordersContainer');
        if (!data.orders?.length) { container.innerHTML = '<div class="empty-state"><i class="fas fa-shopping-bag"></i><h3>Заказов пока нет</h3></div>'; return; }
        
        // Группируем заказы по статусу
        const activeOrders = data.orders.filter(o => ['pending', 'confirmed', 'preparing', 'ready'].includes(o.status));
        const completedOrders = data.orders.filter(o => ['completed', 'cancelled'].includes(o.status));
        const scheduledOrders = data.orders.filter(o => o.status === 'scheduled');
        
        let html = '';
        
        // Активные заказы
        if (activeOrders.length > 0) {
            html += `<div class="orders-section">
                <h3 class="orders-section-title"><i class="fas fa-spinner"></i> Активные заказы</h3>
                <div class="orders-timeline">`;
            activeOrders.forEach((o, idx) => {
                html += `<div class="order-timeline-item ${o.status}" style="animation-delay: ${idx * 0.1}s">
                    <div class="oti-dot"></div>
                    <div class="oti-content">
                        <div class="oti-header">
                            <span class="oti-id">#${String(o.id).slice(-6)}</span>
                            <span class="oti-status ${o.status}">${getStatusText(o.status)}</span>
                        </div>
                        <div class="oti-items">${(o.items || []).map(i => `<span class="oti-item">${i.name || 'Блюдо'} × ${i.quantity}</span>`).join('')}</div>
                        <div class="oti-footer">
                            <span class="oti-date"><i class="far fa-clock"></i> ${new Date(o.created_at).toLocaleDateString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                            <span class="oti-total">${(o.total || 0).toFixed(2)} ₴</span>
                        </div>
                    </div>
                </div>`;
            });
            html += `</div></div>`;
        }
        
        // Запланированные
        if (scheduledOrders.length > 0) {
            html += `<div class="orders-section">
                <h3 class="orders-section-title"><i class="fas fa-calendar-alt"></i> Запланированные</h3>
                <div class="orders-grid">`;
            scheduledOrders.forEach(o => {
                html += `<div class="order-card-scheduled" onclick="showOrderDetails(${o.id})">
                    <div class="ocs-header">
                        <span class="ocs-date"><i class="fas fa-calendar"></i> ${new Date(o.scheduled_date).toLocaleDateString('ru-RU')}</span>
                        <span class="ocs-time">${new Date(o.scheduled_date).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <div class="ocs-items">${(o.items || []).map(i => `<div class="ocs-item"><span>${i.name || 'Блюдо'}</span><span>×${i.quantity}</span></div>`).join('')}</div>
                    <div class="ocs-footer">
                        <span class="ocs-total">${(o.total || 0).toFixed(2)} ₴</span>
                        <button class="ocs-cancel" onclick="event.stopPropagation(); cancelScheduledOrder(${o.id})"><i class="fas fa-times"></i></button>
                    </div>
                </div>`;
            });
            html += `</div></div>`;
        }
        
        // История
        if (completedOrders.length > 0) {
            html += `<div class="orders-section">
                <h3 class="orders-section-title"><i class="fas fa-history"></i> История</h3>
                <div class="orders-list">`;
            completedOrders.forEach(o => {
                html += `<div class="order-card-compact ${o.status}">
                    <div class="occ-icon"><i class="fas ${o.status === 'completed' ? 'fa-check-circle' : 'fa-times-circle'}"></i></div>
                    <div class="occ-info">
                        <div class="occ-header">
                            <span class="occ-id">Заказ #${String(o.id).slice(-6)}</span>
                            <span class="occ-status ${o.status}">${getStatusText(o.status)}</span>
                        </div>
                        <div class="occ-meta">
                            <span>${(o.items || []).length} поз.</span>
                            <span>•</span>
                            <span>${new Date(o.created_at).toLocaleDateString('ru-RU')}</span>
                        </div>
                    </div>
                    <div class="occ-total">${(o.total || 0).toFixed(2)} ₴</div>
                </div>`;
            });
            html += `</div></div>`;
        }
        
        container.innerHTML = html;
    } catch (e) { console.error('Load orders error:', e); }
}

async function processPayment(method) {
    let amount = State.selectedAmount;
    const custom = document.getElementById('customAmount')?.value;
    if (custom) amount = parseInt(custom);
    if (!amount || amount < 10) return showToast('Минимум 10 ₴', 'warning');
    try {
        showToast('Обработка...', 'info');
        const data = await API.post('/api/topup', { amount, method });
        State.user.balance = data.new_balance;
        localStorage.setItem('user', JSON.stringify(State.user));
        updateUserUI(); showToast(`Баланс пополнен на ${data.deposited?.toFixed(2)} ₴`, 'success'); navigate('profile');
    } catch (e) { showToast(e.message || 'Ошибка', 'error'); }
}
function selectAmount(amount) { State.selectedAmount = amount; document.querySelectorAll('.as-btn').forEach(b => b.classList.remove('active')); document.querySelector(`.as-btn[data-amount="${amount}"]`)?.classList.add('active'); document.getElementById('customAmount').value = ''; }

// ==================== Admin ====================
async function loadAdminStats() {
    try { const data = await API.get('/api/admin/stats'); document.getElementById('statUsers').textContent = data.users; document.getElementById('statOrders').textContent = data.orders; document.getElementById('statRevenue').textContent = `${(data.revenue || 0).toFixed(0)} ₴`; loadAdminOrders(); } catch (e) { console.error('Admin error:', e); }
}

async function loadAdminOrders() {
    try {
        const data = await API.get('/api/admin/orders');
        const list = document.getElementById('adminOrders');
        if (!data.orders?.length) { list.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:20px;">Заказов нет</p>'; return; }
        list.innerHTML = data.orders.map(o => `<div class="admin-order"><div class="admin-order-info"><div class="admin-order-user">${o.fullname || o.username}</div><div class="admin-order-meta">${o.class_name || ''} • ${new Date(o.created_at).toLocaleDateString()}</div></div><select onchange="updateOrderStatus('${o.id}', this.value)">${['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'].map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${getStatusText(s)}</option>`).join('')}</select></div>`).join('');
    } catch (e) { console.error('Admin orders error:', e); }
}

async function updateOrderStatus(orderId, status) {
    try { await API.put(`/api/admin/orders/${orderId}/status`, { status }); showToast('Статус обновлён', 'success'); } catch (e) { showToast('Ошибка', 'error'); }
}

async function sendBroadcast(e) {
    e.preventDefault();
    try { await API.post('/api/admin/notifications/broadcast', { title: document.getElementById('notifyTitle').value, message: document.getElementById('notifyMessage').value }); showToast('Отправлено', 'success'); e.target.reset(); } catch (e) { showToast('Ошибка', 'error'); }
}

// ==================== Sessions & Devices ====================
async function openSessions() {
    const modal = document.getElementById('sessionsModal');
    if (!modal) return;
    modal.classList.add('open');
    const list = document.getElementById('sessionsList');
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);"><i class="fas fa-spinner fa-spin" style="font-size:24px;"></i><p style="margin-top:10px;">Загрузка...</p></div>';
    
    try {
        const data = await API.get('/api/sessions');
        if (!data.sessions?.length) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);"><i class="fas fa-laptop" style="font-size:48px;opacity:0.3;"></i><p style="margin-top:10px;">Нет активных устройств</p></div>';
            return;
        }
        list.innerHTML = data.sessions.map(s => `
            <div class="session-item ${s.is_current ? 'current' : ''}">
                <div class="session-icon"><i class="fas fa-${s.device_type === 'mobile' ? 'mobile-alt' : 'laptop'}"></i></div>
                <div class="session-info">
                    <div class="session-device">${s.device_name || 'Устройство'}</div>
                    <div class="session-meta">
                        <span>${s.browser || 'Браузер'}</span>
                        <span>${s.os || 'ОС'}</span>
                    </div>
                </div>
                ${s.is_current ? '<span class="session-badge">Текущее</span>' : `<button class="session-end" onclick="endSession('${s.id}')"><i class="fas fa-times"></i></button>`}
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--error);"><i class="fas fa-exclamation-triangle"></i><p style="margin-top:10px;">Ошибка загрузки устройств</p></div>';
    }
}

function closeSessions() {
    document.getElementById('sessionsModal')?.classList.remove('open');
}

async function endSession(sessionId) {
    try {
        await API.del(`/api/sessions/${sessionId}`);
        showToast('Устройство отключено', 'success');
        openSessions();
    } catch (e) {
        showToast('Ошибка', 'error');
    }
}

async function endAllSessions() {
    if (!confirm('Отключить все устройства кроме текущего?')) return;
    try {
        await API.del('/api/sessions/all');
        showToast('Все устройства отключены', 'success');
        closeSessions();
    } catch (e) {
        showToast('Ошибка', 'error');
    }
}

// ==================== UI Helpers ====================
function openModal(content) { document.getElementById('modalContent').innerHTML = content; document.getElementById('modalOverlay').classList.add('open'); }
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function closeModals() { closeModal(); document.getElementById('searchModal').classList.remove('open'); document.getElementById('cartSidebar').classList.remove('open'); document.getElementById('notifPanel').classList.remove('open'); document.getElementById('sessionsModal')?.classList.remove('open'); }
function toggleTheme() {
    State.isDark = !State.isDark;
    document.body.dataset.theme = State.isDark ? 'dark' : 'light';
    localStorage.setItem('theme', State.isDark ? 'dark' : 'light');
    
    // Обновляем иконку кнопки
    const themeBtnIcon = document.querySelector('.theme-btn i');
    if (themeBtnIcon) {
        themeBtnIcon.className = State.isDark ? 'fas fa-sun' : 'fas fa-moon';
    }
    
    // Обновляем статус в настройках
    const themeStatus = document.getElementById('themeStatus');
    if (themeStatus) {
        themeStatus.textContent = State.isDark ? 'Включена' : 'Выключена';
    }
    
    // Переключаем тумблер - используем querySelectorAll и переключаем каждый
    document.querySelectorAll('#themeToggle').forEach(toggle => {
        if (State.isDark) {
            if (!toggle.classList.contains('active')) toggle.classList.add('active');
        } else {
            toggle.classList.remove('active');
        }
    });
}
function toggleUserMenu() { document.getElementById('userMenu').classList.toggle('open'); }
function toggleNotifications() { document.getElementById('notifPanel').classList.toggle('open'); }
function openSearch() { document.getElementById('searchModal').classList.add('open'); document.getElementById('globalSearch').focus(); }
function closeSearch() { document.getElementById('searchModal').classList.remove('open'); }
function showSettings() { navigate('settings'); }
function addDailyToCart() { const dish = document.getElementById('dailyDish')?.textContent; const p = State.products.find(pr => pr.name === dish); if (p) updateCart(p.id, 1); }
function togglePassword(id) { const input = document.getElementById(id); if (input) input.type = input.type === 'password' ? 'text' : 'password'; }
function toggleMobileMenu() { document.querySelector('.mobile-menu-btn')?.classList.toggle('active'); }
function refreshKitchenOrders() { loadKitchenOrders(); showToast('Обновлено', 'info'); }
function showForgotPassword() { openModal('<h2>Восстановление пароля</h2><p style="color:var(--gray-500);margin:10px 0;">Обратитесь к администратору для восстановления пароля.</p><button class="btn btn-secondary btn-block" onclick="closeModal()">Закрыть</button>'); }
function showRegister() { navigate('register'); }
async function applyPromo() {
    const code = document.getElementById('promoInput')?.value;
    if (!code) return showToast('Введите промокод', 'warning');
    try {
        const data = await API.post('/api/validate-promo', { code });
        if (data.valid) {
            State.activePromo = data.promo;
            showToast(`Промокод применён: -${data.promo.discount}%`, 'success');
            renderCart();
        } else {
            showToast(data.message || 'Промокод не найден', 'error');
        }
    } catch (e) { showToast('Ошибка', 'error'); }
}
async function markAllRead() { showToast('Уведомления отмечены', 'info'); }
// ==================== Color Scheme ====================
const colorSchemes = {
    emerald: { name: 'Изумрудный', primary: '#00C896', secondary: '#7C3AED', gradient: 'linear-gradient(135deg, #00C896, #7C3AED)' },
    ocean: { name: 'Океан', primary: '#0EA5E9', secondary: '#8B5CF6', gradient: 'linear-gradient(135deg, #0EA5E9, #8B5CF6)' },
    sunset: { name: 'Закат', primary: '#F97316', secondary: '#EC4899', gradient: 'linear-gradient(135deg, #F97316, #EC4899)' },
    forest: { name: 'Лес', primary: '#22C55E', secondary: '#14B8A6', gradient: 'linear-gradient(135deg, #22C55E, #14B8A6)' },
    berry: { name: 'Ягода', primary: '#A855F7', secondary: '#EC4899', gradient: 'linear-gradient(135deg, #A855F7, #EC4899)' },
    gold: { name: 'Золото', primary: '#F59E0B', secondary: '#EF4444', gradient: 'linear-gradient(135deg, #F59E0B, #EF4444)' }
};

// Применить цветовую схему
function applyColorScheme(scheme) {
    if (!colorSchemes[scheme]) scheme = 'emerald';
    const colors = colorSchemes[scheme];
    
    // Устанавливаем CSS переменные
    document.documentElement.style.setProperty('--primary', colors.primary);
    document.documentElement.style.setProperty('--primary-light', colors.primary + '99');
    document.documentElement.style.setProperty('--primary-dark', colors.primary + 'CC');
    document.documentElement.style.setProperty('--primary-alpha', colors.primary + '1A');
    document.documentElement.style.setProperty('--secondary', colors.secondary);
    document.documentElement.style.setProperty('--secondary-light', colors.secondary + '99');
    
    State.colorScheme = scheme;
    localStorage.setItem('colorScheme', scheme);
    
    // Обновляем превью цветовой схемы
    updateColorSchemePreview();
}

function updateColorSchemePreview() {
    const preview = document.getElementById('currentSchemePreview');
    const label = document.getElementById('currentScheme');
    if (preview && colorSchemes[State.colorScheme]) {
        preview.style.background = colorSchemes[State.colorScheme].gradient;
    }
    if (label && colorSchemes[State.colorScheme]) {
        label.textContent = colorSchemes[State.colorScheme].name;
    }
}

// Открыть селектор цветовой схемы
function openColorSchemeSelector() {
    const schemesHtml = Object.entries(colorSchemes).map(([key, val]) => {
        const isActive = State.colorScheme === key;
        return `
            <div class="color-scheme-card ${isActive ? 'active' : ''}" data-scheme="${key}" onclick="selectColorScheme('${key}')">
                <div class="csc-preview" style="background: ${val.gradient}">
                    ${isActive ? '<i class="fas fa-check"></i>' : ''}
                </div>
                <div class="csc-info">
                    <span class="csc-name">${val.name}</span>
                    <span class="csc-colors">
                        <span style="background:${val.primary}"></span>
                        <span style="background:${val.secondary}"></span>
                    </span>
                </div>
            </div>
        `;
    }).join('');
    
    const content = `
        <div class="color-scheme-selector">
            <h2><i class="fas fa-palette"></i> Цветовая схема</h2>
            <p class="color-scheme-subtitle">Выберите цветовую палитру для интерфейса</p>
            <div class="color-schemes-grid">
                ${schemesHtml}
            </div>
            <button class="btn btn-secondary btn-block" onclick="closeModal()" style="margin-top:16px;">
                Закрыть
            </button>
        </div>
    `;
    
    openModal(content);
}

function selectColorScheme(scheme) {
    applyColorScheme(scheme);
    openColorSchemeSelector(); // Перерисовываем модалку с новой активной схемой
    showToast(`Цветовая схема: ${colorSchemes[scheme].name}`, 'success');
}
function editAvatar() {
    if (!State.user) { showToast('Войдите для редактирования', 'warning'); return; }
    
    const avatars = [
        { id: 'default', emoji: '😊', color: 'linear-gradient(135deg, #00C896, #7C3AED)' },
        { id: 'chef', emoji: '👨‍🍳', color: 'linear-gradient(135deg, #F97316, #EF4444)' },
        { id: 'student', emoji: '📚', color: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' },
        { id: 'star', emoji: '⭐', color: 'linear-gradient(135deg, #F59E0B, #EF4444)' },
        { id: 'heart', emoji: '❤️', color: 'linear-gradient(135deg, #EC4899, #EF4444)' },
        { id: 'rocket', emoji: '🚀', color: 'linear-gradient(135deg, #10B981, #3B82F6)' },
        { id: 'fire', emoji: '🔥', color: 'linear-gradient(135deg, #F97316, #EF4444)' },
        { id: 'gem', emoji: '💎', color: 'linear-gradient(135deg, #8B5CF6, #EC4899)' },
        { id: 'crown', emoji: '👑', color: 'linear-gradient(135deg, #F59E0B, #EF4444)' },
        { id: 'lightning', emoji: '⚡', color: 'linear-gradient(135deg, #FACC15, #3B82F6)' }
    ];
    
    const currentAvatar = State.user.avatar || 'default';
    
    openModal(`
        <h2 style="margin-bottom:20px;"><i class="fas fa-user-circle" style="color:var(--primary);"></i> Выберите аватарку</h2>
        <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:12px;margin-bottom:20px;">
            ${avatars.map(a => `
                <div onclick="selectAvatar('${a.id}')" style="
                    width:60px;height:60px;border-radius:50%;
                    display:flex;align-items:center;justify-content:center;
                    font-size:28px;cursor:pointer;
                    background:${a.color};
                    border: 3px solid ${currentAvatar === a.id ? 'var(--primary)' : 'transparent'};
                    transition: all 0.2s;
                    box-shadow: ${currentAvatar === a.id ? '0 0 20px var(--primary)' : 'none'};
                ">${a.emoji}</div>
            `).join('')}
        </div>
        <p style="color:var(--gray-500);font-size:12px;text-align:center;">Нажмите на аватарку для выбора</p>
    `);
}

function selectAvatar(avatarId) {
    State.user.avatar = avatarId;
    localStorage.setItem('user', JSON.stringify(State.user));
    
    // Обновляем аватарки в интерфейсе
    document.querySelectorAll('.user-avatar, .profile-avatar, .admin-user-avatar').forEach(el => {
        if (el.textContent.trim() && !el.querySelector('img')) {
            el.style.background = `linear-gradient(135deg, var(--primary), var(--secondary))`;
        }
    });
    
    // Обновляем иконку в header
    const profileAvatarEl = document.getElementById('profileAvatar');
    if (profileAvatarEl) {
        profileAvatarEl.style.background = `linear-gradient(135deg, var(--primary), var(--secondary))`;
    }
    
    showToast('Аватарка обновлена!', 'success');
    closeModal();
}

// ==================== REVIEWS ====================
let productReviews = {}; // { productId: [{ rating, comment, user, date }] }

async function showProductReviews(productId) {
    const product = State.products.find(p => String(p.id) === String(productId));
    
    if (!product) { showToast('Товар не найден', 'error'); return; }
    
    // Загружаем отзывы с сервера
    let reviews = [];
    let avgRating = product.rating || 0;
    let count = 0;
    
    try {
        const menuItemId = parseInt(productId);
        console.log('Loading reviews for menu item:', menuItemId);
        
        const data = await API.get(`/api/reviews/${menuItemId}`);
        console.log('Reviews response:', data);
        
        reviews = data.reviews || [];
        avgRating = data.avgRating || 0;
        count = data.count || 0;
    } catch (e) {
        console.error('Load reviews error:', e);
        // Используем локальные отзывы как запасной вариант
        reviews = productReviews[productId] || [];
        avgRating = reviews.length ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1) : (product.rating || 0);
        count = reviews.length;
    }
    
    openModal(`
        <div style="max-height:70vh;overflow-y:auto;">
            <h2 style="margin-bottom:16px;"><i class="fas fa-star" style="color:#F59E0B;"></i> ${product.name}</h2>
            
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:12px;">
                <div style="text-align:center;">
                    <div style="font-size:36px;font-weight:700;color:var(--primary);">${avgRating}</div>
                    <div style="font-size:12px;color:var(--gray-500);">${count} отзывов</div>
                </div>
                <div style="flex:1;">
                    ${[5,4,3,2,1].map(stars => {
                        const starCount = reviews.filter(r => r.rating === stars).length;
                        const pct = reviews.length ? (starCount / reviews.length * 100) : 0;
                        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                            <span style="width:16px;font-size:12px;color:var(--gray-500);">${stars}</span>
                            <i class="fas fa-star" style="font-size:10px;color:#F59E0B;"></i>
                            <div style="flex:1;height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden;">
                                <div style="width:${pct}%;height:100%;background:#F59E0B;"></div>
                            </div>
                            <span style="width:20px;font-size:11px;color:var(--gray-400);">${starCount}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
            
            <button class="btn btn-primary btn-block" onclick="openWriteReview('${productId}')" style="margin-bottom:20px;">
                <i class="fas fa-pen"></i> Написать отзыв
            </button>
            
            ${reviews.length ? reviews.map(r => `
                <div style="padding:16px;background:var(--gray-50);border-radius:12px;margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:12px;">${(r.user || 'U').charAt(0).toUpperCase()}</div>
                            <span style="font-weight:500;">${r.user_fullname || r.user || 'Пользователь'}</span>
                        </div>
                        <div style="color:#F59E0B;font-size:12px;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
                    </div>
                    <p style="color:var(--gray-600);font-size:14px;margin:0;">${r.comment || ''}</p>
                    <div style="font-size:11px;color:var(--gray-400);margin-top:8px;">${new Date(r.date).toLocaleDateString('ru-RU')}</div>
                </div>
            `).join('') : '<p style="text-align:center;color:var(--gray-500);padding:20px;">Пока нет отзывов. Будьте первым!</p>'}
        </div>
    `);
}

function openWriteReview(productId) {
    if (!State.user) { showToast('Войдите для оставления отзыва', 'warning'); navigate('login'); return; }
    
    closeModal();
    openModal(`
        <h2 style="margin-bottom:20px;"><i class="fas fa-pen" style="color:var(--primary);"></i> Ваш отзыв</h2>
        <form onsubmit="submitReview(event, '${productId}')" style="display:flex;flex-direction:column;gap:16px;">
            <div>
                <label style="display:block;margin-bottom:8px;font-weight:500;">Оценка</label>
                <div id="ratingStars" style="display:flex;gap:8px;font-size:28px;cursor:pointer;">
                    ${[1,2,3,4,5].map(i => `<span data-rating="${i}" onclick="setRating(${i})" style="color:var(--gray-300);transition:color 0.2s;" onmouseover="this.style.color='#F59E0B'" onmouseout="this.style.color=this.dataset.rating <= (document.getElementById('ratingInput').value || 0) ? '#F59E0B' : 'var(--gray-300)'">★</span>`).join('')}
                </div>
                <input type="hidden" id="ratingInput" value="0">
            </div>
            <div>
                <label style="display:block;margin-bottom:8px;font-weight:500;">Комментарий</label>
                <textarea id="reviewComment" placeholder="Расскажите о блюде..." style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;resize:vertical;min-height:100px;font-family:inherit;"></textarea>
            </div>
            <button type="submit" class="btn btn-primary btn-block"><i class="fas fa-paper-plane"></i> Отправить отзыв</button>
        </form>
    `);
}

function setRating(rating) {
    document.getElementById('ratingInput').value = rating;
    document.querySelectorAll('#ratingStars span').forEach((star, i) => {
        star.style.color = i < rating ? '#F59E0B' : 'var(--gray-300)';
    });
}

async function submitReview(e, productId) {
    e.preventDefault();
    
    if (!State.user) { showToast('Войдите для оставления отзыва', 'warning'); return; }
    
    const rating = parseInt(document.getElementById('ratingInput').value);
    const comment = document.getElementById('reviewComment').value.trim();
    
    if (!rating) { showToast('Выберите оценку', 'warning'); return; }
    
    try {
        await API.post('/api/reviews', {
            menu_item_id: parseInt(productId),
            rating,
            comment
        });
        
        showToast('Спасибо за отзыв!', 'success');
        closeModal();
        showProductReviews(productId);
    } catch (err) {
        showToast(err.message || 'Ошибка отправки отзыва', 'error');
    }
}

// Загружаем отзывы (теперь используется для обратной совместимости)
function loadReviews() {
    // Отзывы теперь загружаются при открытии showProductReviews
    // Оставляем для обратной совместимости
    try {
        const saved = localStorage.getItem('reviews');
        if (saved) productReviews = JSON.parse(saved);
    } catch (e) { productReviews = {}; }
}
function editProfile() { showToast('Редактирование профиля скоро будет доступно', 'info'); }
function openProductEditor() { showToast('Редактор меню скоро будет доступен', 'info'); }

// ==================== Admin Functions ====================
let adminData = { users: [], menu: [], orders: [], filters: { users: '', menu: '', orders: '' } };

function showAdminTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.admin-tab[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById(`adminTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.add('active');
    
    if (tabName === 'orders') loadAdminOrders();
    if (tabName === 'users') loadAdminUsers();
    if (tabName === 'menu') loadAdminMenu();
}

async function loadAdminUsers(search = '') {
    try {
        showLoader('adminUsers');
        const data = await API.get('/api/admin/users');
        adminData.users = data.users || [];
        renderAdminUsers(search);
    } catch (e) { 
        console.error('Load admin users error:', e); 
        document.getElementById('adminUsers').innerHTML = '<p style="text-align:center;color:var(--error);padding:40px;">Ошибка загрузки</p>';
    }
}

function renderAdminUsers(search = '') {
    const container = document.getElementById('adminUsers');
    let users = adminData.users;
    
    if (search) {
        const s = search.toLowerCase();
        users = users.filter(u => 
            (u.username || '').toLowerCase().includes(s) ||
            (u.fullname || '').toLowerCase().includes(s) ||
            (u.grade || '').toLowerCase().includes(s)
        );
    }
    
    if (!users.length) { 
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:40px;">Нет пользователей</p>'; 
        return; 
    }
    
    container.innerHTML = `
        <div class="admin-search-bar">
            <input type="text" placeholder="Поиск пользователей..." value="${search}" onkeyup="filterUsers(this.value)" style="width:100%;padding:12px 16px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
        </div>
        <div class="admin-users-grid">
            ${users.map(u => `
                <div class="admin-user-card">
                    <div class="admin-user-avatar" style="background: linear-gradient(135deg, ${getRoleColor(u.role)}, var(--secondary));">${(u.username || 'U').charAt(0).toUpperCase()}</div>
                    <div class="admin-user-info">
                        <div class="admin-user-name">${u.fullname || u.username}</div>
                        <div class="admin-user-meta">
                            <span><i class="fas fa-at"></i> @${u.username}</span>
                            <span><i class="fas fa-graduation-cap"></i> ${u.grade || '-'}</span>
                            <span class="role-badge ${u.role}">${getRoleLabel(u.role)}</span>
                        </div>
                    </div>
                    <div class="admin-user-balance">
                        <div class="balance-value">${(u.balance || 0).toFixed(2)}₴</div>
                        <div class="balance-meta">баланс</div>
                    </div>
                    <div class="admin-user-stats">
                        <div class="admin-user-stat"><span>${u.order_count || 0}</span><small>заказов</small></div>
                        <div class="admin-user-stat"><span>${(u.total_spent || 0).toFixed(0)}₴</span><small>потрачено</small></div>
                    </div>
                    <div class="admin-user-actions">
                        <button onclick="editUser(${u.id}, ${JSON.stringify(u).replace(/"/g, '"')})" title="Редактировать"><i class="fas fa-edit"></i></button>
                        <button onclick="topupUser(${u.id}, '${u.username}')" title="Пополнить"><i class="fas fa-plus-circle"></i></button>
                        ${u.role !== 'admin' ? `<button class="delete" onclick="deleteUser(${u.id})" title="Удалить"><i class="fas fa-trash"></i></button>` : '<button disabled title="Нельзя удалить админа"><i class="fas fa-shield-alt"></i></button>'}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function filterUsers(search) {
    adminData.filters.users = search;
    renderAdminUsers(search);
}

function getRoleColor(role) {
    const colors = { admin: '#EF4444', kitchen: '#F59E0B', staff: '#3B82F6', user: '#10B981' };
    return colors[role] || '#6B7280';
}

function getRoleLabel(role) {
    const labels = { admin: 'Админ', kitchen: 'Повар', staff: 'Персонал', user: 'Ученик' };
    return labels[role] || role;
}

async function loadAdminMenu(search = '') {
    try {
        showLoader('adminMenuItems');
        const data = await API.get('/api/admin/menu');
        adminData.menu = data.items || [];
        renderAdminMenu(search);
    } catch (e) { 
        console.error('Load admin menu error:', e); 
        document.getElementById('adminMenuItems').innerHTML = '<p style="text-align:center;color:var(--error);padding:40px;">Ошибка загрузки</p>';
    }
}

function renderAdminMenu(search = '') {
    const container = document.getElementById('adminMenuItems');
    let items = adminData.menu;
    
    if (search) {
        const s = search.toLowerCase();
        items = items.filter(item => 
            (item.name || '').toLowerCase().includes(s) ||
            (item.category || '').toLowerCase().includes(s)
        );
    }
    
    if (!items.length) { 
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:40px;">Нет позиций меню</p>'; 
        return; 
    }
    
    // Группируем по категориям
    const categories = {};
    items.forEach(item => {
        const cat = item.category || 'Без категории';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(item);
    });
    
    container.innerHTML = `
        <div class="admin-search-bar">
            <input type="text" placeholder="Поиск в меню..." value="${search}" onkeyup="filterMenu(this.value)" style="width:100%;padding:12px 16px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
        </div>
        ${Object.entries(categories).map(([cat, catItems]) => `
            <div class="menu-category">
                <h3 class="menu-category-title"><i class="fas fa-layer-group"></i> ${cat} <span class="count">${catItems.length}</span></h3>
                <div class="menu-items-grid">
                    ${catItems.map(item => `
                        <div class="admin-menu-item ${item.is_new ? 'is-new' : ''} ${item.is_popular ? 'is-popular' : ''}">
                            ${item.is_new ? '<span class="item-badge new">NEW</span>' : ''}
                            ${item.is_popular ? '<span class="item-badge popular">🔥</span>' : ''}
                            <div class="admin-menu-item-header">
                                <span class="admin-menu-item-name">${item.name}</span>
                                <span class="admin-menu-item-price">${item.price}₴</span>
                            </div>
                            ${item.description ? `<p class="item-desc">${item.description}</p>` : ''}
                            <div class="admin-menu-item-meta">
                                <span><i class="fas fa-fire"></i> ${item.calories || 0} ккал</span>
                                <span><i class="fas fa-star"></i> ${item.rating || 4}</span>
                                ${item.allergens ? `<span><i class="fas fa-exclamation-triangle"></i> ${item.allergens}</span>` : ''}
                            </div>
                            <div class="admin-menu-item-actions">
                                <button class="btn btn-sm" onclick="editMenuItem(${item.id})"><i class="fas fa-edit"></i> Изменить</button>
                                <button class="btn btn-sm" style="background:var(--error);color:white;" onclick="deleteMenuItem(${item.id})"><i class="fas fa-trash"></i> Удалить</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('')}
    `;
}

function filterMenu(search) {
    adminData.filters.menu = search;
    renderAdminMenu(search);
}

async function loadAdminOrders(search = '', statusFilter = 'all') {
    try {
        showLoader('adminOrders');
        const data = await API.get('/api/admin/orders');
        adminData.orders = data.orders || [];
        renderAdminOrders(search, statusFilter);
    } catch (e) { 
        console.error('Load admin orders error:', e); 
        document.getElementById('adminOrders').innerHTML = '<p style="text-align:center;color:var(--error);padding:40px;">Ошибка загрузки</p>';
    }
}

function renderAdminOrders(search = '', statusFilter = 'all') {
    const container = document.getElementById('adminOrders');
    let orders = adminData.orders;
    
    if (statusFilter !== 'all') {
        orders = orders.filter(o => o.status === statusFilter);
    }
    
    if (search) {
        const s = search.toLowerCase();
        orders = orders.filter(o => 
            String(o.id).includes(s) ||
            (o.username || '').toLowerCase().includes(s) ||
            (o.fullname || '').toLowerCase().includes(s)
        );
    }
    
    if (!orders.length) { 
        container.innerHTML = '<p style="text-align:center;color:var(--gray-500);padding:40px;">Нет заказов</p>'; 
        return; 
    }
    
    // Статистика по статусам
    const statusCounts = {};
    adminData.orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
    
    container.innerHTML = `
        <div class="admin-filters">
            <input type="text" placeholder="Поиск заказов..." onkeyup="filterOrders(this.value)" style="flex:1;padding:10px 14px;border:2px solid var(--gray-200);border-radius:8px;">
            <select onchange="filterOrdersByStatus(this.value)" style="padding:10px 14px;border:2px solid var(--gray-200);border-radius:8px;">
                <option value="all">Все (${adminData.orders.length})</option>
                ${Object.entries(statusCounts).map(([s, c]) => `<option value="${s}">${getStatusText(s)} (${c})</option>`).join('')}
            </select>
        </div>
        <div class="admin-orders-list">
            ${orders.map(o => `
                <div class="admin-order-full ${o.status}">
                    <div class="order-priority" style="background:${getStatusColor(o.status)}"></div>
                    <span class="order-id">#${String(o.id).slice(-6)}</span>
                    <div class="order-user">
                        <div class="order-user-name">${o.fullname || o.username}</div>
                        <div class="order-user-meta">
                            <span><i class="fas fa-graduation-cap"></i> ${o.class_name || '-'}</span>
                            <span><i class="fas fa-clock"></i> ${new Date(o.created_at).toLocaleString('ru-RU')}</span>
                        </div>
                    </div>
                    <div class="order-items-preview">
                        ${(o.items || []).slice(0, 2).map(i => `<span>${i.name || 'Блюдо'} ×${i.quantity}</span>`).join('')}
                        ${(o.items || []).length > 2 ? `<span class="more">+${(o.items || []).length - 2}</span>` : ''}
                    </div>
                    <span class="order-total">${(o.total || 0).toFixed(2)}₴</span>
                    <select onchange="updateOrderStatus('${o.id}', this.value)" class="status-select ${o.status}">
                        ${['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'].map(s => 
                            `<option value="${s}" ${o.status === s ? 'selected' : ''}>${getStatusText(s)}</option>`
                        ).join('')}
                    </select>
                </div>
            `).join('')}
        </div>
    `;
}

function filterOrders(search) {
    adminData.filters.orders = search;
    renderAdminOrders(search);
}

function filterOrdersByStatus(status) {
    renderAdminOrders(adminData.filters.orders, status);
}

function getStatusColor(status) {
    const colors = { pending: '#F59E0B', confirmed: '#3B82F6', preparing: '#8B5CF6', ready: '#10B981', completed: '#6B7280', cancelled: '#EF4444' };
    return colors[status] || '#6B7280';
}

function showLoader(id) {
    document.getElementById(id).innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:32px;color:var(--primary);"></i></div>';
}

function loadAdminStats() {
    Promise.all([
        API.get('/api/admin/stats'),
        API.get('/api/admin/analytics').catch(() => ({}))
    ]).then(([stats, analytics]) => {
        // Обновляем базовую статистику
        document.getElementById('statUsers').textContent = stats.users || 0;
        document.getElementById('statOrders').textContent = stats.orders || 0;
        document.getElementById('statRevenue').textContent = `${(stats.revenue || 0).toFixed(0)}₴`;
        
        // Обновляем расширенную аналитику если доступна
        if (analytics.total_users !== undefined) {
            document.getElementById('todayOrders').textContent = analytics.today?.orders || 0;
            document.getElementById('todayRevenue').textContent = `${(analytics.today?.revenue || 0).toFixed(0)}₴`;
            document.getElementById('weekOrders').textContent = analytics.week?.orders || 0;
            document.getElementById('weekRevenue').textContent = `${(analytics.week?.revenue || 0).toFixed(0)}₴`;
            document.getElementById('totalUsers').textContent = analytics.total_users || 0;
        }
        
        // Загружаем данные для вкладок
        loadAdminOrders();
    }).catch(e => console.error('Admin stats error:', e));
}

function openAddMenuItem() {
    openModal(`
        <h2 style="margin-bottom:20px;"><i class="fas fa-plus-circle" style="color:var(--primary);"></i> Добавить блюдо</h2>
        <form onsubmit="addMenuItem(event)" style="display:flex;flex-direction:column;gap:16px;">
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Название *</label>
                <input type="text" id="newItemName" placeholder="Например: Борщ" required style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Цена *</label>
                    <input type="number" id="newItemPrice" placeholder="0" required min="0" step="0.01" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
                </div>
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Категория *</label>
                    <select id="newItemCategory" required style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
                        <option value="">Выберите</option>
                        <option value="Горячее">🍽 Горячее</option>
                        <option value="Салаты">🥗 Салаты</option>
                        <option value="Напитки">☕ Напитки</option>
                        <option value="Десерты">🍰 Десерты</option>
                    </select>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Калории</label>
                    <input type="number" id="newItemCalories" placeholder="0" min="0" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
                </div>
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Рейтинг</label>
                    <input type="number" id="newItemRating" placeholder="4.0" min="1" max="5" step="0.1" value="4.0" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
                </div>
            </div>
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Описание</label>
                <textarea id="newItemDesc" placeholder="Опишите блюдо..." style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;resize:vertical;min-height:80px;"></textarea>
            </div>
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Аллергены</label>
                <input type="text" id="newItemAllergens" placeholder="Например: глютен, лактоза" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;font-size:14px;">
            </div>
            <div style="display:flex;gap:12px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="newItemNew"> <span>Новинка</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="newItemPopular"> <span>Популярное</span>
                </label>
            </div>
            <button type="submit" class="btn btn-primary btn-lg btn-block"><i class="fas fa-plus"></i> Добавить блюдо</button>
        </form>
    `);
}

async function addMenuItem(e) {
    e.preventDefault();
    try {
        await API.post('/api/admin/menu', {
            name: document.getElementById('newItemName').value.trim(),
            price: parseFloat(document.getElementById('newItemPrice').value),
            category: document.getElementById('newItemCategory').value,
            calories: parseInt(document.getElementById('newItemCalories').value) || 0,
            rating: parseFloat(document.getElementById('newItemRating').value) || 4.0,
            description: document.getElementById('newItemDesc').value.trim(),
            allergens: document.getElementById('newItemAllergens').value.trim(),
            is_new: document.getElementById('newItemNew').checked,
            is_popular: document.getElementById('newItemPopular').checked
        });
        showToast('Блюдо добавлено!', 'success');
        closeModal();
        loadAdminMenu();
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteMenuItem(id) {
    if (!confirm('Удалить позицию? Это действие необратимо.')) return;
    try {
        await API.del(`/api/admin/menu/${id}`);
        showToast('Позиция удалена', 'success');
        loadAdminMenu();
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteUser(id) {
    if (!confirm('Удалить пользователя? Все его заказы будут удалены.')) return;
    try {
        await API.del(`/api/admin/users/${id}`);
        showToast('Пользователь удалён', 'success');
        loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
}

function editUser(id, userData) {
    openModal(`
        <h2 style="margin-bottom:20px;"><i class="fas fa-user-edit" style="color:var(--primary);"></i> Редактировать пользователя</h2>
        <form onsubmit="saveUser(event, ${id})" style="display:flex;flex-direction:column;gap:16px;">
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Полное имя</label>
                <input type="text" id="editUserFullname" value="${userData.fullname || ''}" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Класс</label>
                    <input type="text" id="editUserGrade" value="${userData.grade || ''}" placeholder="Например: 10-А" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
                </div>
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Роль</label>
                    <select id="editUserRole" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
                        <option value="user" ${userData.role === 'user' ? 'selected' : ''}>Ученик</option>
                        <option value="staff" ${userData.role === 'staff' ? 'selected' : ''}>Персонал</option>
                        <option value="kitchen" ${userData.role === 'kitchen' ? 'selected' : ''}>Повар</option>
                        <option value="admin" ${userData.role === 'admin' ? 'selected' : ''}>Администратор</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Баланс (₴)</label>
                <input type="number" id="editUserBalance" value="${userData.balance || 0}" step="0.01" min="0" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
            </div>
            <button type="submit" class="btn btn-primary btn-block"><i class="fas fa-save"></i> Сохранить изменения</button>
        </form>
    `);
}

async function saveUser(e, id) {
    e.preventDefault();
    try {
        await API.put(`/api/admin/users/${id}`, {
            fullname: document.getElementById('editUserFullname').value,
            grade: document.getElementById('editUserGrade').value,
            role: document.getElementById('editUserRole').value,
            balance: parseFloat(document.getElementById('editUserBalance').value)
        });
        showToast('Данные сохранены!', 'success');
        closeModal();
        loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
}

function topupUser(id, username) {
    openModal(`
        <h2 style="margin-bottom:20px;"><i class="fas fa-plus-circle" style="color:var(--success);"></i> Пополнить баланс</h2>
        <p style="color:var(--gray-500);margin-bottom:16px;">Пользователь: <strong>${username}</strong></p>
        <form onsubmit="doTopup(event, ${id})" style="display:flex;flex-direction:column;gap:16px;">
            <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:8px;">
                ${[50, 100, 200, 500].map(a => `<button type="button" class="btn btn-secondary" onclick="document.getElementById('topupAmount').value=${a}">${a}₴</button>`).join('')}
            </div>
            <input type="number" id="topupAmount" placeholder="Сумма" min="1" required style="width:100%;padding:14px;border:2px solid var(--gray-200);border-radius:10px;font-size:16px;text-align:center;">
            <button type="submit" class="btn btn-primary btn-lg btn-block"><i class="fas fa-plus"></i> Пополнить</button>
        </form>
    `);
}

async function doTopup(e, id) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('topupAmount').value);
    if (!amount || amount <= 0) return showToast('Введите сумму', 'warning');
    try {
        await API.put(`/api/admin/users/${id}`, { balance_delta: amount });
        showToast(`Баланс пополнен на ${amount}₴`, 'success');
        closeModal();
        loadAdminUsers();
    } catch (err) { showToast(err.message, 'error'); }
}

function editMenuItem(id) {
    const item = adminData.menu.find(m => m.id === id);
    if (!item) return showToast('Позиция не найдена', 'error');
    
    openModal(`
        <h2 style="margin-bottom:20px;"><i class="fas fa-edit" style="color:var(--primary);"></i> Редактировать блюдо</h2>
        <form onsubmit="saveMenuItem(event, ${id})" style="display:flex;flex-direction:column;gap:16px;">
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Название</label>
                <input type="text" id="editItemName" value="${item.name || ''}" required style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Цена (₴)</label>
                    <input type="number" id="editItemPrice" value="${item.price || 0}" step="0.01" min="0" required style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
                </div>
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Категория</label>
                    <select id="editItemCategory" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
                        <option value="Горячее" ${item.category === 'Горячее' ? 'selected' : ''}>🍽 Горячее</option>
                        <option value="Салаты" ${item.category === 'Салаты' ? 'selected' : ''}>🥗 Салаты</option>
                        <option value="Напитки" ${item.category === 'Напитки' ? 'selected' : ''}>☕ Напитки</option>
                        <option value="Десерты" ${item.category === 'Десерты' ? 'selected' : ''}>🍰 Десерты</option>
                    </select>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Калории</label>
                    <input type="number" id="editItemCalories" value="${item.calories || 0}" min="0" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
                </div>
                <div class="form-group">
                    <label style="display:block;margin-bottom:6px;font-weight:500;">Рейтинг</label>
                    <input type="number" id="editItemRating" value="${item.rating || 4.0}" min="1" max="5" step="0.1" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;">
                </div>
            </div>
            <div class="form-group">
                <label style="display:block;margin-bottom:6px;font-weight:500;">Описание</label>
                <textarea id="editItemDesc" style="width:100%;padding:12px;border:2px solid var(--gray-200);border-radius:10px;resize:vertical;">${item.description || ''}</textarea>
            </div>
            <div style="display:flex;gap:12px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="editItemNew" ${item.is_new ? 'checked' : ''}> <span>Новинка</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" id="editItemPopular" ${item.is_popular ? 'checked' : ''}> <span>Популярное</span>
                </label>
            </div>
            <button type="submit" class="btn btn-primary btn-block"><i class="fas fa-save"></i> Сохранить</button>
        </form>
    `);
}

async function saveMenuItem(e, id) {
    e.preventDefault();
    try {
        await API.put(`/api/admin/menu/${id}`, {
            name: document.getElementById('editItemName').value.trim(),
            price: parseFloat(document.getElementById('editItemPrice').value),
            category: document.getElementById('editItemCategory').value,
            calories: parseInt(document.getElementById('editItemCalories').value) || 0,
            rating: parseFloat(document.getElementById('editItemRating').value) || 4.0,
            description: document.getElementById('editItemDesc').value.trim(),
            is_new: document.getElementById('editItemNew').checked,
            is_popular: document.getElementById('editItemPopular').checked
        });
        showToast('Изменения сохранены!', 'success');
        closeModal();
        loadAdminMenu();
    } catch (err) { showToast(err.message, 'error'); }
}

function exportUsers() {
    const users = adminData.users;
    if (!users.length) return showToast('Нет данных для экспорта', 'warning');
    
    const csv = [
        ['ID', 'Username', 'ФИО', 'Класс', 'Роль', 'Баланс', 'Заказов', 'Потрачено', 'Дата регистрации'].join(';'),
        ...users.map(u => [u.id, u.username, u.fullname, u.grade, u.role, u.balance, u.order_count, u.total_spent, new Date(u.created_at).toLocaleDateString('ru-RU')].join(';'))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `users_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showToast('Экспорт выполнен!', 'success');
}

function exportOrders() {
    const orders = adminData.orders;
    if (!orders.length) return showToast('Нет заказов для экспорта', 'warning');
    
    const csv = [
        ['ID', 'Пользователь', 'Класс', 'Статус', 'Сумма', 'Товары', 'Дата'].join(';'),
        ...orders.map(o => [
            o.id, 
            o.fullname || o.username, 
            o.class_name || '-', 
            getStatusText(o.status), 
            o.total, 
            (o.items || []).map(i => `${i.name} x${i.quantity}`).join(', '),
            new Date(o.created_at).toLocaleString('ru-RU')
        ].join(';'))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showToast('Заказы экспортированы!', 'success');
}

function showAdminDashboard() {
    const orders = adminData.orders;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const avgOrder = orders.length ? (totalRevenue / orders.length).toFixed(2) : 0;
    
    // Популярные товары
    const itemCounts = {};
    orders.forEach(o => (o.items || []).forEach(i => { itemCounts[i.name || 'Блюдо'] = (itemCounts[i.name || 'Блюдо'] || 0) + (i.quantity || 1); }));
    const popularItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    // Заказы по часам
    const hourlyOrders = {};
    orders.forEach(o => { const hour = new Date(o.created_at).getHours(); hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1; });
    
    // Лучшие пользователи
    const userSpending = {};
    orders.forEach(o => { const key = o.fullname || o.username; userSpending[key] = (userSpending[key] || 0) + (o.total || 0); });
    const topUsers = Object.entries(userSpending).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    openModal(`
        <div style="max-height:80vh;overflow-y:auto;">
            <h2 style="margin-bottom:20px;"><i class="fas fa-chart-pie" style="color:var(--primary);"></i> Аналитика</h2>
            
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">
                <div style="background:linear-gradient(135deg,var(--primary),var(--secondary));padding:16px;border-radius:12px;color:white;">
                    <div style="font-size:12px;opacity:0.9;">Всего заказов</div>
                    <div style="font-size:28px;font-weight:700;">${orders.length}</div>
                </div>
                <div style="background:linear-gradient(135deg,#10B981,#059669);padding:16px;border-radius:12px;color:white;">
                    <div style="font-size:12px;opacity:0.9;">Выручка</div>
                    <div style="font-size:28px;font-weight:700;">${totalRevenue.toFixed(0)}₴</div>
                </div>
                <div style="background:linear-gradient(135deg,#F59E0B,#D97706);padding:16px;border-radius:12px;color:white;">
                    <div style="font-size:12px;opacity:0.9;">Средний чек</div>
                    <div style="font-size:28px;font-weight:700;">${avgOrder}₴</div>
                </div>
            </div>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div style="background:var(--gray-50);padding:16px;border-radius:12px;">
                    <h3 style="margin-bottom:12px;font-size:14px;"><i class="fas fa-fire" style="color:var(--error);"></i> Популярные блюда</h3>
                    ${popularItems.map(([name, count], i) => `
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                            <span style="width:24px;height:24px;background:${i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'var(--gray-300)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;">${i+1}</span>
                            <span style="flex:1;font-size:13px;">${name}</span>
                            <span style="font-weight:600;color:var(--primary);">${count} шт</span>
                        </div>
                    `).join('')}
                </div>
                
                <div style="background:var(--gray-50);padding:16px;border-radius:12px;">
                    <h3 style="margin-bottom:12px;font-size:14px;"><i class="fas fa-trophy" style="color:#FFD700;"></i> Топ покупатели</h3>
                    ${topUsers.map(([name, spent], i) => `
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                            <span style="width:24px;height:24px;background:${i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'var(--gray-300)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;">${i+1}</span>
                            <span style="flex:1;font-size:13px;">${name}</span>
                            <span style="font-weight:600;color:var(--success);">${spent.toFixed(0)}₴</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div style="background:var(--gray-50);padding:16px;border-radius:12px;margin-top:20px;">
                <h3 style="margin-bottom:12px;font-size:14px;"><i class="fas fa-clock" style="color:var(--info);"></i> Заказы по часам</h3>
                <div style="display:flex;gap:4px;align-items:flex-end;height:80px;">
                    ${Array.from({length: 12}, (_, i) => {
                        const hour = i + 8;
                        const count = hourlyOrders[hour] || 0;
                        const max = Math.max(...Object.values(hourlyOrders), 1);
                        const height = (count / max) * 100;
                        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;">
                            <div style="width:100%;height:${height}%;background:var(--primary);border-radius:4px 4px 0 0;min-height:4px;"></div>
                            <span style="font-size:9px;color:var(--gray-400);margin-top:4px;">${hour}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>
            
            <div style="display:flex;gap:12px;margin-top:20px;">
                <button class="btn btn-secondary" onclick="exportOrders()" style="flex:1;"><i class="fas fa-download"></i> Экспорт заказов</button>
                <button class="btn btn-primary" onclick="closeModal()" style="flex:1;"><i class="fas fa-check"></i> Готово</button>
            </div>
        </div>
    `);
}

// Kitchen improvements
let kitchenAudio = null;
function playKitchenSound() {
    try {
        if (!kitchenAudio) {
            kitchenAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQYAKI/R7byMRAA');
        }
        kitchenAudio.currentTime = 0;
        kitchenAudio.play().catch(() => {});
    } catch(e) {}
}

let lastKitchenCheck = null;
async function checkNewKitchenOrders() {
    try {
        const data = await API.get('/api/kitchen/notifications' + (lastKitchenCheck ? `?since=${lastKitchenCheck}` : ''));
        if (data.notifications?.length) {
            playKitchenSound();
            showToast(`Новых заказов: ${data.notifications.length}`, 'warning');
        }
        lastKitchenCheck = new Date().toISOString();
    } catch (e) {}
}

// Улучшенная панель кухни
function showKitchenStats() {
    const container = document.getElementById('kitchenOrders');
    const orders = window.kitchenOrdersData || [];
    
    const stats = {
        pending: orders.filter(o => o.status === 'pending').length,
        preparing: orders.filter(o => o.status === 'preparing').length,
        ready: orders.filter(o => o.status === 'ready').length,
        avgTime: calculateAvgTime(orders)
    };
    
    return `
        <div class="kitchen-stats-bar">
            <div class="ks-item pending">
                <i class="fas fa-clock"></i>
                <span>${stats.pending}</span>
                <small>новых</small>
            </div>
            <div class="ks-item preparing">
                <i class="fas fa-fire"></i>
                <span>${stats.preparing}</span>
                <small>готовятся</small>
            </div>
            <div class="ks-item ready">
                <i class="fas fa-check"></i>
                <span>${stats.ready}</span>
                <small>готово</small>
            </div>
            <div class="ks-item time">
                <i class="fas fa-stopwatch"></i>
                <span>~${stats.avgTime}</span>
                <small>мин</small>
            </div>
        </div>
    `;
}

function calculateAvgTime(orders) {
    if (!orders.length) return 0;
    const now = Date.now();
    const times = orders.filter(o => ['preparing', 'ready'].includes(o.status))
        .map(o => (now - new Date(o.created_at).getTime()) / 60000);
    return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
}

window.kitchenOrdersData = [];
let lastOrderItems = [];
function repeatOrder() { 
    lastOrderItems.forEach(item => updateCart(item.id, item.qty)); 
    showToast('Заказ добавлен в корзину', 'success'); 
    navigate('assortment');
}
function clearSearch() {
    const input = document.getElementById('searchInput');
    if (input) { input.value = ''; searchProducts(); }
    const clearBtn = document.querySelector('.search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
}

// ==================== Confetti ====================
function triggerConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const particles = [];
    const colors = ['#00C896', '#7C3AED', '#F472B6', '#F59E0B', '#3B82F6'];
    for (let i = 0; i < 150; i++) particles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height - canvas.height, vx: (Math.random() - 0.5) * 10, vy: Math.random() * 3 + 2, color: colors[Math.floor(Math.random() * colors.length)], size: Math.random() * 8 + 4, rotation: Math.random() * 360, alpha: 1 });
    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.rotation += 5;
            // Fade out after frame 80
            if (frame > 80) p.alpha = Math.max(0, 1 - (frame - 80) / 40);
            ctx.save(); ctx.globalAlpha = p.alpha; ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
        });
        frame++;
        if (frame < 120) {
            requestAnimationFrame(animate);
        } else {
            // Clear canvas when animation ends
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    animate();
}

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) State.user = JSON.parse(savedUser);
    if (localStorage.getItem('theme') === 'dark') { State.isDark = true; document.body.dataset.theme = 'dark'; }
    // Apply saved color scheme
    const savedScheme = localStorage.getItem('colorScheme');
    if (savedScheme && colorSchemes[savedScheme]) {
        const colors = colorSchemes[savedScheme];
        document.documentElement.style.setProperty('--primary', colors.primary);
        document.documentElement.style.setProperty('--primary-light', colors.primary + 'CC');
        document.documentElement.style.setProperty('--primary-dark', colors.primary + '99');
        document.documentElement.style.setProperty('--primary-alpha', colors.primary + '26');
    }
    updateUserUI(); updateCartBadge(); loadProducts(); initVoice();
    setTimeout(() => { document.getElementById('loader')?.classList.add('hidden'); }, 1000);
    document.addEventListener('click', (e) => { if (!e.target.closest('.user-menu')) document.querySelectorAll('.user-menu').forEach(m => m.classList.remove('open')); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
    console.log('RNL Food v3.1 initialized 🚀');
});

function initVoice() {
    if (!('webkitSpeechRecognition' in window)) return;
    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false; recognition.lang = 'ru-RU';
    recognition.onresult = (e) => { const text = e.results[0][0].transcript.toLowerCase(); if (text.includes('меню')) navigate('assortment'); else if (text.includes('профиль')) navigate('profile'); else if (text.includes('корзина')) toggleCart(); };
    document.getElementById('voiceBtn')?.addEventListener('click', () => { document.getElementById('voiceBtn').classList.add('listening'); recognition.start(); setTimeout(() => recognition.stop(), 5000); });
    recognition.onend = () => { document.getElementById('voiceBtn')?.classList.remove('listening'); };
}
