import { app, BrowserWindow, ipcMain, Tray, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { spawn, exec } from 'node:child_process';
import TOML from '@iarna/toml';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let vpnProcess = null;
let vpnStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'error'
let activeProfile = null;
const vpnLogs = [];
const maxLogLines = 1000;

// Path to profiles directory
const profileDir = path.join(app.getPath('home'), '.config', 'trusttunnel', 'profiles');

// Helper to send status to frontend
function sendStatusUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vpn-status-changed', {
      status: vpnStatus,
      activeProfile,
    });
  }
  updateTrayMenu();
}

// Helper to log and send to frontend
function addLogLine(line) {
  const cleanLine = line.trim();
  if (!cleanLine) return;
  
  const timestampedLine = `[${new Date().toLocaleTimeString()}] ${cleanLine}`;
  vpnLogs.push(timestampedLine);
  if (vpnLogs.length > maxLogLines) {
    vpnLogs.shift();
  }
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vpn-log', timestampedLine);
  }
}

// Check if trusttunnel_client is already running in the system
function checkExistingProcess() {
  return new Promise((resolve) => {
    exec('pgrep trusttunnel_client', (err, stdout) => {
      if (!err && stdout.trim()) {
        vpnStatus = 'connected';
        activeProfile = 'System Active';
        sendStatusUpdate();
        resolve(true);
      } else {
        if (vpnStatus === 'connected' && activeProfile === 'System Active') {
          vpnStatus = 'disconnected';
          activeProfile = null;
          sendStatusUpdate();
        }
        resolve(false);
      }
    });
  });
}

