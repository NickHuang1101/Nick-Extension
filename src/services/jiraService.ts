/**
 * JIRA API 服務
 * 處理與 JIRA Server 的 API 交互
 */
export class JiraService {
    private baseUrl: string;
    private username: string;
    private password: string;
    private authHeader: string;

    constructor() {
        this.baseUrl = 'http://172.20.10.106:5050';
        this.username = 'nick_huang';
        this.password = 'abcd1234';
        this.authHeader = 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');
    }

    /**
     * 發送 API 請求
     */
    private async request(method: string, endpoint: string, body?: any): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        
        const options: RequestInit = {
            method,
            headers: {
                'Authorization': this.authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`JIRA API 錯誤 (${response.status}): ${errorText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            return await response.text();
        } catch (error: any) {
            console.error('JIRA API 請求失敗:', error);
            throw error;
        }
    }

    /**
     * 測試連線
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.request('GET', '/rest/api/2/myself');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 取得所有專案
     */
    async getProjects(): Promise<any[]> {
        return await this.request('GET', '/rest/api/2/project');
    }

    /**
     * 取得專案的 Issue Types
     */
    async getIssueTypes(projectKey: string): Promise<any[]> {
        const project = await this.request('GET', `/rest/api/2/project/${projectKey}`);
        return project.issueTypes || [];
    }

    /**
     * 取得專案的 Sprints（透過 Board）
     */
    async getSprints(projectKey: string): Promise<any[]> {
        try {
            // 先取得 Board ID
            const boards = await this.request('GET', `/rest/agile/1.0/board?projectKeyOrId=${projectKey}`);
            if (!boards.values || boards.values.length === 0) {
                return [];
            }

            const boardId = boards.values[0].id;
            const sprints = await this.request('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=active,future`);
            return sprints.values || [];
        } catch {
            return [];
        }
    }

    /**
     * 取得專案的 Epics
     */
    async getEpics(projectKey: string): Promise<any[]> {
        try {
            const result = await this.request('GET', 
                `/rest/api/2/search?jql=project=${projectKey} AND issuetype=Epic&fields=key,summary`
            );
            return result.issues || [];
        } catch {
            return [];
        }
    }

    /**
     * 取得專案成員（可指派的使用者）
     */
    async getAssignableUsers(projectKey: string): Promise<any[]> {
        try {
            return await this.request('GET', `/rest/api/2/user/assignable/search?project=${projectKey}`);
        } catch {
            return [];
        }
    }

    /**
     * 創建 Issue
     */
    async createIssue(params: {
        projectKey: string;
        issueType: string;
        summary: string;
        description?: string;
        reporter?: string;
        assignee?: string;
        epicLink?: string;
        sprint?: number;
    }): Promise<any> {
        const fields: any = {
            project: { key: params.projectKey },
            issuetype: { name: params.issueType },
            summary: params.summary
        };

        if (params.description) {
            fields.description = params.description;
        }

        if (params.reporter) {
            fields.reporter = { name: params.reporter };
        }

        if (params.assignee) {
            fields.assignee = { name: params.assignee };
        }

        // Epic Link 欄位 (customfield_10101)
        if (params.epicLink) {
            fields.customfield_10101 = params.epicLink;
        }

        const body = { fields };

        const result = await this.request('POST', '/rest/api/2/issue', body);

        // 如果有 Sprint，需要用另一個 API 來設定
        if (params.sprint && result.key) {
            try {
                await this.request('POST', `/rest/agile/1.0/sprint/${params.sprint}/issue`, {
                    issues: [result.key]
                });
            } catch (error) {
                console.warn('設定 Sprint 失敗:', error);
            }
        }

        return result;
    }

    /**
     * 取得 Issue 詳情
     */
    async getIssue(issueKey: string): Promise<any> {
        return await this.request('GET', `/rest/api/2/issue/${issueKey}`);
    }
}
