// ==============================================
// МАСТЕР-ПАНЕЛЬ (мини-CRM)
// ==============================================
async function renderMasterCabinet() {
    if (!currentUser || (currentUser.role !== 'master' && currentUser.role !== 'admin')) return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;

    const masterDoc = (await db.collection('masters').where('userId', '==', currentUser.uid).get()).docs[0];
    if (!masterDoc) {
        container.innerHTML = '<p>Профиль мастера не найден. Обратитесь к администратору.</p>';
        return;
    }
    const master = { id: masterDoc.id, ...masterDoc.data() };
    const salonDoc = await db.collection('salons').doc(master.salonId).get();
    const salon = salonDoc.exists ? salonDoc.data() : { name: 'Не указан' };

    // Автоматическая отмена просроченных записей (для мастера)
    let bookings = (await getCached('bookings')).filter(b => b.masterId === master.id);
    for (const b of bookings) {
        if (new Date(b.date) < new Date() && b.status !== 'Выполнена' && b.status !== 'Отменена') {
            await db.collection('bookings').doc(b.id).update({ status: 'Отменена' });
        }
    }
    bookings = (await getCached('bookings')).filter(b => b.masterId === master.id).sort((a,b)=>new Date(b.date)-new Date(a.date));

    container.innerHTML = `
    <h1 class="section-title">Мастер-панель</h1>
    <div style="display:flex; gap:30px; flex-wrap:wrap;">
        <div style="flex:1; background:white; border-radius:20px; padding:25px; box-shadow:var(--shadow);">
            <h3>${escapeHtml(master.name)}</h3>
            <div class="user-detail-row"><strong>Салон:</strong> ${escapeHtml(salon.name)}</div>
            <div class="user-detail-row"><strong>Специализация:</strong> ${escapeHtml(master.specialization||'—')}</div>
            <div class="user-detail-row"><strong>Email:</strong> ${escapeHtml(currentUser.email)}</div>
            <div class="user-detail-row"><strong>Телефон:</strong> ${escapeHtml(currentUser.phone||'—')}</div>
            <div style="margin-top:20px; display:flex; gap:10px;">
                <button class="btn btn-outline btn-sm" id="editMasterProfileBtn">Редактировать профиль</button>
                <button class="btn btn-outline btn-sm" style="color:red; border-color:red;" id="deleteMasterProfileBtn">Удалить профиль</button>
            </div>
        </div>
        <div style="flex:3;">
            <div class="auth-tabs" style="margin-bottom:20px;">
                <button class="auth-tab active" data-tab="bookings">Управление записями</button>
                <button class="auth-tab" data-tab="actions">Мои действия</button>
            </div>
            <div id="masterBookingsTab">
                <div style="max-height:500px; overflow-y:auto;">
                    <table class="history-table">
                        <thead><tr><th>Клиент</th><th>Услуга</th><th>Дата</th><th>Время</th><th>Телефон</th><th>Статус</th><th>Действия</th></tr></thead>
                        <tbody id="masterBookingsTbody"></tbody>
                    </table>
                </div>
            </div>
            <div id="masterActionsTab" style="display:none;">
                <div id="masterActionsList">Загрузка...</div>
            </div>
        </div>
    </div>
    `;

    const tbody = document.getElementById('masterBookingsTbody');
    if (tbody) {
        tbody.innerHTML = bookings.length ? bookings.map(b => {
            const isPast = new Date(b.date) < new Date();
            let statusSelect = `<select onchange="updateBookingStatusMaster('${b.id}', this.value)" style="padding:4px; border-radius:8px;">`;
            statusSelect += `<option value="Новая" ${b.status==='Новая'?'selected':''}>Новая</option>`;
            statusSelect += `<option value="Подтверждена" ${b.status==='Подтверждена'?'selected':''}>Подтверждена</option>`;
            statusSelect += `<option value="Выполнена" ${b.status==='Выполнена'?'selected':''}>Выполнена</option>`;
            statusSelect += `<option value="Отменена" ${b.status==='Отменена'?'selected':''}>Отменена</option>`;
            statusSelect += `</select>`;
            if (isPast && b.status !== 'Выполнена' && b.status !== 'Отменена') {
                statusSelect = `<span class="badge badge-cancelled">Просрочена (автоотмена)</span>`;
            } else if (isPast && b.status === 'Выполнена') {
                statusSelect = `<span class="badge badge-done">Выполнена</span>`;
            }
            return `<tr>
                <td>${escapeHtml(b.clientName||'—')}</td>
                <td>${escapeHtml(b.serviceName||'—')}</td>
                <td>${b.date}</td>
                <td>${b.time}</td>
                <td>${escapeHtml(b.clientPhone||'—')}</td>
                <td><span class="badge badge-${b.status==='Выполнена'?'done':b.status==='Отменена'?'cancelled':'new'}">${b.status}</span></td>
                <td>${statusSelect}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="7">Нет записей</td>';
    }

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
        if (confirm('Удалить профиль мастера и учётную запись? Это действие необратимо.')) {
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
        if (new Date(old.date) < new Date() && old.status !== 'Выполнена' && newStatus !== 'Отменена') {
            showNotification('Нельзя изменить статус прошедшей записи, кроме отмены', true);
            return;
        }
        await bookingRef.update({ status: newStatus });
        await logAdminAction('update', 'bookings', bookingId, old, { ...old, status: newStatus });
        showNotification(`Статус изменён на ${newStatus}`);
        await clearCache(); await refreshAllCache();
        renderMasterCabinet();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

async function loadMasterActions() {
    const container = document.getElementById('masterActionsList');
    if (!container) return;
    const actions = await db.collection('admin_actions').where('adminId', '==', currentUser.uid).orderBy('timestamp', 'desc').limit(50).get();
    if (actions.empty) {
        container.innerHTML = '<p>Нет действий</p>';
        return;
    }
    container.innerHTML = actions.docs.map(d => {
        const a = d.data();
        return `<div style="padding:10px; border-bottom:1px solid #eee;">${formatDateTime(a.timestamp)} – ${a.actionType} ${a.collection} (${a.docId?.slice(0,8)}...)</div>`;
    }).join('');
}

window.openEditMasterProfile = async function(master) {
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
        currentUser.name = name; currentUser.lastname = lastname; currentUser.phone = phone;
        closeModal('edit-profile-modal');
        showNotification('Профиль обновлён');
        renderMasterCabinet();
    };
};

// ==============================================
// КАЛЕНДАРЬ МАСТЕРА (рабочее время)
// ==============================================
async function renderMasterSchedule() {
    if (!currentUser || currentUser.role !== 'master') return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;

    const masterDoc = (await db.collection('masters').where('userId', '==', currentUser.uid).get()).docs[0];
    if (!masterDoc) {
        container.innerHTML = '<p>Профиль мастера не найден</p>';
        return;
    }
    const master = { id: masterDoc.id, ...masterDoc.data() };
    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();

    function renderCalendar() {
        const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
        const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const adjustedFirstDay = firstDay === 0 ? 7 : firstDay;
        let html = `<h2>${monthNames[currentMonth]} ${currentYear}</h2>`;
        html += '<table class="calendar-table"><thead><tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr></thead><tbody><tr>';
        for (let i = 1; i < adjustedFirstDay; i++) html += '<td></td>';
        for (let day = 1; day <= daysInMonth; day++) {
            const date = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isToday = (day === new Date().getDate() && currentMonth === new Date().getMonth() && currentYear === new Date().getFullYear());
            const isDayOff = (master.daysOff || []).includes(date);
            const hasBookings = (cache.bookings || []).some(b => b.masterId === master.id && b.date === date && b.status !== 'Отменена');
            let classes = '';
            if (isToday) classes += ' today';
            if (isDayOff) classes += ' day-off';
            else if (hasBookings) classes += ' has-bookings';
            html += `<td class="${classes}" data-date="${date}">${day}</td>`;
            if ((day + adjustedFirstDay - 1) % 7 === 0) html += '</tr><tr>';
        }
        html += '</tr></tbody></table>';
        return html;
    }

    async function loadBookingsForDate(date) {
        const bookings = (await getCached('bookings')).filter(b => b.masterId === master.id && b.date === date && b.status !== 'Отменена');
        const listDiv = document.getElementById('bookings-on-date');
        if (!bookings.length) {
            listDiv.innerHTML = '<p>Нет записей</p>';
        } else {
            listDiv.innerHTML = bookings.map(b => `
                <div style="border:1px solid #ddd; padding:10px; margin:8px 0; border-radius:8px;">
                    <strong>${b.time}</strong> — ${escapeHtml(b.serviceName)}<br>
                    Клиент: ${escapeHtml(b.clientName)} | Тел.: ${escapeHtml(b.clientPhone)}
                    <span class="badge badge-${b.status==='Выполнена'?'done':b.status==='Отменена'?'cancelled':'new'}">${b.status}</span>
                </div>
            `).join('');
        }
    }

    container.innerHTML = `
        <h1 class="section-title">Моё рабочее время</h1>
        <div style="display: flex; gap: 30px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 280px;">
                <div class="calendar-controls">
                    <button class="btn btn-outline btn-sm" id="prevMonth"><i class="fas fa-chevron-left"></i></button>
                    <span id="currentMonthLabel"></span>
                    <button class="btn btn-outline btn-sm" id="nextMonth"><i class="fas fa-chevron-right"></i></button>
                </div>
                <div id="calendarContainer"></div>
            </div>
            <div style="flex: 1; min-width: 280px;">
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
            td.onclick = async () => {
                const date = td.dataset.date;
                document.getElementById('selectedDateLabel').textContent = date;
                await loadBookingsForDate(date);
            };
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
        await clearCache(); await refreshAllCache();
        updateCalendar();
        showNotification('Выходной добавлен');
    };
}

// ==============================================
// АДМИН-ПАНЕЛЬ (полная)
// ==============================================
async function renderAdmin() {
    if (!currentUser || currentUser.role !== 'admin') return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `
    <h1 class="section-title">Админ-панель</h1>
    <div style="margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap;">
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
        <div style="margin-bottom:15px; display:flex; gap:10px; flex-wrap:wrap;">
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
            <table class="history-table">
                <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Телефон</th><th>Дата регистрации</th><th>Действия</th></tr></thead>
                <tbody id="usersTableBody"></tbody>
            </table>
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
            <button id="applyBookingFilters" class="btn btn-primary">Применить</button>
            <button id="resetBookingFilters" class="btn btn-secondary">Сбросить</button>
        </div>
        <div style="overflow-x:auto;">
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
        <div style="overflow-x:auto;">
            <table class="history-table">
                <thead><tr><th>Салон</th><th>Автор</th><th>Рейтинг</th><th>Текст отзыва</th><th>Дата</th><th>Действия</th></tr></thead>
                <tbody id="reviewsTableBody"></tbody>
            </table>
        </div>
    </div>
    <div id="admin-history-view" style="display:none">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap;">
            <h2 class="section-title" style="margin:0">История изменений</h2>
            <button class="btn btn-outline" id="clearHistoryBtn" style="color:red; border-color:red;">Очистить историю</button>
        </div>
        <div style="overflow-x:auto;">
            <table class="history-table">
                <thead><tr><th>Действие</th><th>Объект</th><th>Время</th><th>Отмена</th></tr></thead>
                <tbody id="historyTableBody"></tbody>
            </table>
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
    document.getElementById('applyRoleFilter').onclick = () => loadUsersTable();
    document.getElementById('clearHistoryBtn').onclick = async () => {
        if (confirm('Удалить всю историю действий?')) {
            const snap = await db.collection('admin_actions').get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showNotification('История очищена');
            loadAdminHistory();
        }
    };
    document.getElementById('editSettingsBtn').onclick = async () => {
        const snap = await db.collection('settings').doc('main_page').get();
        const data = snap.exists ? snap.data() : {};
        document.getElementById('set-hero-title').value = data.heroTitle || '';
        document.getElementById('set-hero-subtitle').value = data.heroSubtitle || '';
        document.getElementById('set-hero-image').value = data.heroImage || '';
        openModal('site-settings-modal');
    };
    document.getElementById('site-settings-form').onsubmit = async (e) => {
        e.preventDefault();
        await db.collection('settings').doc('main_page').set({
            heroTitle: document.getElementById('set-hero-title').value,
            heroSubtitle: document.getElementById('set-hero-subtitle').value,
            heroImage: document.getElementById('set-hero-image').value
        });
        closeModal('site-settings-modal');
        showNotification('Настройки сохранены');
        if (currentPage === 'home') renderHome();
    };

    await loadAdminDataCards();
    document.getElementById('addServBtn').onclick = () => openServiceModal();
    document.getElementById('addSalonBtn').onclick = () => openSalonModal();
    document.getElementById('addMasterBtn').onclick = () => openMasterModal();
}

async function loadAdminDataCards() {
    const services = await getCached('services');
    const salons = await getCached('salons');
    const masters = await getCached('masters');
    const salonMap = Object.fromEntries(salons.map(s => [s.id, s.name]));

    const svcDiv = document.getElementById('adminServices');
    if (svcDiv) {
        if (!services.length) svcDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет услуг. Добавьте первую.</p>';
        else {
            svcDiv.innerHTML = services.map(s => `
                <div class="card">
                    <img src="${s.imageUrl || getSafeImageUrl('service', s.name)}" class="card-img" onerror="this.src='${getSafeImageUrl('service', 'fallback')}'">
                    <div class="card-content">
                        <h3>${escapeHtml(s.name)}</h3>
                        <p>${escapeHtml(salonMap[s.salonId] || 'Не указан')} • ${s.price} ₽</p>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-outline btn-sm edit-serv" data-id="${s.id}">Ред.</button>
                            <button class="btn btn-outline btn-sm del-serv" data-id="${s.id}" style="color:red;border-color:red">Удалить</button>
                        </div>
                    </div>
                </div>
            `).join('');
            svcDiv.querySelectorAll('.edit-serv').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openServiceModal(btn.dataset.id); });
            svcDiv.querySelectorAll('.del-serv').forEach(btn => btn.onclick = async () => {
                if (confirm('Удалить услугу?')) {
                    const id = btn.dataset.id;
                    const old = services.find(x => x.id === id);
                    await db.collection('services').doc(id).delete();
                    const mastersWith = await db.collection('masters').where('providedServices', 'array-contains', id).get();
                    const batch = db.batch();
                    mastersWith.forEach(d => batch.update(d.ref, { providedServices: firebase.firestore.FieldValue.arrayRemove(id) }));
                    await batch.commit();
                    await logAdminAction('delete', 'services', id, old, null);
                    await clearCache(); await refreshAllCache();
                    renderAdmin();
                }
            });
        }
    }

    const salDiv = document.getElementById('adminSalons');
    if (salDiv) {
        if (!salons.length) salDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет салонов. Добавьте первый.</p>';
        else {
            salDiv.innerHTML = salons.map(s => `
                <div class="card">
                    <img src="${s.imageUrl || getSafeImageUrl('salon', s.name)}" class="card-img" onerror="this.src='${getSafeImageUrl('salon', 'fallback')}'">
                    <div class="card-content">
                        <h3>${escapeHtml(s.name)}</h3>
                        <p>${escapeHtml(s.address || '')}</p>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-outline btn-sm edit-sal" data-id="${s.id}">Ред.</button>
                            <button class="btn btn-outline btn-sm del-sal" data-id="${s.id}" style="color:red;border-color:red">Удалить</button>
                        </div>
                    </div>
                </div>
            `).join('');
            salDiv.querySelectorAll('.edit-sal').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openSalonModal(btn.dataset.id); });
            salDiv.querySelectorAll('.del-sal').forEach(btn => btn.onclick = async () => {
                if (confirm('Удалить салон и всё связанное?')) {
                    const id = btn.dataset.id;
                    const old = salons.find(x => x.id === id);
                    const batch = db.batch();
                    const servicesSnap = await db.collection('services').where('salonId', '==', id).get();
                    servicesSnap.forEach(d => batch.delete(d.ref));
                    const mastersSnap = await db.collection('masters').where('salonId', '==', id).get();
                    mastersSnap.forEach(d => batch.delete(d.ref));
                    const bookingsSnap = await db.collection('bookings').where('salonId', '==', id).get();
                    bookingsSnap.forEach(d => batch.delete(d.ref));
                    const reviewsSnap = await db.collection('reviews').where('salonId', '==', id).get();
                    reviewsSnap.forEach(d => batch.delete(d.ref));
                    batch.delete(db.collection('salons').doc(id));
                    await batch.commit();
                    await logAdminAction('delete', 'salons', id, old, null);
                    await clearCache(); await refreshAllCache();
                    renderAdmin();
                }
            });
        }
    }

    const mstDiv = document.getElementById('adminMasters');
    if (mstDiv) {
        if (!masters.length) mstDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет мастеров. Добавьте первого.</p>';
        else {
            mstDiv.innerHTML = masters.map(m => `
                <div class="card">
                    <img src="${m.imageUrl || getSafeImageUrl('master', m.name)}" class="card-img" onerror="this.src='${getSafeImageUrl('master', 'fallback')}'">
                    <div class="card-content">
                        <h3>${escapeHtml(m.name)}</h3>
                        <p>${escapeHtml(m.specialization || '')} • ${escapeHtml(salonMap[m.salonId] || '')}</p>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-outline btn-sm edit-mast" data-id="${m.id}">Ред.</button>
                            <button class="btn btn-outline btn-sm del-mast" data-id="${m.id}" style="color:red;border-color:red">Удалить</button>
                        </div>
                    </div>
                </div>
            `).join('');
            mstDiv.querySelectorAll('.edit-mast').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openMasterModal(btn.dataset.id); });
            mstDiv.querySelectorAll('.del-mast').forEach(btn => btn.onclick = async () => {
                if (confirm('Удалить мастера?')) {
                    const id = btn.dataset.id;
                    const old = masters.find(x => x.id === id);
                    await db.collection('masters').doc(id).delete();
                    await logAdminAction('delete', 'masters', id, old, null);
                    await clearCache(); await refreshAllCache();
                    renderAdmin();
                }
            });
        }
    }
}

// ==============================================
// ТАБЛИЦЫ В АДМИНКЕ (записи, отзывы, пользователи)
// ==============================================
async function loadAllBookingsTable() {
    const tbody = document.getElementById('bookingsTableBody');
    if (!tbody) return;
    const search = document.getElementById('bookingSearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const dateFilter = document.getElementById('dateFilter')?.value || '';
    let bookings = await getCached('bookings', true);
    bookings = bookings.sort((a,b) => new Date(b.bookingDate?.seconds*1000) - new Date(a.bookingDate?.seconds*1000));
    if (search) bookings = bookings.filter(b => (b.clientName || '').toLowerCase().includes(search) || (b.serviceName || '').toLowerCase().includes(search) || (b.masterName || '').toLowerCase().includes(search));
    if (statusFilter !== 'all') bookings = bookings.filter(b => b.status === statusFilter);
    if (dateFilter) bookings = bookings.filter(b => b.date === dateFilter);
    if (!bookings.length) { tbody.innerHTML = '<tr><td colspan="9">Нет записей</td></tr>'; return; }
    tbody.innerHTML = bookings.map(b => {
        const isPast = new Date(b.date) < new Date();
        let statusSelect = `<select onchange="updateBookingStatusAdmin('${b.id}', this.value)" style="padding:4px; border-radius:8px;">
            <option value="Новая" ${b.status === 'Новая' ? 'selected' : ''}>Новая</option>
            <option value="Подтверждена" ${b.status === 'Подтверждена' ? 'selected' : ''}>Подтверждена</option>
            <option value="Выполнена" ${b.status === 'Выполнена' ? 'selected' : ''}>Выполнена</option>
            <option value="Отменена" ${b.status === 'Отменена' ? 'selected' : ''}>Отменена</option>
        </select>`;
        if (isPast && b.status !== 'Выполнена' && b.status !== 'Отменена') {
            statusSelect = `<span class="badge badge-cancelled">Просрочена</span>`;
        }
        return `
        <tr>
            <td>${b.date || ''} ${b.time || ''}</td>
            <td>${escapeHtml(b.clientName || '—')}</td>
            <td>${escapeHtml(b.serviceName || '—')}</td>
            <td>${escapeHtml(b.masterName || '—')}</td>
            <td>${escapeHtml(b.salonName || '—')}</td>
            <td>${b.totalPrice || 0} ₽</td>
            <td><span class="badge badge-${b.status === 'Выполнена' ? 'done' : b.status === 'Отменена' ? 'cancelled' : 'new'}">${b.status}</span></td>
            <td>${statusSelect}</td>
            <td><button class="btn btn-sm btn-outline" onclick="showBookingHistory('${b.id}')">История</button></td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteBookingAdmin('${b.id}')">Удалить</button></td>
        </tr>
    `}).join('');
}

window.updateBookingStatusAdmin = async (bookingId, newStatus) => {
    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const old = (await bookingRef.get()).data();
        if (new Date(old.date) < new Date() && old.status !== 'Выполнена' && newStatus !== 'Отменена') {
            showNotification('Нельзя изменить статус прошедшей записи, кроме отмены', true);
            return;
        }
        await bookingRef.update({ status: newStatus });
        await logAdminAction('update', 'bookings', bookingId, old, { ...old, status: newStatus });
        showNotification(`Статус изменён на ${newStatus}`);
        await clearCache(); await refreshAllCache();
        loadAllBookingsTable();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

window.deleteBookingAdmin = async (bookingId) => {
    if (!confirm('Удалить эту запись?')) return;
    try {
        const old = (await db.collection('bookings').doc(bookingId).get()).data();
        await db.collection('bookings').doc(bookingId).delete();
        await logAdminAction('delete', 'bookings', bookingId, old, null);
        showNotification('Запись удалена');
        await clearCache(); await refreshAllCache();
        loadAllBookingsTable();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

window.showBookingHistory = async (bookingId) => {
    const actions = await db.collection('admin_actions').where('docId', '==', bookingId).where('collection', '==', 'bookings').orderBy('timestamp', 'desc').get();
    if (actions.empty) { alert('История изменений не найдена.'); return; }
    let msg = `История изменений записи ${bookingId}:\n`;
    actions.forEach(doc => {
        const a = doc.data();
        msg += `${formatDateTime(a.timestamp)} — ${a.actionType}: ${a.oldData ? 'было: '+JSON.stringify(a.oldData) : ''} ${a.newData ? 'стало: '+JSON.stringify(a.newData) : ''}\n`;
    });
    alert(msg);
};

async function loadAllReviewsTable() {
    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;
    const search = document.getElementById('reviewSearch')?.value.toLowerCase() || '';
    const ratingFilter = document.getElementById('reviewRatingFilter')?.value || 'all';
    let reviews = await getCached('reviews', true);
    reviews = reviews.sort((a,b) => new Date(b.createdAt?.seconds*1000) - new Date(a.createdAt?.seconds*1000));
    if (search) reviews = reviews.filter(r => (r.salonName || '').toLowerCase().includes(search) || (r.authorName || '').toLowerCase().includes(search) || (r.text || '').toLowerCase().includes(search));
    if (ratingFilter !== 'all') { const minRating = parseInt(ratingFilter); reviews = reviews.filter(r => r.rating >= minRating); }
    if (!reviews.length) { tbody.innerHTML = '<tr><td colspan="6">Нет отзывов</td></tr>'; return; }
    tbody.innerHTML = reviews.map(r => `
        <tr>
            <td>${escapeHtml(r.salonName || '—')}</td>
            <td>${escapeHtml(r.authorName || '—')}</td>
            <td>${'★'.repeat(Math.floor(r.rating))}${'☆'.repeat(5-Math.floor(r.rating))} (${r.rating})</td>
            <td>${escapeHtml(r.text || '')}</td>
            <td>${formatDate(r.createdAt)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteReviewAdmin('${r.id}')">Удалить</button></td>
        </tr>
    `).join('');
}

window.deleteReviewAdmin = async (reviewId) => {
    if (!confirm('Удалить этот отзыв? Это также обновит рейтинг салона.')) return;
    try {
        const reviewDoc = await db.collection('reviews').doc(reviewId).get();
        const review = reviewDoc.data();
        const salonId = review.salonId;
        await db.collection('reviews').doc(reviewId).delete();
        await logAdminAction('delete', 'reviews', reviewId, review, null);
        const reviewsSnap = await db.collection('reviews').where('salonId', '==', salonId).get();
        let total = 0;
        reviewsSnap.forEach(doc => total += doc.data().rating);
        const avg = reviewsSnap.size ? total / reviewsSnap.size : 0;
        await db.collection('salons').doc(salonId).update({ rating: parseFloat(avg.toFixed(1)), reviewCount: reviewsSnap.size });
        showNotification('Отзыв удалён');
        await clearCache(); await refreshAllCache();
        loadAllReviewsTable();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

async function loadUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    let users = await getCached('users', true);
    const roleFilter = document.getElementById('roleFilter')?.value || 'all';
    if (roleFilter !== 'all') users = users.filter(u => u.role === roleFilter);
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="6">Пользователи не найдены</td></tr>'; return; }
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
        if (!password || password.length < 6) { showNotification('Пароль (мин. 6 символов) обязателен для нового пользователя', true); return; }
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
            await clearCache(); await refreshAllCache();
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
            await clearCache(); await refreshAllCache();
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
        await clearCache(); await refreshAllCache();
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
    const actionTypeMap = { create: 'Добавление', update: 'Редактирование', delete: 'Удаление' };
    const collectionMap = { users: 'Пользователь', masters: 'Мастер', services: 'Услуга', salons: 'Салон', bookings: 'Бронирование', reviews: 'Отзыв' };
    tbody.innerHTML = actions.map(a => {
        let objectText = collectionMap[a.collection] || a.collection;
        if (a.collection === 'salons') {
            const salon = cache.salons.find(s => s.id === a.docId);
            if (salon) objectText += ` (${salon.name})`;
            else objectText += ` (${a.docId?.slice(0,8)}...)`;
        } else if (a.collection === 'masters') {
            const master = cache.masters.find(m => m.id === a.docId);
            if (master) objectText += ` (${master.name})`;
            else objectText += ` (${a.docId?.slice(0,8)}...)`;
        } else {
            objectText += ` (${a.docId?.slice(0,8)}...)`;
        }
        const hasUndo = (a.actionType === 'delete' && a.oldData) || (a.actionType === 'update' && a.oldData) || (a.actionType === 'create');
        return `
        <tr>
            <td>${actionTypeMap[a.actionType] || a.actionType}</td>
            <td>${objectText}</td>
            <td>${a.timestamp ? formatDateTime(a.timestamp) : 'Только что'}</td>
            <td>${hasUndo ? `<button class="undo-btn" onclick="undoAction('${a.id}', '${a.collection}', '${a.docId}')">Отмена</button>` : '-'}</td>
        </tr>
        `;
    }).join('');
}

window.undoAction = async function(actionId, collection, docId) {
    if (!confirm('Отменить это действие?')) return;
    try {
        const actionDoc = await db.collection('admin_actions').doc(actionId).get();
        const action = actionDoc.data();
        if (action.actionType === 'delete' && action.oldData) await db.collection(collection).doc(docId).set(action.oldData);
        else if (action.actionType === 'create') await db.collection(collection).doc(docId).delete();
        else if (action.actionType === 'update' && action.oldData) await db.collection(collection).doc(docId).set(action.oldData);
        else { showNotification('Невозможно отменить', true); return; }
        showNotification('Действие отменено!');
        await clearCache(); await refreshAllCache();
        loadAdminHistory();
        if (currentPage === 'admin') renderAdmin();
    } catch(e) { showNotification('Ошибка отмены: ' + e.message, true); }
};

// ==============================================
// CRUD MODALS (салоны, услуги, мастера)
// ==============================================
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }
window.closeModal = closeModal;

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
        const name = document.getElementById('serv-name').value.trim();
        const price = +document.getElementById('serv-price').value;
        const salonId = document.getElementById('serv-salon').value;
        if (!name || !price || !salonId) { showNotification('Заполните все поля', true); return; }
        const salonName = cache.salons.find(s => s.id === salonId)?.name || '';
        const newData = { name, category: document.getElementById('serv-cat').value, price, salonId, salonName, duration: 60, imageUrl: getSafeImageUrl('service', name) };
        try {
            if (id) {
                const old = (await db.collection('services').doc(id).get()).data();
                if (navigator.onLine) await db.collection('services').doc(id).update(newData);
                else queueOperation('services', 'update', id, newData);
                await logAdminAction('update', 'services', id, old, newData);
            } else {
                if (navigator.onLine) await db.collection('services').add(newData);
                else queueOperation('services', 'add', null, newData);
                await logAdminAction('create', 'services', null, null, newData);
            }
            closeModal('service-modal'); await clearCache(); await refreshAllCache(); renderAdmin();
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
                if (navigator.onLine) await db.collection('salons').doc(id).update(data);
                else queueOperation('salons', 'update', id, data);
                await logAdminAction('update', 'salons', id, old, data);
            } else {
                if (navigator.onLine) await db.collection('salons').add(data);
                else queueOperation('salons', 'add', null, data);
                await logAdminAction('create', 'salons', null, null, data);
            }
            closeModal('salon-modal'); await clearCache(); await refreshAllCache(); renderAdmin();
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
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBottom = '5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'master-service';
        checkbox.value = service.id;
        checkbox.checked = selectedServiceIds.includes(service.id);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${service.name} (${service.price}₽)`));
        container.appendChild(label);
    });
}

