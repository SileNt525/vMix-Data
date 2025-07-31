/**
 * main.js
 * 这是 Electron 的主进程文件。
 * 它的职责是：
 * 1. 创建和管理应用的窗口。
 * 2. 启动和管理后端的 Express 服务器子进程。
 * 3. 处理前端通过 IPC (进程间通信) 发送过来的所有请求。
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// 定义存储配置文件的目录，使用 app.getPath('userData') 可以确保在不同操作系统上都有合适的读写权限
const dataDir = path.join(app.getPath('userData'), 'profiles');

// 如果目录不存在，则创建它
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let mainWindow;
let serverProcess;

// 创建浏览器窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 650,
        webPreferences: {
            // 预加载脚本，用于安全地将主进程的功能暴露给渲染进程
            preload: path.join(__dirname, 'preload.js'),
            // 开启上下文隔离，这是 Electron 的安全最佳实践
            contextIsolation: true,
            // 禁止在渲染进程中使用 Node.js API，增强安全性
            nodeIntegration: false,
        },
    });

    // 加载前端的 HTML 文件
    mainWindow.loadFile('ui/index.html');

    // 如果需要，可以打开开发者工具进行调试
    // mainWindow.webContents.openDevTools();
}

// 启动后端服务器子进程
function startServer() {
    const serverPath = path.join(__dirname, 'server.js');
    // 【已修正】使用 fork 启动一个独立的 Node.js 进程来运行服务器
    // 并将数据目录 dataDir 作为一个参数传递给子进程
    serverProcess = fork(serverPath, [dataDir]);

    // 监听来自服务器子进程的消息
    serverProcess.on('message', (msg) => {
        console.log('Message from server:', msg);
        // 如果服务器启动成功，将端口号发送给前端
        if (msg.status === 'SERVER_STARTED' && mainWindow) {
            mainWindow.webContents.send('server-started', msg.port);
        }
    });

    // 监听服务器子进程的退出事件
    serverProcess.on('exit', (code) => {
        console.log(`Server process exited with code ${code}`);
        // 如果服务器异常退出 (code 不为 0)，则显示错误弹窗
        if (code !== 0) {
            dialog.showErrorBox('Server Error', 'The backend server has crashed. Please restart the application.');
        }
    });
}

// 当 Electron 应用准备就绪时
app.whenReady().then(() => {
    // --- 设置 IPC 处理器 ---
    // 这些处理器响应来自前端 (renderer process) 的请求

    // 获取所有配置文件列表
    ipcMain.handle('get-profiles', async () => {
        const files = await fs.promises.readdir(dataDir);
        // 过滤出 .json 文件并移除扩展名
        return files.filter(file => file.endsWith('.json')).map(file => path.parse(file).name);
    });

    // 获取指定配置文件的数据
    ipcMain.handle('get-profile-data', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            const data = await fs.promises.readFile(filePath, 'utf8');
            // vMix 需要的是一个对象数组，我们这里返回数组中的第一个对象给UI编辑
            const parsedData = JSON.parse(data);
            return Array.isArray(parsedData) && parsedData.length > 0 ? parsedData[0] : {};
        } catch (error) {
            // 如果文件不存在，返回一个空对象，表示这是一个新的配置文件
            if (error.code === 'ENOENT') return {};
            console.error('Failed to read profile data:', error);
            return {};
        }
    });

    // 保存配置文件数据
    ipcMain.handle('save-profile-data', async (event, { profileName, data }) => {
        // 校验配置文件名，防止不安全的字符
        if (!profileName || !/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            dialog.showErrorBox('Invalid Profile Name', 'Profile name can only contain letters, numbers, underscores, and hyphens.');
            return { success: false, error: 'Invalid profile name' };
        }
        const filePath = path.join(dataDir, `${profileName}.json`);
        
        // 将数据写入任务发送给服务器子进程处理，由它来完成原子化写入
        // vMix 需要的是一个对象数组，所以我们在这里将对象包装在数组中
        serverProcess.send({ type: 'WRITE_DATA', filePath, data: [data] });
        return { success: true };
    });

    // 删除配置文件
    ipcMain.handle('delete-profile', async (event, profileName) => {
        const filePath = path.join(dataDir, `${profileName}.json`);
        try {
            await fs.promises.unlink(filePath);
            return { success: true };
        } catch (error) {
            console.error('Failed to delete profile:', error);
            return { success: false, error: error.message };
        }
    });

    // 创建应用窗口
    createWindow();
    // 启动后端服务器
    startServer();

    // 在 macOS 上，当点击 dock 图标并且没有其他窗口打开时，重新创建一个窗口
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 当所有窗口都关闭时退出应用
app.on('window-all-closed', () => {
    // 在 macOS 上，应用和菜单栏通常会保持活动状态，直到用户明确退出
    if (process.platform !== 'darwin') {
        // 在关闭应用前，确保杀掉服务器子进程
        if (serverProcess) {
            serverProcess.kill();
        }
        app.quit();
    }
});
