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
console.log('获取用户数据目录路径');
const userDataPath = app.getPath('userData');
console.log('用户数据目录路径:', userDataPath);
const dataDir = path.join(userDataPath, 'profiles');
console.log('配置文件目录路径:', dataDir);

// 如果目录不存在，则创建它
console.log('检查配置文件目录是否存在');
if (!fs.existsSync(dataDir)) {
    console.log('配置文件目录不存在，正在创建');
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('配置文件目录创建成功');
    } catch (error) {
        console.error('配置文件目录创建失败:', error.message);
        console.error('错误详情:', error);
    }
} else {
    console.log('配置文件目录已存在');
}

// 检查目录是否可写
console.log('检查配置文件目录是否可写');
try {
    fs.accessSync(dataDir, fs.constants.W_OK);
    console.log('配置文件目录可写');
} catch (error) {
    console.error('配置文件目录不可写:', error.message);
    console.error('错误详情:', error);
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
    console.log('Starting backend server process');
    const serverPath = path.join(__dirname, 'server.js');
    // 【已修正】使用 fork 启动一个独立的 Node.js 进程来运行服务器
    // 并将数据目录 dataDir 作为一个参数传递给子进程
    serverProcess = fork(serverPath, [dataDir]);
    console.log('Backend server process started with PID:', serverProcess.pid);

    // 监听来自服务器子进程的消息
    serverProcess.on('message', (msg) => {
        console.log('Message from server:', msg);
        // 如果服务器启动成功，将端口号发送给前端
        if (msg.status === 'SERVER_STARTED' && mainWindow) {
            console.log(`Server started successfully on port ${msg.port}`);
            mainWindow.webContents.send('server-started', msg.port);
        }
        // 如果服务器启动失败，显示错误信息并通知前端UI
        else if (msg.status === 'SERVER_START_FAILED' && mainWindow) {
            console.log('Server failed to start:', msg);
            // 根据错误类型构建详细的错误消息
            let errorMessage = '服务器启动失败';
            if (msg.error === 'NO_AVAILABLE_PORTS') {
                errorMessage = '服务器启动失败：没有可用的端口\n\n';
                if (msg.portCheckResults && Array.isArray(msg.portCheckResults)) {
                    errorMessage += '端口检查结果:\n';
                    msg.portCheckResults.forEach(result => {
                        if (result.available) {
                            errorMessage += `端口 ${result.port}: 可用\n`;
                        } else {
                            switch (result.reason) {
                                case 'PORT_IN_USE':
                                    errorMessage += `端口 ${result.port}: 已被占用\n`;
                                    break;
                                case 'PERMISSION_DENIED':
                                    errorMessage += `端口 ${result.port}: 权限被拒绝\n`;
                                    break;
                                default:
                                    errorMessage += `端口 ${result.port}: 不可用\n`;
                            }
                        }
                    });
                }
            } else if (msg.error === 'PORT_IN_USE') {
                errorMessage = `服务器启动失败：端口 ${msg.port || 'unknown'} 已被占用`;
            } else if (msg.error === 'PERMISSION_DENIED') {
                errorMessage = `服务器启动失败：权限被拒绝，无法绑定到端口 ${msg.port || 'unknown'}`;
            } else if (msg.message) {
                errorMessage = `服务器启动失败：${msg.message}`;
            }
            
            // 显示错误弹窗给用户
            dialog.showErrorBox('服务器启动失败', errorMessage);
            
            // 通知前端UI显示错误状态
            mainWindow.webContents.send('server-start-failed', {
                error: msg.error,
                message: errorMessage,
                port: msg.port,
                portCheckResults: msg.portCheckResults
            });
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
        console.log('Received save-profile-data request:', { profileName, data });
        // 校验配置文件名，防止不安全的字符
        if (!profileName || !/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            console.log('Invalid profile name:', profileName);
            dialog.showErrorBox('Invalid Profile Name', 'Profile name can only contain letters, numbers, underscores, and hyphens.');
            return { success: false, error: 'Invalid profile name' };
        }
        const filePath = path.join(dataDir, `${profileName}.json`);
        console.log('Saving profile data to:', filePath);
        
        // 将数据写入任务发送给服务器子进程处理，由它来完成原子化写入
        // vMix 需要的是一个对象数组，所以我们在这里将对象包装在数组中
        console.log('Sending WRITE_DATA message to server process');
        serverProcess.send({ type: 'WRITE_DATA', filePath, data: [data] });
        console.log('WRITE_DATA message sent to server process');
        return { success: true };
    });

    // 删除配置文件
    ipcMain.handle('delete-profile', async (event, profileName) => {
        // 校验配置文件名
        if (!profileName) {
            return { success: false, error: 'Invalid profile name' };
        }
        const filePath = path.join(dataDir, `${profileName}.json`);
        // 将删除任务发送给服务器子进程处理，以保持文件操作的统一性
        serverProcess.send({ type: 'DELETE_FILE', filePath });
        // 这是一个乐观的返回，UI将刷新列表，删除的配置将消失
        return { success: true };
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
