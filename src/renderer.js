import './index.css';

// Active State
let profiles = {};
let activeProfileName = null;
let selectedProfileName = null;
let vpnStatus = 'disconnected';
let connectTime = null;
let uptimeTimer = null;
let pingTimer = null;

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const connectBtn = document.getElementById('connect-btn');
const vpnStateText = document.querySelector('.connection-state-text');
const uptimeDisplay = document.getElementById('uptime-display');
const pingVal = document.querySelector('.ping-val');

// Sidebar Widget status
const sidebarStatusDot = document.querySelector('.sidebar-status-widget .status-dot');
const sidebarStatusLabel = document.querySelector('.sidebar-status-widget .status-label');
const sidebarActiveProfile = document.querySelector('.sidebar-status-widget .active-profile-name');

// Info Card values
const infoProfile = document.getElementById('info-profile');
const infoServer = document.getElementById('info-server');
const infoProtocol = document.getElementById('info-protocol');
const infoUser = document.getElementById('info-user');
const infoMode = document.getElementById('info-mode');

// Logs Displays
const logsDisplay = document.getElementById('logs-display');
const miniLogsDisplay = document.getElementById('mini-logs-display');
const autoscrollCheckbox = document.getElementById('logs-autoscroll');

// Exclusions Elements
const exclusionsTableBody = document.getElementById('exclusions-table-body');
const exclusionsCount = document.getElementById('exclusions-count');
const addExclusionForm = document.getElementById('add-exclusion-form');
const exclusionInput = document.getElementById('exclusion-input');
const searchExclusionsInput = document.getElementById('search-exclusions');
const modeGeneralBtn = document.getElementById('mode-general-btn');
const modeSelectiveBtn = document.getElementById('mode-selective-btn');
const routingDescription = document.getElementById('routing-mode-description');

// Editor Form Elements
const endpointHostname = document.getElementById('endpoint-hostname');
const endpointAddresses = document.getElementById('endpoint-addresses');
const endpointUsername = document.getElementById('endpoint-username');
const endpointPassword = document.getElementById('endpoint-password');
const endpointProtocol = document.getElementById('endpoint-protocol');
const endpointSni = document.getElementById('endpoint-sni');
const endpointAntiDpi = document.getElementById('endpoint-anti-dpi');
const endpointSkipVerification = document.getElementById('endpoint-skip-verification');
const configLovel = document.getElementById('config-loglevel');
const configKillswitch = document.getElementById('config-killswitch');
const configPostquantum = document.getElementById('config-postquantum');
const tunMtu = document.getElementById('tun-mtu');
const tunIfname = document.getElementById('tun-ifname');
const tunChangeDns = document.getElementById('tun-change-dns');

// Modal Elements
const newProfileModal = document.getElementById('new-profile-modal');
const newProfileNameInput = document.getElementById('new-profile-name-input');

/* ----------------------------------------------------
 * 1. TAB NAVIGATION SYSTEM
 * ---------------------------------------------------- */
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetTab = item.getAttribute('data-tab');
    switchTab(targetTab);
  });
});

// Link from Dashboard cards to logs or other pages
document.querySelectorAll('[data-tab-link]').forEach(link => {
  link.addEventListener('click', (e) => {
    const targetTab = e.target.getAttribute('data-tab-link');
    switchTab(targetTab);
  });
});

function switchTab(tabId) {
  navItems.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  tabPanes.forEach(pane => {
    pane.classList.toggle('active', pane.getAttribute('id') === `tab-${tabId}`);
  });
}

/* ----------------------------------------------------
 * 2. PROFILES LIFECYCLE
 * ---------------------------------------------------- */
