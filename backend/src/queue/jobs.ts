import type { ReportFormat } from '../reports/types.ts';

export const REPORT_QUEUE = 'reports';

export type GenerateReportJob = {
  runId: string;
  reportId: string;
  format: ReportFormat;
  params: unknown;
  userId: string;
};
