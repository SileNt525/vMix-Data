/**
 * ui/script.js (Template Library Upgrade)
 *
 * Key Features:
 * 1.  [PROFESSIONAL TEMPLATES]: Added a rich library of predefined templates for Basketball and Soccer, based on common broadcast graphics.
 * 2.  [TEMPLATE CATEGORIZATION]: The template data structure and UI now support categories (folders). Both the sidebar library and the "Add Instance" modal use this grouping for a much better user experience.
 * 3.  [UI LOGIC REFACTOR]: The `renderTemplateLibrary` and the "Add Instance" modal population logic have been rewritten to handle the new categorized structure.
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

    // === NEW: Categorized, Professional Predefined Templates ===
    const PREDEFINED_TEMPLATES = {
        "篮球 (Basketball)": {
            "bball_main_scoreboard": { name: "主比分牌", items: { "team_a_name": "HOS", "team_a_score": "101", "team_b_name": "GUE", "team_b_score": "99", "period": "Q4", "game_clock": "01:12", "shot_clock": "18", "team_a_fouls": "4", "team_b_fouls": "5", "team_a_timeouts": "2", "team_b_timeouts": "3" } },
            "bball_player_stats": { name: "球员数据条", items: { "player_name": "S. CURRY", "player_number": "30", "points": "35", "rebounds": "8", "assists": "12", "fouls": "2" } },
            "bball_team_stats": { name: "球队技术统计", items: { "team_name": "WARRIORS", "fg_pct": "48.5%", "3p_pct": "41.2%", "ft_pct": "89.1%", "turnovers": "12" } },
            "bball_lower_third": { name: "信息条 (Lower Third)", items: { "line_1": "UPCOMING GAME", "line_2": "LAKERS vs CLIPPERS" } }
        },
        "足球 (Soccer)": {
            "soccer_main_scoreboard": { name: "主比分牌", items: { "team_a_name": "FCB", "team_a_score": "2", "team_b_name": "RMA", "team_b_score": "1", "game_time": "88:24", "half": "2H", "stoppage_time": "+3" } },
            "soccer_match_stats": { name: "赛事统计", items: { "stat_name": "控球率", "team_a_stat": "62%", "team_b_stat": "38%", "stat_name_2": "射门", "team_a_stat_2": "15", "team_b_stat_2": "9" } },
            "soccer_player_card": { name: "球员信息卡", items: { "player_name": "L. MESSI", "player_number": "10", "goals": "1", "assists": "1" } },
            "soccer_substitution": { name: "换人信息", items: { "player_in_name": "G. BALE", "player_in_number": "11", "player_out_name": "K. BENZEMA", "player_out_number": "9", "team_name": "RMA" } }
        },
        "通用 (General)": {
            "simple_text": { name: "单行文本", items: { "line1": "Hello World" } },
            "double_text": { name: "双行文本", items: { "line1": "Main Title", "line2": "Subtitle Text" } }
        }
    };

    // Helper to mark predefined templates
    Object.values(PREDEFINED_TEMPLATES).forEach(category => {
        Object.values(category).forEach(tpl => tpl.predef = true);
    });


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
        ALL_TEMPLATES = { ...PREDEFINED_TEMPLATES };
        if (Object.keys(CUSTOM_TEMPLATES).length > 0) {
            ALL_TEMPLATES["自定义 (Custom)"] = CUSTOM_TEMPLATES;
        }

        templateList.innerHTML = Object.entries(ALL_TEMPLATES).map(([category, templates]) => `
            <li class="category-header">${category}</li>
            ${Object.entries(templates).map(([id, tpl]) => `
                <li data-id="${id}" class="template-item">
                    <span class="template-name">${tpl.name}</span>
                    ${!tpl.predef ? `<div class="template-actions"><button class="edit-template-btn" title="编辑">✏️</button><button class="delete-template-btn" title="删除">🗑️</button></div>` : ''}
                </li>
            `).join('')}
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
        } else alert('加载配置文件列表失败: ' + result.error);
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

    document.querySelectorAll('.modal-cancel-btn').forEach(btn => btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.add('hidden')));
    
    document.getElementById('new-profile-form').addEventListener('submit', async e => {
        e.preventDefault();
        const input = document.getElementById('new-profile-name-input');
        const name = input.value.trim();
        if (!name) return alert('配置文件名不能为空。');
        if (Array.from(profileSelect.options).some(opt => opt.value === name)) return alert('该配置文件名称已存在。');
        const result = await window.api.createProfile(name);
        if (result.success) {
            input.value = '';
            newProfileModal.classList.add('hidden');
            await loadProfiles(name);
        } else alert(`创建配置文件失败: ${result.error}`);
    });
    
    addTemplateInstanceBtn.addEventListener('click', () => {
        const select = document.getElementById('template-select');
        select.innerHTML = Object.entries(ALL_TEMPLATES).map(([category, templates]) =>
            `<optgroup label="${category}">
                ${Object.entries(templates).map(([id, tpl]) => `<option value="${id}">${tpl.name}</option>`).join('')}
            </optgroup>`
        ).join('');
        document.getElementById('template-instance-name').value = '';
        addTemplateInstanceModal.classList.remove('hidden');
    });

    document.getElementById('add-template-instance-form').addEventListener('submit', e => {
        e.preventDefault();
        const name = document.getElementById('template-instance-name').value.trim();
        if (!name) return alert('请为模板组命名。');
        if (currentProfileData.some(inst => inst.templateName === name)) return alert('该名称已被使用。');
        
        const tplId = document.getElementById('template-select').value;
        let selectedTemplate;
        for (const category of Object.values(ALL_TEMPLATES)) {
            if (category[tplId]) {
                selectedTemplate = category[tplId];
                break;
            }
        }
        
        currentProfileData.push({ templateName: name, items: { ...selectedTemplate.items } });
        renderProfile();
        debouncedSaveData(currentProfileData);
        addTemplateInstanceModal.classList.add('hidden');
    });

    addNewTemplateBtn.addEventListener('click', () => openTemplateEditor());
    templateList.addEventListener('click', e => {
        const li = e.target.closest('li.template-item');
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