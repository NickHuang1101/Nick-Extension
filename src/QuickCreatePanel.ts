import * as vscode from 'vscode';
import { GoogleSheetsService } from './services/googleSheetsService';
import { JiraService } from './services/jiraService';

/**
 * 快速開單面板 - 顯示在編輯器區域
 */
export class QuickCreatePanel {
    public static currentPanel: QuickCreatePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _sheetsService: GoogleSheetsService | null = null;
    private _jiraService: JiraService;
    // 記錄當前讀取的 Sheet 資訊用於回填
    private _currentSheetName: string = '';
    private _currentRowNumber: number = 0;

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        sheetsService: GoogleSheetsService | null,
        private readonly _onConnectGoogle: () => Promise<GoogleSheetsService | null>
    ) {
        this._panel = panel;
        this._sheetsService = sheetsService;
        this._jiraService = new JiraService();

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'connectGoogle':
                        const service = await this._onConnectGoogle();
                        if (service) {
                            this._sheetsService = service;
                            try {
                                const sheetNames = await service.getAllSheetNames(GoogleSheetsService.DEFAULT_SPREADSHEET_ID);
                                this._panel.webview.postMessage({ command: 'googleConnected', data: { success: true, sheetNames } });
                            } catch {
                                this._panel.webview.postMessage({ command: 'googleConnected', data: { success: true, sheetNames: [] } });
                            }
                        }
                        break;

                    case 'getRowData':
                        if (!this._sheetsService) {
                            this._panel.webview.postMessage({ command: 'error', message: '請先連接 Google 帳號' });
                            return;
                        }
                        try {
                            // 儲存當前 Sheet 資訊，用於後續回填
                            this._currentSheetName = message.sheetName;
                            this._currentRowNumber = message.rowNumber;
                            
                            // 同時讀取 Sheet 資料和 JIRA 資料
                            const [result, projects, isJiraConnected] = await Promise.all([
                                this._sheetsService.getRowData(
                                    GoogleSheetsService.DEFAULT_SPREADSHEET_ID, message.sheetName, message.rowNumber
                                ),
                                this._jiraService.getProjects(),
                                this._jiraService.testConnection()
                            ]);
                            
                            // 發送 Sheet 資料
                            this._panel.webview.postMessage({ command: 'rowData', data: result });
                            // 發送 JIRA 資料
                            this._panel.webview.postMessage({ command: 'jiraData', data: { projects, isConnected: isJiraConnected } });
                        } catch (error: any) {
                            this._panel.webview.postMessage({ command: 'error', message: error.message });
                        }
                        break;

                    case 'loadJiraData':
                        try {
                            const [projects, isConnected] = await Promise.all([
                                this._jiraService.getProjects(),
                                this._jiraService.testConnection()
                            ]);
                            this._panel.webview.postMessage({ command: 'jiraData', data: { projects, isConnected } });
                        } catch (error: any) {
                            this._panel.webview.postMessage({ command: 'jiraError', message: 'JIRA 連線失敗: ' + error.message });
                        }
                        break;

                    case 'getProjectDetails':
                        try {
                            const [issueTypes, sprints, epics, users] = await Promise.all([
                                this._jiraService.getIssueTypes(message.projectKey),
                                this._jiraService.getSprints(message.projectKey),
                                this._jiraService.getEpics(message.projectKey),
                                this._jiraService.getAssignableUsers(message.projectKey)
                            ]);
                            this._panel.webview.postMessage({ command: 'projectDetails', data: { issueTypes, sprints, epics, users } });
                        } catch (error: any) {
                            this._panel.webview.postMessage({ command: 'jiraError', message: '載入專案資訊失敗: ' + error.message });
                        }
                        break;

                    case 'createJiraIssue':
                        try {
                            const result = await this._jiraService.createIssue({
                                projectKey: message.projectKey,
                                issueType: message.issueType,
                                summary: message.summary,
                                description: message.description,
                                reporter: message.reporter,
                                assignee: message.assignee,
                                epicLink: message.epicLink,
                                sprint: message.sprint
                            });
                            
                            const issueUrl = `http://172.20.10.106:5050/browse/${result.key}`;
                            
                            // 回填 JIRA URL 到 Google Sheet
                            let sheetUpdated = false;
                            let updateError = '';
                            
                            if (!this._sheetsService) {
                                updateError = '未連接 Google';
                            } else if (!this._currentSheetName) {
                                updateError = '未選擇頁籤';
                            } else if (this._currentRowNumber <= 0) {
                                updateError = '未讀取資料列';
                            } else {
                                try {
                                    sheetUpdated = await this._sheetsService.updateJiraUrl(
                                        GoogleSheetsService.DEFAULT_SPREADSHEET_ID,
                                        this._currentSheetName,
                                        this._currentRowNumber,
                                        issueUrl
                                    );
                                    if (!sheetUpdated) {
                                        updateError = '找不到「Jira單號」欄位';
                                    }
                                } catch (e: any) {
                                    updateError = e.message || '寫入失敗';
                                    console.error('回填 JIRA URL 失敗:', e);
                                }
                            }
                            
                            this._panel.webview.postMessage({ 
                                command: 'issueCreated', 
                                data: { ...result, url: issueUrl, sheetUpdated, updateError }
                            });
                            
                            // 自動複製 URL 到剪貼簿
                            await vscode.env.clipboard.writeText(issueUrl);
                            
                            if (sheetUpdated) {
                                vscode.window.showInformationMessage(`✅ Issue 創建成功: ${result.key} (已回填+複製 URL)`);
                            } else {
                                vscode.window.showWarningMessage(`✅ Issue 創建成功: ${result.key} (已複製 URL)，但回填失敗: ${updateError}`);
                            }
                        } catch (error: any) {
                            this._panel.webview.postMessage({ command: 'jiraError', message: '創建 Issue 失敗: ' + error.message });
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, sheetsService: GoogleSheetsService | null, onConnectGoogle: () => Promise<GoogleSheetsService | null>) {
        const column = vscode.ViewColumn.One;
        if (QuickCreatePanel.currentPanel) {
            QuickCreatePanel.currentPanel._panel.reveal(column);
            QuickCreatePanel.currentPanel._sheetsService = sheetsService;
            return;
        }
        const panel = vscode.window.createWebviewPanel('quickCreatePanel', '快速開單', column, {
            enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri]
        });
        QuickCreatePanel.currentPanel = new QuickCreatePanel(panel, extensionUri, sheetsService, onConnectGoogle);
    }

    public updateSheetsService(service: GoogleSheetsService | null) { this._sheetsService = service; }
    private _update() { this._panel.webview.html = this._getHtmlContent(); }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>快速開單</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border); }
        .header h1 { font-size: 20px; font-weight: 600; }
        .badges { display: flex; gap: 8px; }
        .badge { padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; }
        .badge.connected { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
        .badge.disconnected { background: rgba(248, 113, 113, 0.15); color: #f87171; }
        .section { background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .section-title { font-size: 14px; font-weight: 600; margin-bottom: 16px; }
        .form-row { display: flex; gap: 16px; margin-bottom: 16px; }
        .form-group { flex: 1; position: relative; }
        .form-group.full { flex: none; width: 100%; }
        .form-label { display: block; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
        .form-label .required { color: #ef4444; }
        input[type="text"], input[type="number"], select, textarea {
            width: 100%; padding: 10px 12px; border: 1px solid var(--vscode-input-border);
            border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            font-size: 14px; font-family: inherit;
        }
        textarea { min-height: 80px; resize: vertical; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: var(--vscode-focusBorder); }
        input:disabled, select:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-row { display: flex; gap: 12px; margin-top: 16px; }
        button { padding: 10px 20px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.15s; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-google { background: #4285f4; color: white; }
        .btn-google:hover { background: #3367d6; }
        .btn-jira { background: #0052CC; color: white; }
        .btn-jira:hover { background: #0747A6; }
        .btn-success { background: #22c55e; color: white; }
        .btn-success:hover { background: #16a34a; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .error-msg, .success-msg { padding: 12px; border-radius: 6px; font-size: 13px; margin-top: 12px; display: none; }
        .error-msg { background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; }
        .success-msg { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); color: #22c55e; }
        .error-msg.visible, .success-msg.visible { display: block; }
        .info-text { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        
        .searchable-select { position: relative; }
        .searchable-select input { padding-right: 32px; }
        .searchable-select .arrow { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--vscode-descriptionForeground); font-size: 10px; }
        .dropdown-list { position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto;
            background: var(--vscode-dropdown-background, var(--vscode-input-background));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
            border-radius: 6px; margin-top: 4px; z-index: 1000; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .dropdown-list.visible { display: block; }
        .dropdown-item { padding: 10px 12px; cursor: pointer; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border); }
        .dropdown-item:last-child { border-bottom: none; }
        .dropdown-item:hover, .dropdown-item.selected { background: var(--vscode-list-hoverBackground); }
        .dropdown-item .hl { background: rgba(66, 133, 244, 0.3); border-radius: 2px; }
        .no-results { padding: 10px 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
        
        .data-preview { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; margin-top: 12px; }
        .data-preview-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
        .data-preview-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .data-preview-item { font-size: 12px; }
        .data-preview-label { color: var(--vscode-descriptionForeground); }
        .data-preview-value { font-weight: 500; margin-top: 2px; word-break: break-all; }
        .divider { height: 1px; background: var(--vscode-panel-border); margin: 20px 0; }
        
        .issue-link { display: block; margin-top: 8px; padding: 10px 12px;
            background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border);
            border-radius: 6px; font-family: monospace; font-size: 13px;
            color: #4285f4; text-decoration: none; word-break: break-all; user-select: all;
        }
        .issue-link:hover { background: rgba(66, 133, 244, 0.1); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📝 快速開單 (JIRA)</h1>
            <div class="badges">
                <span id="googleBadge" class="badge disconnected">Google 未連接</span>
                <span id="jiraBadge" class="badge disconnected">JIRA 未連接</span>
            </div>
        </div>
        
        <!-- Step 1: Google Sheet -->
        <div class="section">
            <div class="section-title">📊 Step 1: 讀取 Google Sheet 資料</div>
            <button class="btn-google" id="connectGoogleBtn" onclick="connectGoogle()">連接 Google 帳號</button>
            <div class="form-row" style="margin-top: 16px;">
                <div class="form-group">
                    <label class="form-label">頁籤名稱</label>
                    <div class="searchable-select">
                        <input type="text" id="sheetInput" data-type="sheet" placeholder="請先連接 Google..." disabled 
                               oninput="filterList('sheet')" onfocus="showList('sheet')" onblur="hideList('sheet')" />
                        <span class="arrow">▼</span>
                        <div class="dropdown-list" id="sheetDropdown"></div>
                    </div>
                    <div class="info-text" id="sheetCount"></div>
                </div>
                <div class="form-group">
                    <label class="form-label">列號</label>
                    <input type="number" id="rowNumber" placeholder="例如：2" min="2" value="2" />
                </div>
            </div>
            <button class="btn-primary" id="fetchBtn" onclick="fetchRowData()" disabled>📥 讀取資料</button>
            <div id="dataPreview" class="data-preview" style="display: none;">
                <div class="data-preview-title">📋 讀取到的資料</div>
                <div class="data-preview-grid" id="dataPreviewGrid"></div>
            </div>
        </div>
        
        <!-- Step 2: JIRA Issue -->
        <div class="section">
            <div class="section-title">🎫 Step 2: 填寫 JIRA Issue 資訊</div>
            <button class="btn-jira" id="loadJiraBtn" onclick="loadJiraData()">載入 JIRA 資料</button>
            <div class="divider"></div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Project <span class="required">*</span></label>
                    <select id="projectSelect" onchange="onProjectChange()" disabled><option value="">-- 請先載入 JIRA --</option></select>
                </div>
                <div class="form-group">
                    <label class="form-label">Issue Type <span class="required">*</span></label>
                    <select id="issueTypeSelect" disabled><option value="">-- 請先選專案 --</option></select>
                </div>
            </div>
            
            <div class="form-group full">
                <label class="form-label">Summary <span class="required">*</span></label>
                <input type="text" id="summaryInput" placeholder="程式代號DG_議題紀錄" disabled />
                <div class="info-text">格式: 程式代號 + DG_ + 議題紀錄</div>
            </div>
            
            <div class="form-group full">
                <label class="form-label">Description</label>
                <textarea id="descriptionInput" placeholder="Issue 說明" disabled></textarea>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Reporter</label>
                    <div class="searchable-select">
                        <input type="text" id="reporterInput" data-type="reporter" placeholder="搜尋 Reporter..." disabled 
                               oninput="filterList('reporter')" onfocus="showList('reporter')" onblur="hideList('reporter')" />
                        <span class="arrow">▼</span>
                        <div class="dropdown-list" id="reporterDropdown"></div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Assignee</label>
                    <div class="searchable-select">
                        <input type="text" id="assigneeInput" data-type="assignee" placeholder="搜尋 Assignee..." disabled 
                               oninput="filterList('assignee')" onfocus="showList('assignee')" onblur="hideList('assignee')" />
                        <span class="arrow">▼</span>
                        <div class="dropdown-list" id="assigneeDropdown"></div>
                    </div>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Epic Link</label>
                    <div class="searchable-select">
                        <input type="text" id="epicInput" data-type="epic" placeholder="搜尋 Epic..." disabled 
                               oninput="filterList('epic')" onfocus="showList('epic')" onblur="hideList('epic')" />
                        <span class="arrow">▼</span>
                        <div class="dropdown-list" id="epicDropdown"></div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Sprint</label>
                    <div class="searchable-select">
                        <input type="text" id="sprintInput" data-type="sprint" placeholder="搜尋 Sprint..." disabled 
                               oninput="filterList('sprint')" onfocus="showList('sprint')" onblur="hideList('sprint')" />
                        <span class="arrow">▼</span>
                        <div class="dropdown-list" id="sprintDropdown"></div>
                    </div>
                </div>
            </div>
            
            <div class="btn-row">
                <button class="btn-success" id="createIssueBtn" onclick="createJiraIssue()" disabled>✅ 創建 Issue</button>
            </div>
            <div class="error-msg" id="errorMsg"></div>
            <div class="success-msg" id="successMsg">
                <div id="successText"></div>
                <a id="issueLink" class="issue-link" href="#" target="_blank"></a>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let isGoogleConnected = false, isJiraConnected = false, sheetData = null;
        let activeDropdown = null, selectedIdx = -1;
        
        const listData = {
            sheet: { items: [], valueKey: null, textKey: null, filteredItems: [] },
            reporter: { items: [], valueKey: 'name', textKey: 'displayName', filteredItems: [] },
            assignee: { items: [], valueKey: 'name', textKey: 'displayName', filteredItems: [] },
            epic: { items: [], valueKey: 'key', textKey: function(e) { return e.fields.summary + ' - (' + e.key + ')'; }, filteredItems: [] },
            sprint: { items: [], valueKey: 'id', textKey: 'name', filteredItems: [] }
        };
        const selectedValues = { sheet: '', reporter: '', assignee: '', epic: '', sprint: '' };
        
        function showList(type) {
            if (listData[type].items.length === 0) return;
            activeDropdown = type; selectedIdx = -1;
            filterList(type);
            document.getElementById(type + 'Dropdown').classList.add('visible');
        }
        
        function hideList(type) {
            setTimeout(function() {
                document.getElementById(type + 'Dropdown').classList.remove('visible');
                if (activeDropdown === type) { activeDropdown = null; selectedIdx = -1; }
            }, 200);
        }
        
        function filterList(type) {
            var input = document.getElementById(type + 'Input');
            var dropdown = document.getElementById(type + 'Dropdown');
            var keyword = input.value.toLowerCase().trim();
            var items = listData[type].items;
            var textKey = listData[type].textKey;
            
            dropdown.innerHTML = ''; selectedIdx = -1;
            var filtered = items.filter(function(item) {
                var text = typeof textKey === 'function' ? textKey(item) : (textKey ? item[textKey] : item);
                return text.toLowerCase().indexOf(keyword) !== -1;
            });
            listData[type].filteredItems = filtered;
            
            if (filtered.length === 0) {
                dropdown.innerHTML = '<div class="no-results">沒有符合的項目</div>';
            } else {
                filtered.forEach(function(item, idx) {
                    var text = typeof textKey === 'function' ? textKey(item) : (textKey ? item[textKey] : item);
                    var div = document.createElement('div');
                    div.className = 'dropdown-item';
                    div.setAttribute('data-idx', idx);
                    if (keyword) {
                        var start = text.toLowerCase().indexOf(keyword);
                        if (start !== -1) {
                            div.innerHTML = text.substring(0, start) + '<span class="hl">' + text.substring(start, start + keyword.length) + '</span>' + text.substring(start + keyword.length);
                        } else { div.textContent = text; }
                    } else { div.textContent = text; }
                    div.onmousedown = function() { selectItem(type, idx); };
                    dropdown.appendChild(div);
                });
            }
            dropdown.classList.add('visible');
        }
        
        function selectItem(type, idx) {
            var filtered = listData[type].filteredItems;
            if (idx < 0 || idx >= filtered.length) return;
            var item = filtered[idx];
            var textKey = listData[type].textKey;
            var valueKey = listData[type].valueKey;
            var text = typeof textKey === 'function' ? textKey(item) : (textKey ? item[textKey] : item);
            var value = valueKey ? item[valueKey] : item;
            if (type === 'epic') {
                document.getElementById(type + 'Input').value = item.key;
                selectedValues[type] = item.key;
            } else {
                document.getElementById(type + 'Input').value = text;
                selectedValues[type] = value;
            }
            document.getElementById(type + 'Dropdown').classList.remove('visible');
            activeDropdown = null; selectedIdx = -1;
        }
        
        function updateSelectedStyle(type) {
            var dropdown = document.getElementById(type + 'Dropdown');
            var items = dropdown.querySelectorAll('.dropdown-item');
            items.forEach(function(item, idx) { item.classList.toggle('selected', idx === selectedIdx); });
            if (selectedIdx >= 0 && items[selectedIdx]) { items[selectedIdx].scrollIntoView({ block: 'nearest' }); }
        }
        
        document.addEventListener('keydown', function(e) {
            if (!activeDropdown) return;
            var filtered = listData[activeDropdown].filteredItems;
            if (filtered.length === 0) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); updateSelectedStyle(activeDropdown); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); updateSelectedStyle(activeDropdown); }
            else if (e.key === 'Enter') { e.preventDefault(); if (selectedIdx >= 0) selectItem(activeDropdown, selectedIdx); }
            else if (e.key === 'Escape') { document.getElementById(activeDropdown + 'Dropdown').classList.remove('visible'); activeDropdown = null; selectedIdx = -1; }
        });
        
        function connectGoogle() {
            document.getElementById('connectGoogleBtn').textContent = '⏳ 連接中...';
            document.getElementById('connectGoogleBtn').disabled = true;
            vscode.postMessage({ command: 'connectGoogle' });
        }
        
        function fetchRowData() {
            var sheetName = document.getElementById('sheetInput').value.trim();
            var rowNumber = parseInt(document.getElementById('rowNumber').value, 10);
            if (!sheetName) { showError('請選擇頁籤'); return; }
            if (!rowNumber || rowNumber < 1) { showError('請輸入有效的列號'); return; }
            hideMessages();
            document.getElementById('fetchBtn').textContent = '⏳ 讀取中...';
            document.getElementById('fetchBtn').disabled = true;
            vscode.postMessage({ command: 'getRowData', sheetName: sheetName, rowNumber: rowNumber });
        }
        
        function loadJiraData() {
            document.getElementById('loadJiraBtn').textContent = '⏳ 載入中...';
            document.getElementById('loadJiraBtn').disabled = true;
            vscode.postMessage({ command: 'loadJiraData' });
        }
        
        function onProjectChange() {
            var projectKey = document.getElementById('projectSelect').value;
            if (!projectKey) return;
            ['reporterInput', 'assigneeInput', 'epicInput', 'sprintInput'].forEach(function(id) {
                document.getElementById(id).value = '';
                document.getElementById(id).disabled = true;
            });
            selectedValues.reporter = ''; selectedValues.assignee = ''; selectedValues.epic = ''; selectedValues.sprint = '';
            document.getElementById('issueTypeSelect').innerHTML = '<option value="">載入中...</option>';
            document.getElementById('issueTypeSelect').disabled = true;
            vscode.postMessage({ command: 'getProjectDetails', projectKey: projectKey });
        }
        
        function createJiraIssue() {
            var projectKey = document.getElementById('projectSelect').value;
            var issueType = document.getElementById('issueTypeSelect').value;
            var summary = document.getElementById('summaryInput').value.trim();
            var description = document.getElementById('descriptionInput').value.trim();
            if (!projectKey) { showError('請選擇專案'); return; }
            if (!issueType) { showError('請選擇 Issue Type'); return; }
            if (!summary) { showError('請輸入 Summary'); return; }
            hideMessages();
            document.getElementById('createIssueBtn').textContent = '⏳ 創建中...';
            document.getElementById('createIssueBtn').disabled = true;
            vscode.postMessage({
                command: 'createJiraIssue', projectKey: projectKey, issueType: issueType,
                summary: summary, description: description,
                reporter: selectedValues.reporter || null,
                assignee: selectedValues.assignee || null,
                epicLink: selectedValues.epic || null,
                sprint: selectedValues.sprint ? parseInt(selectedValues.sprint) : null
            });
        }
        
        function showError(msg) { document.getElementById('errorMsg').textContent = '❌ ' + msg; document.getElementById('errorMsg').classList.add('visible'); document.getElementById('successMsg').classList.remove('visible'); }
        function hideMessages() { document.getElementById('errorMsg').classList.remove('visible'); document.getElementById('successMsg').classList.remove('visible'); }
        function showSuccess(msg, url, sheetUpdated) {
            var txt = '✅ ' + msg;
            if (sheetUpdated) txt += ' (已回填到 Google Sheet)';
            document.getElementById('successText').textContent = txt;
            if (url) { document.getElementById('issueLink').textContent = url; document.getElementById('issueLink').href = url; document.getElementById('issueLink').style.display = 'block'; }
            else { document.getElementById('issueLink').style.display = 'none'; }
            document.getElementById('successMsg').classList.add('visible');
            document.getElementById('errorMsg').classList.remove('visible');
        }
        
        function updateGoogleStatus(c) {
            isGoogleConnected = c;
            var b = document.getElementById('googleBadge'); b.textContent = c ? 'Google ✓' : 'Google 未連接'; b.className = 'badge ' + (c ? 'connected' : 'disconnected');
            document.getElementById('connectGoogleBtn').textContent = c ? '✓ 已連接' : '連接 Google 帳號';
            document.getElementById('connectGoogleBtn').disabled = c;
            document.getElementById('fetchBtn').disabled = !c;
        }
        
        function updateJiraStatus(c) {
            isJiraConnected = c;
            var b = document.getElementById('jiraBadge'); b.textContent = c ? 'JIRA ✓' : 'JIRA 未連接'; b.className = 'badge ' + (c ? 'connected' : 'disconnected');
            document.getElementById('loadJiraBtn').textContent = c ? '✓ 已連接' : '載入 JIRA 資料';
        }
        
        function enableJiraFields() { ['summaryInput', 'descriptionInput', 'createIssueBtn'].forEach(function(id) { document.getElementById(id).disabled = false; }); }
        
        window.addEventListener('message', function(event) {
            var msg = event.data;
            switch (msg.command) {
                case 'googleConnected':
                    updateGoogleStatus(msg.data.success);
                    if (msg.data.sheetNames) {
                        listData.sheet.items = msg.data.sheetNames; listData.sheet.filteredItems = msg.data.sheetNames;
                        document.getElementById('sheetInput').disabled = false;
                        document.getElementById('sheetInput').placeholder = '輸入關鍵字搜尋...';
                        document.getElementById('sheetCount').textContent = '共 ' + msg.data.sheetNames.length + ' 個頁籤';
                    }
                    break;
                case 'rowData':
                    document.getElementById('fetchBtn').textContent = '📥 讀取資料'; document.getElementById('fetchBtn').disabled = false;
                    sheetData = msg.data;
                    var grid = document.getElementById('dataPreviewGrid'); grid.innerHTML = '';
                    [['issueRecord', '議題紀錄'], ['programCode', '程式代號']].forEach(function(p) {
                        grid.innerHTML += '<div class="data-preview-item"><div class="data-preview-label">' + p[1] + '</div><div class="data-preview-value">' + (sheetData[p[0]] || '-') + '</div></div>';
                    });
                    document.getElementById('dataPreview').style.display = 'block';
                    document.getElementById('summaryInput').value = (sheetData.programCode || '') + 'DG_' + (sheetData.issueRecord || '');
                    var desc = ''; if (sheetData.programCode) desc += '程式代號: ' + sheetData.programCode + '\\n'; if (sheetData.issueRecord) desc += '議題紀錄: ' + sheetData.issueRecord;
                    document.getElementById('descriptionInput').value = desc;
                    break;
                case 'jiraData':
                    updateJiraStatus(msg.data.isConnected);
                    var ps = document.getElementById('projectSelect'); ps.innerHTML = '<option value="">-- 選擇專案 --</option>';
                    msg.data.projects.forEach(function(p) { var o = document.createElement('option'); o.value = p.key; o.textContent = p.name + ' (' + p.key + ')'; if (p.key === 'ERP') o.selected = true; ps.appendChild(o); });
                    ps.disabled = false;
                    document.getElementById('loadJiraBtn').disabled = false;
                    enableJiraFields();
                    if (msg.data.projects.some(function(p) { return p.key === 'ERP'; })) onProjectChange();
                    break;
                case 'projectDetails':
                    var d = msg.data;
                    var its = document.getElementById('issueTypeSelect'); its.innerHTML = '<option value="">-- 選擇類型 --</option>';
                    d.issueTypes.forEach(function(t) { var o = document.createElement('option'); o.value = t.name; o.textContent = t.name; if (t.name === 'Task') o.selected = true; its.appendChild(o); });
                    its.disabled = false;
                    listData.reporter.items = d.users; listData.reporter.filteredItems = d.users;
                    document.getElementById('reporterInput').disabled = false; document.getElementById('reporterInput').placeholder = '搜尋 Reporter（共 ' + d.users.length + ' 人）';
                    listData.assignee.items = d.users; listData.assignee.filteredItems = d.users;
                    document.getElementById('assigneeInput').disabled = false; document.getElementById('assigneeInput').placeholder = '搜尋 Assignee（共 ' + d.users.length + ' 人）';
                    listData.epic.items = d.epics; listData.epic.filteredItems = d.epics;
                    document.getElementById('epicInput').disabled = false; document.getElementById('epicInput').placeholder = '搜尋 Epic（共 ' + d.epics.length + ' 個）';
                    listData.sprint.items = d.sprints; listData.sprint.filteredItems = d.sprints;
                    document.getElementById('sprintInput').disabled = false; document.getElementById('sprintInput').placeholder = '搜尋 Sprint（共 ' + d.sprints.length + ' 個）';
                    break;
                case 'issueCreated':
                    document.getElementById('createIssueBtn').textContent = '✅ 創建 Issue'; document.getElementById('createIssueBtn').disabled = false;
                    showSuccess('Issue 創建成功: ' + msg.data.key, msg.data.url, msg.data.sheetUpdated);
                    break;
                case 'error': case 'jiraError':
                    document.getElementById('fetchBtn').textContent = '📥 讀取資料'; document.getElementById('fetchBtn').disabled = false;
                    document.getElementById('loadJiraBtn').disabled = false;
                    document.getElementById('createIssueBtn').textContent = '✅ 創建 Issue'; document.getElementById('createIssueBtn').disabled = false;
                    showError(msg.message);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        QuickCreatePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) { const d = this._disposables.pop(); if (d) d.dispose(); }
    }
}
