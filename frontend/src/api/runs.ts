import { baseUrl } from './fetcher';

export type CreateRunInput = {
  reportId: string;
  format: 'xlsx';
  params: Record<string, unknown>;
};

export type CreateRunResult = {
  blob: Blob;
  filename: string;
};

export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Run failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? `${input.reportId}.${input.format}`;
  return { blob: await res.blob(), filename };
}

export function triggerDownload({ blob, filename }: CreateRunResult): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
