import * as vscode from 'vscode';

/**
 * 功能選單項目
 */
export class MenuTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly icon?: string,
        public readonly contextValue?: string
    ) {
        super(label, collapsibleState);
        
        if (icon) {
            this.iconPath = new vscode.ThemeIcon(icon);
        }
        
        if (contextValue) {
            this.contextValue = contextValue;
        }
    }
}

/**
 * 功能選單 TreeDataProvider
 */
export class MenuTreeProvider implements vscode.TreeDataProvider<MenuTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MenuTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<MenuTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<MenuTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MenuTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: MenuTreeItem): Thenable<MenuTreeItem[]> {
        if (element) {
            // 子項目
            return Promise.resolve([]);
        } else {
            // 根項目
            return Promise.resolve(this.getMenuItems());
        }
    }

    private getMenuItems(): MenuTreeItem[] {
        return [
            new MenuTreeItem(
                '快速開單',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'sheetReader.quickCreate',
                    title: '快速開單'
                },
                'new-file',
                'quickCreate'
            ),
            // 可以在這裡添加更多功能選單項目
            // new MenuTreeItem(
            //     '其他功能',
            //     vscode.TreeItemCollapsibleState.None,
            //     { command: 'sheetReader.otherFeature', title: '其他功能' },
            //     'gear',
            //     'otherFeature'
            // ),
        ];
    }
}
