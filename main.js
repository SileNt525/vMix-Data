/**
 * main.js (最终调试版)
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
}

async function startServer() {
    try {
        await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
        dialog.showErrorBox('致命错误', '无法创建数据存储目录，程序即将退出。');
        app.quit();
        return;
    }

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
            if (error.code === 'ENOENT') {
                return { success: true, data: { items: {} } };
            }
            return { success: false, error: 'File invalid or unreadable' };
        }
    });

    // 【关键调试点】
    ipcMain.handle('save-profile-data', async (event, { profileName, data }) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        
        // 调试信息 1: 确认主进程收到了请求
        dialog.showMessageBox(mainWindow, { message: `[调试1] 主进程收到保存请求: ${profileName}\n将要写入路径: ${filePath}` });

        try {
            // vMix 需要一个对象数组
            await fs.writeFile(filePath, JSON.stringify([data], null, 2));
            
            // 调试信息 2: 确认文件写入成功
            dialog.showMessageBox(mainWindow, { message: `[调试2] 文件写入成功: ${profileName}` });

            if(mainWindow) mainWindow.webContents.send('data-updated', { profileName, items: data });
            return { success: true, data: { items: data } };
        } catch (error) {
            // 调试信息 3: 捕获并显示写入错误
            dialog.showErrorBox('写入文件时出错', `无法写入文件: ${filePath}\n\n错误详情: ${error.message}`);
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