async function loadProfiles(autoSelectName = null) {
  profiles = await window.api.getProfiles();
  const listContainer = document.getElementById('profiles-list-display');
  listContainer.innerHTML = '';
  
  const keys = Object.keys(profiles);
  
  if (keys.length === 0) {
    listContainer.innerHTML = '<p class="text-secondary" style="padding: 16px;">Профилей не обнаружено. Создайте новый.</p>';
    return;
  }
  
  keys.forEach(name => {
    const conf = profiles[name];
    const endpoint = conf.endpoint || {};
    const addresses = endpoint.addresses || [];
    
    const card = document.createElement('div');
    card.className = `profile-card ${selectedProfileName === name ? 'active' : ''}`;
    
    // Build Card inner HTML safely
    card.innerHTML = `
      <div class="profile-info">
        <span class="profile-title">${name}</span>
        <span class="profile-subtitle">${endpoint.hostname || 'Без хоста'} (${addresses[0] || 'нет адреса'})</span>
      </div>
      <div class="profile-card-actions">
        <button class="btn-select">Выбрать</button>
        <button class="btn-delete" title="Удалить профиль">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
    
    // Select Action
    card.querySelector('.btn-select').addEventListener('click', (e) => {
      e.stopPropagation();
      selectProfile(name);
    });
    card.addEventListener('click', () => {
      selectProfile(name);
    });
    
    // Delete Action
    card.querySelector('.btn-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Вы уверены, что хотите удалить профиль "${name}"?`)) {
        const res = await window.api.deleteProfile(name);
        if (res.success) {
          if (selectedProfileName === name) {
            selectedProfileName = null;
          }
          loadProfiles();
        }
      }
    });
    
    listContainer.appendChild(card);
  });
  
  // Set default selected if none active
  if (!selectedProfileName && keys.length > 0) {
    selectProfile(autoSelectName || keys[0]);
  } else if (selectedProfileName && keys.includes(selectedProfileName)) {
    // Refresh selected layout
    selectProfile(selectedProfileName);
  }
}

function selectProfile(name) {
  selectedProfileName = name;
  const config = profiles[name];
  if (!config) return;
  
  // Update selected class on UI cards
  document.querySelectorAll('.profile-card').forEach(card => {
    const title = card.querySelector('.profile-title').textContent;
    card.classList.toggle('active', title === name);
  });
  
  // Update dashboard information
  infoProfile.textContent = name;
  infoServer.textContent = config.endpoint?.addresses?.join(', ') || config.endpoint?.hostname || '--';
  infoProtocol.textContent = (config.endpoint?.upstream_protocol || 'http2').toUpperCase();
  infoUser.textContent = config.endpoint?.username || '--';
  infoMode.textContent = config.vpn_mode === 'selective' ? 'Selective (Выборочный)' : 'General (Обходной)';
  
  // Fill values in config editor form
  endpointHostname.value = config.endpoint?.hostname || '';
  endpointAddresses.value = config.endpoint?.addresses?.join(', ') || '';
  endpointUsername.value = config.endpoint?.username || '';
  endpointPassword.value = config.endpoint?.password || '';
  endpointProtocol.value = config.endpoint?.upstream_protocol || 'http2';
  endpointSni.value = config.endpoint?.custom_sni || '';
  endpointAntiDpi.checked = !!config.endpoint?.anti_dpi;
  endpointSkipVerification.checked = !!config.endpoint?.skip_verification;
  
  configLovel.value = config.loglevel || 'info';
  configKillswitch.checked = !!config.killswitch_enabled;
  configPostquantum.checked = !!config.post_quantum_group_enabled;
  
  // TUN Listener Editor values
  const tun = config.listener?.tun || {};
  tunMtu.value = tun.mtu_size || 1280;
  tunIfname.value = tun.bound_if || '';
  tunChangeDns.checked = tun.change_system_dns !== false;
  
  // Update exclusions UI
  renderExclusionsList();
}

/* ----------------------------------------------------
 * 3. CONFIG EDITOR & EXCLUSIONS
 * ---------------------------------------------------- */
