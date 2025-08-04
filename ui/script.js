/**
 * script.js (最终修复版)
 */
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
    
    // --- UI 更新函数 ---
    const updateConnectionStatus = (status) => {
        connectionStatusIndicator.className = '';
        connectionStatusIndicator.textContent = {
            connected: '已连接',
            disconnected: '未连接'
        }[status] || '未知';
        connectionStatusIndicator.classList.add(`status-${status}`);
    };

    const updateVmixUrl = () => {
        if (serverPort && currentProfileName) {
            const url = `http://127.0.0.1:${serverPort}/api/data/${currentProfileName}`;
            vmixUrlInput.value = url;
            vmixUrlInput.title = `远程访问: http://<本机IP>:${serverPort}/api/data/${currentProfileName}?api_key=vmix-default-api-key`;
        } else {
            vmixUrlInput.value = '请选择或创建一个配置文件';
            vmixUrlInput.title = '';
        }
    };
    
    const renderDataItems = (data) => {
        dataItemsContainer.innerHTML = '';
        if (Object.keys(data).length === 0) {
            dataItemsContainer.innerHTML = '<p class="placeholder">此配置为空，请添加新数据项。</p>';
        }
        for (const [key, value] of Object.entries(data)) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'data-item';
            itemDiv.innerHTML = `<div class="data-item-info"><div class="data-item-name">${key}</div><div class="data-item-value">${value || ''}</div></div><div class="data-item-actions"><button class="edit-btn">编辑</button><button class="delete-btn">删除</button></div>`;
            itemDiv.querySelector('.edit-btn').addEventListener('click', () => editDataItem(key, value));
            itemDiv.querySelector('.delete-btn').addEventListener('click', () => deleteDataItem(key));
            dataItemsContainer.appendChild(itemDiv);
        }
    };
    
    const updateJsonPreview = (data) => {
        jsonPreviewContent.textContent = JSON.stringify(data, null, 2);
    };
    
    const updateUIForProfile = (profileData) => {
        currentData = profileData;
        renderDataItems(currentData);
        updateJsonPreview(currentData);
        updateVmixUrl();
    };

    // --- 数据逻辑函数 ---
    const saveData = async () => {
        if (!currentProfileName) return;
        await window.api.saveProfileData(currentProfileName, currentData);
    };

    const loadProfiles = async (selectProfileName = null) => {
        const result = await window.api.getProfiles();
        if (result.success) {
            const profiles = result.data;
            const currentSelection = selectProfileName || profileSelect.value || profiles[0];
            
            profileSelect.innerHTML = '<option value="">-- 选择一个配置 --</option>';
            profiles.forEach(p => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = p;
                profileSelect.appendChild(option);
            });
            
            profileSelect.value = profiles.includes(currentSelection) ? currentSelection : '';
            await handleProfileChange();
        }
    };

    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        const controlsVisible = !!currentProfileName;
        deleteProfileBtn.disabled = !controlsVisible;
        dataItemsContainer.parentElement.style.display = controlsVisible ? 'block' : 'none';
        addItemForm.style.display = controlsVisible ? 'block' : 'none';
        jsonPreviewContent.parentElement.style.display = controlsVisible ? 'block' : 'none';
        
        if (!currentProfileName) {
            currentProfileTitle.textContent = '数据项管理';
            updateUIForProfile({});
        } else {
            currentProfileTitle.textContent = `编辑: ${currentProfileName}`;
            const result = await window.api.getProfileData(currentProfileName);
            updateUIForProfile(result.success ? result.data.items : {});
        }
    };
    
    const createNewProfile = async () => {
        const profileName = prompt('请输入新配置文件的名称:');
        if (!profileName) return;

        if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            return alert('配置文件名只能包含字母、数字、下划线和连字符。');
        }
        
        const result = await window.api.saveProfileData(profileName, {});
        if (result.success) {
            await loadProfiles(profileName);
        } else {
            alert(`创建失败: ${result.error}`);
        }
    };

    const deleteCurrentProfile = async () => {
        if (!currentProfileName || !confirm(`确定要删除配置文件 "${currentProfileName}" 吗？此操作不可撤销。`)) return;
        const result = await window.api.deleteProfile(currentProfileName);
        if (result.success) {
            await loadProfiles();
        } else {
            alert(`删除失败: ${result.error}`);
        }
    };

    const addDataItem = async (key, value) => {
        if (currentData.hasOwnProperty(key)) return alert('该数据名称已存在。');
        currentData[key] = value;
        await saveData();
    };

    const editDataItem = async (key, currentValue) => {
        const newValue = prompt(`请输入 "${key}" 的新数据值:`, currentValue);
        if (newValue !== null && newValue !== currentValue) {
            currentData[key] = newValue;
            await saveData();
        }
    };

    const deleteDataItem = async (key) => {
        if (!confirm(`确定要删除数据项 "${key}" 吗？`)) return;
        delete currentData[key];
        await saveData();
    };

    // --- 事件监听器 ---
    window.api.onServerStarted((port) => {
        console.log(`UI received server-started on port: ${port}`);
        serverPort = port;
        updateConnectionStatus('connected');
        updateVmixUrl();
    });

    window.api.onDataUpdated(({ profileName, items }) => {
        if (profileName === currentProfileName) {
            console.log(`UI received data-updated for ${profileName}`);
            updateUIForProfile(items);
        }
    });

    profileSelect.addEventListener('change', handleProfileChange);
    newProfileBtn.addEventListener('click', createNewProfile);
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);
    
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = itemNameInput.value.trim();
        const value = itemValueInput.value;
        if (!key) return alert('数据名称不能为空。');
        
        await addDataItem(key, value);
        itemNameInput.value = '';
        itemValueInput.value = '';
        itemNameInput.focus();
    });

    // --- 初始化 ---
    loadProfiles();
});