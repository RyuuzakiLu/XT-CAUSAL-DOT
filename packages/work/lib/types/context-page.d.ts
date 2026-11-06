export interface PageQuery {
    resource: string;
    revision?: string;
    offset?: number;
    limit?: number;
}
export interface ContextPage {
    resource: string;
    revision: string;
    offset: number;
    totalChars: number;
    nextOffset: number | null;
    text: string;
}
export declare function pageText(query: PageQuery, workRevision: number, value: string): ContextPage;
export declare class ContextBudget {
    private readonly usages;
    charge(agent: object, turn: number, chars: number): void;
}
