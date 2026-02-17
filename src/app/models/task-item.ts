export type TaskKind = 'task' | 'medication';

export interface DailySchedule {
  type: 'daily';
  time: string;
}

export interface TaskState {
  lastCompletedDate: string | null;
  snoozedUntil: string | null;
  lastAlertedAt: string | null;
}

export interface TaskItem {
  id: string;
  kind: TaskKind;
  title: string;
  description: string;
  schedule: DailySchedule;
  state: TaskState;
}

export interface NewTaskInput {
  kind: TaskKind;
  title: string;
  description: string;
  time: string;
}

export interface TaskStatus {
  kind: 'done' | 'snoozed' | 'pending' | 'overdue';
  label: string;
}
