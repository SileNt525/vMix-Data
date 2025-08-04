/**
 * script.js (最终用户版 - 修复删除逻辑)
 * 修复要点:
 * 1. [核心修复] 重写了 deleteCurrentProfile 函数。现在它会先在前端移除选项，然后显式地将下拉列表重置为有效状态，最后才调用 handleProfileChange 更新UI。这保证了程序不会读取已删除的配置。
 * 2. 保留所有之前的修复。
 */
document.addEventListener('DOMContentLoaded', () => {
    // UI元素
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const vmixUrlInput = document.getElementById('vmix-url');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const addItemForm = document.getElementById('add-item-form');
    const itemNameInput = document.getElementById('item-name');
    const itemValueInput = document.getElementById('item-value');
    const dataManagerSection = document.querySelector('.data-manager');
    
    // 模态对话框元素
    const newProfileModal = document.getElementById('new-profile-modal');
    const newProfileForm = document.getElementById('new-profile-form');
    const newProfileNameInput = document.getElementById('new-profile-name-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // 全局状态
    let currentProfileName = null;
    let currentData = {};
    let serverPort = null;
    
    // --- 辅助函数 ---
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
    
    const renderDataItems = () => {
        const dataItemsContainer = document.getElementById('data-items-container');
        dataItemsContainer.innerHTML = '';
        if (!currentData || Object.keys(currentData).length === 0) {
            dataItemsContainer.innerHTML = '<p class="placeholder">此配置为空，请添加新数据项。</p>';
        } else {
            for (const [key, value] of Object.entries(currentData)) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'data-item';
                itemDiv.innerHTML = `<div class="data-item-info"><div class="data-item-name">${key}</div><div class="data-item-value">${value || ''}</div></div><div class="data-item-actions"><button class="edit-btn">编辑</button><button class="delete-btn">删除</button></div>`;
                itemDiv.querySelector('.edit-btn').addEventListener('click', () => editDataItem(key, value));
                itemDiv.querySelector('.delete-btn').addEventListener('click', () => deleteDataItem(key));
                dataItemsContainer.appendChild(itemDiv);
            }
        }
    };
    
    const updateUIForProfile = (profileData) => {
        currentData = profileData || {};
        const jsonPreviewContent = document.getElementById('json-preview-content');
        jsonPreviewContent.textContent = JSON.stringify(currentData, null, 2);
        renderDataItems();
        updateVmixUrl();
    };

    // --- 核心逻辑 ---
    const loadProfiles = async (selectProfileName = null) => {
        const result = await window.api.getProfiles();
        if (result.success) {
            const profiles = result.data;
            let currentSelection = selectProfileName || profileSelect.value;
            
            // 如果当前选中的项不存在于新的列表中（比如刚被删除），则清空选择
            if (!profiles.includes(currentSelection)) {
                currentSelection = profiles[0] || null;
            }

            profileSelect.innerHTML = '<option value="">-- 选择一个配置 --</option>';
            profiles.forEach(p => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = p;
                profileSelect.appendChild(option);
            });

            profileSelect.value = currentSelection || '';
            await handleProfileChange();
        }
    };

    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        const controlsVisible = !!currentProfileName;
        deleteProfileBtn.disabled = !controlsVisible;

        if (controlsVisible) {
            dataManagerSection.classList.remove('hidden');
        } else {
            dataManagerSection.classList.add('hidden');
        }

        if (!currentProfileName) {
            currentProfileTitle.textContent = '数据项管理';
            updateUIForProfile({});
        } else {
            currentProfileTitle.textContent = `编辑: ${currentProfileName}`;
            const result = await window.api.getProfileData(currentProfileName);
            updateUIForProfile(result.success ? result.data.items : {});
        }
    };
    
    const performProfileCreation = async (profileName) => {
        if (!profileName || !profileName.trim()) return;
        if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
            return alert('配置文件名只能包含字母、数字、下划线和连字符。');
        }
        if (Array.from(profileSelect.options).some(opt => opt.value === profileName)) {
            return alert('该配置文件名称已存在。');
        }

        const result = await window.api.saveProfileData(profileName, {});
        if (result.success) {
            const option = document.createElement('option');
            option.value = profileName;
            option.textContent = profileName;
            profileSelect.appendChild(option);
            profileSelect.value = profileName;
            await handleProfileChange();
        } else {
            alert(`创建失败: ${result.error}`);
        }
    };

    const deleteCurrentProfile = async () => {
        const profileNameToDelete = currentProfileName;
        if (!profileNameToDelete || !confirm(`确定要删除配置文件 "${profileNameToDelete}" 吗？此操作不可撤销。`)) return;

        const result = await window.api.deleteProfile(profileNameToDelete);
        
        if (result.success) {
            await loadProfiles(); // 重新加载列表，loadProfiles内部逻辑已优化，会安全地处理选中项
        } else {
            alert(`删除失败: ${result.error}`);
        }
    };

    const saveDataAndUpdateUI = async (dataToSave) => {
        if (!currentProfileName) return;
        const result = await window.api.saveProfileData(currentProfileName, dataToSave);
        if (result.success) {
            updateUIForProfile(result.data.items);
        } else {
            alert(`保存失败: ${result.error}`);
            await handleProfileChange();
        }
    };

    const addDataItem = async (key, value) => {
        if (currentData.hasOwnProperty(key)) return alert('该数据名称已存在。');
        const newData = { ...currentData, [key]: value };
        await saveDataAndUpdateUI(newData);
    };

    const editDataItem = async (key, currentValue) => {
        const newValue = prompt(`请输入 "${key}" 的新数据值:`, currentValue);
        if (newValue !== null && newValue !== currentValue) {
            const newData = { ...currentData, [key]: newValue };
            await saveDataAndUpdateUI(newData);
        }
    };

    const deleteDataItem = async (key) => {
        if (!confirm(`确定要删除数据项 "${key}" 吗？`)) return;
        const newData = { ...currentData };
        delete newData[key];
        await saveDataAndUpdateUI(newData);
    };

    // --- 事件监听器 ---
    window.api.onServerStarted((port) => {
        serverPort = port;
        const connectionStatusIndicator = document.getElementById('connection-status');
        connectionStatusIndicator.className = 'status-connected';
        connectionStatusIndicator.textContent = '已连接';
        updateVmixUrl();
    });

    profileSelect.addEventListener('change', handleProfileChange);
    newProfileBtn.addEventListener('click', () => {
        newProfileNameInput.value = '';
        newProfileModal.classList.remove('hidden');
        newProfileNameInput.focus();
    });
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

    // 模态对话框事件
    newProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        newProfileModal.classList.add('hidden');
        await performProfileCreation(newProfileNameInput.value);
    });
    
    modalCancelBtn.addEventListener('click', () => {
        newProfileModal.classList.add('hidden');
    });

    // 初始加载
    dataManagerSection.classList.add('hidden');
    loadProfiles();
});