function openMasterModal(masterId = null) {
    const salons = cache.salons;
    const salonSelect = document.getElementById('mast-salon');
    if (salonSelect) { salonSelect.innerHTML = salons.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join(''); salonSelect.value = ''; }
    salonSelect.onchange = () => { loadMasterServices(salonSelect.value, []); };
    document.getElementById('mast-name').value = '';
    document.getElementById('mast-image').value = '';
    document.getElementById('mast-id').value = '';
    document.getElementById('master-modal-title').textContent = 'Добавить мастера';
    loadMasterServices('', []);
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
    const name = document.getElementById('mast-name').value.trim();
    const salonId = document.getElementById('mast-salon').value;
    const imageUrl = document.getElementById('mast-image').value.trim();
    const masterId = document.getElementById('mast-id').value;
    if (!name || !salonId) { showNotification('Заполните обязательные поля', true); return; }
    const checkboxes = document.querySelectorAll('#master-services-checkboxes input[type="checkbox"]:checked');
    const providedServices = Array.from(checkboxes).map(cb => cb.value);
    let specialization = '';
    if (providedServices.length) {
        const services = await getCached('services');
        specialization = providedServices.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(', ');
    }
    const salon = cache.salons.find(s => s.id === salonId);
    const salonName = salon ? salon.name : '';
    const masterData = { name, salonId, salonName, imageUrl: imageUrl || getSafeImageUrl('master', name), specialization, providedServices, rating: 0, daysOff: [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    try {
        if (masterId) {
            const old = (await db.collection('masters').doc(masterId).get()).data();
            if (navigator.onLine) await db.collection('masters').doc(masterId).update(masterData);
            else queueOperation('masters', 'update', masterId, masterData);
            await logAdminAction('update', 'masters', masterId, old, masterData);
        } else {
            masterData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            if (navigator.onLine) await db.collection('masters').add(masterData);
            else queueOperation('masters', 'add', null, masterData);
            await logAdminAction('create', 'masters', null, null, masterData);
        }
        closeModal('master-modal'); await clearCache(); await refreshAllCache(); renderAdmin();
    } catch (error) { showNotification('Ошибка: ' + error.message, true); }
}

function resetMasterForm() { document.getElementById('mast-name').value = ''; const salonSelect = document.getElementById('mast-salon'); if (salonSelect) salonSelect.value = ''; document.getElementById('mast-image').value = ''; document.getElementById('mast-id').value = ''; document.getElementById('master-modal-title').textContent = 'Добавить мастера'; const container = document.getElementById('master-services-checkboxes'); if (container) container.innerHTML = ''; }
document.getElementById('cancel-mast')?.addEventListener('click', () => { closeModal('master-modal'); resetMasterForm(); });
document.getElementById('cancel-serv')?.addEventListener('click', () => closeModal('service-modal'));
document.getElementById('cancel-sal')?.addEventListener('click', () => closeModal('salon-modal'));

// ==============================================
// СБРОС ДАННЫХ (resetAndReseed) – исправлено
// ==============================================
async function resetAndReseedAllData() {
    if (!confirm('Вы уверены? Все текущие данные будут удалены и заменены тестовыми.')) return;
    isSeeding = true;
    try {
        const collections = ['salons', 'services', 'masters', 'bookings', 'reviews', 'admin_actions', 'users'];
        for (const col of collections) {
            const snapshot = await db.collection(col).get();
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        seedCompleted = false;
        await clearCache();
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
        // 5 салонов
        const salonNames = ["Beauty Studio 'Элегант'", "Spa 'Оазис'", "Barbershop 'Брутал'", "Салон 'Шарм'", "Лаборатория красоты"];
        const addresses = ["ул. Ленина, 45", "ул. Пушкина, 12", "ул. Советская, 23", "пр. Мира, 8", "ул. Гагарина, 15"];
        const salonRefs = [];
        for (let i = 0; i < 5; i++) {
            const ref = await db.collection('salons').add({
                name: salonNames[i],
                address: addresses[i],
                imageUrl: getSafeImageUrl('salon', salonNames[i]),
                rating: 4 + Math.random() * 0.9,
                specializations: []
            });
            salonRefs.push(ref);
        }

        // Услуги
        const categories = ['hair', 'nails', 'cosmetology', 'massage', 'barber'];
        const basePrices = { hair: 1500, nails: 1200, cosmetology: 2500, massage: 2000, barber: 1000 };
        for (let s of salonRefs) {
            for (let cat of categories) {
                await db.collection('services').add({
                    name: `Услуга ${cat}`,
                    category: cat,
                    price: basePrices[cat],
                    duration: cat === 'massage' ? 30 : 60,
                    salonId: s.id,
                    salonName: (await s.get()).data().name,
                    imageUrl: getSafeImageUrl('service', cat)
                });
            }
        }

        // Пользователи – уникальные email
        const createdEmails = new Set();
        async function createUserIfNeeded(email, name, role, password) {
            if (createdEmails.has(email)) return;
            createdEmails.add(email);
            try {
                const userCred = await auth.createUserWithEmailAndPassword(email, password);
                const uid = userCred.user.uid;
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

        await createUserIfNeeded('admin@beauty.ru', 'Администратор', 'admin', 'admin123');
        const masterNames = ["Анна Иванова", "Сергей Кузнецов", "Екатерина Соколова"];
        const masterEmails = ["master1@beauty.ru", "master2@beauty.ru", "master3@beauty.ru"];
        for (let i = 0; i < masterNames.length; i++) await createUserIfNeeded(masterEmails[i], masterNames[i], 'master', 'Master123!');
        const clientNames = ["Анна", "Мария", "Сергей"];
        const clientEmails = ["client1@example.com", "client2@example.com", "client3@example.com"];
        for (let i = 0; i < clientNames.length; i++) await createUserIfNeeded(clientEmails[i], clientNames[i], 'client', 'client123');
        await createUserIfNeeded('client@beauty.ru', 'Тестовый Клиент', 'client', 'client123');

        const users = await getCached('users', true);
        const firstNames = ["Анна","Мария","Сергей","Екатерина","Дмитрий"];
        const lastNames = ["Иванова","Петрова","Смирнов","Соколова","Кузнецов"];
        const mastersBatch = db.batch();
        let masterCounter = 0;
        for (let s of salonRefs) {
            for (let m = 0; m < 2; m++) {
                const firstName = firstNames[masterCounter % firstNames.length];
                const lastName = lastNames[masterCounter % lastNames.length];
                const masterName = `${firstName} ${lastName}`;
                masterCounter++;
                const relatedUser = users.find(u => u.name === firstName && u.role === 'master');
                const userId = relatedUser ? relatedUser.uid : '';
                const services = await getCached('services');
                const salonServices = services.filter(svc => svc.salonId === s.id);
                const numServices = Math.min(salonServices.length, 2 + (m % 3));
                const providedServiceIds = salonServices.slice(0, numServices).map(svc => svc.id);
                const specialization = providedServiceIds.map(id => salonServices.find(svc => svc.id === id)?.name).join(', ');
                mastersBatch.set(db.collection('masters').doc(), {
                    name: masterName, salonId: s.id, salonName: (await s.get()).data().name,
                    specialization, providedServices: providedServiceIds,
                    rating: 4 + Math.random() * 0.9, imageUrl: getSafeImageUrl('master', masterName),
                    daysOff: [], userId: userId || ''
                });
            }
        }
        await mastersBatch.commit();

        // Несколько отзывов и бронирований (коротко)
        const reviewTexts = ["Отлично!", "Хорошо", "Нормально", "Восторг!", "Рекомендую"];
        for (let s of salonRefs) {
            for (let r = 0; r < 2; r++) {
                const author = users[r % users.length];
                await db.collection('reviews').add({
                    salonId: s.id, salonName: (await s.get()).data().name, userId: author?.uid, authorName: author?.name || 'Гость',
                    rating: parseFloat((3 + Math.random() * 2).toFixed(1)),
                    text: reviewTexts[r % reviewTexts.length],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        const mastersList = await getCached('masters');
        const servicesList = await getCached('services');
        const clients = users.filter(u => u.role === 'client');
        for (let i = 0; i < 10; i++) {
            const client = clients[i % clients.length];
            const master = mastersList[i % mastersList.length];
            const service = servicesList.find(s => s.id === master.providedServices?.[0]);
            if (!service || !client) continue;
            const date = new Date(); date.setDate(date.getDate() + (i % 7));
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
        await clearCache(); await refreshAllCache();
        seedCompleted = true;
        console.log("Seed успешно завершён");
    } catch (error) { console.error('Ошибка автозаполнения:', error); }
    finally {
        isSeeding = false;
        updateAuthUI();
        if (currentPage) showPage(currentPage);
    }
}

// ==============================================
// АУТЕНТИФИКАЦИЯ И ИНИЦИАЛИЗАЦИЯ
// ==============================================
function updateAuthUI() {
    const btn = document.getElementById('profile-modal-btn'), logout = document.getElementById('logout-btn');
    if (currentUser) {
        if (btn) btn.innerHTML = `<i class="fas fa-user"></i><span>${currentUser.name || currentUser.email?.split('@')[0] || 'Пользователь'}</span>`;
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
            currentUser = { uid: user.uid, email: user.email, ...(doc.data() || { role: 'client' }) };
            localStorage.setItem('beautyUser', JSON.stringify(currentUser));
        } catch(e) { currentUser = { uid: user.uid, email: user.email, role: 'client' }; }
    } else {
        currentUser = null;
        localStorage.removeItem('beautyUser');
    }
    updateAuthUI();
    if (currentPage) showPage(currentPage, currentPageParams);
});

document.addEventListener('DOMContentLoaded', async () => {
    const savedPage = localStorage.getItem('lastPage');
    const savedParams = localStorage.getItem('lastPageParams');
    if (savedPage && savedPage !== 'undefined') {
        currentPage = savedPage;
        currentPageParams = savedParams ? JSON.parse(savedParams) : {};
    } else {
        currentPage = 'home';
        currentPageParams = {};
    }
    await seedDataIfEmpty();
    showPage(currentPage, currentPageParams);

    document.getElementById('profile-modal-btn')?.addEventListener('click', async () => {
        if (currentUser) showPage('profile');
        else { await loadLoginDropdowns(); openModal('auth-modal'); }
    });
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        try { await auth.signOut(); currentUser = null; localStorage.removeItem('beautyUser'); updateAuthUI(); showPage('home'); }
        catch(e) { showNotification('Ошибка выхода', true); }
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.onclick = () => btn.closest('.modal').classList.remove('active');
    });
    window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.classList.remove('active'); };

    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const lastname = document.getElementById('reg-lastname').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pass = document.getElementById('reg-pass').value;
        const phone = document.getElementById('reg-phone').value.trim();
        if (!name || !email || !pass) { showNotification('Заполните имя, email и пароль', true); return; }
        if (pass.length < 6) { showNotification('Пароль должен быть не менее 6 символов', true); return; }
        try {
            const userCred = await auth.createUserWithEmailAndPassword(email, pass);
            const uid = userCred.user.uid;
            await db.collection('users').doc(uid).set({
                name, lastname, email, phone, role: 'client', points: 0,
                registrationDate: firebase.firestore.FieldValue.serverTimestamp()
            });
            showNotification('Регистрация успешна!');
            closeModal('auth-modal');
        } catch(err) {
            if (err.code === 'auth/email-already-in-use') showNotification('Пользователь с таким email уже существует', true);
            else showNotification('Ошибка: ' + err.message, true);
        }
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await auth.signInWithEmailAndPassword(email, password);
            closeModal('auth-modal');
        } catch(err) {
            document.getElementById('login-error').style.display = 'block';
            document.getElementById('login-error').innerText = 'Неверный email или пароль';
        }
    });

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById('login-form').classList.toggle('active', target === 'login');
            document.getElementById('register-form').classList.toggle('active', target === 'register');
        });
    });
    document.getElementById('switch-to-register')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.auth-tab[data-tab="register"]').click(); });
    document.getElementById('switch-to-login')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.auth-tab[data-tab="login"]').click(); });

    document.getElementById('menuToggle')?.addEventListener('click', () => { document.querySelector('nav').classList.toggle('open'); });
    document.addEventListener('click', (e) => { const nav = document.querySelector('nav'); const toggle = document.getElementById('menuToggle'); if (nav && toggle && !nav.contains(e.target) && !toggle.contains(e.target)) nav.classList.remove('open'); });

    window.addEventListener('beforeunload', () => {
        localStorage.setItem('lastPage', currentPage);
        localStorage.setItem('lastPageParams', JSON.stringify(currentPageParams));
    });

    document.getElementById('applyBookingFilters')?.addEventListener('click', () => loadAllBookingsTable());
    document.getElementById('resetBookingFilters')?.addEventListener('click', () => {
        document.getElementById('bookingSearch').value = '';
        document.getElementById('statusFilter').value = 'all';
        document.getElementById('dateFilter').value = '';
        loadAllBookingsTable();
    });
    document.getElementById('applyReviewFilters')?.addEventListener('click', () => loadAllReviewsTable());
    document.getElementById('resetReviewFilters')?.addEventListener('click', () => {
        document.getElementById('reviewSearch').value = '';
        document.getElementById('reviewRatingFilter').value = 'all';
        loadAllReviewsTable();
    });
    document.getElementById('edit-user-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveUser(); });
    document.getElementById('cancel-edit-user')?.addEventListener('click', () => closeModal('edit-user-modal'));
});

