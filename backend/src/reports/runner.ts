import { getReport } from './registry.ts';
import {
  ReportError,
  type ReportArtifact,
  type ReportContext,
  type ReportFormat,
} from './types.ts';

const CONTENT_TYPES: Record<ReportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export async function runReport(
  reportId: string,
  format: ReportFormat,
  rawParams: unknown,
  ctx: ReportContext,
): Promise<ReportArtifact> {
  const def = getReport(reportId);
  if (!def) {
    throw new ReportError('not_found', `Unknown report: ${reportId}`);
  }
  if (!def.supportedFormats.includes(format)) {
    throw new ReportError(
      'validation_error',
      `Format "${format}" is not supported by "${reportId}"`,
    );
  }

  const parsed = def.paramsSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new ReportError('validation_error', 'Invalid params', parsed.error.issues);
  }

  const data = await def.fetch(parsed.data, ctx);
  const renderer = def.renderers[format];
  if (!renderer) {
    throw new ReportError('internal_error', `No ${format} renderer for ${reportId}`);
  }
  const buffer = await renderer(data, parsed.data);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    buffer,
    filename: `${def.id}-${stamp}.${format}`,
    contentType: CONTENT_TYPES[format],
  };
}
