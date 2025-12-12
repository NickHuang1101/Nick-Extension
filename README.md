# Hello World Extension

這是一個簡單的 VS Code 擴展範例，用於學習如何開發 VS Code 擴展。

## 功能

此擴展提供兩個命令：

1. **Hello World: 說聲你好** - 顯示一個簡單的問候訊息
2. **Hello World: 詢問名字** - 詢問使用者的名字，並顯示個人化問候

## 如何使用

1. 開啟命令面板 (`Ctrl+Shift+P` 或 `Cmd+Shift+P`)
2. 輸入 "Hello World" 來搜尋相關命令
3. 選擇要執行的命令

## 開發

### 必要條件

- Node.js 18+
- VS Code 1.85+

### 安裝依賴

```bash
npm install
```

### 編譯

```bash
npm run compile
```

### 調試

1. 在 VS Code 中開啟此專案
2. 按下 `F5` 啟動擴展開發主機
3. 在新開啟的 VS Code 視窗中測試擴展

## 專案結構

```
.
├── .vscode/
│   ├── launch.json      # 調試配置
│   └── tasks.json       # 任務配置
├── src/
│   └── extension.ts     # 擴展主程式
├── package.json         # 專案配置與擴展清單
├── tsconfig.json        # TypeScript 配置
└── README.md            # 本文件
```

## 學習更多

- [VS Code 擴展 API 文檔](https://code.visualstudio.com/api)
- [擴展範例](https://github.com/microsoft/vscode-extension-samples)