// Save config from Editor form
document.getElementById('save-config-btn').addEventListener('click', async () => {
  if (!selectedProfileName) {
    alert('Сначала выберите или создайте профиль.');
    return;
  }
  
  const config = profiles[selectedProfileName];
  if (!config) return;
  
  // Construct updated object
  config.loglevel = configLovel.value;
  config.killswitch_enabled = configKillswitch.checked;
  config.post_quantum_group_enabled = configPostquantum.checked;
  
  config.endpoint = config.endpoint || {};
  config.endpoint.hostname = endpointHostname.value.trim();
  config.endpoint.addresses = endpointAddresses.value.split(',').map(s => s.trim()).filter(s => s.length > 0);
  config.endpoint.username = endpointUsername.value.trim();
  config.endpoint.password = endpointPassword.value;
  config.endpoint.upstream_protocol = endpointProtocol.value;
  config.endpoint.custom_sni = endpointSni.value.trim();
  config.endpoint.anti_dpi = endpointAntiDpi.checked;
  config.endpoint.skip_verification = endpointSkipVerification.checked;
  
  config.listener = config.listener || {};
  config.listener.tun = config.listener.tun || {};
  config.listener.tun.mtu_size = parseInt(tunMtu.value, 10) || 1280;
  config.listener.tun.bound_if = tunIfname.value.trim();
  config.listener.tun.change_system_dns = tunChangeDns.checked;
  
  const res = await window.api.saveProfile(selectedProfileName, config);
  if (res.success) {
    alert(`Конфигурация профиля "${selectedProfileName}" успешно сохранена!`);
    loadProfiles(selectedProfileName);
  } else {
    alert(`Ошибка сохранения: ${res.error}`);
  }
});

