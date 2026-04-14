import { baseUrl } from './fetcher';

export async function downloadRun(runId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/runs/${runId}/download`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Download failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? `${runId}.xlsx`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