// Initialize profiles directory
async function initProfiles() {
  try {
    await fs.mkdir(profileDir, { recursive: true });
    
    // Check if directory is empty
    const files = await fs.readdir(profileDir);
    const tomlFiles = files.filter(f => f.endsWith('.toml'));
    
    if (tomlFiles.length === 0) {
      // Try to import from system default path
      const systemDefaultPath = '/opt/trusttunnel_client/trusttunnel_client.toml';
      if (existsSync(systemDefaultPath)) {
        const content = await fs.readFile(systemDefaultPath, 'utf8');
        await fs.writeFile(path.join(profileDir, 'default.toml'), content, 'utf8');
        addLogLine('System default config imported as "default" profile.');
      } else {
        // Create a blank template
        const defaultTemplate = {
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
        await fs.writeFile(
          path.join(profileDir, 'default.toml'),
          TOML.stringify(defaultTemplate),
          'utf8'
        );
        addLogLine('Created standard default template profile.');
      }
    }
  } catch (err) {
    console.error('Failed to initialize profiles:', err);
  }
}

// Parse QR base64 configuration (TLV format)
function parseTlvConfig(base64Data) {
  try {
    const buf = Buffer.from(base64Data, 'base64');
    // Minimal check: should have version/header
    if (buf.length < 5) throw new Error('Data too short');
    
    // Header is 3 bytes (00 01 01)
    let idx = 3;
    const config = {
      hostname: '',
      address: '',
      username: '',
      password: ''
    };
    
    while (idx < buf.length - 2) {
      const tag = buf[idx];
      const len = buf[idx + 1];
      if (idx + 2 + len > buf.length) break;
      
      const val = buf.toString('utf8', idx + 2, idx + 2 + len);
      
      if (tag === 1) config.hostname = val;
      else if (tag === 2) config.address = val;
      else if (tag === 5) config.username = val;
      else if (tag === 6) config.password = val;
      
      idx += 2 + len;
    }
    
    return config;
  } catch (err) {
    console.error('Failed to parse QR config:', err);
    return null;
  }
}

// Setup IPC handlers
function setupIpc() {
  // 1. Get all profiles
  ipcMain.handle('get-profiles', async () => {
    const profiles = {};
    try {
      const files = await fs.readdir(profileDir);
      for (const file of files) {
        if (file.endsWith('.toml')) {
          const name = path.basename(file, '.toml');
          const filePath = path.join(profileDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          try {
            profiles[name] = TOML.parse(content);
          } catch (e) {
            addLogLine(`Error parsing profile "${name}": ${e.message}`);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
    return profiles;
  });

  // 2. Save profile
  ipcMain.handle('save-profile', async (event, name, config) => {
    try {
      const fileName = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.toml`;
      const filePath = path.join(profileDir, fileName);
      const tomlString = TOML.stringify(config);
      await fs.writeFile(filePath, tomlString, 'utf8');
      addLogLine(`Profile "${name}" saved successfully.`);
      return { success: true };
    } catch (err) {
      addLogLine(`Failed to save profile "${name}": ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // 3. Delete profile
  ipcMain.handle('delete-profile', async (event, name) => {
    try {
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = path.join(profileDir, `${safeName}.toml`);
      if (existsSync(filePath)) {
        await fs.unlink(filePath);
        addLogLine(`Profile "${name}" deleted.`);
        if (activeProfile === name) {
          activeProfile = null;
          vpnStatus = 'disconnected';
          sendStatusUpdate();
        }
        return { success: true };
      }
      return { success: false, error: 'Profile not found' };
    } catch (err) {
      addLogLine(`Failed to delete profile "${name}": ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // 4. Start VPN
  ipcMain.handle('start-vpn', async (event, name) => {
    if (vpnProcess) {
      addLogLine('VPN is already active, stopping first...');
      await stopActiveVpn();
    }
    
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const profilePath = path.join(profileDir, `${safeName}.toml`);
    if (!existsSync(profilePath)) {
      return { success: false, error: 'Profile config file not found' };
    }
    
    const stopFile = '/tmp/trusttunnel.stop';
    try {
      if (existsSync(stopFile)) {
        await fs.unlink(stopFile);
      }
    } catch (e) {}
    
    vpnStatus = 'connecting';
    activeProfile = name;
    sendStatusUpdate();
    
    addLogLine(`Starting VPN connection using profile "${name}"...`);
    
    // We use pkexec to run the binary as root to allow creating the TUN interface.
    // The binary is located at /opt/trusttunnel_client/trusttunnel_client.
    const binPath = '/opt/trusttunnel_client/trusttunnel_client';
    
    if (!existsSync(binPath)) {
      vpnStatus = 'error';
      sendStatusUpdate();
      addLogLine(`Error: trusttunnel_client binary not found at ${binPath}`);
      return { success: false, error: 'Binary not found at /opt/trusttunnel_client/trusttunnel_client' };
    }
    
    try {
      const cmd = `export PATH=/usr/sbin:/sbin:/usr/bin:/bin:\$PATH && ${binPath} -c "${profilePath}" & PID=\$! ; (while kill -0 \$PID 2>/dev/null; do if [ -f "${stopFile}" ]; then kill \$PID; rm -f "${stopFile}"; exit 0; fi; sleep 0.5; done; rm -f "${stopFile}") & wait \$PID`;
      vpnProcess = spawn('pkexec', ['sh', '-c', cmd]);
      
      vpnProcess.stdout.on('data', (data) => {
        const text = data.toString();
        addLogLine(text);
        
        // Simple detection of connection success
        if (
          text.includes('DNS listener started') || 
          text.includes('Tunnel device initialized') || 
          text.includes('tunnel interface is up') ||
          text.includes('Successfully connected to endpoint') ||
          text.includes('VPN_SS_CONNECTED')
        ) {
          vpnStatus = 'connected';
          sendStatusUpdate();
        }
      });
      
      vpnProcess.stderr.on('data', (data) => {
        const text = data.toString();
        addLogLine(`[stderr] ${text}`);
        
        // Simple detection of connection success on stderr too
        if (
          text.includes('DNS listener started') || 
          text.includes('Tunnel device initialized') || 
          text.includes('tunnel interface is up') ||
          text.includes('Successfully connected to endpoint') ||
          text.includes('VPN_SS_CONNECTED')
        ) {
          vpnStatus = 'connected';
          sendStatusUpdate();
          return;
        }
        
        // Sometime errors go to stderr
        if (text.includes('Error') || text.includes('fatal') || text.includes('failed') || text.includes('EPERM')) {
          // Don't change immediately to error if we already connected
          if (vpnStatus !== 'connected') {
            vpnStatus = 'error';
            sendStatusUpdate();
          }
        }
      });
      
      vpnProcess.on('error', (err) => {
        addLogLine(`Process error: ${err.message}`);
        vpnStatus = 'error';
        vpnProcess = null;
        sendStatusUpdate();
      });
      
      vpnProcess.on('close', (code) => {
        addLogLine(`VPN client process exited with code ${code}`);
        vpnProcess = null;
        vpnStatus = 'disconnected';
        activeProfile = null;
        sendStatusUpdate();
      });
      
      return { success: true };
    } catch (err) {
      vpnStatus = 'error';
      vpnProcess = null;
      sendStatusUpdate();
      addLogLine(`Failed to launch process: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // 5. Stop VPN
  ipcMain.handle('stop-vpn', async () => {
    return await stopActiveVpn();
  });

  // 6. Get status
  ipcMain.handle('get-vpn-status', async () => {
    // Check if process was killed externally or is already running
    await checkExistingProcess();
    return {
      status: vpnStatus,
      activeProfile,
      logs: vpnLogs
    };
  });

  // 7. Import config from URL (QR link format)
  ipcMain.handle('import-profile-from-url', async (event, url) => {
    try {
      let base64Data = '';
      if (url.includes('#tt=')) {
        base64Data = url.split('#tt=')[1];
      } else {
        base64Data = url.trim();
      }
      
      const config = parseTlvConfig(base64Data);
      if (!config || !config.hostname) {
        return { success: false, error: 'Invalid URL or QR code configuration format' };
      }
      
      // Create new profile object
      const newProfile = {
        loglevel: 'info',
        vpn_mode: 'general',
        killswitch_enabled: true,
        killswitch_allow_ports: [],
        post_quantum_group_enabled: true,
        exclusions: [],
        endpoint: {
          hostname: config.hostname,
          addresses: [config.address || `${config.hostname}:443`],
          custom_sni: '',
          has_ipv6: true,
          username: config.username,
          password: config.password,
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
      
      const sanitizedHostname = config.hostname.replace(/[^a-zA-Z0-9_-]/g, '_');
      const profileName = `imported_${sanitizedHostname}`;
      const fileName = `${profileName}.toml`;
      await fs.writeFile(
        path.join(profileDir, fileName),
        TOML.stringify(newProfile),
        'utf8'
      );
      
      addLogLine(`Successfully imported configuration for "${config.hostname}".`);
      return { success: true, profileName };
    } catch (err) {
      addLogLine(`Import failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

// Stop VPN helper
function stopActiveVpn() {
  return new Promise(async (resolve) => {
    addLogLine('Stopping active VPN connection...');
    
    const stopFile = '/tmp/trusttunnel.stop';
    try {
      await fs.writeFile(stopFile, 'stop', 'utf8');
    } catch (err) {
      addLogLine(`Failed to write stop file: ${err.message}`);
    }
    
    if (vpnProcess) {
      // Send SIGTERM to pkexec wrapper as a backup (ignoring EPERM)
      try {
        vpnProcess.kill('SIGTERM');
      } catch (e) {
        // ignore EPERM
      }
      
      // Wait a moment for normal termination
      setTimeout(() => {
        vpnProcess = null;
        vpnStatus = 'disconnected';
        activeProfile = null;
        sendStatusUpdate();
        addLogLine('VPN stopped.');
        resolve({ success: true });
      }, 1000);
    } else {
      resolve({ success: true });
    }
  });
}

// Setup System Tray
function setupTray() {
  const iconPath = path.join(app.getAppPath(), 'src', 'tray_icon.png');
  
  let finalIconPath = null;
  if (existsSync(iconPath)) {
    finalIconPath = iconPath;
  } else {
    // Try some standard Linux icon locations as fallbacks
    const fallbacks = [
      '/usr/share/icons/Adwaita/scalable/devices/network-vpn-symbolic.svg',
      '/usr/share/icons/hicolor/48x48/apps/network-vpn.png',
      '/usr/share/pixmaps/network-vpn.png',
      '/usr/share/pixmaps/gnome-netstatus-tx.png'
    ];
    for (const f of fallbacks) {
      if (existsSync(f)) {
        finalIconPath = f;
        break;
      }
    }
  }
  
  if (!finalIconPath) {
    console.log('No tray icon found, skipping system tray setup.');
    return;
  }
  
  // Create a minimal tray menu
  tray = new Tray(finalIconPath);
  tray.setToolTip('TrustTunnel VPN');
  updateTrayMenu();
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  
  const statusText = `Status: ${vpnStatus.toUpperCase()}${activeProfile ? ` (${activeProfile})` : ''}`;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'TrustTunnel VPN Client', enabled: false },
    { type: 'separator' },
    { label: statusText, enabled: false },
    {
      label: vpnStatus === 'connected' ? 'Disconnect' : 'Connect Default',
      click: async () => {
        if (vpnStatus === 'connected') {
          await stopActiveVpn();
        } else {
          // Try connecting to default profile
          ipcMain.emit('start-vpn', null, 'default');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Open Client Window',
      click: () => {
        if (mainWindow) mainWindow.show();
      }
    },
    {
      label: 'Quit',
      click: async () => {
        await stopActiveVpn();
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

const createWindow = () => {
  const iconPath = path.join(app.getAppPath(), 'src', 'tray_icon.png');
  mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: true, // We will use standard OS frame but clean CSS inside
    show: false,
    icon: existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Handle external links safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (['http:', 'https:'].includes(parsedUrl.protocol)) {
        shell.openExternal(url);
      }
    } catch (e) {
      console.error('Invalid URL opening attempt:', url);
    }
    return { action: 'deny' };
  });
};

app.whenReady().then(async () => {
  await initProfiles();
  setupIpc();
  createWindow();
  
  try {
    setupTray();
  } catch (e) {
    console.error('Failed to create system tray:', e);
  }
  
  // Periodically check if process crashed or finished externally
  setInterval(checkExistingProcess, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async (e) => {
  if (vpnProcess) {
    e.preventDefault();
    await stopActiveVpn();
    app.isQuitting = true;
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up VPN on exit signals (Ctrl+C in terminal)
const cleanUpAndExit = () => {
  try {
    writeFileSync('/tmp/trusttunnel.stop', 'stop');
  } catch (e) {}
  process.exit(0);
};

process.on('SIGINT', cleanUpAndExit);
process.on('SIGTERM', cleanUpAndExit);
