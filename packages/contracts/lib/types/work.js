/**
 * 把快照压成列表项。
 * 为什么放在契约里：工作空间、临时卡、精灵提示都要同一份投影，
 * 各写一遍就会出现"列表说完成了卡片说执行中"。
 * @param snapshot - 完整快照
 * @returns 列表项
 */
export function summarizeWork(snapshot) {
    return {
        id: snapshot.id,
        goal: snapshot.goal,
        status: snapshot.status,
        stage: snapshot.stage,
        updatedAt: snapshot.updatedAt,
        artifactCount: snapshot.artifacts.length,
    };
}
