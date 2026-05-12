// ==============================================
// FIREBASE INIT (v8 Compat)
// ==============================================
const firebaseConfig = {
    apiKey: "AIzaSyC_HPtUiLt4ZyMpfgnUZf7yMbya7ePGlgg",
    authDomain: "diplom21.firebaseapp.com",
    projectId: "diplom21",
    storageBucket: "diplom21.firebasestorage.app",
    messagingSenderId: "689518163318",
    appId: "1:689518163318:web:1763693cb1399e2304f657",
    measurementId: "G-KVMR59WDVC"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// ==============================================
// GLOBALS
// ==============================================
let currentUser = null;
let currentSalon = null;
let selectedService = null;
let selectedMaster = null;
let selectedDate = null;
let selectedTime = null;
let currentPage = 'home';
let prefillData = {};
const CACHE_TTL = 5 * 60 * 1000;
let cache = { salons: [], services: [], masters: [], users: [], bookings: [], reviews: [], settings: [] };
let lastFetch = 0;
let editingUserId = null;
let seedCompleted = false;
let isSeeding = false;

let loginMastersList = [];
let loginClientsList = [];

// ==============================================
// HELPERS
// ==============================================
function showNotification(msg, isError = false) {
    const div = document.createElement('div');
    div.className = `notification ${isError ? 'error' : ''}`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function formatDate(date) {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('ru-RU');
}

function renderStars(rating) {
    let stars = '';
    const r = parseFloat(rating) || 0;
    for (let i = 1; i <= 5; i++) stars += i <= r ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
    return `<span class="rating">${stars} <small>(${r.toFixed(1)})</small></span>`;
}

function getCategoryName(cat) {
    const map = { hair:'Парикмахерские', nails:'Ногтевой сервис', cosmetology:'Косметология', massage:'Массаж', barber:'Барбершоп' };
    return map[cat] || cat;
}

function getSafeImageUrl(type, name) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect width="400" height="300" fill="#f0f2f5"/>
        <text x="200" y="150" font-family="Arial" font-size="20" fill="#808080" text-anchor="middle">Изображение</text>
        <text x="200" y="180" font-family="Arial" font-size="14" fill="#90a0b0" text-anchor="middle">${type}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function getCached(collection, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cache[collection] && now - lastFetch < CACHE_TTL) return cache[collection];
    try {
        const snap = await db.collection(collection).get();
        cache[collection] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        lastFetch = now;
        return cache[collection];
    } catch(e) {
        console.error(`Load ${collection}:`, e);
        return [];
    }
}

async function clearCache() {
    cache = { salons: [], services: [], masters: [], users: [], bookings: [], reviews: [], settings: [] };
    lastFetch = 0;
}

async function logAdminAction(actionType, collection, docId, oldData, newData) {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'master')) return;
    try {
        await db.collection('admin_actions').add({
            adminId: currentUser.uid,
            adminName: currentUser.name || currentUser.email,
            adminRole: currentUser.role,
            actionType,
            collection,
            docId,
            oldData: oldData ? JSON.parse(JSON.stringify(oldData)) : null,
            newData: newData ? JSON.parse(JSON.stringify(newData)) : null,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) { console.error("Failed to log action", e); }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ==============================================
// AUTH & QUICK LOGIN LOGIC
// ==============================================
async function loadLoginDropdowns() {
    try {
        const users = await getCached('users', true);
        const masters = await getCached('masters', true);
        const salons = await getCached('salons');
        const salonMap = Object.fromEntries(salons.map(s => [s.id, s.name]));

        const masterSelect = document.getElementById('master-select-login');
        if (masterSelect) {
            masterSelect.innerHTML = '<option value="" disabled selected>Выбрать мастера...</option>';
            masters.forEach(m => {
                const masterUser = users.find(u => u.uid === m.userId);
                const email = masterUser ? masterUser.email : '';
                const salonName = salonMap[m.salonId] || 'Неизвестный салон';
                const displayName = `${m.name} (Салон: ${salonName})`;
                const option = document.createElement('option');
                option.value = email;
                option.textContent = displayName;
                option.dataset.pass = 'Master123!';
                masterSelect.appendChild(option);
            });
        }

        const clientSelect = document.getElementById('client-select-login');
        if (clientSelect) {
            clientSelect.innerHTML = '<option value="" disabled selected>Выбрать клиента...</option>';
            const clients = users.filter(u => u.role === 'client');
            clients.forEach(c => {
                const option = document.createElement('option');
                option.value = c.email;
                option.textContent = c.name || c.email;
                option.dataset.pass = 'client123';
                clientSelect.appendChild(option);
            });
        }
    } catch (e) { console.error("Ошибка загрузки списков входа:", e); }
}

window.fillAdminCreds = function() {
    document.getElementById('login-email').value = 'admin@beauty.ru';
    document.getElementById('login-password').value = 'admin123';
    document.getElementById('login-error').style.display = 'none';
};

window.fillMasterCreds = function(email) {
    const select = document.getElementById('master-select-login');
    if (!select) return;
    const option = select.options[select.selectedIndex];
    if (email && option && option.dataset.pass) {
        document.getElementById('login-email').value = email;
        document.getElementById('login-password').value = option.dataset.pass;
        document.getElementById('login-error').style.display = 'none';
    }
};

window.fillClientCreds = function(email) {
    const select = document.getElementById('client-select-login');
    if (!select) return;
    const option = select.options[select.selectedIndex];
    if (email && option && option.dataset.pass) {
        document.getElementById('login-email').value = email;
        document.getElementById('login-password').value = option.dataset.pass;
        document.getElementById('login-error').style.display = 'none';
    }
};

// ==============================================
// NAVIGATION
// ==============================================
function showPage(pageId, params = {}) {
    currentPage = pageId;
    const container = document.getElementById('main-content');
    if (!container) return;
    container.innerHTML = '<div class="container" style="min-height:60vh;"><div class="loading-spinner">Загрузка...</div></div>';
    const url = pageId === 'home' ? '#' : `#${pageId}`;
    history.pushState({ pageId, params }, '', url);
    if (pageId === 'home') renderHome();
    else if (pageId === 'salons') renderSalons(params);
    else if (pageId === 'services') renderServices();
    else if (pageId === 'masters') renderMasters();
    else if (pageId === 'salon' && params.id) renderSalonDetail(params.id);
    else if (pageId === 'master' && params.id) renderMasterDetail(params.id);
    else if (pageId === 'service' && params.name) renderServiceDetail(params.name);
    else if (pageId === 'booking') renderBooking();
    else if (pageId === 'profile') renderProfile();
    else if (pageId === 'master-cabinet') renderMasterCabinet();
    else if (pageId === 'master-schedule') renderMasterSchedule();
    else if (pageId === 'admin') renderAdmin();
    else renderHome();
    attachNavListeners();
}

window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (state && state.pageId) showPage(state.pageId, state.params || {});
    else showPage('home');
});

(function initNavigation() {
    const hash = location.hash.slice(1);
    if (hash) showPage(hash);
    else showPage('home');
})();

function attachNavListeners() {
    document.querySelectorAll('[data-page]').forEach(link => {
        link.onclick = (e) => { e.preventDefault(); showPage(link.dataset.page); };
        link.classList.toggle('active', link.dataset.page === currentPage);
    });
}

