import { google, sheets_v4 } from 'googleapis';

/**
 * Google Sheets API 服務
 * 封裝讀取 Sheet 資料的方法
 */
export class GoogleSheetsService {
    private sheets: sheets_v4.Sheets;

    constructor(authClient: any) {
        this.sheets = google.sheets({ version: 'v4', auth: authClient });
    }

    /**
     * 解析 Google Sheet URL 取得 Spreadsheet ID 和 GID
     */
    static parseSheetUrl(url: string): { spreadsheetId: string; gid?: string } | null {
        // 匹配格式: https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit?gid={gid}
        const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
        const match = url.match(regex);
        
        if (!match) {
            return null;
        }

        const spreadsheetId = match[1];
        
        // 嘗試取得 gid
        const gidMatch = url.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : undefined;

        return { spreadsheetId, gid };
    }

    /**
     * 取得 Spreadsheet 的所有工作表資訊
     */
    async getSpreadsheetInfo(spreadsheetId: string): Promise<sheets_v4.Schema$Spreadsheet | null> {
        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId
            });
            return response.data;
        } catch (error) {
            console.error('取得 Spreadsheet 資訊失敗:', error);
            throw error;
        }
    }

    /**
     * 取得所有工作表（頁籤）名稱
     */
    async getAllSheetNames(spreadsheetId: string): Promise<string[]> {
        const info = await this.getSpreadsheetInfo(spreadsheetId);
        if (!info || !info.sheets) {
            return [];
        }
        
        return info.sheets
            .map(sheet => sheet.properties?.title)
            .filter((name): name is string => !!name);
    }

    /**
     * 根據 GID 找到對應的工作表名稱
     */
    async getSheetNameByGid(spreadsheetId: string, gid: string): Promise<string | null> {
        const info = await this.getSpreadsheetInfo(spreadsheetId);
        if (!info || !info.sheets) {
            return null;
        }

        const sheet = info.sheets.find(
            s => s.properties?.sheetId?.toString() === gid
        );
        
        return sheet?.properties?.title || null;
    }

    /**
     * 讀取指定範圍的資料
     * @param spreadsheetId Spreadsheet ID
     * @param range 範圍，例如 "Sheet1!A1:D10" 或 "Sheet1"
     */
    async getSheetData(spreadsheetId: string, range: string): Promise<any[][] | null> {
        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });

            return response.data.values || null;
        } catch (error) {
            console.error('讀取 Sheet 資料失敗:', error);
            throw error;
        }
    }

    /**
     * 讀取整個工作表的資料（使用 URL）
     */
    async getDataFromUrl(sheetUrl: string): Promise<{
        title: string;
        sheetName: string;
        data: any[][];
        headers: string[];
    } | null> {
        const parsed = GoogleSheetsService.parseSheetUrl(sheetUrl);
        if (!parsed) {
            throw new Error('無效的 Google Sheet URL');
        }

        const { spreadsheetId, gid } = parsed;

        // 取得 Spreadsheet 資訊
        const info = await this.getSpreadsheetInfo(spreadsheetId);
        if (!info) {
            throw new Error('無法取得 Spreadsheet 資訊');
        }

        // 決定要讀取哪個工作表
        let sheetName: string;
        if (gid) {
            const name = await this.getSheetNameByGid(spreadsheetId, gid);
            if (!name) {
                throw new Error(`找不到 GID ${gid} 對應的工作表`);
            }
            sheetName = name;
        } else {
            // 使用第一個工作表
            sheetName = info.sheets?.[0]?.properties?.title || 'Sheet1';
        }

        // 讀取資料
        const data = await this.getSheetData(spreadsheetId, sheetName);
        if (!data || data.length === 0) {
            throw new Error('工作表沒有資料');
        }

        return {
            title: info.properties?.title || 'Untitled',
            sheetName,
            data: data.slice(1), // 資料列（不含標題）
            headers: data[0] || [] // 第一列作為標題
        };
    }

    /**
     * 讀取指定頁籤的指定列，並取得「議題紀錄」和「程式代號」欄位
     * @param spreadsheetId Spreadsheet ID
     * @param sheetName 頁籤名稱
     * @param rowNumber 列號（從 1 開始，1 是標題列）
     */
    async getRowData(spreadsheetId: string, sheetName: string, rowNumber: number): Promise<{
        issueRecord: string;
        programCode: string;
        rowData: { [key: string]: string };
        headers: string[];
    }> {
        // 先讀取標題列（第一列）來找出欄位位置
        const headerRange = `'${sheetName}'!1:1`;
        const headerData = await this.getSheetData(spreadsheetId, headerRange);
        
        if (!headerData || headerData.length === 0) {
            throw new Error(`找不到頁籤 "${sheetName}" 或沒有標題列`);
        }

        const headers = headerData[0] as string[];
        
        // 找出「議題紀錄」和「程式代號」的欄位索引
        const issueRecordIndex = headers.findIndex(h => 
            h && (h.includes('議題紀錄') || h.includes('議題記錄') || h === '議題')
        );
        const programCodeIndex = headers.findIndex(h => 
            h && (h.includes('程式代號') || h.includes('程式碼') || h === '程式')
        );

        // 讀取指定列
        const rowRange = `'${sheetName}'!${rowNumber}:${rowNumber}`;
        const rowData = await this.getSheetData(spreadsheetId, rowRange);

        if (!rowData || rowData.length === 0) {
            throw new Error(`找不到第 ${rowNumber} 列的資料`);
        }

        const row = rowData[0] as string[];

        // 建立完整的 rowData 物件
        const rowDataObj: { [key: string]: string } = {};
        headers.forEach((header, index) => {
            if (header) {
                rowDataObj[header] = row[index] || '';
            }
        });

        return {
            issueRecord: issueRecordIndex >= 0 ? (row[issueRecordIndex] || '') : '(找不到此欄位)',
            programCode: programCodeIndex >= 0 ? (row[programCodeIndex] || '') : '(找不到此欄位)',
            rowData: rowDataObj,
            headers
        };
    }

    /**
     * 更新指定儲存格的值
     * @param spreadsheetId Spreadsheet ID
     * @param range 儲存格範圍（如 'Sheet1!A2'）
     * @param value 要寫入的值
     */
    async updateCell(spreadsheetId: string, range: string, value: string): Promise<void> {
        try {
            await this.sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[value]]
                }
            });
        } catch (error) {
            console.error('更新儲存格失敗:', error);
            throw error;
        }
    }

    /**
     * 更新 JIRA URL 到指定頁籤的「Jira單號」欄位
     * @param spreadsheetId Spreadsheet ID
     * @param sheetName 頁籤名稱
     * @param rowNumber 列號
     * @param jiraUrl JIRA Issue URL
     */
    async updateJiraUrl(spreadsheetId: string, sheetName: string, rowNumber: number, jiraUrl: string): Promise<boolean> {
        try {
            // 先讀取標題列找出「Jira單號」欄位的位置
            const headerRange = `'${sheetName}'!1:1`;
            const headerData = await this.getSheetData(spreadsheetId, headerRange);
            
            if (!headerData || headerData.length === 0) {
                throw new Error('找不到標題列');
            }

            const headers = headerData[0] as string[];
            console.log('標題列:', JSON.stringify(headers));  // 調試用
            
            // 尋找「Jira單號」欄位
            let jiraColIndex = -1;
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i];
                if (h && typeof h === 'string') {
                    const lower = h.toLowerCase();
                    console.log(`檢查欄位 ${i}: "${h}" -> "${lower}"`);
                    if (lower.includes('jira')) {
                        jiraColIndex = i;
                        console.log(`找到 Jira 欄位: 索引 ${i}, 名稱 "${h}"`);
                        break;
                    }
                }
            }

            if (jiraColIndex < 0) {
                console.warn('找不到任何包含 jira 的欄位');
                return false;
            }

            // 將欄位索引轉換為字母（支援超過 Z 的欄位）
            let colLetter = '';
            let colIdx = jiraColIndex;
            while (colIdx >= 0) {
                colLetter = String.fromCharCode(65 + (colIdx % 26)) + colLetter;
                colIdx = Math.floor(colIdx / 26) - 1;
            }
            const cellRange = `'${sheetName}'!${colLetter}${rowNumber}`;
            console.log('寫入儲存格:', cellRange, '值:', jiraUrl);

            await this.updateCell(spreadsheetId, cellRange, jiraUrl);
            return true;
        } catch (error) {
            console.error('更新 Jira URL 失敗:', error);
            return false;
        }
    }

    /**
     * 使用固定的 Spreadsheet ID（用戶提供的 Sheet）
     */
    static readonly DEFAULT_SPREADSHEET_ID = '1k2mEDCgzIDpEefl0S6h2jYSlWxbueA_IZxrYhRjWqP4';
}
