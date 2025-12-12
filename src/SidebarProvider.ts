import * as vscode from 'vscode';

export interface SidebarCallbacks {
    onConnectGoogle: () => Promise<boolean>;
    onGetRowData: (sheetName: string, rowNumber: number) => Promise<any>;
    onLogout: () => Promise<void>;
}

/**
 * 側邊欄 Webview Provider
 * Google Sheet 讀取器 - 簡化版
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _callbacks?: SidebarCallbacks;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        callbacks?: SidebarCallbacks
    ) {
        this._callbacks = callbacks;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlContent();

        // 處理來自側邊欄的訊息
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'connectGoogle':
                    if (this._callbacks?.onConnectGoogle) {
                        const success = await this._callbacks.onConnectGoogle();
                        webviewView.webview.postMessage({
                            command: 'googleConnected',
                            data: { success }
                        });
                    }
                    break;
                case 'getRowData':
                    if (this._callbacks?.onGetRowData) {
                        try {
                            const data = await this._callbacks.onGetRowData(
                                message.sheetName,
                                message.rowNumber
                            );
                            webviewView.webview.postMessage({
                                command: 'rowData',
                                data
                            });
                        } catch (error: any) {
                            webviewView.webview.postMessage({
                                command: 'error',
                                message: error.message
                            });
                        }
                    }
                    break;
                case 'logout':
                    if (this._callbacks?.onLogout) {
                        await this._callbacks.onLogout();
                        webviewView.webview.postMessage({
                            command: 'loggedOut'
                        });
                    }
                    break;
            }
        });
    }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
            padding: 12px;
        }
        
        .section {
            margin-bottom: 16px;
        }
        
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-sideBarSectionHeader-foreground);
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
        }
        
        .btn {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 10px 12px;
            margin-bottom: 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            text-align: left;
            transition: all 0.15s;
        }
        
        .btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-google {
            background: #4285f4;
            color: white;
        }
        
        .btn-google:hover {
            background: #3367d6;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .form-group {
            margin-bottom: 12px;
        }
        
        .form-label {
            display: block;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        
        input[type="text"],
        input[type="number"] {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 13px;
        }
        
        input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .result-box {
            margin-top: 16px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
            display: none;
        }
        
        .result-box.visible {
            display: block;
        }
        
        .result-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .result-item {
            margin-bottom: 12px;
        }
        
        .result-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        
        .result-value {
            font-size: 13px;
            color: var(--vscode-foreground);
            background: var(--vscode-input-background);
            padding: 8px 10px;
            border-radius: 4px;
            word-break: break-all;
            user-select: all;
        }
        
        .result-value.highlight {
            background: rgba(66, 133, 244, 0.15);
            border: 1px solid rgba(66, 133, 244, 0.3);
        }
        
        .status-bar {
            margin-top: 16px;
            padding: 8px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        
        .status-dot.connected {
            background: #4ade80;
        }
        
        .status-dot.disconnected {
            background: #f87171;
        }
        
        .error-msg {
            margin-top: 8px;
            padding: 8px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 4px;
            color: #ef4444;
            font-size: 12px;
            display: none;
        }
        
        .error-msg.visible {
            display: block;
        }
        
        .loading {
            opacity: 0.7;
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div class="section">
        <div class="section-title">📊 Google Sheet 讀取器</div>
        
        <button class="btn btn-google" id="connectBtn" onclick="connectGoogle()">
            🔐 連接 Google 帳號
        </button>
        
        <div class="form-group">
            <label class="form-label">頁籤名稱</label>
            <input type="text" id="sheetName" placeholder="例如：Sheet1" />
        </div>
        
        <div class="form-group">
            <label class="form-label">列號（第幾列）</label>
            <input type="number" id="rowNumber" placeholder="例如：2" min="2" value="2" />
        </div>
        
        <button class="btn btn-primary" id="fetchBtn" onclick="fetchRowData()" disabled>
            📥 讀取資料
        </button>
        
        <div class="error-msg" id="errorMsg"></div>
        
        <div class="result-box" id="resultBox">
            <div class="result-title">📋 讀取結果</div>
            
            <div class="result-item">
                <div class="result-label">議題紀錄</div>
                <div class="result-value highlight" id="issueRecord">-</div>
            </div>
            
            <div class="result-item">
                <div class="result-label">程式代號</div>
                <div class="result-value highlight" id="programCode">-</div>
            </div>
        </div>
    </div>
    
    <div class="status-bar">
        <span id="statusDot" class="status-dot disconnected"></span>
        <span id="statusText">未連接</span>
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
            
            // 驗證輸入
            if (!sheetName) {
                showError('請輸入頁籤名稱');
                return;
            }
            if (!rowNumber || rowNumber < 1) {
                showError('請輸入有效的列號（大於 0）');
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
            document.getElementById('statusDot').className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
            document.getElementById('statusText').textContent = connected ? '已連接' : '未連接';
            document.getElementById('connectBtn').textContent = connected ? '✓ 已連接' : '🔐 連接 Google 帳號';
            document.getElementById('connectBtn').disabled = connected;
            document.getElementById('fetchBtn').disabled = !connected;
        }
        
        // 接收來自擴展的訊息
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
                    document.getElementById('resultBox').classList.add('visible');
                    break;
                    
                case 'error':
                    document.getElementById('fetchBtn').textContent = '📥 讀取資料';
                    document.getElementById('fetchBtn').disabled = false;
                    showError(message.message);
                    break;
                    
                case 'loggedOut':
                    updateConnectionStatus(false);
                    document.getElementById('resultBox').classList.remove('visible');
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