// ==============================================
// МАСТЕР-ПАНЕЛЬ (мини-CRM)
// ==============================================
async function renderMasterCabinet() {
    if (!currentUser || (currentUser.role !== 'master' && currentUser.role !== 'admin')) return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;

    const masterDoc = (await db.collection('masters').where('userId', '==', currentUser.uid).get()).docs[0];
    if (!masterDoc) {
        container.innerHTML = '<p>Профиль мастера не найден. Обратитесь к администратору.</p>';
        return;
    }
    const master = { id: masterDoc.id, ...masterDoc.data() };
    const salonDoc = await db.collection('salons').doc(master.salonId).get();
    const salon = salonDoc.exists ? salonDoc.data() : { name: 'Не указан' };

    // Автоматическая отмена просроченных записей (для мастера)
    let bookings = (await getCached('bookings')).filter(b => b.masterId === master.id);
    for (const b of bookings) {
        if (new Date(b.date) < new Date() && b.status !== 'Выполнена' && b.status !== 'Отменена') {
            await db.collection('bookings').doc(b.id).update({ status: 'Отменена' });
        }
    }
    bookings = (await getCached('bookings')).filter(b => b.masterId === master.id).sort((a,b)=>new Date(b.date)-new Date(a.date));

    container.innerHTML = `
    <h1 class="section-title">Мастер-панель</h1>
    <div style="display:flex; gap:30px; flex-wrap:wrap;">
        <div style="flex:1; background:white; border-radius:20px; padding:25px; box-shadow:var(--shadow);">
            <h3>${escapeHtml(master.name)}</h3>
            <div class="user-detail-row"><strong>Салон:</strong> ${escapeHtml(salon.name)}</div>
            <div class="user-detail-row"><strong>Специализация:</strong> ${escapeHtml(master.specialization||'—')}</div>
            <div class="user-detail-row"><strong>Email:</strong> ${escapeHtml(currentUser.email)}</div>
            <div class="user-detail-row"><strong>Телефон:</strong> ${escapeHtml(currentUser.phone||'—')}</div>
            <div style="margin-top:20px; display:flex; gap:10px;">
                <button class="btn btn-outline btn-sm" id="editMasterProfileBtn">Редактировать профиль</button>
                <button class="btn btn-outline btn-sm" style="color:red; border-color:red;" id="deleteMasterProfileBtn">Удалить профиль</button>
            </div>
        </div>
        <div style="flex:3;">
            <div class="auth-tabs" style="margin-bottom:20px;">
                <button class="auth-tab active" data-tab="bookings">Управление записями</button>
                <button class="auth-tab" data-tab="actions">Мои действия</button>
            </div>
            <div id="masterBookingsTab">
                <div style="max-height:500px; overflow-y:auto;">
                    <table class="history-table">
                        <thead><tr><th>Клиент</th><th>Услуга</th><th>Дата</th><th>Время</th><th>Телефон</th><th>Статус</th><th>Действия</th></tr></thead>
                        <tbody id="masterBookingsTbody"></tbody>
                    </table>
                </div>
            </div>
            <div id="masterActionsTab" style="display:none;">
                <div id="masterActionsList">Загрузка...</div>
            </div>
        </div>
    </div>
    `;

    const tbody = document.getElementById('masterBookingsTbody');
    if (tbody) {
        tbody.innerHTML = bookings.length ? bookings.map(b => {
            const isPast = new Date(b.date) < new Date();
            let statusSelect = `<select onchange="updateBookingStatusMaster('${b.id}', this.value)" style="padding:4px; border-radius:8px;">`;
            statusSelect += `<option value="Новая" ${b.status==='Новая'?'selected':''}>Новая</option>`;
            statusSelect += `<option value="Подтверждена" ${b.status==='Подтверждена'?'selected':''}>Подтверждена</option>`;
            statusSelect += `<option value="Выполнена" ${b.status==='Выполнена'?'selected':''}>Выполнена</option>`;
            statusSelect += `<option value="Отменена" ${b.status==='Отменена'?'selected':''}>Отменена</option>`;
            statusSelect += `</select>`;
            if (isPast && b.status !== 'Выполнена' && b.status !== 'Отменена') {
                statusSelect = `<span class="badge badge-cancelled">Просрочена (автоотмена)</span>`;
            } else if (isPast && b.status === 'Выполнена') {
                statusSelect = `<span class="badge badge-done">Выполнена</span>`;
            }
            return `<tr>
                <td>${escapeHtml(b.clientName||'—')}</td>
                <td>${escapeHtml(b.serviceName||'—')}</td>
                <td>${b.date}</td>
                <td>${b.time}</td>
                <td>${escapeHtml(b.clientPhone||'—')}</td>
                <td><span class="badge badge-${b.status==='Выполнена'?'done':b.status==='Отменена'?'cancelled':'new'}">${b.status}</span></td>
                <td>${statusSelect}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="7">Нет записей</td>';
    }

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
        if (confirm('Удалить профиль мастера и учётную запись? Это действие необратимо.')) {
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
        if (new Date(old.date) < new Date() && old.status !== 'Выполнена' && newStatus !== 'Отменена') {
            showNotification('Нельзя изменить статус прошедшей записи, кроме отмены', true);
            return;
        }
        await bookingRef.update({ status: newStatus });
        await logAdminAction('update', 'bookings', bookingId, old, { ...old, status: newStatus });
        showNotification(`Статус изменён на ${newStatus}`);
        await clearCache(); await refreshAllCache();
        renderMasterCabinet();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

async function loadMasterActions() {
    const container = document.getElementById('masterActionsList');
    if (!container) return;
    const actions = await db.collection('admin_actions').where('adminId', '==', currentUser.uid).orderBy('timestamp', 'desc').limit(50).get();
    if (actions.empty) {
        container.innerHTML = '<p>Нет действий</p>';
        return;
    }
    container.innerHTML = actions.docs.map(d => {
        const a = d.data();
        return `<div style="padding:10px; border-bottom:1px solid #eee;">${formatDateTime(a.timestamp)} – ${a.actionType} ${a.collection} (${a.docId?.slice(0,8)}...)</div>`;
    }).join('');
}

window.openEditMasterProfile = async function(master) {
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
        currentUser.name = name; currentUser.lastname = lastname; currentUser.phone = phone;
        closeModal('edit-profile-modal');
        showNotification('Профиль обновлён');
        renderMasterCabinet();
    };
};

// ==============================================
// КАЛЕНДАРЬ МАСТЕРА (рабочее время)
// ==============================================
async function renderMasterSchedule() {
    if (!currentUser || currentUser.role !== 'master') return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;

    const masterDoc = (await db.collection('masters').where('userId', '==', currentUser.uid).get()).docs[0];
    if (!masterDoc) {
        container.innerHTML = '<p>Профиль мастера не найден</p>';
        return;
    }
    const master = { id: masterDoc.id, ...masterDoc.data() };
    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();

    function renderCalendar() {
        const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
        const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const adjustedFirstDay = firstDay === 0 ? 7 : firstDay;
        let html = `<h2>${monthNames[currentMonth]} ${currentYear}</h2>`;
        html += '<table class="calendar-table"><thead><tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr></thead><tbody><tr>';
        for (let i = 1; i < adjustedFirstDay; i++) html += '<td></td>';
        for (let day = 1; day <= daysInMonth; day++) {
            const date = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isToday = (day === new Date().getDate() && currentMonth === new Date().getMonth() && currentYear === new Date().getFullYear());
            const isDayOff = (master.daysOff || []).includes(date);
            const hasBookings = (cache.bookings || []).some(b => b.masterId === master.id && b.date === date && b.status !== 'Отменена');
            let classes = '';
            if (isToday) classes += ' today';
            if (isDayOff) classes += ' day-off';
            else if (hasBookings) classes += ' has-bookings';
            html += `<td class="${classes}" data-date="${date}">${day}</td>`;
            if ((day + adjustedFirstDay - 1) % 7 === 0) html += '</tr><tr>';
        }
        html += '</tr></tbody></table>';
        return html;
    }

    async function loadBookingsForDate(date) {
        const bookings = (await getCached('bookings')).filter(b => b.masterId === master.id && b.date === date && b.status !== 'Отменена');
        const listDiv = document.getElementById('bookings-on-date');
        if (!bookings.length) {
            listDiv.innerHTML = '<p>Нет записей</p>';
        } else {
            listDiv.innerHTML = bookings.map(b => `
                <div style="border:1px solid #ddd; padding:10px; margin:8px 0; border-radius:8px;">
                    <strong>${b.time}</strong> — ${escapeHtml(b.serviceName)}<br>
                    Клиент: ${escapeHtml(b.clientName)} | Тел.: ${escapeHtml(b.clientPhone)}
                    <span class="badge badge-${b.status==='Выполнена'?'done':b.status==='Отменена'?'cancelled':'new'}">${b.status}</span>
                </div>
            `).join('');
        }
    }

    container.innerHTML = `
        <h1 class="section-title">Моё рабочее время</h1>
        <div style="display: flex; gap: 30px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 280px;">
                <div class="calendar-controls">
                    <button class="btn btn-outline btn-sm" id="prevMonth"><i class="fas fa-chevron-left"></i></button>
                    <span id="currentMonthLabel"></span>
                    <button class="btn btn-outline btn-sm" id="nextMonth"><i class="fas fa-chevron-right"></i></button>
                </div>
                <div id="calendarContainer"></div>
            </div>
            <div style="flex: 1; min-width: 280px;">
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
            td.onclick = async () => {
                const date = td.dataset.date;
                document.getElementById('selectedDateLabel').textContent = date;
                await loadBookingsForDate(date);
            };
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
        await clearCache(); await refreshAllCache();
        updateCalendar();
        showNotification('Выходной добавлен');
    };
}

// ==============================================
// АДМИН-ПАНЕЛЬ (полная)
// ==============================================
async function renderAdmin() {
    if (!currentUser || currentUser.role !== 'admin') return showPage('home');
    const container = document.querySelector('#main-content .container');
    if (!container) return;
    container.innerHTML = `
    <h1 class="section-title">Админ-панель</h1>
    <div style="margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap;">
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
        <div style="margin-bottom:15px; display:flex; gap:10px; flex-wrap:wrap;">
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
            <table class="history-table">
                <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Телефон</th><th>Дата регистрации</th><th>Действия</th></tr></thead>
                <tbody id="usersTableBody"></tbody>
            </table>
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
            <button id="applyBookingFilters" class="btn btn-primary">Применить</button>
            <button id="resetBookingFilters" class="btn btn-secondary">Сбросить</button>
        </div>
        <div style="overflow-x:auto;">
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
        <div style="overflow-x:auto;">
            <table class="history-table">
                <thead><tr><th>Салон</th><th>Автор</th><th>Рейтинг</th><th>Текст отзыва</th><th>Дата</th><th>Действия</th></tr></thead>
                <tbody id="reviewsTableBody"></tbody>
            </table>
        </div>
    </div>
    <div id="admin-history-view" style="display:none">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap;">
            <h2 class="section-title" style="margin:0">История изменений</h2>
            <button class="btn btn-outline" id="clearHistoryBtn" style="color:red; border-color:red;">Очистить историю</button>
        </div>
        <div style="overflow-x:auto;">
            <table class="history-table">
                <thead><tr><th>Действие</th><th>Объект</th><th>Время</th><th>Отмена</th></tr></thead>
                <tbody id="historyTableBody"></tbody>
            </table>
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
    document.getElementById('applyRoleFilter').onclick = () => loadUsersTable();
    document.getElementById('clearHistoryBtn').onclick = async () => {
        if (confirm('Удалить всю историю действий?')) {
            const snap = await db.collection('admin_actions').get();
            const batch = db.batch();
            snap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showNotification('История очищена');
            loadAdminHistory();
        }
    };
    document.getElementById('editSettingsBtn').onclick = async () => {
        const snap = await db.collection('settings').doc('main_page').get();
        const data = snap.exists ? snap.data() : {};
        document.getElementById('set-hero-title').value = data.heroTitle || '';
        document.getElementById('set-hero-subtitle').value = data.heroSubtitle || '';
        document.getElementById('set-hero-image').value = data.heroImage || '';
        openModal('site-settings-modal');
    };
    document.getElementById('site-settings-form').onsubmit = async (e) => {
        e.preventDefault();
        await db.collection('settings').doc('main_page').set({
            heroTitle: document.getElementById('set-hero-title').value,
            heroSubtitle: document.getElementById('set-hero-subtitle').value,
            heroImage: document.getElementById('set-hero-image').value
        });
        closeModal('site-settings-modal');
        showNotification('Настройки сохранены');
        if (currentPage === 'home') renderHome();
    };

    await loadAdminDataCards();
    document.getElementById('addServBtn').onclick = () => openServiceModal();
    document.getElementById('addSalonBtn').onclick = () => openSalonModal();
    document.getElementById('addMasterBtn').onclick = () => openMasterModal();
}

async function loadAdminDataCards() {
    const services = await getCached('services');
    const salons = await getCached('salons');
    const masters = await getCached('masters');
    const salonMap = Object.fromEntries(salons.map(s => [s.id, s.name]));

    const svcDiv = document.getElementById('adminServices');
    if (svcDiv) {
        if (!services.length) svcDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет услуг. Добавьте первую.</p>';
        else {
            svcDiv.innerHTML = services.map(s => `
                <div class="card">
                    <img src="${s.imageUrl || getSafeImageUrl('service', s.name)}" class="card-img" onerror="this.src='${getSafeImageUrl('service', 'fallback')}'">
                    <div class="card-content">
                        <h3>${escapeHtml(s.name)}</h3>
                        <p>${escapeHtml(salonMap[s.salonId] || 'Не указан')} • ${s.price} ₽</p>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-outline btn-sm edit-serv" data-id="${s.id}">Ред.</button>
                            <button class="btn btn-outline btn-sm del-serv" data-id="${s.id}" style="color:red;border-color:red">Удалить</button>
                        </div>
                    </div>
                </div>
            `).join('');
            svcDiv.querySelectorAll('.edit-serv').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openServiceModal(btn.dataset.id); });
            svcDiv.querySelectorAll('.del-serv').forEach(btn => btn.onclick = async () => {
                if (confirm('Удалить услугу?')) {
                    const id = btn.dataset.id;
                    const old = services.find(x => x.id === id);
                    await db.collection('services').doc(id).delete();
                    const mastersWith = await db.collection('masters').where('providedServices', 'array-contains', id).get();
                    const batch = db.batch();
                    mastersWith.forEach(d => batch.update(d.ref, { providedServices: firebase.firestore.FieldValue.arrayRemove(id) }));
                    await batch.commit();
                    await logAdminAction('delete', 'services', id, old, null);
                    await clearCache(); await refreshAllCache();
                    renderAdmin();
                }
            });
        }
    }

    const salDiv = document.getElementById('adminSalons');
    if (salDiv) {
        if (!salons.length) salDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет салонов. Добавьте первый.</p>';
        else {
            salDiv.innerHTML = salons.map(s => `
                <div class="card">
                    <img src="${s.imageUrl || getSafeImageUrl('salon', s.name)}" class="card-img" onerror="this.src='${getSafeImageUrl('salon', 'fallback')}'">
                    <div class="card-content">
                        <h3>${escapeHtml(s.name)}</h3>
                        <p>${escapeHtml(s.address || '')}</p>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-outline btn-sm edit-sal" data-id="${s.id}">Ред.</button>
                            <button class="btn btn-outline btn-sm del-sal" data-id="${s.id}" style="color:red;border-color:red">Удалить</button>
                        </div>
                    </div>
                </div>
            `).join('');
            salDiv.querySelectorAll('.edit-sal').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openSalonModal(btn.dataset.id); });
            salDiv.querySelectorAll('.del-sal').forEach(btn => btn.onclick = async () => {
                if (confirm('Удалить салон и всё связанное?')) {
                    const id = btn.dataset.id;
                    const old = salons.find(x => x.id === id);
                    const batch = db.batch();
                    const servicesSnap = await db.collection('services').where('salonId', '==', id).get();
                    servicesSnap.forEach(d => batch.delete(d.ref));
                    const mastersSnap = await db.collection('masters').where('salonId', '==', id).get();
                    mastersSnap.forEach(d => batch.delete(d.ref));
                    const bookingsSnap = await db.collection('bookings').where('salonId', '==', id).get();
                    bookingsSnap.forEach(d => batch.delete(d.ref));
                    const reviewsSnap = await db.collection('reviews').where('salonId', '==', id).get();
                    reviewsSnap.forEach(d => batch.delete(d.ref));
                    batch.delete(db.collection('salons').doc(id));
                    await batch.commit();
                    await logAdminAction('delete', 'salons', id, old, null);
                    await clearCache(); await refreshAllCache();
                    renderAdmin();
                }
            });
        }
    }

    const mstDiv = document.getElementById('adminMasters');
    if (mstDiv) {
        if (!masters.length) mstDiv.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Нет мастеров. Добавьте первого.</p>';
        else {
            mstDiv.innerHTML = masters.map(m => `
                <div class="card">
                    <img src="${m.imageUrl || getSafeImageUrl('master', m.name)}" class="card-img" onerror="this.src='${getSafeImageUrl('master', 'fallback')}'">
                    <div class="card-content">
                        <h3>${escapeHtml(m.name)}</h3>
                        <p>${escapeHtml(m.specialization || '')} • ${escapeHtml(salonMap[m.salonId] || '')}</p>
                        <div style="display:flex; gap:5px; margin-top:10px;">
                            <button class="btn btn-outline btn-sm edit-mast" data-id="${m.id}">Ред.</button>
                            <button class="btn btn-outline btn-sm del-mast" data-id="${m.id}" style="color:red;border-color:red">Удалить</button>
                        </div>
                    </div>
                </div>
            `).join('');
            mstDiv.querySelectorAll('.edit-mast').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); openMasterModal(btn.dataset.id); });
            mstDiv.querySelectorAll('.del-mast').forEach(btn => btn.onclick = async () => {
                if (confirm('Удалить мастера?')) {
                    const id = btn.dataset.id;
                    const old = masters.find(x => x.id === id);
                    await db.collection('masters').doc(id).delete();
                    await logAdminAction('delete', 'masters', id, old, null);
                    await clearCache(); await refreshAllCache();
                    renderAdmin();
                }
            });
        }
    }
}

// ==============================================
// ТАБЛИЦЫ В АДМИНКЕ (записи, отзывы, пользователи)
// ==============================================
async function loadAllBookingsTable() {
    const tbody = document.getElementById('bookingsTableBody');
    if (!tbody) return;
    const search = document.getElementById('bookingSearch')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const dateFilter = document.getElementById('dateFilter')?.value || '';
    let bookings = await getCached('bookings', true);
    bookings = bookings.sort((a,b) => new Date(b.bookingDate?.seconds*1000) - new Date(a.bookingDate?.seconds*1000));
    if (search) bookings = bookings.filter(b => (b.clientName || '').toLowerCase().includes(search) || (b.serviceName || '').toLowerCase().includes(search) || (b.masterName || '').toLowerCase().includes(search));
    if (statusFilter !== 'all') bookings = bookings.filter(b => b.status === statusFilter);
    if (dateFilter) bookings = bookings.filter(b => b.date === dateFilter);
    if (!bookings.length) { tbody.innerHTML = '<tr><td colspan="9">Нет записей</td></tr>'; return; }
    tbody.innerHTML = bookings.map(b => {
        const isPast = new Date(b.date) < new Date();
        let statusSelect = `<select onchange="updateBookingStatusAdmin('${b.id}', this.value)" style="padding:4px; border-radius:8px;">
            <option value="Новая" ${b.status === 'Новая' ? 'selected' : ''}>Новая</option>
            <option value="Подтверждена" ${b.status === 'Подтверждена' ? 'selected' : ''}>Подтверждена</option>
            <option value="Выполнена" ${b.status === 'Выполнена' ? 'selected' : ''}>Выполнена</option>
            <option value="Отменена" ${b.status === 'Отменена' ? 'selected' : ''}>Отменена</option>
        </select>`;
        if (isPast && b.status !== 'Выполнена' && b.status !== 'Отменена') {
            statusSelect = `<span class="badge badge-cancelled">Просрочена</span>`;
        }
        return `
        <tr>
            <td>${b.date || ''} ${b.time || ''}</td>
            <td>${escapeHtml(b.clientName || '—')}</td>
            <td>${escapeHtml(b.serviceName || '—')}</td>
            <td>${escapeHtml(b.masterName || '—')}</td>
            <td>${escapeHtml(b.salonName || '—')}</td>
            <td>${b.totalPrice || 0} ₽</td>
            <td><span class="badge badge-${b.status === 'Выполнена' ? 'done' : b.status === 'Отменена' ? 'cancelled' : 'new'}">${b.status}</span></td>
            <td>${statusSelect}</td>
            <td><button class="btn btn-sm btn-outline" onclick="showBookingHistory('${b.id}')">История</button></td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteBookingAdmin('${b.id}')">Удалить</button></td>
        </tr>
    `}).join('');
}

window.updateBookingStatusAdmin = async (bookingId, newStatus) => {
    try {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const old = (await bookingRef.get()).data();
        if (new Date(old.date) < new Date() && old.status !== 'Выполнена' && newStatus !== 'Отменена') {
            showNotification('Нельзя изменить статус прошедшей записи, кроме отмены', true);
            return;
        }
        await bookingRef.update({ status: newStatus });
        await logAdminAction('update', 'bookings', bookingId, old, { ...old, status: newStatus });
        showNotification(`Статус изменён на ${newStatus}`);
        await clearCache(); await refreshAllCache();
        loadAllBookingsTable();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

window.deleteBookingAdmin = async (bookingId) => {
    if (!confirm('Удалить эту запись?')) return;
    try {
        const old = (await db.collection('bookings').doc(bookingId).get()).data();
        await db.collection('bookings').doc(bookingId).delete();
        await logAdminAction('delete', 'bookings', bookingId, old, null);
        showNotification('Запись удалена');
        await clearCache(); await refreshAllCache();
        loadAllBookingsTable();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

window.showBookingHistory = async (bookingId) => {
    const actions = await db.collection('admin_actions').where('docId', '==', bookingId).where('collection', '==', 'bookings').orderBy('timestamp', 'desc').get();
    if (actions.empty) { alert('История изменений не найдена.'); return; }
    let msg = `История изменений записи ${bookingId}:\n`;
    actions.forEach(doc => {
        const a = doc.data();
        msg += `${formatDateTime(a.timestamp)} — ${a.actionType}: ${a.oldData ? 'было: '+JSON.stringify(a.oldData) : ''} ${a.newData ? 'стало: '+JSON.stringify(a.newData) : ''}\n`;
    });
    alert(msg);
};

async function loadAllReviewsTable() {
    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;
    const search = document.getElementById('reviewSearch')?.value.toLowerCase() || '';
    const ratingFilter = document.getElementById('reviewRatingFilter')?.value || 'all';
    let reviews = await getCached('reviews', true);
    reviews = reviews.sort((a,b) => new Date(b.createdAt?.seconds*1000) - new Date(a.createdAt?.seconds*1000));
    if (search) reviews = reviews.filter(r => (r.salonName || '').toLowerCase().includes(search) || (r.authorName || '').toLowerCase().includes(search) || (r.text || '').toLowerCase().includes(search));
    if (ratingFilter !== 'all') { const minRating = parseInt(ratingFilter); reviews = reviews.filter(r => r.rating >= minRating); }
    if (!reviews.length) { tbody.innerHTML = '<tr><td colspan="6">Нет отзывов</td></tr>'; return; }
    tbody.innerHTML = reviews.map(r => `
        <tr>
            <td>${escapeHtml(r.salonName || '—')}</td>
            <td>${escapeHtml(r.authorName || '—')}</td>
            <td>${'★'.repeat(Math.floor(r.rating))}${'☆'.repeat(5-Math.floor(r.rating))} (${r.rating})</td>
            <td>${escapeHtml(r.text || '')}</td>
            <td>${formatDate(r.createdAt)}</td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteReviewAdmin('${r.id}')">Удалить</button></td>
        </tr>
    `).join('');
}

window.deleteReviewAdmin = async (reviewId) => {
    if (!confirm('Удалить этот отзыв? Это также обновит рейтинг салона.')) return;
    try {
        const reviewDoc = await db.collection('reviews').doc(reviewId).get();
        const review = reviewDoc.data();
        const salonId = review.salonId;
        await db.collection('reviews').doc(reviewId).delete();
        await logAdminAction('delete', 'reviews', reviewId, review, null);
        const reviewsSnap = await db.collection('reviews').where('salonId', '==', salonId).get();
        let total = 0;
        reviewsSnap.forEach(doc => total += doc.data().rating);
        const avg = reviewsSnap.size ? total / reviewsSnap.size : 0;
        await db.collection('salons').doc(salonId).update({ rating: parseFloat(avg.toFixed(1)), reviewCount: reviewsSnap.size });
        showNotification('Отзыв удалён');
        await clearCache(); await refreshAllCache();
        loadAllReviewsTable();
    } catch(e) { showNotification('Ошибка: '+e.message, true); }
};

async function loadUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    let users = await getCached('users', true);
    const roleFilter = document.getElementById('roleFilter')?.value || 'all';
    if (roleFilter !== 'all') users = users.filter(u => u.role === roleFilter);
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="6">Пользователи не найдены</td></tr>'; return; }
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
        if (!password || password.length < 6) { showNotification('Пароль (мин. 6 символов) обязателен для нового пользователя', true); return; }
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
            await clearCache(); await refreshAllCache();
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
            await clearCache(); await refreshAllCache();
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
        await clearCache(); await refreshAllCache();
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
    const actionTypeMap = { create: 'Добавление', update: 'Редактирование', delete: 'Удаление' };
    const collectionMap = { users: 'Пользователь', masters: 'Мастер', services: 'Услуга', salons: 'Салон', bookings: 'Бронирование', reviews: 'Отзыв' };
    tbody.innerHTML = actions.map(a => {
        let objectText = collectionMap[a.collection] || a.collection;
        if (a.collection === 'salons') {
            const salon = cache.salons.find(s => s.id === a.docId);
            if (salon) objectText += ` (${salon.name})`;
            else objectText += ` (${a.docId?.slice(0,8)}...)`;
        } else if (a.collection === 'masters') {
            const master = cache.masters.find(m => m.id === a.docId);
            if (master) objectText += ` (${master.name})`;
            else objectText += ` (${a.docId?.slice(0,8)}...)`;
        } else {
            objectText += ` (${a.docId?.slice(0,8)}...)`;
        }
        const hasUndo = (a.actionType === 'delete' && a.oldData) || (a.actionType === 'update' && a.oldData) || (a.actionType === 'create');
        return `
        <tr>
            <td>${actionTypeMap[a.actionType] || a.actionType}</td>
            <td>${objectText}</td>
            <td>${a.timestamp ? formatDateTime(a.timestamp) : 'Только что'}</td>
            <td>${hasUndo ? `<button class="undo-btn" onclick="undoAction('${a.id}', '${a.collection}', '${a.docId}')">Отмена</button>` : '-'}</td>
        </tr>
        `;
    }).join('');
}

window.undoAction = async function(actionId, collection, docId) {
    if (!confirm('Отменить это действие?')) return;
    try {
        const actionDoc = await db.collection('admin_actions').doc(actionId).get();
        const action = actionDoc.data();
        if (action.actionType === 'delete' && action.oldData) await db.collection(collection).doc(docId).set(action.oldData);
        else if (action.actionType === 'create') await db.collection(collection).doc(docId).delete();
        else if (action.actionType === 'update' && action.oldData) await db.collection(collection).doc(docId).set(action.oldData);
        else { showNotification('Невозможно отменить', true); return; }
        showNotification('Действие отменено!');
        await clearCache(); await refreshAllCache();
        loadAdminHistory();
        if (currentPage === 'admin') renderAdmin();
    } catch(e) { showNotification('Ошибка отмены: ' + e.message, true); }
};

// ==============================================
// CRUD MODALS (салоны, услуги, мастера)
// ==============================================
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }
window.closeModal = closeModal;

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
        const name = document.getElementById('serv-name').value.trim();
        const price = +document.getElementById('serv-price').value;
        const salonId = document.getElementById('serv-salon').value;
        if (!name || !price || !salonId) { showNotification('Заполните все поля', true); return; }
        const salonName = cache.salons.find(s => s.id === salonId)?.name || '';
        const newData = { name, category: document.getElementById('serv-cat').value, price, salonId, salonName, duration: 60, imageUrl: getSafeImageUrl('service', name) };
        try {
            if (id) {
                const old = (await db.collection('services').doc(id).get()).data();
                if (navigator.onLine) await db.collection('services').doc(id).update(newData);
                else queueOperation('services', 'update', id, newData);
                await logAdminAction('update', 'services', id, old, newData);
            } else {
                if (navigator.onLine) await db.collection('services').add(newData);
                else queueOperation('services', 'add', null, newData);
                await logAdminAction('create', 'services', null, null, newData);
            }
            closeModal('service-modal'); await clearCache(); await refreshAllCache(); renderAdmin();
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
                if (navigator.onLine) await db.collection('salons').doc(id).update(data);
                else queueOperation('salons', 'update', id, data);
                await logAdminAction('update', 'salons', id, old, data);
            } else {
                if (navigator.onLine) await db.collection('salons').add(data);
                else queueOperation('salons', 'add', null, data);
                await logAdminAction('create', 'salons', null, null, data);
            }
            closeModal('salon-modal'); await clearCache(); await refreshAllCache(); renderAdmin();
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
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBottom = '5px';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'master-service';
        checkbox.value = service.id;
        checkbox.checked = selectedServiceIds.includes(service.id);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${service.name} (${service.price}₽)`));
        container.appendChild(label);
    });
}

