const TOKEN_KEY = 'hailin-admin-token';

const bookingStatuses = [
  ['all', '全部'],
  ['new', '待确认'],
  ['confirmed', '已确认'],
  ['processing', '处理中'],
  ['completed', '已完成'],
  ['cancelled', '已取消']
];
const feedbackStatuses = [
  ['all', '全部'],
  ['new', '待处理'],
  ['processing', '处理中'],
  ['resolved', '已解决'],
  ['archived', '已归档']
];
const statusText = {
  new: '待处理',
  confirmed: '已确认',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已取消',
  resolved: '已解决',
  archived: '已归档'
};

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  bookingStatus: 'all',
  feedbackStatus: 'all',
  bookingSearch: '',
  feedbackSearch: '',
  auditSearch: '',
  summary: null,
  latestBookings: [],
  latestFeedback: [],
  latestAudit: [],
  homeContent: null,
  selectedBookings: new Set(),
  selectedFeedback: new Set(),
  detail: null
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function maskContact(value) {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (/^1\d{10}$/.test(text)) {
    return `${text.slice(0, 3)}****${text.slice(-4)}`;
  }
  if (text.includes('@')) {
    const [name, domain] = text.split('@');
    return `${name.slice(0, 2)}***@${domain || ''}`;
  }
  if (text.length <= 4) return `${text[0] || '*'}***`;
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('is-visible'), 2200);
}

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${state.token}`
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(options.headers || {})
    })
  });

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (response.status === 401 || response.status === 503) {
    showLogin(payload && payload.error ? payload.error.message : '请重新登录');
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error.message : `请求失败 ${response.status}`);
  }

  return payload ? payload.data : null;
}

function showLogin(message) {
  $('#loginPanel').hidden = false;
  $('#appPanel').hidden = true;
  $('#loginError').textContent = message || '';
  $('#tokenInput').value = state.token;
  closeDetail();
}

function showApp() {
  $('#loginPanel').hidden = true;
  $('#appPanel').hidden = false;
  $('#loginError').textContent = '';
}

function renderTabs(container, statuses, active, onChange) {
  container.innerHTML = statuses.map(([value, label]) => (
    `<button type="button" class="status-tab ${value === active ? 'is-active' : ''}" data-status="${value}">${label}</button>`
  )).join('');
  container.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => onChange(button.dataset.status));
  });
}

function renderStatusOptions(statuses, active) {
  return statuses
    .filter(([value]) => value !== 'all')
    .map(([value, label]) => `<option value="${value}" ${active === value ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function populateStaticSelects() {
  $('#bookingBulkStatus').innerHTML = renderStatusOptions(bookingStatuses, 'confirmed');
  $('#feedbackBulkStatus').innerHTML = renderStatusOptions(feedbackStatuses, 'processing');
}

function updateSummary(summary) {
  state.summary = summary;
  const bookings = summary.counts.bookings;
  const feedback = summary.counts.feedback;
  const system = summary.system;
  const security = system.security || {};

  $('#bookingToday').textContent = bookings.today || 0;
  $('#bookingTotal').textContent = `总计 ${bookings.total || 0}`;
  $('#feedbackPending').textContent = (feedback.new || 0) + (feedback.processing || 0);
  $('#feedbackTotal').textContent = `总计 ${feedback.total || 0}`;
  $('#aiProvider').textContent = system.aiProvider === 'kimi' ? 'Kimi' : '本地';
  $('#aiModel').textContent = system.aiModel || '兜底回复';
  $('#liveCount').textContent = summary.counts.lives.total || 0;
  $('#serviceMode').textContent = system.storageWritable ? '真实服务已连接' : '存储异常';
  $('#storageState').textContent = system.storageWritable ? '可写' : '异常';
  $('#envState').textContent = system.environment || '-';
  $('#uptimeState').textContent = `${Math.floor((system.uptimeSeconds || 0) / 60)} 分钟`;
  $('#adminUser').textContent = system.adminUser || '-';
  setHealthState('#securityDomain', security.publicBaseUrl || '未配置', Boolean(security.publicBaseUrl));
  setHealthState('#securityHttps', security.httpsEnabled ? '已启用' : '未启用', Boolean(security.httpsEnabled));
  setHealthState('#securityToken', security.adminTokenConfigured ? '已配置' : '未配置', Boolean(security.adminTokenConfigured));
  setHealthState('#securityCors', security.corsRestricted ? '已限制' : '未限制', Boolean(security.corsRestricted));
  renderRecent(summary);
}

function setHealthState(selector, text, ok) {
  const node = $(selector);
  node.textContent = text;
  node.classList.toggle('is-good', ok);
  node.classList.toggle('is-bad', !ok);
}

function renderRecent(summary) {
  const items = [
    ...summary.recent.bookings.map((item) => ({
      title: item.service || '预约',
      meta: `${formatDate(item.createdAt)} · ${maskContact(item.contact)}`
    })),
    ...summary.recent.feedback.map((item) => ({
      title: item.nickname || '游客反馈',
      meta: `${formatDate(item.createdAt)} · ${item.content || '-'}`
    }))
  ].slice(0, 6);

  $('#recentList').innerHTML = items.length ? items.map((item) => `
    <div class="recent-item">
      <div class="recent-top">
        <span class="recent-title">${escapeHtml(item.title)}</span>
      </div>
      <div class="recent-meta">${escapeHtml(item.meta)}</div>
    </div>
  `).join('') : '<div class="recent-meta">暂无动态</div>';
}

function renderBookings(items) {
  state.latestBookings = items;
  pruneSelections('bookings');
  $('#bookingRows').innerHTML = items.length ? items.map((item) => `
    <tr>
      <td class="check-cell"><input class="row-check" type="checkbox" data-kind="bookings" data-id="${escapeHtml(item.id)}" ${state.selectedBookings.has(item.id) ? 'checked' : ''} aria-label="选择预约"></td>
      <td><strong>${escapeHtml(item.service || '-')}</strong><br><small>${formatDate(item.createdAt)}</small></td>
      <td>${escapeHtml(item.date || '-')}</td>
      <td>${escapeHtml(item.people || '-')}</td>
      <td>${escapeHtml(maskContact(item.contact))}</td>
      <td>
        <select class="status-select" data-kind="bookings" data-id="${escapeHtml(item.id)}">
          ${renderStatusOptions(bookingStatuses, item.status)}
        </select>
      </td>
      <td>
        <div class="detail-button-row">
          <button class="text-button detail-trigger" type="button" data-kind="bookings" data-id="${escapeHtml(item.id)}">详情</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7">暂无预约</td></tr>';
  updateBulkControls('bookings');
}

function renderFeedback(items) {
  state.latestFeedback = items;
  pruneSelections('feedback');
  $('#feedbackRows').innerHTML = items.length ? items.map((item) => `
    <article class="feedback-item">
      <div class="feedback-top">
        <label class="feedback-name">
          <input class="row-check" type="checkbox" data-kind="feedback" data-id="${escapeHtml(item.id)}" ${state.selectedFeedback.has(item.id) ? 'checked' : ''}>
          ${escapeHtml(item.nickname || '游客')}
        </label>
        <div class="detail-button-row">
          <select class="status-select" data-kind="feedback" data-id="${escapeHtml(item.id)}">
            ${renderStatusOptions(feedbackStatuses, item.status)}
          </select>
          <button class="text-button detail-trigger" type="button" data-kind="feedback" data-id="${escapeHtml(item.id)}">详情</button>
        </div>
      </div>
      <div class="feedback-content">${escapeHtml(item.content || '')}</div>
      <div class="feedback-content">${formatDate(item.createdAt)} · ${escapeHtml(maskContact(item.contact))} · ${escapeHtml(statusText[item.status] || item.status || '-')}</div>
    </article>
  `).join('') : '<div class="feedback-content">暂无反馈</div>';
  updateBulkControls('feedback');
}

function renderAudit(items) {
  state.latestAudit = items;
  $('#auditRows').innerHTML = items.length ? items.map((item) => `
    <article class="audit-item">
      <div class="audit-top">
        <strong>${escapeHtml(auditActionText(item.action))}</strong>
        <span>${formatDate(item.createdAt)}</span>
      </div>
      <div class="audit-meta">
        ${escapeHtml(item.adminUser || '-')} · ${escapeHtml(item.targetType || '-')} · ${escapeHtml(item.targetId || '-')}
      </div>
      <div class="audit-detail">${escapeHtml(JSON.stringify(item.detail || {}))}</div>
    </article>
  `).join('') : '<div class="feedback-content">暂无审计记录</div>';
}

function homeStats(content) {
  return {
    banners: (content.banners || []).length,
    gridItems: (content.gridPages || []).reduce((total, page) => total + (Array.isArray(page.items) ? page.items.length : 0), 0),
    hotRecommends: (content.hotRecommends || []).length,
    feeds: (content.feeds || []).length
  };
}

function renderHomeContent(payload) {
  state.homeContent = payload;
  const content = payload.content || {};
  const meta = payload.meta || {};
  const stats = meta.stats || homeStats(content);
  const editor = $('#homeContentEditor');
  if (document.activeElement !== editor) {
    editor.value = JSON.stringify(content, null, 2);
  }

  $('#homeContentSource').textContent = meta.source === 'storage' ? '后台已保存' : '默认内容';
  $('#homeContentUpdated').textContent = meta.updatedAt ? formatDate(meta.updatedAt) : '未修改';
  $('#homeBannerCount').textContent = stats.banners || 0;
  $('#homeGridCount').textContent = stats.gridItems || 0;
  $('#homeHotCount').textContent = stats.hotRecommends || 0;
  $('#homeFeedCount').textContent = stats.feeds || 0;

  const previewItems = [
    ...(content.banners || []).slice(0, 3).map((item) => ({ type: '轮播', title: item.title, meta: item.subtitle || item.tag })),
    ...(content.hotRecommends || []).slice(0, 4).map((item) => ({ type: '推荐', title: item.title, meta: item.subtitle || item.buttonText }))
  ];

  $('#homePreviewList').innerHTML = previewItems.length ? previewItems.map((item) => `
    <article class="home-preview-item">
      <span>${escapeHtml(item.type)}</span>
      <strong>${escapeHtml(item.title || '-')}</strong>
      <small>${escapeHtml(item.meta || '-')}</small>
    </article>
  `).join('') : '<div class="recent-meta">暂无首页内容</div>';
}

function parseHomeEditor() {
  try {
    const parsed = JSON.parse($('#homeContentEditor').value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('首页内容必须是 JSON 对象');
    }
    return parsed;
  } catch (error) {
    throw new Error(`JSON 格式错误：${error.message}`);
  }
}

async function saveHomeContent() {
  try {
    const content = parseHomeEditor();
    const payload = await api('/api/admin/home-content', {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
    renderHomeContent(payload);
    toast('首页内容已保存');
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

function formatHomeContent() {
  try {
    $('#homeContentEditor').value = JSON.stringify(parseHomeEditor(), null, 2);
    toast('格式化完成');
  } catch (error) {
    toast(error.message);
  }
}

async function resetHomeContent() {
  if (!window.confirm('恢复默认首页内容？')) return;
  try {
    const payload = await api('/api/admin/home-content/reset', { method: 'POST' });
    renderHomeContent(payload);
    toast('首页内容已恢复默认');
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

function auditActionText(action) {
  return {
    'booking.created': '提交预约',
    'feedback.created': '提交反馈',
    'booking.status.updated': '更新预约状态',
    'feedback.status.updated': '更新反馈状态',
    'booking.bulk-status.updated': '批量处理预约',
    'feedback.bulk-status.updated': '批量处理反馈',
    'home-content.updated': '更新首页内容',
    'home-content.reset': '恢复默认首页',
    'bookings.csv.exported': '导出预约 CSV',
    'feedback.csv.exported': '导出反馈 CSV',
    'backup.exported': '下载完整备份'
  }[action] || action || '系统操作';
}

function queryString(status, search) {
  const params = new URLSearchParams({ pageSize: '50' });
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('q', search);
  return params.toString();
}

function auditQueryString(search) {
  const params = new URLSearchParams({ pageSize: '30' });
  if (search) params.set('q', search);
  return params.toString();
}

async function loadDashboard() {
  const [summary, homeContent, bookings, feedback, audit] = await Promise.all([
    api('/api/admin/summary'),
    api('/api/admin/home-content'),
    api(`/api/admin/bookings?${queryString(state.bookingStatus, state.bookingSearch)}`),
    api(`/api/admin/feedback?${queryString(state.feedbackStatus, state.feedbackSearch)}`),
    api(`/api/admin/audit?${auditQueryString(state.auditSearch)}`)
  ]);
  showApp();
  updateSummary(summary);
  renderHomeContent(homeContent);
  renderBookings(bookings.items);
  renderFeedback(feedback.items);
  renderAudit(audit.items);
  bindRecordControls();
}

function selectionFor(kind) {
  return kind === 'bookings' ? state.selectedBookings : state.selectedFeedback;
}

function listFor(kind) {
  return kind === 'bookings' ? state.latestBookings : state.latestFeedback;
}

function statusesFor(kind) {
  return kind === 'bookings' ? bookingStatuses : feedbackStatuses;
}

function pruneSelections(kind) {
  const visibleIds = new Set(listFor(kind).map((item) => item.id));
  selectionFor(kind).forEach((id) => {
    if (!visibleIds.has(id)) selectionFor(kind).delete(id);
  });
}

function updateBulkControls(kind) {
  const selected = selectionFor(kind);
  const prefix = kind === 'bookings' ? 'booking' : 'feedback';
  const bar = $(`#${prefix}BulkBar`);
  const checkAll = $(`#${prefix}CheckAll`);
  const visibleIds = listFor(kind).map((item) => item.id);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));

  bar.hidden = selected.size === 0;
  $(`#${prefix}SelectedCount`).textContent = `已选择 ${selected.size} 条`;
  if (checkAll) {
    checkAll.checked = Boolean(visibleIds.length && selectedVisible.length === visibleIds.length);
    checkAll.indeterminate = Boolean(selectedVisible.length && selectedVisible.length < visibleIds.length);
  }
}

