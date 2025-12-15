import * as vscode from 'vscode';
import { MenuTreeProvider } from './MenuTreeProvider';
import { QuickCreatePanel } from './QuickCreatePanel';
import { GoogleAuthService } from './services/googleAuthService';
import { GoogleSheetsService } from './services/googleSheetsService';

// 全域變數
let googleAuthService: GoogleAuthService;
let googleSheetsService: GoogleSheetsService | null = null;

/**
 * 擴展啟動時調用
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('工具箱已啟動！');

    // 初始化 Google Auth 服務
    googleAuthService = new GoogleAuthService(context);

    // 註冊左側功能選單 TreeView
    const menuTreeProvider = new MenuTreeProvider();
    vscode.window.registerTreeDataProvider('sheetReader.menuView', menuTreeProvider);

    // 註冊連接 Google 帳號的命令
    const connectGoogleCmd = vscode.commands.registerCommand('sheetReader.connectGoogle', async () => {
        const authClient = await googleAuthService.authenticate();
        if (authClient) {
            googleSheetsService = new GoogleSheetsService(authClient);
            vscode.window.showInformationMessage('✅ Google 帳號連接成功！');
        }
    });

    // 註冊快速開單命令 - 點擊左側選單時觸發
    const quickCreateCmd = vscode.commands.registerCommand('sheetReader.quickCreate', () => {
        QuickCreatePanel.createOrShow(
            context.extensionUri,
            googleSheetsService,
            async () => {
                const authClient = await googleAuthService.authenticate();
                if (authClient) {
                    googleSheetsService = new GoogleSheetsService(authClient);
                    return googleSheetsService;
                }
                return null;
            }
        );
    });

    // 註冊登出 Google 帳號的命令
    const logoutCmd = vscode.commands.registerCommand('sheetReader.logout', async () => {
        await googleAuthService.logout();
        googleSheetsService = null;
    });

    context.subscriptions.push(connectGoogleCmd, quickCreateCmd, logoutCmd);
}

export function deactivate() {
    console.log('工具箱已停用');
}