function openMasterModal(masterId = null) {
    const salons = cache.salons;
    const salonSelect = document.getElementById('mast-salon');
    if (salonSelect) { salonSelect.innerHTML = salons.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join(''); salonSelect.value = ''; }
    salonSelect.onchange = () => { loadMasterServices(salonSelect.value, []); };
    document.getElementById('mast-name').value = '';
    document.getElementById('mast-image').value = '';
    document.getElementById('mast-id').value = '';
    document.getElementById('master-modal-title').textContent = 'Добавить мастера';
    loadMasterServices('', []);
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
    const name = document.getElementById('mast-name').value.trim();
    const salonId = document.getElementById('mast-salon').value;
    const imageUrl = document.getElementById('mast-image').value.trim();
    const masterId = document.getElementById('mast-id').value;
    if (!name || !salonId) { showNotification('Заполните обязательные поля', true); return; }
    const checkboxes = document.querySelectorAll('#master-services-checkboxes input[type="checkbox"]:checked');
    const providedServices = Array.from(checkboxes).map(cb => cb.value);
    let specialization = '';
    if (providedServices.length) {
        const services = await getCached('services');
        specialization = providedServices.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(', ');
    }
    const salon = cache.salons.find(s => s.id === salonId);
    const salonName = salon ? salon.name : '';
    const masterData = { name, salonId, salonName, imageUrl: imageUrl || getSafeImageUrl('master', name), specialization, providedServices, rating: 0, daysOff: [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    try {
        if (masterId) {
            const old = (await db.collection('masters').doc(masterId).get()).data();
            if (navigator.onLine) await db.collection('masters').doc(masterId).update(masterData);
            else queueOperation('masters', 'update', masterId, masterData);
            await logAdminAction('update', 'masters', masterId, old, masterData);
        } else {
            masterData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            if (navigator.onLine) await db.collection('masters').add(masterData);
            else queueOperation('masters', 'add', null, masterData);
            await logAdminAction('create', 'masters', null, null, masterData);
        }
        closeModal('master-modal'); await clearCache(); await refreshAllCache(); renderAdmin();
    } catch (error) { showNotification('Ошибка: ' + error.message, true); }
}

function resetMasterForm() { document.getElementById('mast-name').value = ''; const salonSelect = document.getElementById('mast-salon'); if (salonSelect) salonSelect.value = ''; document.getElementById('mast-image').value = ''; document.getElementById('mast-id').value = ''; document.getElementById('master-modal-title').textContent = 'Добавить мастера'; const container = document.getElementById('master-services-checkboxes'); if (container) container.innerHTML = ''; }
document.getElementById('cancel-mast')?.addEventListener('click', () => { closeModal('master-modal'); resetMasterForm(); });
document.getElementById('cancel-serv')?.addEventListener('click', () => closeModal('service-modal'));
document.getElementById('cancel-sal')?.addEventListener('click', () => closeModal('salon-modal'));

// ==============================================
// СБРОС ДАННЫХ (resetAndReseed) – исправлено
// ==============================================
async function resetAndReseedAllData() {
    if (!confirm('Вы уверены? Все текущие данные будут удалены и заменены тестовыми.')) return;
    isSeeding = true;
    try {
        const collections = ['salons', 'services', 'masters', 'bookings', 'reviews', 'admin_actions', 'users'];
        for (const col of collections) {
            const snapshot = await db.collection(col).get();
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        seedCompleted = false;
        await clearCache();
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
        // 5 салонов
        const salonNames = ["Beauty Studio 'Элегант'", "Spa 'Оазис'", "Barbershop 'Брутал'", "Салон 'Шарм'", "Лаборатория красоты"];
        const addresses = ["ул. Ленина, 45", "ул. Пушкина, 12", "ул. Советская, 23", "пр. Мира, 8", "ул. Гагарина, 15"];
        const salonRefs = [];
        for (let i = 0; i < 5; i++) {
            const ref = await db.collection('salons').add({
                name: salonNames[i],
                address: addresses[i],
                imageUrl: getSafeImageUrl('salon', salonNames[i]),
                rating: 4 + Math.random() * 0.9,
                specializations: []
            });
            salonRefs.push(ref);
        }

        // Услуги
        const categories = ['hair', 'nails', 'cosmetology', 'massage', 'barber'];
        const basePrices = { hair: 1500, nails: 1200, cosmetology: 2500, massage: 2000, barber: 1000 };
        for (let s of salonRefs) {
            for (let cat of categories) {
                await db.collection('services').add({
                    name: `Услуга ${cat}`,
                    category: cat,
                    price: basePrices[cat],
                    duration: cat === 'massage' ? 30 : 60,
                    salonId: s.id,
                    salonName: (await s.get()).data().name,
                    imageUrl: getSafeImageUrl('service', cat)
                });
            }
        }

        // Пользователи – уникальные email
        const createdEmails = new Set();
        async function createUserIfNeeded(email, name, role, password) {
            if (createdEmails.has(email)) return;
            createdEmails.add(email);
            try {
                const userCred = await auth.createUserWithEmailAndPassword(email, password);
                const uid = userCred.user.uid;
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

        await createUserIfNeeded('admin@beauty.ru', 'Администратор', 'admin', 'admin123');
        const masterNames = ["Анна Иванова", "Сергей Кузнецов", "Екатерина Соколова"];
        const masterEmails = ["master1@beauty.ru", "master2@beauty.ru", "master3@beauty.ru"];
        for (let i = 0; i < masterNames.length; i++) await createUserIfNeeded(masterEmails[i], masterNames[i], 'master', 'Master123!');
        const clientNames = ["Анна", "Мария", "Сергей"];
        const clientEmails = ["client1@example.com", "client2@example.com", "client3@example.com"];
        for (let i = 0; i < clientNames.length; i++) await createUserIfNeeded(clientEmails[i], clientNames[i], 'client', 'client123');
        await createUserIfNeeded('client@beauty.ru', 'Тестовый Клиент', 'client', 'client123');

        const users = await getCached('users', true);
        const firstNames = ["Анна","Мария","Сергей","Екатерина","Дмитрий"];
        const lastNames = ["Иванова","Петрова","Смирнов","Соколова","Кузнецов"];
        const mastersBatch = db.batch();
        let masterCounter = 0;
        for (let s of salonRefs) {
            for (let m = 0; m < 2; m++) {
                const firstName = firstNames[masterCounter % firstNames.length];
                const lastName = lastNames[masterCounter % lastNames.length];
                const masterName = `${firstName} ${lastName}`;
                masterCounter++;
                const relatedUser = users.find(u => u.name === firstName && u.role === 'master');
                const userId = relatedUser ? relatedUser.uid : '';
                const services = await getCached('services');
                const salonServices = services.filter(svc => svc.salonId === s.id);
                const numServices = Math.min(salonServices.length, 2 + (m % 3));
                const providedServiceIds = salonServices.slice(0, numServices).map(svc => svc.id);
                const specialization = providedServiceIds.map(id => salonServices.find(svc => svc.id === id)?.name).join(', ');
                mastersBatch.set(db.collection('masters').doc(), {
                    name: masterName, salonId: s.id, salonName: (await s.get()).data().name,
                    specialization, providedServices: providedServiceIds,
                    rating: 4 + Math.random() * 0.9, imageUrl: getSafeImageUrl('master', masterName),
                    daysOff: [], userId: userId || ''
                });
            }
        }
        await mastersBatch.commit();

        // Несколько отзывов и бронирований (коротко)
        const reviewTexts = ["Отлично!", "Хорошо", "Нормально", "Восторг!", "Рекомендую"];
        for (let s of salonRefs) {
            for (let r = 0; r < 2; r++) {
                const author = users[r % users.length];
                await db.collection('reviews').add({
                    salonId: s.id, salonName: (await s.get()).data().name, userId: author?.uid, authorName: author?.name || 'Гость',
                    rating: parseFloat((3 + Math.random() * 2).toFixed(1)),
                    text: reviewTexts[r % reviewTexts.length],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        const mastersList = await getCached('masters');
        const servicesList = await getCached('services');
        const clients = users.filter(u => u.role === 'client');
        for (let i = 0; i < 10; i++) {
            const client = clients[i % clients.length];
            const master = mastersList[i % mastersList.length];
            const service = servicesList.find(s => s.id === master.providedServices?.[0]);
            if (!service || !client) continue;
            const date = new Date(); date.setDate(date.getDate() + (i % 7));
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
        await clearCache(); await refreshAllCache();
        seedCompleted = true;
        console.log("Seed успешно завершён");
    } catch (error) { console.error('Ошибка автозаполнения:', error); }
    finally {
        isSeeding = false;
        updateAuthUI();
        if (currentPage) showPage(currentPage);
    }
}

// ==============================================
// АУТЕНТИФИКАЦИЯ И ИНИЦИАЛИЗАЦИЯ
// ==============================================
function updateAuthUI() {
    const btn = document.getElementById('profile-modal-btn'), logout = document.getElementById('logout-btn');
    if (currentUser) {
        if (btn) btn.innerHTML = `<i class="fas fa-user"></i><span>${currentUser.name || currentUser.email?.split('@')[0] || 'Пользователь'}</span>`;
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
            currentUser = { uid: user.uid, email: user.email, ...(doc.data() || { role: 'client' }) };
            localStorage.setItem('beautyUser', JSON.stringify(currentUser));
        } catch(e) { currentUser = { uid: user.uid, email: user.email, role: 'client' }; }
    } else {
        currentUser = null;
        localStorage.removeItem('beautyUser');
    }
    updateAuthUI();
    if (currentPage) showPage(currentPage, currentPageParams);
});

document.addEventListener('DOMContentLoaded', async () => {
    const savedPage = localStorage.getItem('lastPage');
    const savedParams = localStorage.getItem('lastPageParams');
    if (savedPage && savedPage !== 'undefined') {
        currentPage = savedPage;
        currentPageParams = savedParams ? JSON.parse(savedParams) : {};
    } else {
        currentPage = 'home';
        currentPageParams = {};
    }
    await seedDataIfEmpty();
    showPage(currentPage, currentPageParams);

    document.getElementById('profile-modal-btn')?.addEventListener('click', async () => {
        if (currentUser) showPage('profile');
        else { await loadLoginDropdowns(); openModal('auth-modal'); }
    });
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        try { await auth.signOut(); currentUser = null; localStorage.removeItem('beautyUser'); updateAuthUI(); showPage('home'); }
        catch(e) { showNotification('Ошибка выхода', true); }
    });
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.onclick = () => btn.closest('.modal').classList.remove('active');
    });
    window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.classList.remove('active'); };

    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const lastname = document.getElementById('reg-lastname').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pass = document.getElementById('reg-pass').value;
        const phone = document.getElementById('reg-phone').value.trim();
        if (!name || !email || !pass) { showNotification('Заполните имя, email и пароль', true); return; }
        if (pass.length < 6) { showNotification('Пароль должен быть не менее 6 символов', true); return; }
        try {
            const userCred = await auth.createUserWithEmailAndPassword(email, pass);
            const uid = userCred.user.uid;
            await db.collection('users').doc(uid).set({
                name, lastname, email, phone, role: 'client', points: 0,
                registrationDate: firebase.firestore.FieldValue.serverTimestamp()
            });
            showNotification('Регистрация успешна!');
            closeModal('auth-modal');
        } catch(err) {
            if (err.code === 'auth/email-already-in-use') showNotification('Пользователь с таким email уже существует', true);
            else showNotification('Ошибка: ' + err.message, true);
        }
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await auth.signInWithEmailAndPassword(email, password);
            closeModal('auth-modal');
        } catch(err) {
            document.getElementById('login-error').style.display = 'block';
            document.getElementById('login-error').innerText = 'Неверный email или пароль';
        }
    });

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            document.getElementById('login-form').classList.toggle('active', target === 'login');
            document.getElementById('register-form').classList.toggle('active', target === 'register');
        });
    });
    document.getElementById('switch-to-register')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.auth-tab[data-tab="register"]').click(); });
    document.getElementById('switch-to-login')?.addEventListener('click', (e) => { e.preventDefault(); document.querySelector('.auth-tab[data-tab="login"]').click(); });

    document.getElementById('menuToggle')?.addEventListener('click', () => { document.querySelector('nav').classList.toggle('open'); });
    document.addEventListener('click', (e) => { const nav = document.querySelector('nav'); const toggle = document.getElementById('menuToggle'); if (nav && toggle && !nav.contains(e.target) && !toggle.contains(e.target)) nav.classList.remove('open'); });

    window.addEventListener('beforeunload', () => {
        localStorage.setItem('lastPage', currentPage);
        localStorage.setItem('lastPageParams', JSON.stringify(currentPageParams));
    });

    document.getElementById('applyBookingFilters')?.addEventListener('click', () => loadAllBookingsTable());
    document.getElementById('resetBookingFilters')?.addEventListener('click', () => {
        document.getElementById('bookingSearch').value = '';
        document.getElementById('statusFilter').value = 'all';
        document.getElementById('dateFilter').value = '';
        loadAllBookingsTable();
    });
    document.getElementById('applyReviewFilters')?.addEventListener('click', () => loadAllReviewsTable());
    document.getElementById('resetReviewFilters')?.addEventListener('click', () => {
        document.getElementById('reviewSearch').value = '';
        document.getElementById('reviewRatingFilter').value = 'all';
        loadAllReviewsTable();
    });
    document.getElementById('edit-user-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveUser(); });
    document.getElementById('cancel-edit-user')?.addEventListener('click', () => closeModal('edit-user-modal'));
});