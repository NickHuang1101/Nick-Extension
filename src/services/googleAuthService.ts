import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Google OAuth 認證服務
 * 處理 OAuth 2.0 認證流程
 */
export class GoogleAuthService {
    private oauth2Client: any;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 從 credentials.json 載入憑證並初始化 OAuth 客戶端
     */
    private async loadCredentials(): Promise<boolean> {
        // 嘗試從擴展安裝目錄或工作區尋找 credentials.json
        const possiblePaths = [
            path.join(this.context.extensionPath, 'credentials.json')
        ];

        // 如果有工作區，也嘗試從工作區尋找
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            possiblePaths.push(path.join(workspaceFolders[0].uri.fsPath, 'credentials.json'));
        }

        let credentialsPath: string | null = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                credentialsPath = p;
                break;
            }
        }

        if (!credentialsPath) {
            vscode.window.showErrorMessage(
                `找不到 credentials.json！請將檔案放到: ${possiblePaths[0]}`
            );
            return false;
        }

        try {
            const content = fs.readFileSync(credentialsPath, 'utf-8');
            const credentials = JSON.parse(content);
            const { client_id, client_secret } = credentials.installed || credentials.web;

            this.oauth2Client = new google.auth.OAuth2(
                client_id,
                client_secret,
                'http://localhost:3000/oauth2callback'
            );

            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`載入憑證失敗: ${error}`);
            return false;
        }
    }

    /**
     * 取得已儲存的 Token
     */
    private async getStoredToken(): Promise<any | null> {
        const token = await this.context.secrets.get('google-oauth-token');
        if (token) {
            try {
                return JSON.parse(token);
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 儲存 Token
     */
    private async storeToken(token: any): Promise<void> {
        await this.context.secrets.store('google-oauth-token', JSON.stringify(token));
    }

    /**
     * 啟動本地伺服器接收 OAuth 回調
     */
    private startLocalServer(): Promise<string> {
        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                try {
                    const queryObject = url.parse(req.url || '', true).query;
                    const code = queryObject.code as string;

                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
                            <html>
                            <head>
                                <style>
                                    body {
                                        font-family: 'Segoe UI', sans-serif;
                                        display: flex;
                                        justify-content: center;
                                        align-items: center;
                                        height: 100vh;
                                        margin: 0;
                                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                        color: white;
                                    }
                                    .container {
                                        text-align: center;
                                        padding: 40px;
                                        background: rgba(255,255,255,0.1);
                                        border-radius: 20px;
                                        backdrop-filter: blur(10px);
                                    }
                                    h1 { margin-bottom: 10px; }
                                    p { opacity: 0.9; }
                                </style>
                            </head>
                            <body>
                                <div class="container">
                                    <h1>✅ 授權成功！</h1>
                                    <p>您可以關閉此頁面並返回 VS Code</p>
                                </div>
                            </body>
                            </html>
                        `);
                        
                        server.close();
                        resolve(code);
                    } else {
                        res.writeHead(400);
                        res.end('Missing authorization code');
                        reject(new Error('Missing authorization code'));
                    }
                } catch (error) {
                    reject(error);
                }
            });

            server.listen(3000, () => {
                console.log('OAuth callback server listening on port 3000');
            });

            // 30 秒超時
            setTimeout(() => {
                server.close();
                reject(new Error('OAuth 超時，請重試'));
            }, 30000);
        });
    }

    /**
     * 執行認證流程
     */
    async authenticate(): Promise<any | null> {
        // 載入憑證
        if (!await this.loadCredentials()) {
            return null;
        }

        // 檢查是否有已儲存的 Token
        const storedToken = await this.getStoredToken();
        if (storedToken) {
            this.oauth2Client.setCredentials(storedToken);
            
            // 檢查 Token 是否過期
            if (storedToken.expiry_date && storedToken.expiry_date > Date.now()) {
                return this.oauth2Client;
            }

            // 嘗試刷新 Token
            if (storedToken.refresh_token) {
                try {
                    const { credentials } = await this.oauth2Client.refreshAccessToken();
                    await this.storeToken(credentials);
                    this.oauth2Client.setCredentials(credentials);
                    return this.oauth2Client;
                } catch (error) {
                    console.log('Token 刷新失敗，需要重新登入');
                }
            }
        }

        // 生成授權 URL
        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });

        // 開啟瀏覽器讓使用者登入
        vscode.env.openExternal(vscode.Uri.parse(authUrl));
        vscode.window.showInformationMessage('請在瀏覽器中完成 Google 登入...');

        try {
            // 啟動本地伺服器等待回調
            const code = await this.startLocalServer();

            // 用授權碼換取 Token
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            
            // 儲存 Token
            await this.storeToken(tokens);
            
            vscode.window.showInformationMessage('✅ Google 帳號連接成功！');
            return this.oauth2Client;
        } catch (error) {
            vscode.window.showErrorMessage(`認證失敗: ${error}`);
            return null;
        }
    }

    /**
     * 登出（清除已儲存的 Token）
     */
    async logout(): Promise<void> {
        await this.context.secrets.delete('google-oauth-token');
        this.oauth2Client = null;
        vscode.window.showInformationMessage('已登出 Google 帳號');
    }

    /**
     * 取得認證後的 OAuth 客戶端
     */
    getAuthClient(): any {
        return this.oauth2Client;
    }
}
