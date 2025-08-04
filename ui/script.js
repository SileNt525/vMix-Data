/**
 * ui/script.js (Definitive-Fix v2)
 *
 * Key Fixes:
 * 1.  [USE DEDICATED CREATION API]: The new profile form now calls `window.api.createProfile(name)` instead of the generic save function. It awaits the result and only proceeds on success, ensuring the file exists before the UI tries to load it.
 * 2.  [CHECK EVERY SAVE]: All functions that write data (`debouncedSaveData`, `createNewProfile`, `saveCustomTemplates`, `deleteCustomTemplate`) now properly `await` the API call and check the `result.success` flag.
 * 3.  [IMMEDIATE USER FEEDBACK]: If any save operation fails, an alert with a descriptive error is shown immediately.
 * 4.  [STATE SYNC ON SUCCESS]: The local state (e.g., `CUSTOM_TEMPLATES`) is now only updated *after* a successful save confirmation from the backend, guaranteeing UI and disk are in sync.
 */
document.addEventListener('DOMContentLoaded', () => {
    // === UI Elements & State ===
    const profileSelect = document.getElementById('profile-select');
    const newProfileBtn = document.getElementById('new-profile-btn');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const connectionText = document.getElementById('connection-text');
    const currentProfileTitle = document.getElementById('current-profile-title');
    const addTemplateInstanceBtn = document.getElementById('add-template-instance-btn');
    const templateInstancesContainer = document.getElementById('template-instances-container');
    const welcomeMessage = document.getElementById('welcome-message');
    const templateList = document.getElementById('template-list');
    const addNewTemplateBtn = document.getElementById('add-new-template-btn');
    const newProfileModal = document.getElementById('new-profile-modal');
    const addTemplateInstanceModal = document.getElementById('add-template-instance-modal');
    const templateEditorModal = document.getElementById('template-editor-modal');
    
    let serverPort = null;
    let currentProfileName = null;
    let currentProfileData = [];
    let debounceTimer = null;
    let CUSTOM_TEMPLATES = {};
    let ALL_TEMPLATES = {};

    const PREDEFINED_TEMPLATES = {
        "basic_scoreboard": { name: "通用比分牌", items: { "team_a_name": "主队", "team_a_score": "0", "team_b_name": "客队", "team_b_score": "0" }, predef: true },
        "basketball_stats": { name: "篮球技术统计", items: { "fouls": "0", "timeouts": "3", "possession": ">" }, predef: true },
        "player_stats": { name: "球员数据", items: { "points": "0", "rebounds": "0", "assists": "0" }, predef: true },
        "simple_text": { name: "单行文本", items: { "line1": "Hello World" }, predef: true }
    };

    // === Core Save/Render Functions ===
    const debouncedSaveData = (data) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            if (!currentProfileName) return;
            const result = await window.api.saveProfileData(currentProfileName, data);
            if (!result.success) alert(`自动保存失败: ${result.error}`);
        }, 400);
    };

    const renderTemplateLibrary = () => {
        ALL_TEMPLATES = { ...PREDEFINED_TEMPLATES, ...CUSTOM_TEMPLATES };
        templateList.innerHTML = Object.entries(ALL_TEMPLATES).map(([id, tpl]) => `
            <li data-id="${id}">
                <span class="template-name">${tpl.name} ${tpl.predef ? '(内置)' : ''}</span>
                ${!tpl.predef ? `<div class="template-actions"><button class="edit-template-btn" title="编辑">✏️</button><button class="delete-template-btn" title="删除">🗑️</button></div>` : ''}
            </li>
        `).join('');
    };
    
    const renderProfile = () => {
        const hasProfile = !!currentProfileName && currentProfileName !== '请新建一个配置';
        addTemplateInstanceBtn.classList.toggle('hidden', !hasProfile);
        templateInstancesContainer.innerHTML = '';
        if (!hasProfile || currentProfileData.length === 0) {
            templateInstancesContainer.appendChild(welcomeMessage);
        } else {
            currentProfileData.forEach((instance, index) => {
                const instanceDiv = document.createElement('div');
                instanceDiv.className = 'template-instance';
                instanceDiv.dataset.instanceIndex = index;
                const cardsHTML = Object.entries(instance.items).map(([key, value]) => {
                    const isNumeric = !isNaN(parseFloat(value)) && isFinite(value);
                    return `<div class="data-item-card" data-key="${key}"><div class="item-name">${key}</div><div class="item-content">${isNumeric ? `<div class="value-controls"><button class="value-increment">+</button><button class="value-decrement">-</button></div>` : ''}<div class="item-value" contenteditable="true">${value}</div></div></div>`;
                }).join('');
                instanceDiv.innerHTML = `<div class="instance-header"><h3>${instance.templateName}</h3><button class="delete-instance-btn" title="删除模板组">&times;</button></div><div class="data-items-grid">${cardsHTML}</div>`;
                templateInstancesContainer.appendChild(instanceDiv);
            });
        }
    };

    // === Initial Load & Profile Management ===
    const loadProfiles = async (selectProfileName = null) => {
        const result = await window.api.getProfiles();
        if (result.success) {
            const profiles = result.data;
            profileSelect.innerHTML = profiles.length ? profiles.map(p => `<option value="${p}">${p}</option>`).join('') : '<option>请新建一个配置</option>';
            profileSelect.value = selectProfileName || profiles[0] || '';
            await handleProfileChange();
        } else {
            alert('加载配置文件列表失败: ' + result.error);
        }
    };

    const handleProfileChange = async () => {
        currentProfileName = profileSelect.value;
        const hasProfile = !!currentProfileName && currentProfileName !== '请新建一个配置';
        deleteProfileBtn.disabled = !hasProfile;
        currentProfileTitle.textContent = hasProfile ? `当前配置: ${currentProfileName}` : '请选择或新建配置文件';
        currentProfileData = [];
        if (hasProfile) {
            const result = await window.api.getProfileData(currentProfileName);
            if (result.success) currentProfileData = result.data;
            else alert(`加载配置 "${currentProfileName}" 失败: ${result.error}`);
        }
        renderProfile();
    };

    const loadCustomTemplates = async () => {
        const result = await window.api.getCustomTemplates();
        if (result.success) CUSTOM_TEMPLATES = result.data || {};
        else alert('加载自定义模板失败: ' + result.error);
        renderTemplateLibrary();
    };

    // === Event Listeners ===
    window.api.onServerStarted(port => {
        serverPort = port;
        connectionText.textContent = `已连接 (端口: ${port})`;
        document.getElementById('connection-indicator').className = 'status-connected';
    });

    profileSelect.addEventListener('change', handleProfileChange);
    newProfileBtn.addEventListener('click', () => newProfileModal.classList.remove('hidden'));
    deleteProfileBtn.addEventListener('click', async () => {
        if (!currentProfileName || !confirm(`确定删除配置文件 "${currentProfileName}"? 此操作不可撤销。`)) return;
        const result = await window.api.deleteProfile(currentProfileName);
        if (result.success) await loadProfiles();
        else alert(`删除失败: ${result.error}`);
    });

    // --- Template Instance & Data Card Interactions ---
    templateInstancesContainer.addEventListener('click', e => {
        const instanceDiv = e.target.closest('.template-instance');
        if (!instanceDiv) return;
        const instanceIndex = parseInt(instanceDiv.dataset.instanceIndex, 10);
        if (e.target.classList.contains('delete-instance-btn')) {
            currentProfileData.splice(instanceIndex, 1);
            renderProfile();
            debouncedSaveData(currentProfileData);
            return;
        }
        const card = e.target.closest('.data-item-card');
        if (!card) return;
        const key = card.dataset.key;
        const updateValue = offset => {
            let val = parseFloat(currentProfileData[instanceIndex].items[key]) + offset;
            if (!isNaN(val)) {
                currentProfileData[instanceIndex].items[key] = val;
                card.querySelector('.item-value').textContent = val;
                debouncedSaveData(currentProfileData);
            }
        };
        if (e.target.classList.contains('value-increment')) updateValue(1);
        if (e.target.classList.contains('value-decrement')) updateValue(-1);
    });
    templateInstancesContainer.addEventListener('blur', (e) => {
        if (!e.target.isContentEditable) return;
        const instanceDiv = e.target.closest('.template-instance');
        const card = e.target.closest('.data-item-card');
        if (!instanceDiv || !card) return;
        const instanceIndex = parseInt(instanceDiv.dataset.instanceIndex, 10);
        const key = card.dataset.key;
        const newValue = e.target.textContent.trim();
        if (currentProfileData[instanceIndex].items[key] != newValue) {
            currentProfileData[instanceIndex].items[key] = newValue;
            debouncedSaveData(currentProfileData);
            renderProfile();
        }
    }, true);
    templateInstancesContainer.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.isContentEditable) { e.preventDefault(); e.target.blur(); }
    });

    // --- Modal Logic with Fixes ---
    document.querySelectorAll('.modal-cancel-btn').forEach(btn => btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.add('hidden')));
    
    document.getElementById('new-profile-form').addEventListener('submit', async e => {
        e.preventDefault();
        const input = document.getElementById('new-profile-name-input');
        const name = input.value.trim();
        if (!name) return alert('配置文件名不能为空。');
        if (Array.from(profileSelect.options).some(opt => opt.value === name)) return alert('该配置文件名称已存在。');
        
        const result = await window.api.createProfile(name); // Use dedicated creation API
        if (result.success) {
            input.value = '';
            newProfileModal.classList.add('hidden');
            await loadProfiles(name);
        } else {
            alert(`创建配置文件失败: ${result.error}`);
        }
    });
    
    addTemplateInstanceBtn.addEventListener('click', () => {
        document.getElementById('template-select').innerHTML = Object.entries(ALL_TEMPLATES).map(([id, tpl]) => `<option value="${id}">${tpl.name}</option>`).join('');
        document.getElementById('template-instance-name').value = '';
        addTemplateInstanceModal.classList.remove('hidden');
    });

    document.getElementById('add-template-instance-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('template-instance-name').value.trim();
        if (!name) return alert('请为模板组命名。');
        if (currentProfileData.some(inst => inst.templateName === name)) return alert('该名称已被使用。');
        const tplId = document.getElementById('template-select').value;
        currentProfileData.push({ templateName: name, items: { ...ALL_TEMPLATES[tplId].items } });
        renderProfile();
        debouncedSaveData(currentProfileData);
        addTemplateInstanceModal.classList.add('hidden');
    });

    // --- Template Library & Editor Logic with Fixes ---
    addNewTemplateBtn.addEventListener('click', () => openTemplateEditor());
    templateList.addEventListener('click', e => {
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        const id = li.dataset.id;
        if (e.target.classList.contains('edit-template-btn')) openTemplateEditor(id);
        if (e.target.classList.contains('delete-template-btn')) deleteCustomTemplate(id);
    });
    
    const openTemplateEditor = (id = null) => {
        const form = document.getElementById('template-editor-form');
        form.reset();
        document.getElementById('template-editor-title').textContent = id ? '编辑模板' : '创建新模板';
        document.getElementById('template-editor-id').value = id || `custom_${Date.now()}`;
        document.getElementById('template-fields-container').innerHTML = '';
        if (id && CUSTOM_TEMPLATES[id]) {
            document.getElementById('template-editor-name').value = CUSTOM_TEMPLATES[id].name;
            Object.entries(CUSTOM_TEMPLATES[id].items).forEach(([key, value]) => addTemplateFieldRow(key, value));
        } else {
            addTemplateFieldRow();
        }
        templateEditorModal.classList.remove('hidden');
    };

    const addTemplateFieldRow = (key = '', value = '') => {
        const row = document.createElement('div');
        row.className = 'template-field-row';
        row.innerHTML = `<input type="text" class="key-input" placeholder="字段名 (key)" value="${key}" required><input type="text" class="value-input" placeholder="默认值" value="${value}"><button type="button" class="remove-field-btn">&times;</button>`;
        document.getElementById('template-fields-container').appendChild(row);
    };
    document.getElementById('add-template-field-btn').addEventListener('click', () => addTemplateFieldRow());
    document.getElementById('template-fields-container').addEventListener('click', e => {
        if (e.target.classList.contains('remove-field-btn')) e.target.closest('.template-field-row').remove();
    });

    document.getElementById('template-editor-form').addEventListener('submit', async e => {
        e.preventDefault();
        const id = document.getElementById('template-editor-id').value;
        const name = document.getElementById('template-editor-name').value.trim();
        const items = {};
        let allKeysValid = true;
        const keys = new Set();
        document.querySelectorAll('#template-fields-container .template-field-row').forEach(row => {
            const key = row.querySelector('.key-input').value.trim();
            if (key && !keys.has(key)) {
                items[key] = row.querySelector('.value-input').value.trim();
                keys.add(key);
            } else { allKeysValid = false; }
        });
        if (!name || !allKeysValid || Object.keys(items).length === 0) return alert('模板名称和所有字段名都必须填写，字段名不能重复，且至少需要一个字段。');
        
        const newTemplates = { ...CUSTOM_TEMPLATES, [id]: { name, items } };
        const result = await window.api.saveCustomTemplates(newTemplates);
        if (result.success) {
            CUSTOM_TEMPLATES = newTemplates;
            renderTemplateLibrary();
            templateEditorModal.classList.add('hidden');
        } else {
            alert(`保存模板失败: ${result.error}`);
        }
    });

    const deleteCustomTemplate = async (id) => {
        if (confirm(`确定要删除模板 "${CUSTOM_TEMPLATES[id].name}" 吗？此操作不可撤销。`)) {
            const tempTemplates = { ...CUSTOM_TEMPLATES };
            delete tempTemplates[id];
            const result = await window.api.saveCustomTemplates(tempTemplates);
            if (result.success) {
                CUSTOM_TEMPLATES = tempTemplates;
                renderTemplateLibrary();
            } else {
                alert(`删除模板失败: ${result.error}`);
            }
        }
    };

    // --- Initial Load ---
    loadCustomTemplates().then(() => loadProfiles());
});