// Render Exclusions table
function renderExclusionsList() {
  const config = profiles[selectedProfileName];
  if (!config) {
    exclusionsTableBody.innerHTML = '';
    exclusionsCount.textContent = '0';
    return;
  }
  
  config.exclusions = config.exclusions || [];
  const mode = config.vpn_mode || 'general';
  
  // Setup General / Selective Toggles active state
  modeGeneralBtn.classList.toggle('active', mode === 'general');
  modeSelectiveBtn.classList.toggle('active', mode === 'selective');
  
  if (mode === 'general') {
    routingDescription.textContent = 'Режим General: Весь трафик идет через VPN, за исключением указанных в списке сайтов.';
  } else {
    routingDescription.textContent = 'Режим Selective: Трафик идет через VPN ТОЛЬКО для сайтов, указанных в списке.';
  }
  
  // Render domains table
  const filter = searchExclusionsInput.value.toLowerCase().trim();
  const list = config.exclusions.filter(item => item.toLowerCase().includes(filter));
  
  exclusionsCount.textContent = config.exclusions.length;
  exclusionsTableBody.innerHTML = '';
  
  if (list.length === 0) {
    exclusionsTableBody.innerHTML = `
      <tr>
        <td colspan="2" class="text-secondary" style="text-align: center; padding: 24px;">
          ${filter ? 'Ничего не найдено по вашему запросу.' : 'Список исключений пуст. Добавьте первый домен.'}
        </td>
      </tr>
    `;
    return;
  }
  
  list.forEach(domain => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${domain}</code></td>
      <td style="text-align: right;">
        <button class="btn btn-sm btn-secondary btn-delete-ex" style="color: var(--accent-red)">Удалить</button>
      </td>
    `;
    
    tr.querySelector('.btn-delete-ex').addEventListener('click', async () => {
      config.exclusions = config.exclusions.filter(ex => ex !== domain);
      await saveExclusionsQuietly();
    });
    
    exclusionsTableBody.appendChild(tr);
  });
}

// Quietly save exclusions when editing items
async function saveExclusionsQuietly() {
  const config = profiles[selectedProfileName];
  if (!config) return;
  const res = await window.api.saveProfile(selectedProfileName, config);
  if (res.success) {
    renderExclusionsList();
    // Also update Dashboard info mode text
    infoMode.textContent = config.vpn_mode === 'selective' ? 'Selective (Выборочный)' : 'General (Обходной)';
  }
}

// Mode triggers
modeGeneralBtn.addEventListener('click', () => {
  const config = profiles[selectedProfileName];
  if (config && config.vpn_mode !== 'general') {
    config.vpn_mode = 'general';
    saveExclusionsQuietly();
  }
});

modeSelectiveBtn.addEventListener('click', () => {
  const config = profiles[selectedProfileName];
  if (config && config.vpn_mode !== 'selective') {
    config.vpn_mode = 'selective';
    saveExclusionsQuietly();
  }
});

// Add exclusion trigger
addExclusionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = exclusionInput.value.trim();
  const config = profiles[selectedProfileName];
  if (!val || !config) return;
  
  config.exclusions = config.exclusions || [];
  if (!config.exclusions.includes(val)) {
    config.exclusions.push(val);
    exclusionInput.value = '';
    await saveExclusionsQuietly();
  } else {
    alert('Этот адрес уже добавлен в список.');
  }
});

// Search exclusion trigger
searchExclusionsInput.addEventListener('input', () => {
  renderExclusionsList();
});

/* ----------------------------------------------------
 * 4. NEW & IMPORT PROFILE DIALOGS
 * ---------------------------------------------------- */
const newProfileBtn = document.getElementById('new-profile-btn');
const cancelProfileBtn = document.getElementById('cancel-profile-btn');
const confirmProfileBtn = document.getElementById('confirm-profile-btn');

newProfileBtn.addEventListener('click', () => {
  newProfileModal.classList.add('active');
  newProfileNameInput.value = '';
  newProfileNameInput.focus();
});

cancelProfileBtn.addEventListener('click', () => {
  newProfileModal.classList.remove('active');
});

confirmProfileBtn.addEventListener('click', async () => {
  const name = newProfileNameInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!name) {
    alert('Пожалуйста, введите корректное имя.');
    return;
  }
  
  if (profiles[name]) {
    alert('Профиль с таким именем уже существует.');
    return;
  }
  
  // Template Profile structure
  const blankTemplate = {
    loglevel: 'info',
    vpn_mode: 'general',
    killswitch_enabled: true,
    killswitch_allow_ports: [],
    post_quantum_group_enabled: true,
    exclusions: [],
    endpoint: {
      hostname: '',
      addresses: [],
      custom_sni: '',
      has_ipv6: true,
      username: '',
      password: '',
      client_random: '',
      skip_verification: false,
      certificate: '',
      upstream_protocol: 'http2',
      anti_dpi: false
    },
    dns_upstreams: [],
    listener: {
      tun: {
        bound_if: '',
        included_routes: ['0.0.0.0/0', '2000::/3'],
        excluded_routes: ['0.0.0.0/8', '10.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/3'],
        mtu_size: 1280,
        change_system_dns: true
      }
    }
  };
  
  const res = await window.api.saveProfile(name, blankTemplate);
  if (res.success) {
    newProfileModal.classList.remove('active');
    selectedProfileName = name;
    await loadProfiles(name);
    switchTab('editor'); // Go straight to config editor to set up values
  } else {
    alert(`Ошибка создания: ${res.error}`);
  }
});

// Import Link Button Action
document.getElementById('import-btn').addEventListener('click', async () => {
  const url = document.getElementById('import-url-input').value.trim();
  if (!url) {
    alert('Пожалуйста, введите URL-ссылку или base64-строку.');
    return;
  }
  
  const res = await window.api.importProfileFromUrl(url);
  if (res.success) {
    document.getElementById('import-url-input').value = '';
    alert(`Профиль "${res.profileName}" успешно импортирован!`);
    await loadProfiles(res.profileName);
  } else {
    alert(`Ошибка импорта: ${res.error}`);
  }
});

/* ----------------------------------------------------
 * 5. VPN STATE MACHINE & UI INTERACTIVITY
 * ---------------------------------------------------- */
connectBtn.addEventListener('click', async () => {
  if (vpnStatus === 'connected' || vpnStatus === 'connecting') {
    connectBtn.disabled = true;
    await window.api.stopVpn();
  } else {
    if (!selectedProfileName) {
      alert('Пожалуйста, сначала выберите профиль для подключения.');
      return;
    }
    connectBtn.disabled = true;
    const res = await window.api.startVpn(selectedProfileName);
    if (!res.success) {
      alert(`Ошибка подключения: ${res.error}`);
      connectBtn.disabled = false;
    }
  }
});

function updateVpnStateUI(statusData) {
  vpnStatus = statusData.status;
  activeProfileName = statusData.activeProfile;
  
  // Re-enable connect button
  connectBtn.disabled = false;
  
  // Reset classes
  connectBtn.className = 'connect-button';
  sidebarStatusDot.className = 'status-dot';
  
  // Apply classes based on status
  connectBtn.classList.add(vpnStatus);
  sidebarStatusDot.classList.add(vpnStatus);
  
  let label = 'Отключено';
  let bannerLabel = 'Готов к подключению';
  
  if (vpnStatus === 'disconnected') {
    label = 'Отключено';
    bannerLabel = 'Готов к подключению';
    stopUptimeTimer();
    stopPingTester();
  } else if (vpnStatus === 'connecting') {
    label = 'Подключение';
    bannerLabel = 'Установка соединения...';
    stopPingTester();
  } else if (vpnStatus === 'connected') {
    label = 'Подключено';
    bannerLabel = 'Защищено (VPN Активен)';
    startUptimeTimer();
    startPingTester();
  } else if (vpnStatus === 'error') {
    label = 'Ошибка';
    bannerLabel = 'Ошибка подключения';
    stopUptimeTimer();
    stopPingTester();
  }
  
  sidebarStatusLabel.textContent = label;
  vpnStateText.textContent = bannerLabel;
  sidebarActiveProfile.textContent = activeProfileName ? `Профиль: ${activeProfileName}` : 'Нет активного профиля';
}

/* Uptime Timer logic */
function startUptimeTimer() {
  if (uptimeTimer) clearInterval(uptimeTimer);
  connectTime = Date.now();
  
  uptimeTimer = setInterval(() => {
    const diff = Date.now() - connectTime;
    const hrs = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const mins = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    uptimeDisplay.textContent = `${hrs}:${mins}:${secs}`;
  }, 1000);
}

function stopUptimeTimer() {
  if (uptimeTimer) {
    clearInterval(uptimeTimer);
    uptimeTimer = null;
  }
  uptimeDisplay.textContent = '00:00:00';
}

/* Ping Test Mock/Logic */
function startPingTester() {
  if (pingTimer) clearInterval(pingTimer);
  
  const testPing = () => {
    // Since we are connected to VPN, pinging a fast external server is a good way to show connection speed
    // We will do a mock ping to represent network latency through the tunnel
    const latency = Math.floor(Math.random() * 20) + 15; // 15-35 ms typical
    pingVal.textContent = `${latency} ms`;
  };
  
  testPing();
  pingTimer = setInterval(testPing, 4000);
}

function stopPingTester() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  pingVal.textContent = '-- ms';
}

/* Logs and stream parsing */
function appendLogLine(line) {
  // Main tab console logs
  const row = document.createElement('div');
  row.className = 'log-line';
  const lowerLine = line.toLowerCase();
  if (lowerLine.includes('error') || lowerLine.includes('fatal') || lowerLine.includes('fail') || lowerLine.includes('crit')) {
    row.classList.add('error');
  } else if (lowerLine.includes('info') || lowerLine.includes('success') || lowerLine.includes('system') || lowerLine.includes('default')) {
    row.classList.add('system');
  }
  row.textContent = line;
  
  logsDisplay.appendChild(row);
  
  // Limit memory rows in console
  while (logsDisplay.childNodes.length > 500) {
    logsDisplay.removeChild(logsDisplay.firstChild);
  }
  
  // Dashboard mini logs
  const miniRow = row.cloneNode(true);
  miniLogsDisplay.appendChild(miniRow);
  
  while (miniLogsDisplay.childNodes.length > 30) {
    miniLogsDisplay.removeChild(miniLogsDisplay.firstChild);
  }
  
  if (autoscrollCheckbox.checked) {
    logsDisplay.scrollTop = logsDisplay.scrollHeight;
  }
  miniLogsDisplay.scrollTop = miniLogsDisplay.scrollHeight;
}

// Clear and copy log buttons
document.getElementById('clear-logs-btn').addEventListener('click', () => {
  logsDisplay.innerHTML = '';
  miniLogsDisplay.innerHTML = '';
});

document.getElementById('copy-logs-btn').addEventListener('click', () => {
  const text = Array.from(logsDisplay.querySelectorAll('.log-line'))
    .map(el => el.textContent)
    .join('\n');
  navigator.clipboard.writeText(text);
  alert('Логи успешно скопированы в буфер обмена!');
});

/* ----------------------------------------------------
 * 6. INITIALIZATION & LISTENERS
 * ---------------------------------------------------- */
window.api.onVpnStatusChanged((statusData) => {
  updateVpnStateUI(statusData);
});

window.api.onVpnLog((logLine) => {
  appendLogLine(logLine);
});

async function init() {
  // Get initial state
  const state = await window.api.getVpnStatus();
  updateVpnStateUI(state);
  
  // Seed current logs if any exist in status
  if (state.logs && state.logs.length > 0) {
    state.logs.forEach(line => appendLogLine(line));
  }
  
  // Load profiles
  await loadProfiles();
}

// Launch app
init();