// ==============================================
// HOME PAGE (с индикацией загрузки данных)
// ==============================================
async function renderHome() {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    
    if (isSeeding) {
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px;">
                <div class="loading-spinner"></div>
                <p style="margin-top:20px; color:var(--text-light);">Подготовка данных, пожалуйста подождите...</p>
                <p style="font-size:0.9rem; color:var(--text-light);">Это происходит только при первом запуске</p>
            </div>
        `;
        const checkInterval = setInterval(() => {
            if (!isSeeding) {
                clearInterval(checkInterval);
                renderHome();
            }
        }, 500);
        return;
    }

    if (!seedCompleted && !isSeeding) { await seedDataIfEmpty(true); clearCache(); }
    
    let heroTitle = 'BeautyBooking — запись в салоны красоты';
    let heroSubtitle = 'Лучшие мастера, удобное бронирование';
    let heroImage = getSafeImageUrl('hero', 'default');
    try {
        const settingsSnap = await db.collection('settings').doc('main_page').get();
        if (settingsSnap.exists) {
            const data = settingsSnap.data();
            if (data.heroTitle) heroTitle = data.heroTitle;
            if (data.heroSubtitle) heroSubtitle = data.heroSubtitle;
            if (data.heroImage) heroImage = data.heroImage;
        }
    } catch (e) {}
    
    container.innerHTML = `
    <div class="hero"><img src="${heroImage}" class="hero-img-bg" onerror="this.src='${getSafeImageUrl('hero','fallback')}'"><div class="container hero-content"><h1>${heroTitle}</h1><p>${heroSubtitle}</p><div class="search-bar"><input type="text" id="homeSearch" placeholder="Поиск..."><button id="searchBtn">Найти</button></div></div></div>
    <div id="dataStatus"></div>
    ${ (currentUser && currentUser.role === 'admin') ? '<div style="text-align:center; margin-bottom:20px;"><button class="btn btn-outline" id="resetDataBtn">Сбросить и пересоздать тестовые данные</button></div>' : '' }
    <h2 class="section-title">Рекомендуемые салоны</h2><div id="topSalons" class="salons-grid"></div>
    <h2 class="section-title">Все салоны</h2><div id="allSalons" class="salons-grid"></div>
    <h2 class="section-title">Отзывы</h2><div id="reviewsBlock" class="salons-grid"></div>
    `;
    
    const resetBtn = document.getElementById('resetDataBtn');
    if (resetBtn) resetBtn.addEventListener('click', async () => { if (confirm('Вы уверены?')) await resetAndReseedAllData(); });
    
    let salons = await getCached('salons', true);
    if (salons.length === 0) {
        const statusDiv = document.getElementById('dataStatus');
        if (statusDiv) statusDiv.innerHTML = `<div style="background:#fff3cd;border-radius:16px;padding:20px;margin:20px 0;text-align:center"><p>База пуста. Нажмите кнопку "Сбросить данные" или обновите страницу.</p></div>`;
    } else {
        let personalized = [];
        if (currentUser) {
            const bookings = (await getCached('bookings')).filter(b => b.userId === currentUser.uid);
            if (bookings.length > 0) {
                const lastBooking = bookings.sort((a,b) => new Date(b.date) - new Date(a.date))[0];
                const lastSalon = salons.find(s => s.id === lastBooking.salonId);
                if (lastSalon && lastSalon.specializations) {
                    personalized = salons.filter(s => s.id !== lastSalon.id && s.specializations?.some(spec => lastSalon.specializations.includes(spec)));
                }
            }
        }
        const recommended = personalized.length >= 3 ? personalized.slice(0,3) : [...salons].sort((a,b)=> (b.rating||0)-(a.rating||0)).slice(0,3);
        renderSalonCards(recommended, 'topSalons');
        renderSalonCards(salons, 'allSalons');
    }
    
    const reviews = await getCached('reviews');
    const reviewsBlock = document.getElementById('reviewsBlock');
    if (reviewsBlock) reviewsBlock.innerHTML = reviews.slice(0,6).map(r => `<div class="card"><div class="card-content"><div class="rating">${renderStars(r.rating)}</div><p>"${r.text}"</p><p><strong>${r.authorName}</strong> — ${r.salonName}</p></div></div>`).join('');
    
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.onclick = async () => {
            const q = document.getElementById('homeSearch').value.trim();
            if (q) {
                const services = await getCached('services');
                const masters = await getCached('masters');
                const lowerQ = q.toLowerCase();
                const matchedSalonIds = new Set();
                salons.forEach(s => { if (s.name?.toLowerCase().includes(lowerQ) || s.address?.toLowerCase().includes(lowerQ)) matchedSalonIds.add(s.id); });
                services.forEach(svc => { if (svc.name?.toLowerCase().includes(lowerQ) || getCategoryName(svc.category).toLowerCase().includes(lowerQ)) if (svc.salonId) matchedSalonIds.add(svc.salonId); });
                masters.forEach(m => { if (m.name?.toLowerCase().includes(lowerQ) || m.specialization?.toLowerCase().includes(lowerQ)) if (m.salonId) matchedSalonIds.add(m.salonId); });
                if (matchedSalonIds.size > 0) showPage('salons', { search: q, filteredIds: Array.from(matchedSalonIds) });
                else showPage('salons', { search: q });
            } else showPage('salons');
        };
    }
}

function renderSalonCards(salons, containerId) {
    const container = document.getElementById(containerId);
    if (!container || salons.length === 0) return;
    const fallbackImg = getSafeImageUrl('salon','fallback');
    container.innerHTML = salons.map(s => `
    <div class="card" data-id="${s.id}"><img src="${s.imageUrl||fallbackImg}" class="card-img" onerror="this.src='${fallbackImg}'"><div class="card-content"><h3 class="card-title">${escapeHtml(s.name)}</h3><p><i class="fas fa-map-marker-alt"></i> ${escapeHtml(s.address||'')}</p><div class="rating">${renderStars(s.rating)}</div><div class="card-actions"><button class="btn btn-outline btn-detail" data-id="${s.id}">Подробнее</button><button class="btn btn-primary btn-book" data-id="${s.id}">Записаться</button></div></div></div>
    `).join('');
    container.querySelectorAll('.btn-detail').forEach(btn => btn.onclick = () => showPage('salon', { id: btn.dataset.id }));
    container.querySelectorAll('.btn-book').forEach(btn => btn.onclick = () => startBooking({ salonId: btn.dataset.id }));
    container.querySelectorAll('.card').forEach(card => card.onclick = (e) => { if(!e.target.closest('button')) showPage('salon', { id: card.dataset.id }); });
}

// ==============================================
// LISTS & DETAILS
// ==============================================
async function renderSalons(params = {}) {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `
        <h1 class="section-title">Все салоны</h1>
        <div class="filters-bar" style="display:flex; gap:15px; align-items:center; margin-bottom:20px; flex-wrap:wrap;">
            <input type="text" id="salonSearchInput" placeholder="Поиск салонов..." class="form-input" style="max-width:300px;">
            <select id="ratingFilter" class="form-input" style="max-width:200px;">
                <option value="all">Все рейтинги</option>
                <option value="4.5">4.5 и выше</option>
                <option value="4">4.0 и выше</option>
                <option value="3">3.0 и выше</option>
            </select>
            <button id="applyFiltersBtn" class="btn btn-primary">Применить</button>
        </div>
        <div id="salonsList" class="salons-grid"></div>
    `;
    const applyFilters = async () => {
        const searchText = document.getElementById('salonSearchInput').value.trim().toLowerCase();
        const ratingFilterVal = document.getElementById('ratingFilter').value;
        let salons = await getCached('salons', true);
        if (params.filteredIds) { const idSet = new Set(params.filteredIds); salons = salons.filter(s => idSet.has(s.id)); }
        else if (params.search) { const lower = params.search.toLowerCase(); salons = salons.filter(s => s.name?.toLowerCase().includes(lower) || s.address?.toLowerCase().includes(lower)); }
        if (searchText) salons = salons.filter(s => s.name?.toLowerCase().includes(searchText) || s.address?.toLowerCase().includes(searchText));
        if (ratingFilterVal !== 'all') { const minRating = parseFloat(ratingFilterVal); salons = salons.filter(s => parseFloat(s.rating) >= minRating); }
        renderSalonCards(salons, 'salonsList');
    };
    document.getElementById('applyFiltersBtn').onclick = applyFilters;
    if (params.search) document.getElementById('salonSearchInput').value = params.search;
    await applyFilters();
}

async function renderServices() {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `<h1 class="section-title">Все услуги</h1><div id="servicesList" class="services-grid"></div>`;
    let services = await getCached('services', true);
    const list = document.getElementById('servicesList');
    if (!list) return;
    if (services.length === 0) {
        const resetLink = (currentUser && currentUser.role === 'admin') ? ' Нажмите кнопку "Сбросить данные" на главной странице.' : '';
        list.innerHTML = `<p class="no-results" style="grid-column:1/-1; text-align:center; padding:40px;">Услуги не найдены.${resetLink}</p>`;
        return;
    }
    const unique = new Map();
    services.forEach(s => { if(!unique.has(s.name)) unique.set(s.name, s); });
    const fallbackImg = getSafeImageUrl('service','fallback');
    list.innerHTML = Array.from(unique.values()).map(s => `
    <div class="card" data-name="${encodeURIComponent(s.name)}"><img src="${s.imageUrl||fallbackImg}" class="card-img" onerror="this.src='${fallbackImg}'"><div class="card-content"><h3>${escapeHtml(s.name)}</h3><p>${s.price} ₽ • ${getCategoryName(s.category)}</p><div class="card-actions"><button class="btn btn-outline btn-detail" data-name="${encodeURIComponent(s.name)}">Подробнее</button><button class="btn btn-primary btn-book" data-name="${encodeURIComponent(s.name)}">Записаться</button></div></div></div>
    `).join('');
    list.querySelectorAll('.btn-detail').forEach(btn => btn.onclick = () => showPage('service', { name: decodeURIComponent(btn.dataset.name) }));
    list.querySelectorAll('.btn-book').forEach(btn => btn.onclick = () => startBooking({ serviceName: decodeURIComponent(btn.dataset.name) }));
}

async function renderMasters() {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `<h1 class="section-title">Наши мастера</h1><div id="mastersList" class="masters-grid"></div>`;
    let masters = await getCached('masters', true);
    const salons = await getCached('salons');
    const salonMap = Object.fromEntries(salons.map(s => [s.id, s.name]));
    const list = document.getElementById('mastersList');
    if (!list) return;
    if (masters.length === 0) {
        const resetLink = (currentUser && currentUser.role === 'admin') ? ' Нажмите кнопку "Сбросить данные" на главной странице.' : '';
        list.innerHTML = `<p class="no-results" style="grid-column:1/-1; text-align:center; padding:40px;">Мастера не найдены.${resetLink}</p>`;
        return;
    }
    const fallbackImg = getSafeImageUrl('master','fallback');
    list.innerHTML = masters.map(m => `
    <div class="card" data-id="${m.id}"><img src="${m.imageUrl||fallbackImg}" class="card-img" onerror="this.src='${fallbackImg}'"><div class="card-content"><h3>${escapeHtml(m.name)}</h3><p><i class="fas fa-user-tie"></i> ${escapeHtml(m.specialization||'Мастер')}</p><p><i class="fas fa-store"></i> ${escapeHtml(m.salonName||salonMap[m.salonId]||'Не указан')}</p><div class="rating">${renderStars(m.rating)}</div><div class="card-actions"><button class="btn btn-outline btn-detail" data-id="${m.id}">Подробнее</button><button class="btn btn-primary btn-book" data-id="${m.id}">Записаться</button></div></div></div>
    `).join('');
    list.querySelectorAll('.btn-detail').forEach(btn => btn.onclick = () => showPage('master', { id: btn.dataset.id }));
    list.querySelectorAll('.btn-book').forEach(btn => btn.onclick = () => startBooking({ masterId: btn.dataset.id }));
}

async function renderSalonDetail(id) {
    try {
        const salonDoc = await db.collection('salons').doc(id).get();
        if (!salonDoc.exists) { showNotification('Салон не найден', true); showPage('salons'); return; }
        const salon = { id: salonDoc.id, ...salonDoc.data() };
        currentSalon = salon;
        const servicesSnapshot = await db.collection('services').where('salonId', '==', id).get();
        const mastersSnapshot = await db.collection('masters').where('salonId', '==', id).get();
        const services = []; servicesSnapshot.forEach(doc => services.push({ id: doc.id, ...doc.data() }));
        const masters = []; mastersSnapshot.forEach(doc => masters.push({ id: doc.id, ...doc.data() }));
        const reviewsSnapshot = await db.collection('reviews').where('salonId', '==', id).get();
        const reviews = []; reviewsSnapshot.forEach(doc => reviews.push({ id: doc.id, ...doc.data() }));
        const container = document.querySelector('#main-content .container');
        if (!container) return;
        const fallbackImg = getSafeImageUrl('salon','fallback');
        container.innerHTML = `
        <div class="detail-header"><div class="detail-img"><img src="${salon.imageUrl||fallbackImg}" onerror="this.src='${fallbackImg}'"></div><div class="detail-info"><h1 class="detail-title">${escapeHtml(salon.name)}</h1><div class="detail-meta"><span><i class="fas fa-map-marker-alt"></i> ${escapeHtml(salon.address||'')}</span><span><i class="fas fa-star"></i> ${(parseFloat(salon.rating)||0).toFixed(1)}</span></div><button class="btn btn-primary" id="bookSalonBtn"><i class="fas fa-calendar-check"></i> Записаться</button></div></div>
        <h2 class="section-title">Услуги салона</h2><div id="salonServices" class="services-grid"></div>
        <h2 class="section-title">Мастера салона</h2><div id="salonMasters" class="masters-grid"></div>
        <h2 class="section-title">Отзывы</h2>
        <div id="salonReviews">
            ${currentUser ? `<div class="review-form card" style="padding:20px; margin-bottom:20px;"><h3>Оставить отзыв</h3><div class="star-rating" id="reviewStars">${[1,2,3,4,5].map(i => `<i class="far fa-star" data-value="${i}"></i>`).join('')}</div><textarea id="reviewText" class="form-input" placeholder="Ваш отзыв..." rows="3"></textarea><button id="submitReviewBtn" class="btn btn-primary" style="margin-top:10px;">Отправить</button></div>` : '<p style="margin-bottom:20px;">Войдите, чтобы оставить отзыв.</p>'}
            <div id="reviewsList"></div>
        </div>
        `;
        document.getElementById('bookSalonBtn').onclick = () => startBooking({ salonId: id });
        const svcDiv = document.getElementById('salonServices');
        const svcFallback = getSafeImageUrl('service','fallback');
        if (svcDiv) svcDiv.innerHTML = services.map(s => `<div class="card" data-name="${encodeURIComponent(s.name)}"><img src="${s.imageUrl||svcFallback}" class="card-img" onerror="this.src='${svcFallback}'"><div class="card-content"><h3>${escapeHtml(s.name)||'Без названия'}</h3><p>${s.price||0} ₽ • ${getCategoryName(s.category)}</p></div></div>`).join('');
        svcDiv.querySelectorAll('.card').forEach(c => c.onclick = () => showPage('service', { name: decodeURIComponent(c.dataset.name) }));
        const mstDiv = document.getElementById('salonMasters');
        const mstFallback = getSafeImageUrl('master','fallback');
        if (mstDiv) mstDiv.innerHTML = masters.map(m => `<div class="card" data-id="${m.id}"><img src="${m.imageUrl||mstFallback}" class="card-img" onerror="this.src='${mstFallback}'"><div class="card-content"><h3>${escapeHtml(m.name)||'Без имени'}</h3><p>${escapeHtml(m.specialization)||''}</p><div class="rating">${renderStars(m.rating)}</div></div></div>`).join('');
        mstDiv.querySelectorAll('.card').forEach(c => c.onclick = () => startBooking({ masterId: c.dataset.id, salonId: id }));
        const reviewsListDiv = document.getElementById('reviewsList');
        function renderReviewList() {
            reviewsListDiv.innerHTML = reviews.length ? reviews.map(r => `<div class="card"><div class="card-content"><div class="rating">${renderStars(r.rating)}</div><p>"${r.text}"</p><p><strong>${r.authorName}</strong> &mdash; ${new Date(r.createdAt?.seconds*1000).toLocaleDateString('ru-RU')}</p></div></div>`).join('') : '<p>Пока нет отзывов.</p>';
        }
        renderReviewList();
        let selectedReviewRating = 0;
        const starElements = document.querySelectorAll('#reviewStars i');
        starElements.forEach(star => {
            star.addEventListener('click', function() { selectedReviewRating = parseInt(this.dataset.value); updateStars(selectedReviewRating); });
            star.addEventListener('mouseenter', function() { updateStars(parseInt(this.dataset.value)); });
        });
        document.getElementById('reviewStars')?.addEventListener('mouseleave', () => updateStars(selectedReviewRating));
        function updateStars(val) { starElements.forEach(s => { s.className = parseInt(s.dataset.value) <= val ? 'fas fa-star' : 'far fa-star'; }); }
        document.getElementById('submitReviewBtn')?.addEventListener('click', async () => {
            const text = document.getElementById('reviewText').value.trim();
            if (!selectedReviewRating) { showNotification('Выберите оценку', true); return; }
            if (!text) { showNotification('Напишите отзыв', true); return; }
            try {
                const newReview = { salonId: id, salonName: salon.name, userId: currentUser.uid, authorName: currentUser.name || currentUser.email, rating: selectedReviewRating, text: text, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
                await db.collection('reviews').add(newReview);
                const allReviewsSnap = await db.collection('reviews').where('salonId', '==', id).get();
                let totalRating = 0, count = 0;
                allReviewsSnap.forEach(doc => { totalRating += doc.data().rating; count++; });
                const avg = count ? (totalRating / count).toFixed(1) : 0;
                await db.collection('salons').doc(id).update({ rating: parseFloat(avg) });
                clearCache();
                showNotification('Отзыв добавлен!');
                showPage('salon', { id: id });
            } catch(e) { showNotification('Ошибка: ' + e.message, true); }
        });
    } catch(e) { console.error(e); }
}

async function renderMasterDetail(id) {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    try {
        const doc = await db.collection('masters').doc(id).get();
        if (!doc.exists) { showNotification('Мастер не найден', true); showPage('masters'); return; }
        const master = { id: doc.id, ...doc.data() };
        const salonDoc = await db.collection('salons').doc(master.salonId).get();
        const salon = salonDoc.exists ? salonDoc.data() : { name: 'Не указан' };
        const servicesSnapshot = await db.collection('services').where('salonId', '==', master.salonId).get();
        const services = [];
        servicesSnapshot.forEach(doc => { const s = { id: doc.id, ...doc.data() }; if (master.providedServices?.includes(s.id)) services.push(s); });
        const fallbackImg = getSafeImageUrl('master','fallback');
        const svcFallback = getSafeImageUrl('service','fallback');
        container.innerHTML = `
        <div class="detail-header"><div class="detail-img"><img src="${master.imageUrl||fallbackImg}" onerror="this.src='${fallbackImg}'"></div><div class="detail-info"><h1 class="detail-title">${escapeHtml(master.name)}</h1><div class="detail-meta"><span><i class="fas fa-store"></i> ${escapeHtml(salon.name)}</span><span><i class="fas fa-briefcase"></i> ${escapeHtml(master.specialization||'')}</span><span><i class="fas fa-star"></i> ${(parseFloat(master.rating)||0).toFixed(1)}</span></div><button class="btn btn-primary" id="bookMasterBtn"><i class="fas fa-calendar-check"></i> Записаться</button></div></div>
        <h2 class="section-title">Услуги мастера</h2><div id="masterServices" class="services-grid"></div>
        `;
        document.getElementById('bookMasterBtn').onclick = () => startBooking({ masterId: id });
        const svcDiv = document.getElementById('masterServices');
        if (svcDiv) svcDiv.innerHTML = services.map(s => `<div class="card" data-name="${encodeURIComponent(s.name)}"><img src="${s.imageUrl||svcFallback}" class="card-img" onerror="this.src='${svcFallback}'"><div class="card-content"><h3>${escapeHtml(s.name)||'Без названия'}</h3><p>${s.price||0} ₽</p></div></div>`).join('');
        svcDiv.querySelectorAll('.card').forEach(c => c.onclick = () => startBooking({ masterId: id, serviceName: decodeURIComponent(c.dataset.name) }));
    } catch(e) { console.error(e); }
}

async function renderServiceDetail(name) {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    try {
        const decoded = decodeURIComponent(name);
        const services = await getCached('services');
        const service = services.find(s => s.name === decoded);
        if (!service) { showNotification('Услуга не найдена', true); showPage('services'); return; }
        const salonIds = [...new Set(services.filter(s => s.name === decoded).map(s => s.salonId))];
        const salons = (await getCached('salons')).filter(s => salonIds.includes(s.id));
        const fallbackImg = getSafeImageUrl('service','fallback');
        container.innerHTML = `
        <div class="detail-header"><div class="detail-img"><img src="${service.imageUrl||fallbackImg}" onerror="this.src='${fallbackImg}'"></div><div class="detail-info"><h1 class="detail-title">${escapeHtml(service.name)}</h1><div class="detail-meta"><span><i class="fas fa-tag"></i> ${getCategoryName(service.category)}</span><span><i class="fas fa-ruble-sign"></i> ${service.price} ₽</span></div><button class="btn btn-primary" id="bookServiceBtn"><i class="fas fa-calendar-check"></i> Записаться</button></div></div>
        <h2 class="section-title">Салоны, предоставляющие услугу</h2><div id="serviceSalons" class="salons-grid"></div>
        `;
        document.getElementById('bookServiceBtn').onclick = () => startBooking({ serviceName: decoded });
        renderSalonCards(salons, 'serviceSalons');
    } catch(e) { console.error(e); }
}

// ==============================================
// BOOKING (полностью)
// ==============================================
let bookingServicesCache = [];
let bookingMastersCache = [];

async function startBooking(prefill = {}) {
    prefillData = prefill;
    selectedService = selectedMaster = selectedDate = selectedTime = null;
    await renderBooking();
    showPage('booking');
}

async function renderBooking() {
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `
    <h1 class="section-title">Бронирование</h1>
    <div class="booking-steps"><div class="step active" data-step="1"><div class="step-circle">1</div><div>Услуга</div></div><div class="step" data-step="2"><div class="step-circle">2</div><div>Мастер</div></div><div class="step" data-step="3"><div class="step-circle">3</div><div>Дата/время</div></div><div class="step" data-step="4"><div class="step-circle">4</div><div>Подтверждение</div></div></div>
    <div id="step1" class="booking-step active"><h3>Выберите услугу</h3><div id="bookingServices" class="services-grid"></div><button id="next1" class="btn btn-primary" disabled>Далее</button></div>
    <div id="step2" class="booking-step"><h3>Выберите мастера</h3><div id="bookingMasters" class="masters-grid"></div><button id="prev2" class="btn btn-secondary">Назад</button><button id="next2" class="btn btn-primary" disabled>Далее</button></div>
    <div id="step3" class="booking-step"><h3>Дата и время</h3><input type="date" id="bookingDate" class="form-input"><div id="timeSlots" class="time-slots"></div><button id="prev3" class="btn btn-secondary">Назад</button><button id="next3" class="btn btn-primary" disabled>Далее</button></div>
    <div id="step4" class="booking-step"><h3>Подтверждение</h3><div id="summary" class="booking-summary"></div><div class="form-group"><label>Имя</label><input type="text" id="clientName" class="form-input"></div><div class="form-group"><label>Телефон</label><input type="tel" id="clientPhone" class="form-input" placeholder="+7XXXXXXXXXX"></div><div class="form-group"><label>Комментарий</label><textarea id="clientComment" class="form-input"></textarea></div>
    <div class="form-group" id="points-use-group" style="display:none;"><label><input type="checkbox" id="usePoints"> Использовать баллы (до 30%)</label><p id="points-info" style="font-size:0.9rem;color:var(--text-light);margin-top:5px;"></p></div>
    <button id="prev4" class="btn btn-secondary">Назад</button><button id="confirmBtn" class="btn btn-primary">Подтвердить</button></div>
    `;
    await loadBookingServices();
    attachBookingEvents();
}

async function loadBookingServices() {
    let services = await getCached('services', true);
    if (prefillData.salonId) services = services.filter(s => s.salonId === prefillData.salonId);
    if (prefillData.serviceName) services = services.filter(s => s.name === prefillData.serviceName);
    if (prefillData.masterId && prefillData.masterId !== 'any') { const m = (await getCached('masters')).find(x => x.id === prefillData.masterId); if (m) services = services.filter(s => m.providedServices?.includes(s.id)); }
    services = services.map(s => ({ ...s, duration: s.duration || 60 }));
    const unique = new Map();
    services.forEach(s => { if (!unique.has(s.name)) unique.set(s.name, s); });
    bookingServicesCache = Array.from(unique.values());
    const container = document.getElementById('bookingServices');
    if (!container) return;
    container.innerHTML = bookingServicesCache.map((s, idx) => `
        <div class="card" data-idx="${idx}">
            <div class="card-content">
                <h3>${escapeHtml(s.name)||'Без названия'}</h3>
                <p>${s.price||0} ₽</p>
            </div>
        </div>
    `).join('');
    container.querySelectorAll('.card').forEach(card => {
        card.onclick = () => {
            container.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            const idx = parseInt(card.dataset.idx);
            selectedService = bookingServicesCache[idx];
            const btn = document.getElementById('next1'); if (btn) btn.disabled = false;
        };
    });
    if (bookingServicesCache.length === 1) {
        container.querySelector('.card')?.click();
    }
}

async function loadBookingMasters() {
    if (!selectedService) return;
    let masters = (await getCached('masters', true)).filter(m => m.providedServices?.includes(selectedService.id));
    if (prefillData.salonId) masters = masters.filter(m => m.salonId === prefillData.salonId);
    bookingMastersCache = masters;
    const container = document.getElementById('bookingMasters');
    if (!container) return;
    let html = `<div class="card" data-idx="-1"><div class="card-content"><h3>Любой свободный мастер</h3><p>Мы подберем лучшее время</p></div></div>`;
    html += bookingMastersCache.map((m, idx) => `
        <div class="card" data-idx="${idx}">
            <div class="card-content">
                <h3>${escapeHtml(m.name)||'Без имени'}</h3>
                <p>${escapeHtml(m.specialization)||''}</p>
            </div>
        </div>
    `).join('');
    container.innerHTML = html;
    container.querySelectorAll('.card').forEach(card => {
        card.onclick = () => {
            container.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            const idx = parseInt(card.dataset.idx);
            if (idx === -1) {
                selectedMaster = { id: 'any', name: 'Любой свободный мастер', salonId: null, salonName: null };
            } else {
                selectedMaster = bookingMastersCache[idx];
            }
            const btn = document.getElementById('next2'); if (btn) btn.disabled = false;
        };
    });
    if (prefillData.masterId) {
        const targetIdx = bookingMastersCache.findIndex(m => m.id === prefillData.masterId);
        if (targetIdx !== -1) {
            const targetCard = container.querySelector(`.card[data-idx="${targetIdx}"]`);
            if (targetCard) targetCard.click();
        }
    }
}

async function loadTimeSlots(date) {
    if (!date || !selectedMaster || !selectedService) return;
    const slots = [];
    for (let h=10; h<=20; h++) {
        slots.push(`${h}:00`);
        if (h<20) slots.push(`${h}:30`);
    }
    let relevantMasterIds = [];
    if (selectedMaster.id === 'any') {
        const allMasters = await getCached('masters');
        relevantMasterIds = allMasters.filter(m => m.providedServices?.includes(selectedService.id)).map(m => m.id);
        if (prefillData.salonId) {
            const salonMasters = allMasters.filter(m => m.salonId === prefillData.salonId);
            relevantMasterIds = relevantMasterIds.filter(id => salonMasters.some(sm => sm.id === id));
        }
    } else {
        relevantMasterIds = [selectedMaster.id];
    }
    try {
        const allBookings = await getCached('bookings');
        const bookedSlots = new Set();
        const serviceDuration = selectedService.duration || 60;
        const buffer = 15;
        for (const masterId of relevantMasterIds) {
            const master = (await getCached('masters')).find(m => m.id === masterId);
            if (master && master.daysOff && master.daysOff.includes(date)) {
                slots.forEach(slot => bookedSlots.add(slot));
                continue;
            }
            const masterBookings = allBookings.filter(b => b.masterId === masterId && b.date === date && b.status !== 'Отменена');
            for (const slotTime of slots) {
                const [sh, sm] = slotTime.split(':').map(Number);
                const slotStartMinutes = sh * 60 + sm;
                const slotEndMinutes = slotStartMinutes + serviceDuration + buffer;
                let isBusy = false;
                for (const booking of masterBookings) {
                    const [bh, bm] = booking.time.split(':').map(Number);
                    const bookStartMinutes = bh * 60 + bm;
                    const bookEndMinutes = bookStartMinutes + (selectedService.duration || 60) + buffer;
                    if (slotStartMinutes < bookEndMinutes && slotEndMinutes > bookStartMinutes) {
                        isBusy = true;
                        break;
                    }
                }
                if (isBusy) bookedSlots.add(slotTime);
            }
        }
        const container = document.getElementById('timeSlots');
        if (!container) return;
        container.innerHTML = slots.map(t => `<div class="time-slot ${bookedSlots.has(t)?'booked':''}" data-time="${t}">${t}</div>`).join('');
        container.querySelectorAll('.time-slot:not(.booked)').forEach(slot => {
            slot.onclick = () => {
                container.querySelectorAll('.time-slot').forEach(s => s.classList.remove('selected'));
                slot.classList.add('selected');
                selectedTime = slot.dataset.time;
                const btn = document.getElementById('next3'); if (btn) btn.disabled = false;
            };
        });
    } catch (error) {
        showNotification('Ошибка загрузки времени: ' + error.message, true);
        console.error(error);
    }
}

function updateSummary() {
    const summary = document.getElementById('summary');
    if (!summary) return;
    const usePointsCheckbox = document.getElementById('usePoints');
    let finalPrice = selectedService?.price || 0;
    if (usePointsCheckbox && usePointsCheckbox.checked && currentUser) {
        const maxDiscount = Math.floor(finalPrice * 0.3);
        const userPoints = currentUser.points || 0;
        const used = Math.min(maxDiscount, userPoints);
        finalPrice = finalPrice - used;
    }
    summary.innerHTML = `<div class="summary-item"><span>Услуга:</span><span>${selectedService?.name||'—'}</span></div><div class="summary-item"><span>Мастер:</span><span>${selectedMaster?.name||'—'}</span></div><div class="summary-item"><span>Дата:</span><span>${selectedDate||'—'}</span></div><div class="summary-item"><span>Время:</span><span>${selectedTime||'—'}</span></div><div class="summary-item summary-total"><span>Итого:</span><span>${finalPrice} ₽</span></div>`;
}

async function checkPointsAvailability() {
    if (!currentUser) return;
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    const userData = userDoc.data();
    const points = userData.points || 0;
    const group = document.getElementById('points-use-group');
    const info = document.getElementById('points-info');
    if (points > 0) { group.style.display = 'block'; const maxDiscount = Math.floor(selectedService.price * 0.3); info.innerText = `У вас ${points} баллов. Можно списать до ${maxDiscount} баллов.`; }
    else group.style.display = 'none';
}

async function confirmBooking() {
    if (!selectedService || !selectedMaster || !selectedDate || !selectedTime) return;
    const name = document.getElementById('clientName').value;
    const phoneRaw = document.getElementById('clientPhone').value.trim();
    const comment = document.getElementById('clientComment').value;
    const usePoints = document.getElementById('usePoints')?.checked;
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    if (!/^7\d{10}$/.test(phoneDigits) && !/^8\d{10}$/.test(phoneDigits)) { showNotification('Введите корректный номер телефона в формате +7XXXXXXXXXX', true); return; }
    const phone = '+7' + phoneDigits.slice(-10);
    let pointsUsed = 0;
    let finalPrice = selectedService.price;
    if (usePoints && currentUser) {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data();
        const maxDiscount = selectedService.price * 0.3;
        const possiblePoints = Math.min(userData.points || 0, maxDiscount);
        pointsUsed = Math.floor(possiblePoints);
        finalPrice = selectedService.price - pointsUsed;
        await db.collection('users').doc(currentUser.uid).update({ points: firebase.firestore.FieldValue.increment(-pointsUsed) });
    }
    let finalMasterId = selectedMaster.id;
    let finalMasterName = selectedMaster.name;
    let finalSalonId = selectedMaster.salonId;
    let finalSalonName = selectedMaster.salonName;
    if (selectedMaster.id === 'any') {
        const allMasters = await getCached('masters');
        let candidates = allMasters.filter(m => m.providedServices?.includes(selectedService.id));
        if (prefillData.salonId) {
            candidates = candidates.filter(m => m.salonId === prefillData.salonId);
        }
        if (candidates.length > 0) { finalMasterId = candidates[0].id; finalMasterName = candidates[0].name; finalSalonId = candidates[0].salonId; finalSalonName = candidates[0].salonName; }
        else { showNotification('Нет доступных мастеров', true); return; }
    }
    try {
        const exists = await db.collection('bookings').where('masterId','==',finalMasterId).where('date','==',selectedDate).where('time','==',selectedTime).where('status','!=','Отменена').get();
        if (!exists.empty) { showNotification('Время только что занято', true); return; }
        await db.collection('bookings').add({ userId: currentUser?.uid||'guest', salonId: finalSalonId, salonName: finalSalonName, serviceId: selectedService.id, serviceName: selectedService.name, masterId: finalMasterId, masterName: finalMasterName, date: selectedDate, time: selectedTime, totalPrice: finalPrice, originalPrice: selectedService.price, pointsUsed: pointsUsed, status: 'Новая', clientName: name, clientPhone: phone, clientComment: comment, bookingDate: firebase.firestore.FieldValue.serverTimestamp() });
        showNotification('✅ Запись создана!');
        showPage('profile');
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
}

function attachBookingEvents() {
    const n1 = document.getElementById('next1');
    const n2 = document.getElementById('next2');
    const n3 = document.getElementById('next3');
    const p2 = document.getElementById('prev2');
    const p3 = document.getElementById('prev3');
    const p4 = document.getElementById('prev4');
    const confirm = document.getElementById('confirmBtn');
    if (n1) { n1.disabled = true; n1.onclick = async () => { await loadBookingMasters(); goToStep(2); }; }
    if (p2) p2.onclick = () => goToStep(1);
    if (n2) { n2.disabled = true; n2.onclick = () => { goToStep(3); const dateInput = document.getElementById('bookingDate'); if (dateInput) { selectedDate = dateInput.value; loadTimeSlots(selectedDate); } }; }
    if (p3) p3.onclick = () => goToStep(2);
    if (n3) { n3.disabled = true; n3.onclick = () => { if (selectedTime) { goToStep(4); updateSummary(); checkPointsAvailability(); } }; }
    if (p4) p4.onclick = () => goToStep(3);
    if (confirm) confirm.onclick = confirmBooking;
    const dateInput = document.getElementById('bookingDate');
    if (dateInput) { dateInput.min = new Date().toISOString().split('T')[0]; dateInput.value = dateInput.min; selectedDate = dateInput.min; dateInput.onchange = () => { selectedDate = dateInput.value; loadTimeSlots(selectedDate); }; }
    const usePointsCheckbox = document.getElementById('usePoints');
    if (usePointsCheckbox) {
        usePointsCheckbox.addEventListener('change', () => {
            updateSummary();
        });
    }
}

function goToStep(step) {
    const steps = document.querySelectorAll('.booking-step');
    const stepIndicators = document.querySelectorAll('.step');
    if (!steps.length) return;
    steps.forEach((s, i) => s.classList.toggle('active', i+1 === step));
    stepIndicators.forEach((s, i) => s.classList.toggle('active', i+1 <= step));
}

// ==============================================
// PROFILE & POINTS
// ==============================================
async function renderProfile() {
    if (!currentUser) return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (!userDoc.exists) { showNotification('Профиль не найден. Пересоздайте аккаунт.', true); return showPage('home'); }
    const userData = userDoc.data() || {};
    const points = userData.points || 0;
    await processPointsAwarding();
    container.innerHTML = `
    <h1 class="section-title">Мой профиль</h1>
    <div class="user-info-card"><div class="user-details"><h3>Личные данные</h3><div class="user-detail-row"><strong>Имя:</strong> ${escapeHtml(userData.name || 'Не указано')}</div><div class="user-detail-row"><strong>Фамилия:</strong> ${escapeHtml(userData.lastname || 'Не указана')}</div><div class="user-detail-row"><strong>Email:</strong> ${escapeHtml(userData.email)}</div><div class="user-detail-row"><strong>Телефон:</strong> ${escapeHtml(userData.phone || 'Не указан')}</div></div><button class="edit-profile-btn" onclick="openEditProfileModal()"><i class="fas fa-edit"></i> Редактировать</button></div>
    <div class="points-card"><div class="points-value">${points}</div><div class="points-label">Бонусных баллов</div><p style="font-size:0.9rem;margin-top:10px;">1 балл = 1 рубль. Можно оплатить до 30% стоимости.</p></div>
    <h2 class="section-title">Мои записи</h2><div id="profileBookings" class="services-grid"></div>
    `;
    const bookings = (await getCached('bookings')).filter(b => b.userId === currentUser.uid);
    const list = document.getElementById('profileBookings');
    if (!list) return;
    list.innerHTML = bookings.length ? bookings.map(b => { let badgeClass = 'badge-new'; if (b.status === 'Выполнена') badgeClass = 'badge-done'; if (b.status === 'Отменена') badgeClass = 'badge-cancelled'; return `<div class="card"><div class="card-content"><h3>${escapeHtml(b.salonName||'Салон')}</h3><p>${escapeHtml(b.serviceName||'Услуга')} • ${escapeHtml(b.masterName||'Мастер')}</p><p>${b.date||''} в ${b.time||''}</p><p>Статус: <span class="badge ${badgeClass}">${b.status||'Неизвестно'}</span></p>${b.pointsUsed ? `<p>Списано баллов: ${b.pointsUsed}</p>` : ''}${b.clientComment?`<p>Комент: ${escapeHtml(b.clientComment)}</p>`:''}${b.status==='Новая'?`<button class="btn btn-outline btn-sm" onclick="cancelBooking('${b.id}')">Отменить</button>`:''}</div></div>`; }).join('') : '<p style="text-align:center;padding:40px;">Нет записей</p>';
}

async function processPointsAwarding() {
    if (!currentUser) return;
    const bookingsSnap = await db.collection('bookings').where('userId', '==', currentUser.uid).where('status', '==', 'Выполнена').get();
    const batch = db.batch();
    let totalPointsToAdd = 0;
    bookingsSnap.forEach(doc => { const data = doc.data(); if (!data.pointsAwarded) { const points = Math.floor(data.totalPrice * 0.05); batch.update(doc.ref, { pointsAwarded: true }); totalPointsToAdd += points; } });
    if (totalPointsToAdd > 0) { batch.update(db.collection('users').doc(currentUser.uid), { points: firebase.firestore.FieldValue.increment(totalPointsToAdd) }); await batch.commit(); showNotification(`✅ Начислено ${totalPointsToAdd} баллов!`); clearCache(); }
}

window.openEditProfileModal = async function() {
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    const data = userDoc.data();
    document.getElementById('edit-name').value = data.name || '';
    document.getElementById('edit-lastname').value = data.lastname || '';
    document.getElementById('edit-phone').value = data.phone || '';
    document.getElementById('edit-specialization-group').style.display = 'none';
    openModal('edit-profile-modal');
};

document.getElementById('edit-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('edit-name').value, lastname = document.getElementById('edit-lastname').value, phone = document.getElementById('edit-phone').value;
    try { await db.collection('users').doc(currentUser.uid).update({ name, lastname, phone }); closeModal('edit-profile-modal'); showNotification('Профиль обновлен!'); renderProfile(); } catch(err) { showNotification('Ошибка сохранения: ' + err.message, true); }
});

async function cancelBooking(id) { try { await db.collection('bookings').doc(id).update({ status: 'Отменена' }); renderProfile(); } catch(e) { showNotification('Ошибка отмены', true); } }

// ==============================================
// MASTER CABINET
// ==============================================
async function renderMasterCabinet() {
    if (!currentUser || (currentUser.role !== 'master' && currentUser.role !== 'admin')) return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;

    const masterDoc = (await db.collection('masters').where('userId', '==', currentUser.uid).get()).docs[0];
    if (!masterDoc) {
        container.innerHTML = '<p>Ваш профиль мастера не найден. Обратитесь к администратору.</p>';
        return;
    }
    const master = { id: masterDoc.id, ...masterDoc.data() };
    const salonDoc = await db.collection('salons').doc(master.salonId).get();
    const salon = salonDoc.exists ? salonDoc.data() : { name: 'Не указан' };

    container.innerHTML = `
    <h1 class="section-title">Мастер-панель</h1>
    <div style="display: flex; gap: 30px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 280px; background: white; border-radius: 20px; padding: 25px; box-shadow: var(--shadow);">
            <h3 style="margin-bottom: 20px;">Личный кабинет мастера: ${escapeHtml(master.name)}</h3>
            <div class="user-detail-row"><strong>Имя:</strong> ${escapeHtml(currentUser.name || '—')}</div>
            <div class="user-detail-row"><strong>Фамилия:</strong> ${escapeHtml(currentUser.lastname || '—')}</div>
            <div class="user-detail-row"><strong>Email:</strong> ${escapeHtml(currentUser.email)}</div>
            <div class="user-detail-row"><strong>Телефон:</strong> ${escapeHtml(currentUser.phone || '—')}</div>
            <div class="user-detail-row"><strong>Салон:</strong> ${escapeHtml(salon.name)}</div>
            <div class="user-detail-row"><strong>Специализация:</strong> ${escapeHtml(master.specialization || '—')}</div>
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button class="btn btn-outline btn-sm" id="editMasterProfileBtn"><i class="fas fa-edit"></i> Редактировать профиль</button>
                <button class="btn btn-outline btn-sm" style="color:red; border-color:red;" id="deleteMasterProfileBtn"><i class="fas fa-trash"></i> Удалить профиль</button>
            </div>
        </div>
        <div style="flex: 3; min-width: 600px;">
            <div class="auth-tabs" style="margin-bottom:20px;">
                <button class="auth-tab active" data-tab="bookings">Управление записями</button>
                <button class="auth-tab" data-tab="actions">Мои действия</button>
            </div>
            <div id="masterBookingsTab">
                <h3>Мои записи</h3>
                <div style="max-height: 500px; overflow-y: auto;">
                    <table class="history-table" id="masterBookingsTable">
                        <thead><tr><th>Клиент</th><th>Услуга</th><th>Дата</th><th>Время</th><th>Телефон</th><th>Статус</th><th>Действия</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
            <div id="masterActionsTab" style="display:none;">
                <h3>История действий</h3>
                <div id="masterActionsList">Загрузка...</div>
            </div>
        </div>
    </div>
    `;

    const bookings = (await getCached('bookings')).filter(b => b.masterId === master.id).sort((a,b) => new Date(b.date) - new Date(a.date));
    const tbody = document.querySelector('#masterBookingsTable tbody');
    tbody.innerHTML = bookings.length ? bookings.map(b => `
        <tr>
            <td>${escapeHtml(b.clientName)}</td>
            <td>${escapeHtml(b.serviceName)}</td>
            <td>${b.date}</td>
            <td>${b.time}</td>
            <td>${escapeHtml(b.clientPhone)}</td>
            <td><span class="badge badge-${b.status === 'Выполнена' ? 'done' : b.status === 'Отменена' ? 'cancelled' : 'new'}">${b.status}</span></td>
            <td>
                <select onchange="updateBookingStatusMaster('${b.id}', this.value)" style="padding:4px; border-radius:8px;">
                    <option value="Новая" ${b.status === 'Новая' ? 'selected' : ''}>Новая</option>
                    <option value="Подтверждена" ${b.status === 'Подтверждена' ? 'selected' : ''}>Подтверждена</option>
                    <option value="Выполнена" ${b.status === 'Выполнена' ? 'selected' : ''}>Выполнена</option>
                    <option value="Отменена" ${b.status === 'Отменена' ? 'selected' : ''}>Отменена</option>
                </select>
            </td>
        </tr>
    `).join('') : '<tr><td colspan="7">Нет записей</td></tr>';

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById('masterBookingsTab').style.display = tabName === 'bookings' ? 'block' : 'none';
            document.getElementById('masterActionsTab').style.display = tabName === 'actions' ? 'block' : 'none';
            if (tabName === 'actions') loadMasterActions();
        };
    });

    document.getElementById('editMasterProfileBtn').onclick = () => openEditMasterProfile(master);
    document.getElementById('deleteMasterProfileBtn').onclick = async () => {
        if (confirm('Удалить ваш профиль мастера и учётную запись? Это действие необратимо.')) {
            await db.collection('masters').doc(master.id).delete();
            await db.collection('users').doc(currentUser.uid).delete();
            await auth.currentUser.delete();
            showNotification('Профиль удалён');
            auth.signOut();
        }
    };
}

window.updateBookingStatusMaster = async (bookingId, newStatus) => {
    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const old = (await bookingRef.get()).data();
        await bookingRef.update({ status: newStatus });
        await logAdminAction('update', 'bookings', bookingId, old, { ...old, status: newStatus });
        showNotification(`Статус изменён на ${newStatus}`);
        clearCache();
        renderMasterCabinet();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

async function loadMasterActions() {
    const container = document.getElementById('masterActionsList');
    if (!container) return;
    const actions = await db.collection('admin_actions')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();
    const list = actions.docs.filter(d => d.data().adminId === currentUser.uid).map(d => {
        const a = d.data();
        return `<div style="padding:10px; border-bottom:1px solid #eee;">${formatDate(a.timestamp)} – ${a.actionType} ${a.collection} ${a.docId?.slice(0,8)}...</div>`;
    }).join('');
    container.innerHTML = list || 'Нет действий';
}

window.openEditMasterProfile = async function(master) {
    const modal = document.getElementById('edit-profile-modal');
    document.getElementById('edit-name').value = currentUser.name || '';
    document.getElementById('edit-lastname').value = currentUser.lastname || '';
    document.getElementById('edit-phone').value = currentUser.phone || '';
    document.getElementById('edit-specialization-group').style.display = 'block';
    document.getElementById('edit-specialization').value = master.specialization || '';
    openModal('edit-profile-modal');
    const form = document.getElementById('edit-profile-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const name = document.getElementById('edit-name').value;
        const lastname = document.getElementById('edit-lastname').value;
        const phone = document.getElementById('edit-phone').value;
        const spec = document.getElementById('edit-specialization').value;
        await db.collection('users').doc(currentUser.uid).update({ name, lastname, phone });
        await db.collection('masters').doc(master.id).update({ specialization: spec });
        currentUser.name = name;
        currentUser.lastname = lastname;
        currentUser.phone = phone;
        closeModal('edit-profile-modal');
        showNotification('Профиль обновлён');
        renderMasterCabinet();
    };
};

// ==============================================
// MASTER SCHEDULE (Календарь)
// ==============================================
async function renderMasterSchedule() {
    if (!currentUser || currentUser.role !== 'master') return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;

    const masterDoc = (await db.collection('masters').where('userId', '==', currentUser.uid).get()).docs[0];
    if (!masterDoc) {
        container.innerHTML = '<p>Профиль мастера не найден.</p>';
        return;
    }
    const master = { id: masterDoc.id, ...masterDoc.data() };

    const today = new Date();
    let currentMonth = today.getMonth();
    let currentYear = today.getFullYear();

    function renderCalendar() {
        const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const adjustedFirstDay = firstDay === 0 ? 7 : firstDay;

        let calendarHTML = `<h2>${monthNames[currentMonth]} ${currentYear}</h2>`;
        calendarHTML += '<table class="calendar-table"><thead><tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr></thead><tbody><tr>';

        for (let i = 1; i < adjustedFirstDay; i++) {
            calendarHTML += '<td></td>';
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = `${currentYear}-${String(currentMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isToday = (day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear());
            const isDayOff = (master.daysOff || []).includes(date);
            const hasBookings = (cache.bookings || []).some(b => b.masterId === master.id && b.date === date && b.status !== 'Отменена');
            let classes = '';
            if (isToday) classes += ' today';
            if (isDayOff) classes += ' day-off';
            else if (hasBookings) classes += ' has-bookings';

            calendarHTML += `<td class="${classes}" data-date="${date}">${day}</td>`;

            if ((day + adjustedFirstDay - 1) % 7 === 0) {
                calendarHTML += '</tr><tr>';
            }
        }
        calendarHTML += '</tr></tbody></table>';
        return calendarHTML;
    }

    async function loadBookingsForDate(date) {
        const bookings = (await getCached('bookings')).filter(b => b.masterId === master.id && b.date === date && b.status !== 'Отменена');
        const listDiv = document.getElementById('bookings-on-date');
        if (bookings.length === 0) {
            listDiv.innerHTML = '<p>На эту дату нет записей</p>';
        } else {
            listDiv.innerHTML = bookings.map(b => `
                <div style="border:1px solid #ddd; padding:10px; margin:8px 0; border-radius:8px;">
                    <strong>${b.time}</strong> — ${escapeHtml(b.serviceName)}<br>
                    Клиент: ${escapeHtml(b.clientName)} | Тел.: ${escapeHtml(b.clientPhone)}
                    <span class="badge badge-${b.status === 'Выполнена' ? 'done' : b.status === 'Отменена' ? 'cancelled' : 'new'}">${b.status}</span>
                </div>
            `).join('');
        }
    }

    container.innerHTML = `
        <h1 class="section-title">Моё рабочее время</h1>
        <div style="display: flex; gap: 30px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 300px;">
                <div class="calendar-controls">
                    <button class="btn btn-outline btn-sm" id="prevMonth"><i class="fas fa-chevron-left"></i></button>
                    <span id="currentMonthLabel"></span>
                    <button class="btn btn-outline btn-sm" id="nextMonth"><i class="fas fa-chevron-right"></i></button>
                </div>
                <div id="calendarContainer"></div>
            </div>
            <div style="flex: 1; min-width: 300px;">
                <h3>Записи на <span id="selectedDateLabel">—</span></h3>
                <div id="bookings-on-date"></div>
                <div style="margin-top: 20px;">
                    <h3>Добавить выходной</h3>
                    <input type="date" id="new-dayoff" class="form-input" style="width:auto;">
                    <button class="btn btn-primary btn-sm" id="addDayOffBtn">Добавить</button>
                </div>
            </div>
        </div>
    `;

    const updateCalendar = () => {
        document.getElementById('calendarContainer').innerHTML = renderCalendar();
        document.getElementById('currentMonthLabel').textContent = `${new Date(currentYear, currentMonth).toLocaleString('ru', { month: 'long' })} ${currentYear}`;
        document.querySelectorAll('.calendar-table td[data-date]').forEach(td => {
            td.addEventListener('click', async () => {
                const date = td.dataset.date;
                document.getElementById('selectedDateLabel').textContent = date;
                await loadBookingsForDate(date);
            });
        });
    };

    updateCalendar();

    document.getElementById('prevMonth').onclick = () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        updateCalendar();
    };
    document.getElementById('nextMonth').onclick = () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        updateCalendar();
    };

    document.getElementById('addDayOffBtn').onclick = async () => {
        const date = document.getElementById('new-dayoff').value;
        if (!date) return;
        if ((master.daysOff || []).includes(date)) {
            showNotification('Эта дата уже выходная');
            return;
        }
        const newDaysOff = [...(master.daysOff || []), date];
        await db.collection('masters').doc(master.id).update({ daysOff: newDaysOff });
        master.daysOff = newDaysOff;
        updateCalendar();
        showNotification('Выходной добавлен');
    };
}

