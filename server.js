/**
 * server.js
 * 这是一个独立的 Node.js 进程，运行一个 Express 服务器。
 * 它的职责是：
 * 1. 提供一个 HTTP GET 端点，供 vMix 轮询以获取最新的 JSON 数据。
 * 2. 接收来自主进程的消息，以原子方式将数据写入文件系统，确保数据安全。
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { writeFile } = require('atomically'); // 使用 atomically 库来保证文件写入的原子性

const app = express();
const PORT = 8088; // 定义服务器端口

// 【已修正】从主进程启动时传递的命令行参数中获取数据目录
// process.argv 是一个数组，[0]是node程序路径, [1]是本脚本路径, [2]是第一个参数
const dataDir = process.argv[2]; 
if (!dataDir) {
    console.error('Data directory not provided. Server is exiting.');
    process.exit(1); // 如果没有提供目录，则退出并返回一个错误码
}

app.use(cors()); // 允许跨域请求
app.use(express.json()); // 解析 JSON 请求体

// --- API 端点 ---
// 这是 vMix 将要轮询的端点
app.get('/api/data/:profileName', (req, res) => {
    const { profileName } = req.params;
    const filePath = path.join(dataDir, `${profileName}.json`);

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            // 如果文件不存在，返回 404
            if (err.code === 'ENOENT') {
                // 返回一个空的有效JSON数组，防止vMix出错
                return res.status(404).json([]);
            }
            // 其他错误返回 500
            return res.status(500).json({ error: 'Failed to read profile data' });
        }
        // 成功读取文件，返回其内容
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    });
});

// --- 进程消息监听器 ---
// 监听来自主进程的消息，执行文件写入操作
process.on('message', async (msg) => {
    if (msg.type === 'WRITE_DATA') {
        const { filePath, data } = msg;
        try {
            // 使用 atomically.writeFile 来安全地写入文件
            // 它会先写入一个临时文件，成功后再重命名，防止vMix读到不完整的数据
            await writeFile(filePath, JSON.stringify(data, null, 2));
            // console.log(`Data written to ${filePath}`);
        } catch (error) {
            console.error('Atomic write failed:', error);
        }
    } else if (msg.type === 'DELETE_FILE') {
        // 接收主进程的删除文件指令
        fs.unlink(msg.filePath, (err) => {
            // 如果文件不存在 (ENOENT)，则忽略错误，否则打印错误
            if (err && err.code !== 'ENOENT') {
                console.error('Failed to delete file:', err);
            }
        });
    }
});

// 启动服务器
app.listen(PORT, '127.0.0.1', () => {
    // 通知主进程服务器已成功启动，并传递端口号
    if (process.send) {
        process.send({ status: 'SERVER_STARTED', port: PORT });
    }
    console.log(`vMix Data Server listening at http://127.0.0.1:${PORT}`);
});
