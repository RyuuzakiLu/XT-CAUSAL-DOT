import { type ReactElement } from 'react';
import { type CalTask, type CalTasks } from './calendar.ts';
type Mutate = (task: CalTask, status: 'done' | 'pending', operationId: string) => Promise<CalTask>;
type Create = (title: string, operationId: string) => Promise<CalTask>;
export type TaskState = {
    status: 'loading';
} | {
    status: 'error';
    message: string;
} | ({
    status: 'ready';
} & CalTasks);
export declare function CalendarTasks({ state, setState, retry, now, update, create }: {
    state: TaskState;
    setState(value: TaskState): void;
    retry(): void;
    now: number;
    update?: Mutate;
    create?: Create;
}): ReactElement;
export {};
