document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 元素获取 ---
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const connectionStatusIndicator = document.getElementById('connection-status');
    const addItemForm = document.getElementById('add-item-form');
    const itemNameInput = document.getElementById('item-name');
    const itemValueInput = document.getElementById('item-value');
    const dataItemsContainer = document.getElementById('data-items-container');
    const jsonPreviewContent = document.getElementById('json-preview-content');

    // --- 应用状态 ---
    let currentProfileName = null;
    let serverPort = null;
    let currentData = {};
    let websocket = null;
    let reconnectTimeout = null;
    let reconnectAttempts = 0;
    let heartbeatInterval = null;

    // --- 函数定义 ---

    const updateVmixUrl = () => {
        if (serverPort && currentProfileName) {
            const url = `http://127.0.0.1:${serverPort}/api/data/${currentProfileName}`;
            vmixUrlInput.value = url;
            vmixUrlInput.title = `点击复制。远程访问URL: http://<您的IP>:${serverPort}/api/data/${currentProfileName}?api_key=vmix-default-api-key`;
        } else {
            vmixUrlInput.value = '请先选择或创建一个配置文件';
            vmixUrlInput.title = '';
        }
    };
    
    const connectWebSocket = () => {
        if (websocket && websocket.readyState === WebSocket.OPEN) return;
        if (!serverPort) {
            console.log('Server port not set, WebSocket connection skipped.');
            return;
        }

        try {
            const wsUrl = `ws://127.0.0.1:${serverPort}`;
            console.log(`Attempting to connect WebSocket to ${wsUrl}`);
            websocket = new WebSocket(wsUrl);
            
            websocket.onopen = () => {
                console.log('WebSocket connection established');
                reconnectAttempts = 0;
                updateConnectionStatus('connected');
                startHeartbeat();
            };
            
            websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.type === 'dataUpdate' && message.profileName === currentProfileName) {
                    console.log(`Received data update for profile: ${message.profileName}`);
                    handleWebSocketMessage(message);
                }
            };
            
            websocket.onclose = (event) => {
                console.log('WebSocket connection closed', event);
                updateConnectionStatus('disconnected');
                scheduleReconnect();
            };
            
            websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                updateConnectionStatus('error');
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            updateConnectionStatus('error');
            scheduleReconnect();
        }
    };

    const handleWebSocketMessage = (message) => {
         if (message.changes) {
            for (const [key, value] of Object.entries(message.changes)) {
                if (value === null) delete currentData[key];
                else currentData[key] = value;
            }
        }
        renderDataItems(currentData);
        updateJsonPreview(currentData);
    };

    const updateConnectionStatus = (status) => {
        if (!connectionStatusIndicator) return;
        connectionStatusIndicator.classList.remove('status-connected', 'status-disconnected', 'status-error');
        switch (status) {
            case 'connected':
                connectionStatusIndicator.textContent = '已连接';
                connectionStatusIndicator.classList.add('status-connected');
                break;
            case 'disconnected':
                connectionStatusIndicator.textContent = '未连接';
                connectionStatusIndicator.classList.add('status-disconnected');
                break;
            case 'error':
                connectionStatusIndicator.textContent = '连接错误';
                connectionStatusIndicator.classList.add('status-error');
                break;
        }
    };

    const startHeartbeat = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    };
    
    const stopHeartbeat = () => clearInterval(heartbeatInterval);

    const scheduleReconnect = () => {
        stopHeartbeat();
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (reconnectAttempts >= 10) {
            console.log('Max reconnect attempts reached.');
            return;
        }
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        console.log(`Scheduling reconnect attempt in ${delay}ms`);
        reconnectTimeout = setTimeout(connectWebSocket, delay);
    };

    const loadProfiles = async () => {
        const profiles = await window.api.getProfiles();
        const previouslySelected = profileSelect.value;
        profileSelect.innerHTML = '<option value="">-- 选择一个配置 --</option>';
        profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });
        if (profiles.includes(previouslySelected)) {
            profileSelect.value = previouslySelected;
        } else {
            profileSelect.value = '';
        }
        handleProfileChange();
    };

    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        deleteProfileBtn.disabled = !currentProfileName;

        if (!currentProfileName) {
            currentData = {};
            currentProfileTitle.textContent = '数据项管理';
            dataItemsContainer.innerHTML = '<p class="placeholder">请从上方选择一个配置文件进行编辑，或点击"新建"来创建一个新的配置。</p>';
            jsonPreviewContent.textContent = '{}';
        } else {
            currentProfileTitle.textContent = `编辑: ${currentProfileName}`;
            const result = await window.api.getProfileData(currentProfileName);
            if (result.success) {
                currentData = result.data.items || {};
                renderDataItems(currentData);
                updateJsonPreview(currentData);
            } else {
                console.error('Failed to load profile data:', result.error);
                dataItemsContainer.innerHTML = '<p class="placeholder">加载数据时出错。</p>';
                jsonPreviewContent.textContent = '{}';
                currentData = {};
            }
        }
        updateVmixUrl();
    };

    const renderDataItems = (data) => {
        dataItemsContainer.innerHTML = '';
        if (Object.keys(data).length === 0) {
            dataItemsContainer.innerHTML = '<p class="placeholder">此配置为空，请添加新数据项。</p>';
            return;
        }
        for (const key in data) {
            createDataItem(key, data[key]);
        }
    };

    const createDataItem = (key, value) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'data-item';
        itemDiv.dataset.key = key;
        itemDiv.innerHTML = `<div class="data-item-info"><div class="data-item-name">${key}</div><div class="data-item-value">${value}</div></div><div class="data-item-actions"><button class="edit-btn">编辑</button><button class="delete-btn">删除</button></div>`;
        itemDiv.querySelector('.edit-btn').addEventListener('click', () => {
            const newValue = prompt(`请输入 "${key}" 的新数据值:`, value);
            if (newValue !== null) updateDataItem(key, newValue);
        });
        itemDiv.querySelector('.delete-btn').addEventListener('click', () => {
            if (confirm(`确定要删除数据项 "${key}" 吗？`)) deleteDataItem(key);
        });
        dataItemsContainer.appendChild(itemDiv);
    };

    const updateJsonPreview = (data) => {
        jsonPreviewContent.textContent = JSON.stringify(data, null, 2);
    };

    const addDataItem = async (key, value) => {
        if (currentData.hasOwnProperty(key)) {
            alert(`数据项 "${key}" 已存在，请使用不同的名称。`);
            return false;
        }
        const result = await window.api.addItem(currentProfileName, key, value);
        if (result.success) {
            currentData = result.data.items || {};
            renderDataItems(currentData);
            updateJsonPreview(currentData);
            return true;
        } else {
            alert(`添加数据项失败: ${result.data?.error || result.error}`);
            return false;
        }
    };
    
    const updateDataItem = async (key, value) => {
        const result = await window.api.updateItem(currentProfileName, key, value);
        if (result.success) {
            currentData = result.data.items || {};
            renderDataItems(currentData);
            updateJsonPreview(currentData);
        } else {
            alert(`更新数据项失败: ${result.data?.error || result.error}`);
        }
    };

    const deleteDataItem = async (key) => {
        const result = await window.api.deleteItem(currentProfileName, key);
        if (result.success) {
            currentData = result.data.items || {};
            renderDataItems(currentData);
            updateJsonPreview(currentData);
        } else {
            alert(`删除数据项失败: ${result.data?.error || result.error}`);
        }
    };

    const validateDataItemKey = (key) => {
        if (!key.trim()) {
            alert('数据名称不能为空。');
            return false;
        }
        if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(key)) {
            alert('数据名称只能包含字母、数字、下划线、连字符和中文字符。');
            return false;
        }
        return true;
    };
    
    // 【已修正】新建配置文件的逻辑
    const createNewProfile = async () => {
        const profileName = prompt('请输入新配置文件的名称:');
        if (!profileName) return;

        if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            alert('配置文件名只能包含字母、数字、下划线和连字符。');
            return;
        }

        const result = await window.api.createEmptyProfile(profileName);

        if (result.success) {
            await loadProfiles();
            profileSelect.value = profileName;
            handleProfileChange();
        } else {
            alert(`创建失败: ${result.error}`);
        }
    };

    const deleteCurrentProfile = async () => {
        if (!currentProfileName) return;
        if (!confirm(`确定要删除配置文件 "${currentProfileName}" 吗？此操作不可撤销。`)) return;

        const result = await window.api.deleteProfile(currentProfileName);
        if (result.success) {
            loadProfiles();
        } else {
            alert('删除配置文件失败，请查看控制台了解详情。');
        }
    };

    // --- 事件监听器 ---
    
    // 【已修正】服务器启动后，立即连接 WebSocket
    window.api.onServerStarted((port) => {
        console.log(`Server started on port: ${port}`);
        serverPort = port;
        connectWebSocket(); // 立即连接
        updateVmixUrl(); // 更新URL显示
    });

    profileSelect.addEventListener('change', handleProfileChange);
    newProfileBtn.addEventListener('click', createNewProfile);
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);
    
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentProfileName) {
            alert('请先选择一个配置文件。');
            return;
        }
        const key = itemNameInput.value.trim();
        const value = itemValueInput.value;
        if (!validateDataItemKey(key)) return;
        
        if (await addDataItem(key, value)) {
            itemNameInput.value = '';
            itemValueInput.value = '';
            itemNameInput.focus();
        }
    });

    // --- 初始化 ---
    loadProfiles();
});