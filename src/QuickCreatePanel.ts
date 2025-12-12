import * as vscode from 'vscode';
import { GoogleSheetsService } from './services/googleSheetsService';

/**
 * 快速開單面板 - 顯示在編輯器區域
 */
export class QuickCreatePanel {
    public static currentPanel: QuickCreatePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _sheetsService: GoogleSheetsService | null = null;

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        sheetsService: GoogleSheetsService | null,
        private readonly _onConnectGoogle: () => Promise<GoogleSheetsService | null>
    ) {
        this._panel = panel;
        this._sheetsService = sheetsService;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 處理來自 Webview 的訊息
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'connectGoogle':
                        const service = await this._onConnectGoogle();
                        if (service) {
                            this._sheetsService = service;
                            this._panel.webview.postMessage({
                                command: 'googleConnected',
                                data: { success: true }
                            });
                        }
                        break;
                    case 'getRowData':
                        if (!this._sheetsService) {
                            this._panel.webview.postMessage({
                                command: 'error',
                                message: '請先連接 Google 帳號'
                            });
                            return;
                        }
                        try {
                            const result = await this._sheetsService.getRowData(
                                GoogleSheetsService.DEFAULT_SPREADSHEET_ID,
                                message.sheetName,
                                message.rowNumber
                            );
                            this._panel.webview.postMessage({
                                command: 'rowData',
                                data: result
                            });
                        } catch (error: any) {
                            this._panel.webview.postMessage({
                                command: 'error',
                                message: error.message
                            });
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        sheetsService: GoogleSheetsService | null,
        onConnectGoogle: () => Promise<GoogleSheetsService | null>
    ) {
        const column = vscode.ViewColumn.One;

        if (QuickCreatePanel.currentPanel) {
            QuickCreatePanel.currentPanel._panel.reveal(column);
            QuickCreatePanel.currentPanel._sheetsService = sheetsService;
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'quickCreatePanel',
            '快速開單',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        QuickCreatePanel.currentPanel = new QuickCreatePanel(
            panel, 
            extensionUri, 
            sheetsService, 
            onConnectGoogle
        );
    }

    public updateSheetsService(service: GoogleSheetsService | null) {
        this._sheetsService = service;
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>快速開單</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 20px;
            min-height: 100vh;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .header h1 {
            font-size: 20px;
            font-weight: 600;
        }
        
        .status-badge {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .status-badge.connected {
            background: rgba(74, 222, 128, 0.15);
            color: #4ade80;
        }
        
        .status-badge.disconnected {
            background: rgba(248, 113, 113, 0.15);
            color: #f87171;
        }
        
        .section {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
        }
        
        .form-row {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
        }
        
        .form-group {
            flex: 1;
        }
        
        .form-label {
            display: block;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
        }
        
        input[type="text"],
        input[type="number"] {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 14px;
        }
        
        input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .btn-row {
            display: flex;
            gap: 12px;
        }
        
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-google {
            background: #4285f4;
            color: white;
        }
        
        .btn-google:hover {
            background: #3367d6;
        }
        
        .btn-google:disabled,
        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .result-section {
            display: none;
        }
        
        .result-section.visible {
            display: block;
        }
        
        .result-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }
        
        .result-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
        }
        
        .result-card.highlight {
            border-color: #4285f4;
            background: rgba(66, 133, 244, 0.05);
        }
        
        .result-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .result-value {
            font-size: 14px;
            color: var(--vscode-foreground);
            word-break: break-all;
            user-select: all;
        }
        
        .error-msg {
            padding: 12px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 6px;
            color: #ef4444;
            font-size: 13px;
            margin-top: 12px;
            display: none;
        }
        
        .error-msg.visible {
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📝 快速開單</h1>
            <span id="statusBadge" class="status-badge disconnected">未連接</span>
        </div>
        
        <div class="section">
            <div class="section-title">🔐 Google 帳號</div>
            <button class="btn-google" id="connectBtn" onclick="connectGoogle()">
                連接 Google 帳號
            </button>
        </div>
        
        <div class="section">
            <div class="section-title">📊 讀取 Sheet 資料</div>
            
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">頁籤名稱</label>
                    <input type="text" id="sheetName" placeholder="例如：Sheet1" />
                </div>
                <div class="form-group">
                    <label class="form-label">列號（第幾列）</label>
                    <input type="number" id="rowNumber" placeholder="例如：2" min="2" value="2" />
                </div>
            </div>
            
            <div class="btn-row">
                <button class="btn-primary" id="fetchBtn" onclick="fetchRowData()" disabled>
                    📥 讀取資料
                </button>
            </div>
            
            <div class="error-msg" id="errorMsg"></div>
        </div>
        
        <div class="section result-section" id="resultSection">
            <div class="section-title">📋 讀取結果</div>
            
            <div class="result-grid">
                <div class="result-card highlight">
                    <div class="result-label">議題紀錄</div>
                    <div class="result-value" id="issueRecord">-</div>
                </div>
                <div class="result-card highlight">
                    <div class="result-label">程式代號</div>
                    <div class="result-value" id="programCode">-</div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let isConnected = false;
        
        function connectGoogle() {
            document.getElementById('connectBtn').textContent = '⏳ 連接中...';
            document.getElementById('connectBtn').disabled = true;
            vscode.postMessage({ command: 'connectGoogle' });
        }
        
        function fetchRowData() {
            const sheetName = document.getElementById('sheetName').value.trim();
            const rowNumber = parseInt(document.getElementById('rowNumber').value, 10);
            
            if (!sheetName) {
                showError('請輸入頁籤名稱');
                return;
            }
            if (!rowNumber || rowNumber < 1) {
                showError('請輸入有效的列號');
                return;
            }
            
            hideError();
            document.getElementById('fetchBtn').textContent = '⏳ 讀取中...';
            document.getElementById('fetchBtn').disabled = true;
            
            vscode.postMessage({ 
                command: 'getRowData',
                sheetName: sheetName,
                rowNumber: rowNumber
            });
        }
        
        function showError(msg) {
            const el = document.getElementById('errorMsg');
            el.textContent = '❌ ' + msg;
            el.classList.add('visible');
        }
        
        function hideError() {
            document.getElementById('errorMsg').classList.remove('visible');
        }
        
        function updateConnectionStatus(connected) {
            isConnected = connected;
            const badge = document.getElementById('statusBadge');
            badge.textContent = connected ? '已連接' : '未連接';
            badge.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
            
            document.getElementById('connectBtn').textContent = connected ? '✓ 已連接' : '連接 Google 帳號';
            document.getElementById('connectBtn').disabled = connected;
            document.getElementById('fetchBtn').disabled = !connected;
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'googleConnected':
                    updateConnectionStatus(message.data.success);
                    break;
                    
                case 'rowData':
                    document.getElementById('fetchBtn').textContent = '📥 讀取資料';
                    document.getElementById('fetchBtn').disabled = false;
                    
                    const data = message.data;
                    document.getElementById('issueRecord').textContent = data.issueRecord || '-';
                    document.getElementById('programCode').textContent = data.programCode || '-';
                    document.getElementById('resultSection').classList.add('visible');
                    break;
                    
                case 'error':
                    document.getElementById('fetchBtn').textContent = '📥 讀取資料';
                    document.getElementById('fetchBtn').disabled = false;
                    showError(message.message);
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
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
