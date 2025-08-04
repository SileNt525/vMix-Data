/**
 * main.js (最终修复版)
 * 职责:
 * 1. 创建和管理应用窗口。
 * 2. 直接在本进程内创建和运行Express服务器。
 * 3. 通过IPC处理所有来自前端的请求，并直接操作文件。
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

// 创建应用窗口
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

    // 关键：确保渲染进程完全加载后再发送端口信息
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Renderer process finished loading. Sending server-started event.');
        mainWindow.webContents.send('server-started', port);
    });
    
    // 打开开发者工具，方便调试
    // mainWindow.webContents.openDevTools();
}

// 启动Express服务器
async function startServer() {
    // 确保数据目录存在
    try {
        await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
        console.error('Fatal: Could not create data directory.', error);
        dialog.showErrorBox('致命错误', '无法创建数据存储目录，程序即将退出。');
        app.quit();
        return;
    }

    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(compression());
    expressApp.use(express.json());

    const API_KEY = process.env.VMIX_API_KEY || 'vmix-default-api-key';

    // 访问控制中间件
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
    
    // API 端点
    expressApp.get('/api/data/:profileName', accessControl, async (req, res) => {
        const filePath = path.join(dataDir, `${req.params.profileName}.json`);
        try {
            const fileData = await fs.readFile(filePath, 'utf8');
            res.setHeader('Content-Type', 'application/json; charset=utf-8').send(fileData);
        } catch (error) {
            // vMix需要一个有效的JSON数组，即使是空的
            res.setHeader('Content-Type', 'application/json; charset=utf-8').send('[{"message":"Profile not found"}]');
        }
    });

    // 启动服务器监听
    server = expressApp.listen(serverPort, '0.0.0.0', () => {
        const actualPort = server.address().port;
        console.log(`Server started successfully on port ${actualPort}`);
        // 服务器成功启动后，创建窗口
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
            // 如果文件不存在，这是正常情况，返回成功和空数据
            if (error.code === 'ENOENT') {
                return { success: true, data: { items: {} } };
            }
            return { success: false, error: 'File invalid or unreadable' };
        }
    });

    ipcMain.handle('save-profile-data', async (event, { profileName, data }) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            // vMix 需要一个对象数组
            await fs.writeFile(filePath, JSON.stringify([data], null, 2));
            // 通知前端更新
            if(mainWindow) mainWindow.webContents.send('data-updated', { profileName, items: data });
            return { success: true, data: { items: data } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    
    ipcMain.handle('delete-profile', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.unlink(filePath);
            return { success: true };
        } catch (error) {
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