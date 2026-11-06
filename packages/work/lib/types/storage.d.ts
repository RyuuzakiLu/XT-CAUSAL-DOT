import type { ArtifactId, WorkId } from '@xtcausal/dot-contracts';
import type { ArtifactRecord, OperationRecord, PlanRecord, WorkRecord } from './types.ts';
/** 工作域：四张表，单一版本。任何一条记录不合 schema 都会拒绝整个域的打开（官方行为）。 */
export declare const dotWorkDomain: {
    name: string;
    version: number;
    tables: {
        works: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<WorkId, WorkRecord>;
        artifacts: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<ArtifactId, ArtifactRecord>;
        plans: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, PlanRecord>;
        operations: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, OperationRecord>;
    };
};
