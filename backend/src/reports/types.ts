import type { Sql } from 'postgres';
import type { ZodType } from 'zod';

export type ReportFormat = 'xlsx';

export type ReportContext = {
  db: Sql;
  userId: string;
};

export type ReportArtifact = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

export type ReportDefinition<P = unknown, D = unknown> = {
  id: string;
  name: string;
  description: string;
  paramsSchema: ZodType<P>;
  supportedFormats: ReportFormat[];
  fetch: (params: P, ctx: ReportContext) => Promise<D>;
  renderers: {
    xlsx?: (data: D, params: P) => Promise<Buffer>;
  };
};

export class ReportError extends Error {
  constructor(
    public code:
      | 'validation_error'
      | 'not_found'
      | 'unprocessable'
      | 'internal_error',
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
