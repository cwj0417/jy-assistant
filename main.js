const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const AdmZip = require('adm-zip');
const https = require('https');
const http = require('http');
const fs = require('fs');

const store = new Store();
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 520,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  // 构建菜单
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu', label: '应用', submenu: [
      { label: '关于剪映助手', click: () => checkForUpdates() },
      { type: 'separator' },
      { role: 'quit', label: '退出剪映助手' },
    ]}] : []),
    {
      label: '文件',
      submenu: [
        { label: '检查更新...', click: () => checkForUpdates() },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: '全部置于前面' },
        ] : []),
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // 启动时自动检查更新
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// --- 自动更新 ---
autoUpdater.autoDownload = false;

autoUpdater.on('update-available', (info) => {
  console.log('[updater] 发现新版本:', info.version);
  mainWindow.webContents.send('update-status', {
    type: 'available',
    version: info.version,
  });
  // 发现更新后自动下载
  autoUpdater.downloadUpdate();
});

autoUpdater.on('update-not-available', () => {
  console.log('[updater] 已是最新版本');
  mainWindow.webContents.send('update-status', { type: 'not-available' });
});

autoUpdater.on('download-progress', (progress) => {
  mainWindow.webContents.send('update-status', {
    type: 'downloading',
    percent: progress.percent,
  });
});

autoUpdater.on('update-downloaded', () => {
  console.log('[updater] 更新下载完成');
  mainWindow.webContents.send('update-status', { type: 'downloaded' });
});

autoUpdater.on('error', (err) => {
  console.error('[updater] 错误:', err.message);
  mainWindow.webContents.send('update-status', {
    type: 'error',
    message: err.message,
  });
});

function checkForUpdates() {
  if (!app.isPackaged) {
    mainWindow.webContents.send('update-status', {
      type: 'error',
      message: '开发模式下无法检查更新',
    });
    return;
  }
  autoUpdater.checkForUpdates();
}

// --- IPC 处理 ---

// 获取草稿路径
ipcMain.handle('get-draft-path', () => {
  return store.get('draftPath', '');
});

// 设置草稿路径
ipcMain.handle('set-draft-path', async (_, dirPath) => {
  store.set('draftPath', dirPath);
  return dirPath;
});

// 选择文件夹对话框
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// 下载并解压
ipcMain.handle('download-and-extract', async (_, { apiKey, draftId }) => {
  const draftPath = store.get('draftPath', '');
  if (!draftPath) {
    console.log('[export] 草稿路径未设置');
    return { success: false, error: '请先设置剪映草稿路径' };
  }

  try {
    const apiUrl = `http://49.235.60.245:8080/plugin/v1/tools/video/draft/${draftId}/step/jianying-pack`;
    const body = JSON.stringify({
      draftFoldPath: draftPath,
    });

    console.log('[export] 请求URL:', apiUrl);
    console.log('[export] 请求Body:', body);

    const respBuffer = await postJson(apiUrl, body, apiKey);
    const respText = respBuffer.toString('utf8');
    console.log('[export] 响应内容:', respText);

    const resp = JSON.parse(respText);
    const packUrl = resp.packUrl || resp.data?.packUrl;
    if (!packUrl) {
      return { success: false, error: '响应中未找到 packUrl' };
    }

    console.log('[export] packUrl:', packUrl);
    const zipBuffer = await downloadFile(packUrl);
    console.log('[export] zip大小:', zipBuffer.length, 'bytes');

    const zip = new AdmZip(zipBuffer);
    console.log('[export] zip条目数:', zip.getEntries().length);
    zip.getEntries().forEach(e => console.log('[export]  -', e.entryName));

    zip.extractAllTo(draftPath, true);
    console.log('[export] 解压完成，目标路径:', draftPath);
    return { success: true };
  } catch (err) {
    console.error('[export] 失败:', err.message);
    return { success: false, error: err.message };
  }
});

// 下载更新
ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate();
});

// 安装更新
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// 检查更新
ipcMain.handle('check-update', () => {
  checkForUpdates();
});

// GET下载文件并返回buffer
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败，状态码: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// POST JSON请求并返回响应buffer
function postJson(url, body, apiKey) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
        'Accept': '*/*',
      },
    };
    console.log('[http] POST', urlObj.hostname + ':' + urlObj.port + urlObj.pathname);
    console.log('[http] Authorization:', apiKey);
    console.log('[http] Body:', body);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      console.log('[http] 响应状态码:', res.statusCode);
      console.log('[http] 响应Content-Type:', res.headers['content-type']);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log('[http] 重定向到:', res.headers.location);
        return postJson(res.headers.location, body, apiKey).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        let errMsg = '';
        res.on('data', (c) => errMsg += c);
        res.on('end', () => {
          console.error('[http] 请求失败:', res.statusCode, errMsg);
          reject(new Error(`请求失败，状态码: ${res.statusCode} ${errMsg}`));
        });
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', (err) => {
      console.error('[http] 请求错误:', err.message);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
