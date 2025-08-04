/**
 * main.js (最终修复版)
 * 职责:
 * 1. 创建和管理应用窗口。
 * 2. 直接在本进程内创建和运行Express服务器。
 * 3. 通过IPC处理所有来自前端的请求，并直接操作文件。
 * 修复要点:
 * 1. [调试] 默认开启开发者工具，方便查看前端console.log的输出。
 * 2. [健壮性] 在文件操作的catch块中增加详细的错误日志打印。
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const cors = require('cors');
const compression = require('compression');

// --- 基础设置 ---
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'profiles');
let mainWindow;
let server;
const serverPort = 8088; // 默认端口

// --- 主程序逻辑 ---

function createWindow(port) {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile('ui/index.html');

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Renderer process finished loading. Sending server-started event.');
        mainWindow.webContents.send('server-started', port);
    });
    
    // [调试] 默认打开开发者工具
    mainWindow.webContents.openDevTools();
}

async function startServer() {
    await fs.mkdir(dataDir, { recursive: true }).catch(error => {
        console.error('Fatal: Could not create data directory.', error);
        dialog.showErrorBox('致命错误', '无法创建数据存储目录，程序即将退出。');
        app.quit();
    });

    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(compression());
    expressApp.use(express.json());

    const API_KEY = process.env.VMIX_API_KEY || 'vmix-default-api-key';

    const accessControl = (req, res, next) => {
        const clientIP = req.ip;
        const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIP);
        if (!isLocal) {
            const apiKey = req.headers['x-api-key'] || req.query.api_key;
            if (!apiKey || apiKey !== API_KEY) {
                return res.status(403).json({ error: 'Forbidden: Invalid API key' });
            }
        }
        next();
    };
    
    expressApp.get('/api/data/:profileName', accessControl, async (req, res) => {
        const filePath = path.join(dataDir, `${req.params.profileName}.json`);
        try {
            const fileData = await fs.readFile(filePath, 'utf8');
            res.setHeader('Content-Type', 'application/json; charset=utf-8').send(fileData);
        } catch (error) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8').send('[{"message":"Profile not found"}]');
        }
    });

    server = expressApp.listen(serverPort, '0.0.0.0', () => {
        const actualPort = server.address().port;
        console.log(`Server started successfully on port ${actualPort}`);
        createWindow(actualPort);
    }).on('error', (err) => {
        console.error('Failed to start server:', err);
        dialog.showErrorBox('服务器启动失败', `无法在端口 ${serverPort} 上启动服务。\n错误: ${err.message}`);
        app.quit();
    });
}

// --- Electron 应用生命周期 ---

app.whenReady().then(() => {
    // --- IPC 处理器 ---
    ipcMain.handle('get-profiles', async () => {
        try {
            const files = await fs.readdir(dataDir);
            return { success: true, data: files.filter(f => f.endsWith('.json')).map(f => path.parse(f).name) };
        } catch (error) {
            console.error('Error getting profiles:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-profile-data', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(data);
            return { success: true, data: { items: Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : {} }};
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: true, data: { items: {} } };
            }
            console.error(`Error getting profile data for ${profileName}:`, error);
            return { success: false, error: 'File invalid or unreadable' };
        }
    });

    ipcMain.handle('save-profile-data', async (event, { profileName, data }) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.writeFile(filePath, JSON.stringify([data], null, 2));
            return { success: true, data: { items: data } };
        } catch (error) {
            console.error(`Error saving profile data for ${profileName}:`, error);
            return { success: false, error: error.message };
        }
    });
    
    ipcMain.handle('delete-profile', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.unlink(filePath);
            return { success: true };
        } catch (error) {
            console.error(`Error deleting profile ${profileName}:`, error);
            return { success: false, error: error.message };
        }
    });

    startServer();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) startServer();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (server) server.close();
        app.quit();
    }
});