// ==============================================
// ADMIN PANEL (полный рендер, вкладки, обработчики)
// ==============================================
async function renderAdmin() {
    if (!currentUser || currentUser.role !== 'admin') return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `
    <h1 class="section-title">Админ-панель</h1>
    <div style="margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" id="addServBtn"><i class="fas fa-plus"></i> Услуга</button>
        <button class="btn btn-secondary" id="addSalonBtn"><i class="fas fa-plus"></i> Салон</button>
        <button class="btn btn-secondary" id="addMasterBtn"><i class="fas fa-plus"></i> Мастер</button>
        <button class="btn btn-outline" id="editSettingsBtn"><i class="fas fa-cog"></i> Настройки сайта</button>
    </div>
    <div class="auth-tabs" style="margin-top:20px">
        <button class="auth-tab active" data-admin-tab="data">Данные</button>
        <button class="auth-tab" data-admin-tab="users">Пользователи</button>
        <button class="auth-tab" data-admin-tab="bookings">Записи</button>
        <button class="auth-tab" data-admin-tab="reviews">Отзывы</button>
        <button class="auth-tab" data-admin-tab="history">История действий</button>
    </div>
    <div id="admin-data-view">
        <h2 class="section-title">Услуги</h2><div id="adminServices" class="services-grid" style="max-height:400px; overflow-y:auto;"></div>
        <h2 class="section-title">Салоны</h2><div id="adminSalons" class="salons-grid" style="max-height:400px; overflow-y:auto;"></div>
        <h2 class="section-title">Мастера</h2><div id="adminMasters" class="masters-grid" style="max-height:400px; overflow-y:auto;"></div>
    </div>
    <div id="admin-users-view" style="display:none">
        <h2 class="section-title">Управление пользователями</h2>
        <div style="margin-bottom:15px; display:flex; gap:10px;">
            <button class="btn btn-primary" id="add-user-admin-btn"><i class="fas fa-user-plus"></i> Добавить пользователя</button>
            <select id="roleFilter" class="form-input" style="width:auto;">
                <option value="all">Все роли</option>
                <option value="client">Клиенты</option>
                <option value="master">Мастера</option>
                <option value="admin">Администраторы</option>
            </select>
            <button id="applyRoleFilter" class="btn btn-secondary">Применить</button>
        </div>
        <div style="max-height:500px; overflow-y:auto;">
            <table class="history-table"><thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Телефон</th><th>Дата регистрации</th><th>Действия</th></tr></thead><tbody id="usersTableBody"></tbody></table>
        </div>
    </div>
    <div id="admin-bookings-view" style="display:none">
        <h2 class="section-title">Все записи</h2>
        <div style="display:flex; gap:15px; margin-bottom:20px; flex-wrap:wrap;">
            <input type="text" id="bookingSearch" placeholder="Поиск по клиенту, услуге, мастеру..." class="form-input" style="max-width:300px;">
            <select id="statusFilter" class="form-input" style="max-width:200px;">
                <option value="all">Все статусы</option>
                <option value="Новая">Новая</option>
                <option value="Подтверждена">Подтверждена</option>
                <option value="Выполнена">Выполнена</option>
                <option value="Отменена">Отменена</option>
            </select>
            <input type="date" id="dateFilter" class="form-input" style="max-width:180px;">
            <button id="applyBookingFilters" class="btn btn-primary">Применить фильтры</button>
            <button id="resetBookingFilters" class="btn btn-secondary">Сбросить</button>
        </div>
        <div style="max-height:500px; overflow-y:auto;">
            <table class="history-table">
                <thead><tr><th>Дата/время</th><th>Клиент</th><th>Услуга</th><th>Мастер</th><th>Салон</th><th>Сумма</th><th>Статус</th><th>Действия</th><th>История</th></tr></thead>
                <tbody id="bookingsTableBody"></tbody>
            </table>
        </div>
    </div>
    <div id="admin-reviews-view" style="display:none">
        <h2 class="section-title">Управление отзывами</h2>
        <div style="display:flex; gap:15px; margin-bottom:20px; flex-wrap:wrap;">
            <input type="text" id="reviewSearch" placeholder="Поиск по салону, автору, тексту..." class="form-input" style="max-width:300px;">
            <select id="reviewRatingFilter" class="form-input" style="max-width:150px;">
                <option value="all">Все рейтинги</option>
                <option value="5">5 звёзд</option>
                <option value="4">4+ звёзд</option>
                <option value="3">3+ звёзд</option>
                <option value="2">2+ звёзд</option>
                <option value="1">1+ звёзд</option>
            </select>
            <button id="applyReviewFilters" class="btn btn-primary">Применить</button>
            <button id="resetReviewFilters" class="btn btn-secondary">Сбросить</button>
        </div>
        <div style="max-height:500px; overflow-y:auto;">
            <table class="history-table">
                <thead><tr><th>Салон</th><th>Автор</th><th>Рейтинг</th><th>Текст отзыва</th><th>Дата</th><th>Действия</th></tr></thead>
                <tbody id="reviewsTableBody"></tbody>
            </table>
        </div>
    </div>
    <div id="admin-history-view" style="display:none">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h2 class="section-title" style="margin:0">История изменений</h2>
            <button class="btn btn-outline" id="clearHistoryBtn" style="color:red; border-color:red;">Очистить историю</button>
        </div>
        <div style="max-height:500px; overflow-y:auto;">
            <table class="history-table"><thead><tr><th>Действие</th><th>Объект</th><th>Время</th><th>Откат</th></tr></thead><tbody id="historyTableBody"></tbody></table>
        </div>
    </div>
    `;
    document.querySelectorAll('[data-admin-tab]').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('[data-admin-tab]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('admin-data-view').style.display = tab.dataset.adminTab === 'data' ? 'block' : 'none';
            document.getElementById('admin-users-view').style.display = tab.dataset.adminTab === 'users' ? 'block' : 'none';
            document.getElementById('admin-bookings-view').style.display = tab.dataset.adminTab === 'bookings' ? 'block' : 'none';
            document.getElementById('admin-reviews-view').style.display = tab.dataset.adminTab === 'reviews' ? 'block' : 'none';
            document.getElementById('admin-history-view').style.display = tab.dataset.adminTab === 'history' ? 'block' : 'none';
            if (tab.dataset.adminTab === 'history') loadAdminHistory();
            if (tab.dataset.adminTab === 'users') loadUsersTable();
            if (tab.dataset.adminTab === 'bookings') loadAllBookingsTable();
            if (tab.dataset.adminTab === 'reviews') loadAllReviewsTable();
        };
    });
    document.getElementById('add-user-admin-btn').onclick = () => openEditUser(null);
    const applyRoleFilter = document.getElementById('applyRoleFilter');
    if (applyRoleFilter) applyRoleFilter.onclick = () => loadUsersTable();
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) clearBtn.onclick = async () => { if (confirm('Удалить всю историю действий?')) { const snap = await db.collection('admin_actions').get(); const batch = db.batch(); snap.forEach(doc => batch.delete(doc.ref)); await batch.commit(); showNotification('История очищена'); loadAdminHistory(); } };
    const editSettingsBtn = document.getElementById('editSettingsBtn');
    if (editSettingsBtn) {
        editSettingsBtn.onclick = async () => {
            const snap = await db.collection('settings').doc('main_page').get();
            const data = snap.exists ? snap.data() : {};
            document.getElementById('set-hero-title').value = data.heroTitle || '';
            document.getElementById('set-hero-subtitle').value = data.heroSubtitle || '';
            document.getElementById('set-hero-image').value = data.heroImage || '';
            openModal('site-settings-modal');
        };
    }
    const settingsForm = document.getElementById('site-settings-form');
    if (settingsForm) settingsForm.onsubmit = async (e) => { e.preventDefault(); await db.collection('settings').doc('main_page').set({ heroTitle: document.getElementById('set-hero-title').value, heroSubtitle: document.getElementById('set-hero-subtitle').value, heroImage: document.getElementById('set-hero-image').value }); closeModal('site-settings-modal'); showNotification('Настройки сохранены'); if (currentPage === 'home') renderHome(); };
    try {
        const [services, salons, masters] = await Promise.all([getCached('services'), getCached('salons'), getCached('masters')]);
        const salonMap = Object.fromEntries(salons.map(s => [s.id, s.name]));
        const svcDiv = document.getElementById('adminServices');
        if (svcDiv) {
            if (services.length === 0) svcDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет услуг. Добавьте первую.</p>';
            else {
                svcDiv.innerHTML = services.map(s => `<div class="card"><div class="card-content"><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(salonMap[s.salonId]||'Не указан')} • ${s.price} ₽</p><div style="display:flex; gap:5px; margin-top:10px;"><button class="btn btn-outline btn-sm edit-serv" data-id="${s.id}">Ред.</button><button class="btn btn-outline btn-sm del-serv" data-id="${s.id}" style="color:red;border-color:red">Удалить</button></div></div></div>`).join('');
                svcDiv.querySelectorAll('.edit-serv').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openServiceModal(btn.dataset.id); });
                svcDiv.querySelectorAll('.del-serv').forEach(btn => btn.onclick = async () => {
                    if (confirm('Удалить услугу?')) { const serviceId = btn.dataset.id; const old = services.find(x => x.id === serviceId); await db.collection('services').doc(serviceId).delete(); const mastersWithService = await db.collection('masters').where('providedServices', 'array-contains', serviceId).get(); const batch = db.batch(); mastersWithService.forEach(doc => batch.update(doc.ref, { providedServices: firebase.firestore.FieldValue.arrayRemove(serviceId) })); await batch.commit(); await logAdminAction('delete', 'services', serviceId, old, null); clearCache(); renderAdmin(); }
                });
            }
        }
        const salDiv = document.getElementById('adminSalons');
        if (salDiv) {
            if (salons.length === 0) salDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет салонов. Добавьте первый.</p>';
            else {
                salDiv.innerHTML = salons.map(s => `<div class="card"><div class="card-content"><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.address||'')}</p><div style="display:flex; gap:5px; margin-top:10px;"><button class="btn btn-outline btn-sm edit-sal" data-id="${s.id}">Ред.</button><button class="btn btn-outline btn-sm del-sal" data-id="${s.id}" style="color:red;border-color:red">Удалить</button></div></div></div>`).join('');
                salDiv.querySelectorAll('.edit-sal').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openSalonModal(btn.dataset.id); });
                salDiv.querySelectorAll('.del-sal').forEach(btn => btn.onclick = async () => {
                    if (confirm('Удалить салон и всё связанное?')) { const salonId = btn.dataset.id; const old = salons.find(x => x.id === salonId); const batch = db.batch(); const servicesSnap = await db.collection('services').where('salonId', '==', salonId).get(); servicesSnap.forEach(doc => batch.delete(doc.ref)); const mastersSnap = await db.collection('masters').where('salonId', '==', salonId).get(); mastersSnap.forEach(doc => batch.delete(doc.ref)); const bookingsSnap = await db.collection('bookings').where('salonId', '==', salonId).get(); bookingsSnap.forEach(doc => batch.delete(doc.ref)); const reviewsSnap = await db.collection('reviews').where('salonId', '==', salonId).get(); reviewsSnap.forEach(doc => batch.delete(doc.ref)); batch.delete(db.collection('salons').doc(salonId)); await batch.commit(); await logAdminAction('delete', 'salons', salonId, old, null); clearCache(); renderAdmin(); }
                });
            }
        }
        const mstDiv = document.getElementById('adminMasters');
        if (mstDiv) {
            if (masters.length === 0) mstDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет мастеров. Добавьте первого.</p>';
            else {
                mstDiv.innerHTML = masters.map(m => `<div class="card"><div class="card-content"><h3>${escapeHtml(m.name)}</h3><p>${escapeHtml(m.specialization||'')} • ${escapeHtml(salonMap[m.salonId]||'')}</p><div style="display:flex; gap:5px; margin-top:10px;"><button class="btn btn-outline btn-sm edit-mast" data-id="${m.id}">Ред.</button><button class="btn btn-outline btn-sm del-mast" data-id="${m.id}" style="color:red;border-color:red">Удалить</button></div></div></div>`).join('');
                mstDiv.querySelectorAll('.edit-mast').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openMasterModal(btn.dataset.id); });
                mstDiv.querySelectorAll('.del-mast').forEach(btn => btn.onclick = async () => { if (confirm('Удалить мастера?')) { const old = masters.find(x => x.id === btn.dataset.id); await db.collection('masters').doc(btn.dataset.id).delete(); await logAdminAction('delete', 'masters', btn.dataset.id, old, null); clearCache(); renderAdmin(); } });
            }
        }
        document.getElementById('addServBtn').onclick = () => openServiceModal();
        document.getElementById('addSalonBtn').onclick = () => openSalonModal();
        document.getElementById('addMasterBtn').onclick = () => openMasterModal();
    } catch(e) { console.error(e); }
}