function bindRecordControls() {
  document.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const kind = select.dataset.kind;
      const id = select.dataset.id;
      try {
        await api(`/api/admin/${kind}/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: select.value })
        });
        toast('状态已更新');
        await loadDashboard();
      } catch (error) {
        toast(error.message);
      }
    });
  });

  document.querySelectorAll('.row-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const selected = selectionFor(checkbox.dataset.kind);
      if (checkbox.checked) selected.add(checkbox.dataset.id);
      else selected.delete(checkbox.dataset.id);
      updateBulkControls(checkbox.dataset.kind);
    });
  });

  document.querySelectorAll('.detail-trigger').forEach((button) => {
    button.addEventListener('click', () => openDetail(button.dataset.kind, button.dataset.id));
  });
}

async function applyBulk(kind) {
  const selected = [...selectionFor(kind)];
  if (!selected.length) {
    toast('请先选择记录');
    return;
  }

  const prefix = kind === 'bookings' ? 'booking' : 'feedback';
  const status = $(`#${prefix}BulkStatus`).value;
  const note = $(`#${prefix}BulkNote`).value.trim();
  try {
    const result = await api(`/api/admin/${kind}/bulk-status`, {
      method: 'PATCH',
      body: JSON.stringify({ ids: selected, status, note })
    });
    selectionFor(kind).clear();
    $(`#${prefix}BulkNote`).value = '';
    toast(`已处理 ${result.updated} 条记录`);
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

function clearSelection(kind) {
  selectionFor(kind).clear();
  document.querySelectorAll(`.row-check[data-kind="${kind}"]`).forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateBulkControls(kind);
}

async function exportData(type) {
  const response = await fetch(`/api/admin/export?type=${type}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    toast('导出失败');
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hailin-${type}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportBackup() {
  const response = await fetch('/api/admin/backup', {
    headers: authHeaders()
  });
  if (!response.ok) {
    toast('备份失败');
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hailin-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('备份已下载');
  loadDashboard().catch((error) => toast(error.message));
}

function openDetail(kind, id) {
  const item = listFor(kind).find((record) => record.id === id);
  if (!item) {
    toast('记录不存在或已被筛选');
    return;
  }

  state.detail = { kind, id, item };
  const isBooking = kind === 'bookings';
  $('#detailType').textContent = isBooking ? '预约详情' : '反馈详情';
  $('#detailTitle').textContent = isBooking ? (item.service || '预约记录') : (item.nickname || '游客反馈');
  $('#detailStatus').innerHTML = renderStatusOptions(statusesFor(kind), item.status);
  $('#detailNote').value = item.adminNote || '';
  $('#detailBody').innerHTML = isBooking ? renderBookingDetail(item) : renderFeedbackDetail(item);
  $('#drawerOverlay').hidden = false;
  $('#detailDrawer').hidden = false;
}

function renderBookingDetail(item) {
  return `
    <dl class="detail-body">
      <div class="detail-row"><dt>服务</dt><dd>${escapeHtml(item.service || '-')}</dd></div>
      <div class="detail-row"><dt>预约日期</dt><dd>${escapeHtml(item.date || '-')}</dd></div>
      <div class="detail-row"><dt>人数</dt><dd>${escapeHtml(item.people || '-')}</dd></div>
      <div class="detail-row"><dt>联系方式</dt><dd>${escapeHtml(item.contact || '-')}</dd></div>
      <div class="detail-row"><dt>游客备注</dt><dd>${escapeHtml(item.remark || '无')}</dd></div>
      <div class="detail-row"><dt>提交时间</dt><dd>${formatDate(item.createdAt)}</dd></div>
      <div class="detail-row"><dt>更新时间</dt><dd>${formatDate(item.updatedAt)}</dd></div>
    </dl>
  `;
}

function renderFeedbackDetail(item) {
  return `
    <dl class="detail-body">
      <div class="detail-row"><dt>游客</dt><dd>${escapeHtml(item.nickname || '游客')}</dd></div>
      <div class="detail-row"><dt>联系方式</dt><dd>${escapeHtml(item.contact || '未留联系方式')}</dd></div>
      <div class="detail-row"><dt>反馈内容</dt><dd>${escapeHtml(item.content || '-')}</dd></div>
      <div class="detail-row"><dt>提交时间</dt><dd>${formatDate(item.createdAt)}</dd></div>
      <div class="detail-row"><dt>更新时间</dt><dd>${formatDate(item.updatedAt)}</dd></div>
    </dl>
  `;
}

function closeDetail() {
  state.detail = null;
  const overlay = $('#drawerOverlay');
  const drawer = $('#detailDrawer');
  if (overlay) overlay.hidden = true;
  if (drawer) drawer.hidden = true;
}

async function saveDetail() {
  if (!state.detail) return;
  const { kind, id } = state.detail;
  try {
    await api(`/api/admin/${kind}/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: $('#detailStatus').value,
        note: $('#detailNote').value.trim()
      })
    });
    toast('处理记录已保存');
    closeDetail();
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
}

async function copyDetailContact() {
  if (!state.detail) return;
  const contact = state.detail.item.contact || '';
  if (!contact) {
    toast('没有联系方式');
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(contact);
    } else {
      const input = document.createElement('textarea');
      input.value = contact;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    toast('联系方式已复制');
  } catch {
    toast(contact);
  }
}

function bindEvents() {
  populateStaticSelects();

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    state.token = $('#tokenInput').value.trim();
    localStorage.setItem(TOKEN_KEY, state.token);
    try {
      await loadDashboard();
      toast('已进入后台');
    } catch (error) {
      $('#loginError').textContent = error.message === 'Unauthorized' ? 'Token 无效或未配置' : error.message;
    }
  });

  $('#logoutBtn').addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem(TOKEN_KEY);
    showLogin('');
  });
  $('#refreshBtn').addEventListener('click', () => loadDashboard().then(() => toast('已刷新')).catch((error) => toast(error.message)));
  $('#exportBookings').addEventListener('click', () => exportData('bookings'));
  $('#exportFeedback').addEventListener('click', () => exportData('feedback'));
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#homeContentSave').addEventListener('click', saveHomeContent);
  $('#homeContentFormat').addEventListener('click', formatHomeContent);
  $('#homeContentReset').addEventListener('click', resetHomeContent);
  $('#quickBookingExport').addEventListener('click', () => exportData('bookings'));
  $('#quickFeedbackExport').addEventListener('click', () => exportData('feedback'));
  $('#quickBackupExport').addEventListener('click', exportBackup);
  $('#bookingBulkApply').addEventListener('click', () => applyBulk('bookings'));
  $('#feedbackBulkApply').addEventListener('click', () => applyBulk('feedback'));
  $('#bookingBulkClear').addEventListener('click', () => clearSelection('bookings'));
  $('#feedbackBulkClear').addEventListener('click', () => clearSelection('feedback'));
  $('#drawerClose').addEventListener('click', closeDetail);
  $('#drawerOverlay').addEventListener('click', closeDetail);
  $('#detailSave').addEventListener('click', saveDetail);
  $('#detailCopyContact').addEventListener('click', copyDetailContact);

  $('#bookingCheckAll').addEventListener('change', (event) => {
    const selected = selectionFor('bookings');
    state.latestBookings.forEach((item) => {
      if (event.target.checked) selected.add(item.id);
      else selected.delete(item.id);
    });
    renderBookings(state.latestBookings);
    bindRecordControls();
  });

  $('#bookingSearch').addEventListener('input', (event) => {
    state.bookingSearch = event.target.value.trim();
    clearTimeout(bindEvents.bookingTimer);
    bindEvents.bookingTimer = setTimeout(loadDashboard, 260);
  });
  $('#feedbackSearch').addEventListener('input', (event) => {
    state.feedbackSearch = event.target.value.trim();
    clearTimeout(bindEvents.feedbackTimer);
    bindEvents.feedbackTimer = setTimeout(loadDashboard, 260);
  });
  $('#auditSearch').addEventListener('input', (event) => {
    state.auditSearch = event.target.value.trim();
    clearTimeout(bindEvents.auditTimer);
    bindEvents.auditTimer = setTimeout(loadDashboard, 260);
  });

  const onBookingTabChange = (status) => {
    state.bookingStatus = status;
    renderTabs($('#bookingTabs'), bookingStatuses, state.bookingStatus, onBookingTabChange);
    loadDashboard().catch((error) => toast(error.message));
  };
  const onFeedbackTabChange = (status) => {
    state.feedbackStatus = status;
    renderTabs($('#feedbackTabs'), feedbackStatuses, state.feedbackStatus, onFeedbackTabChange);
    loadDashboard().catch((error) => toast(error.message));
  };

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('is-active'));
      button.classList.add('is-active');
      const view = button.dataset.view;
      if (view === 'home-content') document.querySelector('[data-section="home-content"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (view === 'bookings') document.querySelector('[data-section="bookings"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (view === 'feedback') document.querySelector('[data-section="feedback"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (view === 'audit') document.querySelector('[data-section="audit"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (view === 'system') document.querySelector('.right-rail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (view === 'dashboard') window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  renderTabs($('#bookingTabs'), bookingStatuses, state.bookingStatus, onBookingTabChange);
  renderTabs($('#feedbackTabs'), feedbackStatuses, state.feedbackStatus, onFeedbackTabChange);
}

bindEvents();
if (state.token) {
  loadDashboard().catch(() => showLogin('Token 已过期或服务未配置'));
} else {
  showLogin('');
}
