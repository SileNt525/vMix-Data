/**
 * script.js
 * 这是前端的 JavaScript 逻辑文件。
 * 它的职责是：
 * 1. 处理用户界面上的所有交互（点击按钮、输入文本等）。
 * 2. 通过 preload.js 暴露的 'electronAPI' 与主进程通信，来加载、保存和管理数据。
 * 3. 动态地在页面上创建和移除数据字段输入框。
 */
document.addEventListener('DOMContentLoaded', () => {
    // 获取页面上的所有交互元素
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const dataFieldsContainer = document.getElementById('data-fields-container');
    const addFieldBtn = document.getElementById('add-field-btn');
    const currentProfileTitle = document.getElementById('current-profile-title');

    let currentProfile = '';
    let serverPort = 8088; // 默认端口，会被主进程更新

    // --- 核心功能函数 ---

    // 从后端加载所有配置文件并填充下拉列表
    async function loadProfiles() {
        const profiles = await window.electronAPI.getProfiles();
        profileSelect.innerHTML = '';
        
        let profileToSelect = profiles[0];
        if (profiles.length === 0) {
            // 如果没有任何配置文件，创建一个默认的
            profileToSelect = 'default';
            profiles.push(profileToSelect);
        }

        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });
        
        // 选中第一个或默认的配置文件
        await selectProfile(profileToSelect);
    }

    // 当用户选择一个配置文件时，加载其数据
    async function selectProfile(profileName) {
        if (!profileName) {
            dataFieldsContainer.innerHTML = '';
            vmixUrlInput.value = '';
            currentProfileTitle.textContent = '数据字段';
            currentProfile = '';
            return;
        }

        currentProfile = profileName;
        profileSelect.value = currentProfile;
        vmixUrlInput.value = `http://127.0.0.1:${serverPort}/api/data/${currentProfile}`;
        currentProfileTitle.textContent = `数据字段 (${currentProfile})`;

        // 从后端获取数据并渲染到界面
        const data = await window.electronAPI.getProfileData(currentProfile);
        renderDataFields(data || {});
    }

    // 根据数据对象，动态创建键值对输入框
    function renderDataFields(data) {
        dataFieldsContainer.innerHTML = '';
        Object.entries(data).forEach(([key, value]) => {
            createFieldRow(key, value);
        });
    }

    // 创建一行键值对输入框和移除按钮
    function createFieldRow(key = '', value = '') {
        const row = document.createElement('div');
        row.className = 'data-field-row';
        row.innerHTML = `
            <input type="text" class="key-input" placeholder="Key (键)" value="${key}">
            <input type="text" class="value-input" placeholder="Value (值)" value="${value}">
            <button class="remove-field-btn">移除</button>
        `;
        dataFieldsContainer.appendChild(row);
    }

    // 收集当前界面上所有键值对，并发送到后端保存
    async function collectAndSaveData() {
        if (!currentProfile) return;

        const data = {};
        const rows = dataFieldsContainer.querySelectorAll('.data-field-row');
        rows.forEach(row => {
            const keyInput = row.querySelector('.key-input');
            const valueInput = row.querySelector('.value-input');
            const key = keyInput.value.trim();
            if (key) { // 只有当 "key" 不为空时才保存
                data[key] = valueInput.value;
            }
        });

        // 通过 electronAPI 发送数据到主进程
        await window.electronAPI.saveProfileData({ profileName: currentProfile, data });
    }

    // --- 事件监听器 ---

    // "新建" 按钮
    newProfileBtn.addEventListener('click', () => {
        const profileName = prompt('请输入新的配置文件名称 (只能使用字母, 数字, -, _):');
        if (profileName && /^[a-zA-Z0-9_-]+$/.test(profileName)) {
            // 检查是否已存在
            if ([...profileSelect.options].some(opt => opt.value === profileName)) {
                alert('该名称已存在！');
                return;
            }
            const option = document.createElement('option');
            option.value = profileName;
            option.textContent = profileName;
            profileSelect.appendChild(option);
            selectProfile(profileName);
            collectAndSaveData(); // 保存一个空的配置
        } else if (profileName) {
            alert('名称无效。请只使用字母, 数字, 下划线, 和连字符。');
        }
    });

    // "删除" 按钮
    deleteProfileBtn.addEventListener('click', async () => {
        const selectedProfile = profileSelect.value;
        if (selectedProfile && confirm(`您确定要删除配置文件 "${selectedProfile}" 吗？此操作无法撤销。`)) {
            const result = await window.electronAPI.deleteProfile(selectedProfile);
            if (result.success) {
                await loadProfiles(); // 重新加载配置文件列表
            } else {
                alert(`删除失败: ${result.error}`);
            }
        }
    });

    // 下拉列表切换事件
    profileSelect.addEventListener('change', () => {
        selectProfile(profileSelect.value);
    });

    // "添加字段" 按钮
    addFieldBtn.addEventListener('click', () => {
        createFieldRow();
    });

    // 使用事件委托处理 "移除" 按钮的点击和输入框的实时输入
    dataFieldsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-field-btn')) {
            e.target.closest('.data-field-row').remove();
            collectAndSaveData(); // 移除后立即保存
        }
    });

    dataFieldsContainer.addEventListener('input', () => {
        // 使用 debounce 防止过于频繁的保存操作
        // (简单实现，不引入额外库)
        clearTimeout(window.saveTimeout);
        window.saveTimeout = setTimeout(collectAndSaveData, 300);
    });

    // URL 输入框点击时自动复制
    vmixUrlInput.addEventListener('click', () => {
        vmixUrlInput.select();
        document.execCommand('copy');
        // 可以添加一个简单的提示，比如改变边框颜色
        vmixUrlInput.style.boxShadow = '0 0 0 2px var(--success-color)';
        setTimeout(() => {
            vmixUrlInput.style.boxShadow = '';
        }, 1000);
    });
    
    // --- 初始化 ---
    // 监听主进程发来的服务器端口号
    window.electronAPI.onServerStarted((port) => {
        console.log(`Server started on port: ${port}`);
        serverPort = port;
        // 服务器启动后，加载配置文件并更新URL
        loadProfiles();
    });
});