async function loadAllBookingsTable() {
    const tbody = document.getElementById('bookingsTableBody');
    if (!tbody) return;
    const search = document.getElementById('bookingSearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const dateFilter = document.getElementById('dateFilter')?.value || '';
    let bookings = await getCached('bookings', true);
    bookings = bookings.sort((a,b) => new Date(b.bookingDate?.seconds*1000) - new Date(a.bookingDate?.seconds*1000));
    if (search) bookings = bookings.filter(b => (b.clientName && b.clientName.toLowerCase().includes(search)) || (b.serviceName && b.serviceName.toLowerCase().includes(search)) || (b.masterName && b.masterName.toLowerCase().includes(search)));
    if (statusFilter !== 'all') bookings = bookings.filter(b => b.status === statusFilter);
    if (dateFilter) bookings = bookings.filter(b => b.date === dateFilter);
    if (bookings.length === 0) { tbody.innerHTML = '<tr><td colspan="9">Нет записей</td></tr>'; return; }
    const masters = await getCached('masters');
    const masterMap = Object.fromEntries(masters.map(m => [m.id, m.name]));
    tbody.innerHTML = bookings.map(b => {
        const masterName = b.masterName || masterMap[b.masterId] || 'Неизвестный мастер';
        return `
        <tr>
            <td>${b.date || ''} ${b.time || ''}</td>
            <td>${escapeHtml(b.clientName || '—')}</td>
            <td>${escapeHtml(b.serviceName || '—')}</td>
            <td>${escapeHtml(masterName)}</td>
            <td>${escapeHtml(b.salonName || '—')}</td>
            <td>${b.totalPrice || 0} ₽</td>
            <td>
                <select onchange="updateBookingStatusAdmin('${b.id}', this.value)" style="padding:4px; border-radius:8px;">
                    <option value="Новая" ${b.status === 'Новая' ? 'selected' : ''}>Новая</option>
                    <option value="Подтверждена" ${b.status === 'Подтверждена' ? 'selected' : ''}>Подтверждена</option>
                    <option value="Выполнена" ${b.status === 'Выполнена' ? 'selected' : ''}>Выполнена</option>
                    <option value="Отменена" ${b.status === 'Отменена' ? 'selected' : ''}>Отменена</option>
                </select>
            </td>
            <td><button class="btn btn-sm btn-outline" onclick="showBookingHistory('${b.id}')">История</button></td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteBookingAdmin('${b.id}')" style="background:#ef4444; color:white;">Удалить</button></td>
        </tr>
        `;
    }).join('');
}
window.updateBookingStatusAdmin = async (bookingId, newStatus) => { try { const bookingRef = db.collection('bookings').doc(bookingId); const old = (await bookingRef.get()).data(); await bookingRef.update({ status: newStatus }); await logAdminAction('update', 'bookings', bookingId, old, { ...old, status: newStatus }); showNotification(`Статус изменён на ${newStatus}`); clearCache(); loadAllBookingsTable(); } catch(e) { showNotification('Ошибка: '+e.message, true); } };
window.deleteBookingAdmin = async (bookingId) => { if (!confirm('Удалить эту запись?')) return; try { const old = (await db.collection('bookings').doc(bookingId).get()).data(); await db.collection('bookings').doc(bookingId).delete(); await logAdminAction('delete', 'bookings', bookingId, old, null); showNotification('Запись удалена'); clearCache(); loadAllBookingsTable(); } catch(e) { showNotification('Ошибка: '+e.message, true); } };
window.showBookingHistory = async (bookingId) => { const actions = await db.collection('admin_actions').where('docId', '==', bookingId).where('collection', '==', 'bookings').orderBy('timestamp', 'desc').get(); if (!actions.empty) { let msg = `История изменений записи ${bookingId}:\n`; actions.forEach(doc => { const a = doc.data(); msg += `${formatDate(a.timestamp)} — ${a.actionType}: ${a.oldData ? 'было: '+JSON.stringify(a.oldData) : ''} ${a.newData ? 'стало: '+JSON.stringify(a.newData) : ''}\n`; }); alert(msg); } else { alert('История изменений не найдена.'); } };

async function loadAllReviewsTable() {
    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;
    const search = document.getElementById('reviewSearch')?.value.toLowerCase() || '';
    const ratingFilter = document.getElementById('reviewRatingFilter')?.value || 'all';
    let reviews = await getCached('reviews', true);
    reviews = reviews.sort((a,b) => new Date(b.createdAt?.seconds*1000) - new Date(a.createdAt?.seconds*1000));
    if (search) reviews = reviews.filter(r => (r.salonName && r.salonName.toLowerCase().includes(search)) || (r.authorName && r.authorName.toLowerCase().includes(search)) || (r.text && r.text.toLowerCase().includes(search)));
    if (ratingFilter !== 'all') { const minRating = parseInt(ratingFilter); reviews = reviews.filter(r => r.rating >= minRating); }
    if (reviews.length === 0) { tbody.innerHTML = '<tr><td colspan="6">Нет отзывов</td></tr>'; return; }
    tbody.innerHTML = reviews.map(r => `
        <tr>
            <td>${escapeHtml(r.salonName || '—')}</td>
            <td>${escapeHtml(r.authorName || '—')}</td>
            <td>${'★'.repeat(Math.floor(r.rating))}${'☆'.repeat(5-Math.floor(r.rating))} (${r.rating})</td>
            <td>${escapeHtml(r.text || '')}</td>
            <td>${formatDate(r.createdAt)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteReviewAdmin('${r.id}')" style="background:#ef4444; color:white;">Удалить</button></td>
        </tr>
    `).join('');
}
window.deleteReviewAdmin = async (reviewId) => { if (!confirm('Удалить этот отзыв? Это также обновит рейтинг салона.')) return; try { const reviewDoc = await db.collection('reviews').doc(reviewId).get(); const review = reviewDoc.data(); const salonId = review.salonId; await db.collection('reviews').doc(reviewId).delete(); await logAdminAction('delete', 'reviews', reviewId, review, null); const reviewsSnap = await db.collection('reviews').where('salonId', '==', salonId).get(); let total = 0; reviewsSnap.forEach(doc => total += doc.data().rating); const avg = reviewsSnap.size ? total / reviewsSnap.size : 0; await db.collection('salons').doc(salonId).update({ rating: parseFloat(avg.toFixed(1)), reviewCount: reviewsSnap.size }); showNotification('Отзыв удалён'); clearCache(); loadAllReviewsTable(); } catch(e) { showNotification('Ошибка: '+e.message, true); } };

async function loadUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    let users = await getCached('users', true);
    const roleFilter = document.getElementById('roleFilter')?.value || 'all';
    if (roleFilter !== 'all') users = users.filter(u => u.role === roleFilter);
    if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="6">Пользователи не найдены.</td></tr>'; return; }
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>${escapeHtml(u.name || '')} ${escapeHtml(u.lastname || '')}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${u.role === 'admin' ? 'Администратор' : u.role === 'master' ? 'Мастер' : 'Клиент'}</td>
            <td>${escapeHtml(u.phone || 'Не указан')}</td>
            <td>${formatDate(u.registrationDate)}</td>
            <td>${u.uid !== currentUser.uid ? `<button class="btn btn-outline btn-sm" onclick="openEditUser('${u.uid}')">Изменить</button> <button class="btn btn-outline btn-sm" style="color:red;" onclick="deleteUser('${u.uid}')">Удалить</button>` : '<span style="color:#999">Это вы</span>'}</td>
        </tr>
    `).join('');
}
window.openEditUser = async (uid) => {
    const modal = document.getElementById('edit-user-modal'); if (!modal) { showNotification('Модальное окно не найдено.', true); return; }
    const passwordGroup = document.getElementById('edit-user-password-group');
    const titleEl = modal.querySelector('.modal-title');
    if (!uid) {
        titleEl.textContent = 'Добавить пользователя';
        document.getElementById('edit-user-id').value = '';
        document.getElementById('edit-user-name').value = '';
        document.getElementById('edit-user-lastname').value = '';
        document.getElementById('edit-user-email').value = '';
        document.getElementById('edit-user-phone').value = '';
        document.getElementById('edit-user-role').value = 'client';
        if (passwordGroup) passwordGroup.style.display = 'block';
        document.getElementById('edit-user-password').value = '';
        editingUserId = null;
    } else {
        const users = await getCached('users', true);
        const user = users.find(u => u.id === uid);
        if (!user) { showNotification('Пользователь не найден', true); return; }
        titleEl.textContent = 'Редактировать пользователя';
        document.getElementById('edit-user-id').value = uid;
        document.getElementById('edit-user-name').value = user.name || '';
        document.getElementById('edit-user-lastname').value = user.lastname || '';
        document.getElementById('edit-user-email').value = user.email || '';
        document.getElementById('edit-user-phone').value = user.phone || '';
        document.getElementById('edit-user-role').value = user.role || 'client';
        if (passwordGroup) passwordGroup.style.display = 'none';
        editingUserId = uid;
    }
    openModal('edit-user-modal');
};
async function saveUser() {
    const name = document.getElementById('edit-user-name').value.trim();
    const lastname = document.getElementById('edit-user-lastname').value.trim();
    const email = document.getElementById('edit-user-email').value.trim();
    const phone = document.getElementById('edit-user-phone').value.trim();
    const role = document.getElementById('edit-user-role').value;
    const password = document.getElementById('edit-user-password')?.value;
    if (!name || !email || !role) { showNotification('Заполните имя, email, роль', true); return; }
    if (!editingUserId) {
        if (!password || password.length < 6) { showNotification('Пароль ≥ 6 символов', true); return; }
        try {
            const cred = await auth.createUserWithEmailAndPassword(email, password);
            const uid = cred.user.uid;
            const userData = { name, lastname, email, phone, role, points: 0, registrationDate: firebase.firestore.FieldValue.serverTimestamp() };
            await db.collection('users').doc(uid).set(userData);
            await logAdminAction('create', 'users', uid, null, userData);
            if (role === 'master') {
                const fullName = `${name} ${lastname}`.trim();
                await db.collection('masters').add({ name: fullName, userId: uid, specialization: '', providedServices: [], rating: 0, daysOff: [] });
            }
            showNotification('Пользователь добавлен');
            closeModal('edit-user-modal');
            await clearCache();
            await loadUsersTable();
            if (role === 'master') renderAdmin();
        } catch (err) { showNotification('Ошибка: ' + err.message, true); }
    } else {
        try {
            const old = (await db.collection('users').doc(editingUserId).get()).data();
            const updates = { name, lastname, email, phone, role };
            await db.collection('users').doc(editingUserId).update(updates);
            await logAdminAction('update', 'users', editingUserId, old, updates);
            if (role === 'master') {
                const fullName = `${name} ${lastname}`.trim();
                const masterDoc = (await db.collection('masters').where('userId', '==', editingUserId).get()).docs[0];
                if (masterDoc) await db.collection('masters').doc(masterDoc.id).update({ name: fullName });
                else await db.collection('masters').add({ name: fullName, userId: editingUserId, specialization: '', providedServices: [], rating: 0, daysOff: [] });
            } else {
                const masterDoc = (await db.collection('masters').where('userId', '==', editingUserId).get()).docs[0];
                if (masterDoc && old.role === 'master') await db.collection('masters').doc(masterDoc.id).delete();
            }
            showNotification('Данные обновлены');
            closeModal('edit-user-modal');
            await clearCache();
            await loadUsersTable();
            renderAdmin();
        } catch (err) { showNotification('Ошибка: ' + err.message, true); }
    }
}
window.deleteUser = async (userId) => {
    if (userId === currentUser.uid) { showNotification('Нельзя удалить себя', true); return; }
    if (!confirm('Удалить пользователя? Это также удалит профиль мастера.')) return;
    try {
        const old = (await db.collection('users').doc(userId).get()).data();
        await db.collection('users').doc(userId).delete();
        const mastersSnap = await db.collection('masters').where('userId', '==', userId).get();
        const batch = db.batch();
        mastersSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await logAdminAction('delete', 'users', userId, old, null);
        showNotification('Пользователь удалён');
        await clearCache();
        await loadUsersTable();
        renderAdmin();
    } catch (e) { showNotification('Ошибка: ' + e.message, true); }
};

async function loadAdminHistory() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4">Загрузка...</td></tr>';
    const snap = await db.collection('admin_actions').orderBy('timestamp', 'desc').limit(100).get();
    const actions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (actions.length === 0) { tbody.innerHTML = '<tr><td colspan="4">История пуста</td></tr>'; return; }
    const actionTypeMap = { create: '➕ Добавление', update: '✏️ Изменение', delete: '🗑️ Удаление' };
    const collectionMap = { users: 'Пользователь', masters: 'Мастер', services: 'Услуга', salons: 'Салон', bookings: 'Бронирование', reviews: 'Отзыв' };
    tbody.innerHTML = actions.map(a => {
        const actionText = actionTypeMap[a.actionType] || a.actionType;
        const objectText = collectionMap[a.collection] || a.collection;
        const hasUndo = (a.actionType === 'delete' && a.oldData) || (a.actionType === 'update' && a.oldData) || (a.actionType === 'create');
        return `
        <tr>
            <td>${actionText}</td>
            <td>${objectText} (${a.docId?.slice(0,8)}...)</td>
            <td>${a.timestamp ? formatDate(a.timestamp) : 'Только что'}</td>
            <td>${hasUndo ? `<button class="undo-btn" onclick="undoAction('${a.id}', '${a.collection}', '${a.docId}')">Откатить</button>` : '-'}</td>
        </tr>
        `;
    }).join('');
}
window.undoAction = async function(actionId, collection, docId) {
    if (!confirm('Откатить это действие?')) return;
    try {
        const actionDoc = await db.collection('admin_actions').doc(actionId).get();
        const action = actionDoc.data();
        if (action.actionType === 'delete' && action.oldData) await db.collection(collection).doc(docId).set(action.oldData);
        else if (action.actionType === 'create') await db.collection(collection).doc(docId).delete();
        else if (action.actionType === 'update' && action.oldData) await db.collection(collection).doc(docId).set(action.oldData);
        else { showNotification('Невозможно откатить', true); return; }
        showNotification('Действие отменено!');
        await clearCache();
        loadAdminHistory();
        if (currentPage === 'admin') renderAdmin();
    } catch(e) { showNotification('Ошибка отката: ' + e.message, true); }
};

// ==============================================
// CRUD MODALS HELPERS
// ==============================================
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

function openServiceModal(serviceId = null) {
    const salons = cache.salons;
    const select = document.getElementById('serv-salon');
    if (select) select.innerHTML = salons.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    document.getElementById('service-form').reset();
    document.getElementById('serv-id').value = '';
    document.getElementById('service-modal-title').textContent = 'Добавить услугу';
    if (serviceId) {
        const service = cache.services.find(s => s.id === serviceId);
        if (service) {
            document.getElementById('serv-id').value = serviceId;
            document.getElementById('serv-name').value = service.name || '';
            document.getElementById('serv-cat').value = service.category || 'hair';
            document.getElementById('serv-price').value = service.price || 0;
            document.getElementById('serv-salon').value = service.salonId || '';
            document.getElementById('service-modal-title').textContent = 'Редактировать услугу';
        }
    }
    openModal('service-modal');
    const saveBtn = document.getElementById('save-serv');
    saveBtn.onclick = async () => {
        const id = document.getElementById('serv-id').value;
        const name = document.getElementById('serv-name').value.trim(); const price = +document.getElementById('serv-price').value; const salonId = document.getElementById('serv-salon').value;
        if (!name || !price || !salonId) { showNotification('Заполните все поля', true); return; }
        const salonName = cache.salons.find(s => s.id === salonId)?.name || '';
        const newData = { name, category: document.getElementById('serv-cat').value, price, salonId, salonName, duration: 60, imageUrl: getSafeImageUrl('service', name) };
        try {
            if (id) {
                const old = (await db.collection('services').doc(id).get()).data();
                await db.collection('services').doc(id).update(newData);
                await logAdminAction('update', 'services', id, old, newData);
            } else {
                const ref = await db.collection('services').add(newData);
                await logAdminAction('create', 'services', ref.id, null, newData);
            }
            closeModal('service-modal'); await clearCache(); await renderAdmin();
        } catch (e) { showNotification('Ошибка: ' + e.message, true); }
    };
}
function openSalonModal(salonId = null) {
    document.getElementById('salon-form').reset();
    document.getElementById('sal-id').value = '';
    document.getElementById('salon-modal-title').textContent = 'Добавить салон';
    if (salonId) {
        const salon = cache.salons.find(s => s.id === salonId);
        if (salon) {
            document.getElementById('sal-id').value = salonId;
            document.getElementById('sal-name').value = salon.name || '';
            document.getElementById('sal-address').value = salon.address || '';
            document.getElementById('sal-image').value = salon.imageUrl || '';
            document.getElementById('salon-modal-title').textContent = 'Редактировать салон';
        }
    }
    openModal('salon-modal');
    const saveBtn = document.getElementById('save-sal');
    saveBtn.onclick = async () => {
        const id = document.getElementById('sal-id').value;
        const name = document.getElementById('sal-name').value.trim();
        if (!name) { showNotification('Введите название', true); return; }
        const data = { name, address: document.getElementById('sal-address').value.trim(), imageUrl: document.getElementById('sal-image').value.trim() || getSafeImageUrl('salon'), rating: 0, reviewCount: 0, specializations: [] };
        try {
            if (id) {
                const old = (await db.collection('salons').doc(id).get()).data();
                await db.collection('salons').doc(id).update(data);
                await logAdminAction('update', 'salons', id, old, data);
            } else {
                const ref = await db.collection('salons').add(data);
                await logAdminAction('create', 'salons', ref.id, null, data);
            }
            closeModal('salon-modal'); await clearCache(); await renderAdmin();
        } catch (e) { showNotification('Ошибка: ' + e.message, true); }
    };
}
async function loadMasterServices(salonId, selectedServiceIds = []) {
    const container = document.getElementById('master-services-checkboxes');
    if (!container) return;
    const services = await getCached('services');
    const filtered = services.filter(s => s.salonId === salonId);
    container.innerHTML = '';
    if (filtered.length === 0) { container.innerHTML = '<p>Нет услуг для этого салона</p>'; return; }
    filtered.forEach(service => {
        const label = document.createElement('label'); label.style.display = 'block'; label.style.marginBottom = '5px';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'master-service'; checkbox.value = service.id; checkbox.checked = selectedServiceIds.includes(service.id);
        label.appendChild(checkbox); label.appendChild(document.createTextNode(` ${service.name} (${service.price}₽)`));
        container.appendChild(label);
    });
}
function openMasterModal(masterId = null) {
    const salons = cache.salons;
    const salonSelect = document.getElementById('mast-salon');
    if (salonSelect) { salonSelect.innerHTML = salons.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join(''); salonSelect.value = ''; }
    salonSelect.onchange = () => { loadMasterServices(salonSelect.value); };
    document.getElementById('mast-name').value = ''; document.getElementById('mast-image').value = ''; document.getElementById('mast-id').value = '';
    document.getElementById('master-modal-title').textContent = 'Добавить мастера';
    loadMasterServices('');
    if (masterId) {
        const master = cache.masters.find(m => m.id === masterId);
        if (master) {
            document.getElementById('mast-id').value = masterId;
            document.getElementById('mast-name').value = master.name || '';
            document.getElementById('mast-salon').value = master.salonId || '';
            document.getElementById('mast-image').value = master.imageUrl || '';
            loadMasterServices(master.salonId, master.providedServices || []);
            document.getElementById('master-modal-title').textContent = 'Редактировать мастера';
        }
    }
    openModal('master-modal');
    const saveBtn = document.getElementById('save-mast');
    saveBtn.onclick = addMaster;
}
async function addMaster() {
    const name = document.getElementById('mast-name').value.trim(); const salonId = document.getElementById('mast-salon').value; const imageUrl = document.getElementById('mast-image').value.trim();
    const masterId = document.getElementById('mast-id').value;
    if (!name || !salonId) { showNotification('Заполните обязательные поля', true); return; }
    const checkboxes = document.querySelectorAll('#master-services-checkboxes input[type="checkbox"]:checked');
    const providedServices = Array.from(checkboxes).map(cb => cb.value);
    let specialization = '';
    if (providedServices.length) { const services = await getCached('services'); specialization = providedServices.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(', '); }
    const salon = cache.salons.find(s => s.id === salonId); const salonName = salon ? salon.name : '';
    const masterData = { name, salonId, salonName, imageUrl: imageUrl || getSafeImageUrl('master', name), specialization, providedServices, rating: 0, daysOff: [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    try {
        if (masterId) {
            const old = (await db.collection('masters').doc(masterId).get()).data();
            await db.collection('masters').doc(masterId).update(masterData);
            await logAdminAction('update', 'masters', masterId, old, masterData);
        } else {
            masterData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('masters').add(masterData);
            await logAdminAction('create', 'masters', ref.id, null, masterData);
        }
        closeModal('master-modal'); clearCache(); renderAdmin();
    } catch (error) { showNotification('Ошибка: ' + error.message, true); }
}
function resetMasterForm() { document.getElementById('mast-name').value = ''; const salonSelect = document.getElementById('mast-salon'); if (salonSelect) salonSelect.value = ''; document.getElementById('mast-image').value = ''; document.getElementById('mast-id').value = ''; document.getElementById('master-modal-title').textContent = 'Добавить мастера'; const container = document.getElementById('master-services-checkboxes'); if (container) container.innerHTML = ''; }
document.getElementById('cancel-mast')?.addEventListener('click', () => { closeModal('master-modal'); resetMasterForm(); });
document.getElementById('cancel-serv')?.addEventListener('click', () => closeModal('service-modal'));
document.getElementById('cancel-sal')?.addEventListener('click', () => closeModal('salon-modal'));

// ==============================================
// RESET AND RESEED DATA (ОПТИМИЗИРОВАННАЯ) – исправлено
// ==============================================
async function resetAndReseedAllData() {
    if (!confirm('Вы уверены? Все текущие данные будут удалены и заменены тестовыми.')) return;
    isSeeding = true;
    try {
        const collections = ['salons', 'services', 'masters', 'bookings', 'reviews', 'admin_actions', 'users'];
        for (const col of collections) { const snapshot = await db.collection(col).get(); const batch = db.batch(); snapshot.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); }
        seedCompleted = false;
        clearCache();
        await seedDataIfEmpty(true);
        showNotification('✅ Данные успешно пересозданы!', false);
        showPage(currentPage);
    } catch (error) { console.error(error); showNotification('Ошибка при сбросе данных', true); }
    finally {
        isSeeding = false;
        updateAuthUI();
        showPage(currentPage);
    }
}

async function seedDataIfEmpty(force = false) {
    if (!force && (await db.collection('salons').limit(1).get()).docs.length > 0 && (await db.collection('services').limit(1).get()).docs.length > 0) {
        seedCompleted = true;
        return;
    }
    isSeeding = true;
    try {
        const salonNames = [ "Beauty Studio 'Элегант'", "Spa 'Оазис'", "Barbershop 'Брутал'", "Салон 'Шарм'", "Лаборатория красоты", "Студия 'Имидж'", "Центр 'Гармония'", "Beauty House", "Solo Nails", "Парикмахерская 'Локон'", "Косметология 'Лик'", "Массажный салон 'Релакс'", "Барбершоп 'Классик'", "Салон 'Визаж'", "Студия загара 'Золото'" ];
        const addresses = [ "ул. Ленина, 45", "ул. Пушкина, 12", "ул. Советская, 23", "пр. Мира, 8", "ул. Гагарина, 15", "ул. Кирова, 7", "ул. Октябрьская, 30", "ул. Комсомольская, 55", "ул. Дзержинского, 19", "ул. Лермонтова, 3", "ул. Чехова, 11", "ул. Толстого, 24", "ул. Достоевского, 41", "ул. Тургенева, 6", "ул. Есенина, 17" ];
        const specializationsList = [ ['hair','nails'], ['massage','cosmetology'], ['barber'], ['hair','makeup'], ['cosmetology','nails'], ['hair','barber'], ['massage','cosmetology','nails'], ['hair','nails','makeup'], ['nails'], ['hair','barber'], ['cosmetology'], ['massage'], ['barber'], ['makeup','hair'], ['massage','cosmetology'] ];

        const salonBatch = db.batch();
        const salonRefs = [];
        for (let i = 0; i < 15; i++) {
            const ref = db.collection('salons').doc();
            salonBatch.set(ref, { name: salonNames[i], address: addresses[i], specializations: specializationsList[i], imageUrl: getSafeImageUrl('salon', salonNames[i]), rating: 4 + Math.random() * 0.9, reviewCount: 0 });
            salonRefs.push(ref);
        }
        await salonBatch.commit();

        const categories = ['hair', 'nails', 'cosmetology', 'massage', 'barber'];
        const serviceNamesByCat = { hair: ['Стрижка', 'Окрашивание', 'Укладка', 'Лечение волос', 'Биозавивка'], nails: ['Маникюр', 'Педикюр', 'Наращивание ногтей', 'Гель-лак', 'Дизайн ногтей'], cosmetology: ['Чистка лица', 'Пилинг', 'Уход за кожей', 'Ботокс для лица', 'Массаж лица'], massage: ['Общий массаж', 'Антицеллюлитный', 'Точечный', 'Релакс-массаж', 'Спортивный'], barber: ['Мужская стрижка', 'Моделирование бороды', 'Бритье', 'Камуфляж седины', 'Стрижка машинкой'] };
        const basePrices = { hair: 1500, nails: 1200, cosmetology: 2500, massage: 2000, barber: 1000 };
        const servicesBatch = db.batch();
        const servicesPerSalon = [];
        for (let sIdx = 0; sIdx < salonRefs.length; sIdx++) {
            const salonId = salonRefs[sIdx].id;
            const salonName = salonNames[sIdx];
            const salonServices = [];
            for (let catIdx = 0; catIdx < categories.length; catIdx++) {
                const cat = categories[catIdx];
                const serviceName = serviceNamesByCat[cat][sIdx % 5];
                const price = basePrices[cat] + (sIdx * 50);
                const ref = db.collection('services').doc();
                servicesBatch.set(ref, { name: serviceName, category: cat, price, duration: (cat === 'massage' ? 30 : 60), salonId, salonName, imageUrl: getSafeImageUrl(cat, serviceName) });
                salonServices.push({ id: ref.id, name: serviceName, category: cat, price });
            }
            servicesPerSalon.push(salonServices);
        }
        await servicesBatch.commit();

        // ----- Только несколько реальных пользователей с задержками -----
        const delay = ms => new Promise(res => setTimeout(res, ms));
        async function createUserIfNeeded(email, name, role, password) {
            try {
                const cred = await auth.createUserWithEmailAndPassword(email, password);
                const uid = cred.user.uid;
                await db.collection('users').doc(uid).set({
                    uid, email, name: name.split(' ')[0], lastname: name.split(' ')[1] || '', role, points: 0,
                    registrationDate: firebase.firestore.FieldValue.serverTimestamp()
                });
                return uid;
            } catch (err) {
                if (err.code === 'auth/email-already-in-use') {
                    const signIn = await auth.signInWithEmailAndPassword(email, password);
                    const uid = signIn.user.uid;
                    await db.collection('users').doc(uid).set({ uid, email, name: name.split(' ')[0], lastname: name.split(' ')[1] || '', role, points: 0, registrationDate: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    return uid;
                }
                console.warn(`Auth error ${email}:`, err);
                return null;
            }
        }

        // Регистрируем с задержками только несколько демо-пользователей
        await createUserIfNeeded('admin@beauty.ru', 'Администратор', 'admin', 'admin123');
        await delay(400);
        for (let i = 1; i <= 5; i++) {
            const email = `master${i}@beauty.ru`;
            const firstName = ["Анна", "Сергей", "Екатерина", "Дмитрий", "Мария"][i-1];
            const lastName = ["Иванова", "Кузнецов", "Соколова", "Попов", "Фёдорова"][i-1];
            await createUserIfNeeded(email, `${firstName} ${lastName}`, 'master', 'Master123!');
            await delay(300);
        }
        for (let i = 1; i <= 3; i++) {
            const email = `client${i}@example.com`;
            await createUserIfNeeded(email, ["Анна", "Мария", "Сергей"][i-1], 'client', 'client123');
            await delay(200);
        }
        await createUserIfNeeded('client@beauty.ru', 'Тестовый Клиент', 'client', 'client123');
        await delay(200);

        // Теперь создаём документы мастеров в Firestore (без реальных аккаунтов)
        const firstNames = ["Анна", "Мария", "Екатерина", "Ольга", "Татьяна", "Сергей", "Дмитрий", "Алексей", "Владимир", "Ирина", "Наталья", "Елена", "Александра", "Юлия", "Михаил", "Андрей", "Ксения", "Виктория", "Анастасия", "Павел"];
        const lastNames = ["Иванова", "Петрова", "Сидорова", "Козлова", "Новикова", "Смирнов", "Кузнецов", "Попов", "Васильев", "Морозов", "Фёдорова", "Михайлова", "Волкова", "Алексеева", "Соколова", "Лебедева", "Егорова", "Павлова", "Семёнова", "Тихонова"];
        const mastersBatch = db.batch();
        let masterCounter = 0;
        for (let sIdx = 0; sIdx < salonRefs.length; sIdx++) {
            const salonId = salonRefs[sIdx].id;
            const salonName = salonNames[sIdx];
            const services = servicesPerSalon[sIdx];
            for (let m = 0; m < 5; m++) {
                const firstName = firstNames[masterCounter % firstNames.length];
                const lastName = lastNames[masterCounter % lastNames.length];
                const masterName = `${firstName} ${lastName}`;
                masterCounter++;
                // userId оставим пустым для не-демо мастеров
                const ref = db.collection('masters').doc();
                const numServices = Math.min(services.length, 2 + (m % 4));
                const providedServiceIds = services.slice(0, numServices).map(s => s.id);
                const specialization = providedServiceIds.map(id => services.find(s => s.id === id)?.name).join(', ');
                mastersBatch.set(ref, {
                    name: masterName,
                    salonId, salonName,
                    specialization,
                    providedServices: providedServiceIds,
                    rating: 4 + Math.random() * 0.9,
                    imageUrl: getSafeImageUrl('master', masterName),
                    daysOff: [],
                    userId: ''
                });
            }
        }
        await mastersBatch.commit();

        // Асинхронное наполнение отзывами и бронями (не влияет на скорость)
        setTimeout(async () => {
            try {
                const allUsers = await getCached('users', true);
                const reviewTexts = ["Отлично!", "Хорошо", "Нормально", "Восторг!", "Рекомендую", "Приду ещё", "Спасибо мастеру", "Прекрасный сервис", "Очень чисто и уютно", "Профессионально"];
                for (let sIdx = 0; sIdx < salonRefs.length; sIdx++) {
                    const salonId = salonRefs[sIdx].id;
                    const salonName = salonNames[sIdx];
                    const numReviews = 2 + Math.floor(Math.random() * 4);
                    for (let r = 0; r < numReviews; r++) {
                        const author = allUsers[r % allUsers.length];
                        await db.collection('reviews').add({
                            salonId, salonName, userId: author?.uid, authorName: author?.name || 'Гость',
                            rating: parseFloat((3 + Math.random() * 2).toFixed(1)),
                            text: reviewTexts[(sIdx + r) % reviewTexts.length],
                            createdAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
                const masters = await getCached('masters');
                const services = await getCached('services');
                const clients = allUsers.filter(u => u.role === 'client');
                for (let i = 0; i < 30; i++) {
                    const client = clients[i % clients.length];
                    const master = masters[i % masters.length];
                    const service = services.find(s => s.id === master.providedServices?.[0]);
                    if (!service || !client) continue;
                    const date = new Date();
                    date.setDate(date.getDate() + (i % 14));
                    const dateStr = date.toISOString().split('T')[0];
                    const time = `${10 + (i % 10)}:00`;
                    let status = 'Новая';
                    if (i % 5 === 0) status = 'Выполнена';
                    if (i % 7 === 0) status = 'Отменена';
                    await db.collection('bookings').add({
                        userId: client.uid, salonId: master.salonId, salonName: master.salonName,
                        serviceId: service.id, serviceName: service.name, masterId: master.id, masterName: master.name,
                        date: dateStr, time, totalPrice: service.price, originalPrice: service.price, pointsUsed: 0,
                        status, clientName: client.name || 'Клиент', clientPhone: '+7XXXXXXXXXX', clientComment: '',
                        bookingDate: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
                clearCache();
            } catch (e) { console.error('Delayed seed error:', e); }
        }, 200);

        await clearCache();
        seedCompleted = true;
        console.log("Seed успешно завершён (быстрая загрузка, минимум регистраций)");
    } catch (error) {
        console.error('Ошибка автозаполнения:', error);
    } finally {
        isSeeding = false;
        updateAuthUI();
        if (currentPage) showPage(currentPage);
    }
}

// ==============================================
// AUTH UI & EVENT LISTENERS
// ==============================================
function updateAuthUI() {
    const btn = document.getElementById('profile-modal-btn'), logout = document.getElementById('logout-btn');
    if (currentUser) {
        if (btn) btn.innerHTML = `<i class="fas fa-user"></i><span>${currentUser.name||currentUser.email?.split('@')[0]||'Пользователь'}</span>`;
        if (logout) logout.style.display = 'flex';
        document.getElementById('profile-nav-item').style.display = 'block';
        document.getElementById('master-nav-item').style.display = (currentUser.role === 'master') ? 'block' : 'none';
        document.getElementById('master-schedule-item').style.display = currentUser.role === 'master' ? 'block' : 'none';
        document.getElementById('admin-nav-item').style.display = currentUser.role === 'admin' ? 'block' : 'none';
    } else {
        if (btn) btn.innerHTML = `<i class="fas fa-user"></i><span>Войти</span>`;
        if (logout) logout.style.display = 'none';
        document.getElementById('profile-nav-item').style.display = 'none';
        document.getElementById('master-nav-item').style.display = 'none';
        document.getElementById('master-schedule-item').style.display = 'none';
        document.getElementById('admin-nav-item').style.display = 'none';
    }
}

auth.onAuthStateChanged(async (user) => {
    if (isSeeding) return;
    if (user) {
        try {
            const doc = await db.collection('users').doc(user.uid).get();
            currentUser = { uid: user.uid, email: user.email, ...(doc.data()||{role:'client'}) };
            localStorage.setItem('beautyUser', JSON.stringify(currentUser));
        } catch(e) { currentUser = { uid: user.uid, email: user.email, role:'client' }; }
    } else {
        currentUser = null;
        localStorage.removeItem('beautyUser');
    }
    updateAuthUI();
    if (currentPage) showPage(currentPage);
});

document.getElementById('profile-modal-btn')?.addEventListener('click', async () => {
    if (currentUser) showPage('profile');
    else { await loadLoginDropdowns(); openModal('auth-modal'); }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
        await auth.signOut();
        currentUser = null;
        localStorage.removeItem('beautyUser');
        updateAuthUI();
        showPage('home');
    } catch (e) { showNotification('Ошибка выхода', true); }
});

function setupEventListeners() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value, pass = document.getElementById('login-password').value;
        try {
            const userCred = await auth.signInWithEmailAndPassword(email, pass);
            const user = userCred.user;
            const doc = await db.collection('users').doc(user.uid).get();
            currentUser = { uid: user.uid, email: user.email, ...(doc.data()||{role:'client'}) };
            localStorage.setItem('beautyUser', JSON.stringify(currentUser));
            closeModal('auth-modal');
            showNotification('Добро пожаловать!');
            updateAuthUI();
            showPage('home');
        } catch(err) {
            document.getElementById('login-error').style.display = 'block';
            showNotification('Ошибка входа', true);
        }
    });

    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('reg-email').value.trim(), pass = document.getElementById('reg-pass').value,
              name = document.getElementById('reg-name').value.trim();
        if (!email || !pass || !name) { showNotification('Заполните все поля', true); return; }
        if (!email.includes('@') || !email.includes('.')) { showNotification('Неверный email', true); return; }
        if (pass.length < 6) { showNotification('Пароль минимум 6 символов', true); return; }
        try {
            const cred = await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection('users').doc(cred.user.uid).set({
                name, email, phone: document.getElementById('reg-phone').value,
                role:'client', points:0
            });
            closeModal('auth-modal');
            showNotification('✅ Регистрация успешна!');
        } catch(err) {
            const msg = err.code === 'auth/email-already-in-use' ? 'Email уже занят' :
                        err.code === 'auth/invalid-email' ? 'Неверный email' :
                        err.code === 'auth/weak-password' ? 'Слабый пароль' : err.message;
            showNotification('Ошибка: '+msg, true);
        }
    });

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            tab.classList.add('active');
            const form = document.getElementById(`${tab.dataset.tab}-form`);
            if (form) form.classList.add('active');
        };
    });

    document.getElementById('switch-to-register')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.auth-tab[data-tab="register"]')?.click(); });
    document.getElementById('switch-to-login')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.auth-tab[data-tab="login"]')?.click(); });

    document.querySelectorAll('.modal-close').forEach(btn => btn.onclick = () => closeModal(btn.closest('.modal').id));
    document.querySelectorAll('.modal').forEach(mod => { mod.onclick = (e) => { if (e.target === mod) closeModal(mod.id); }; });

    document.querySelector('.logo')?.addEventListener('click', () => showPage('home'));

    document.getElementById('edit-user-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveUser(); });
    document.getElementById('cancel-edit-user')?.addEventListener('click', () => closeModal('edit-user-modal'));

    const applyFiltersBtn = document.getElementById('applyBookingFilters');
    if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', () => loadAllBookingsTable());
    const resetFiltersBtn = document.getElementById('resetBookingFilters');
    if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', () => {
        if (document.getElementById('bookingSearch')) document.getElementById('bookingSearch').value = '';
        if (document.getElementById('statusFilter')) document.getElementById('statusFilter').value = 'all';
        if (document.getElementById('dateFilter')) document.getElementById('dateFilter').value = '';
        loadAllBookingsTable();
    });
    const applyReviewFilters = document.getElementById('applyReviewFilters');
    if (applyReviewFilters) applyReviewFilters.addEventListener('click', () => loadAllReviewsTable());
    const resetReviewFilters = document.getElementById('resetReviewFilters');
    if (resetReviewFilters) resetReviewFilters.addEventListener('click', () => {
        if (document.getElementById('reviewSearch')) document.getElementById('reviewSearch').value = '';
        if (document.getElementById('reviewRatingFilter')) document.getElementById('reviewRatingFilter').value = 'all';
        loadAllReviewsTable();
    });

    document.getElementById('menuToggle')?.addEventListener('click', () => {
        document.querySelector('nav').classList.toggle('open');
    });
}

// ==============================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ
// ==============================================
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    try { await seedDataIfEmpty(); }
    catch (e) { console.error('Ошибка инициализации данных:', e); }
    finally {
        if (currentPage) showPage(currentPage);
    }
});