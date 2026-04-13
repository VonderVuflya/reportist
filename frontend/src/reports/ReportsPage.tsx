import { useListReports } from '../api/generated/reports/reports';

export function ReportsPage() {
  const { data, isPending, error } = useListReports();

  if (isPending) return <p style={{ textAlign: 'center' }}>Loading reports…</p>;
  if (error)
    return (
      <p style={{ textAlign: 'center', color: 'tomato' }}>
        Failed to load reports: {error instanceof Error ? error.message : String(error)}
      </p>
    );

  const reports = data?.data ?? [];

  return (
    <section style={{ maxWidth: 640, margin: '0 auto' }}>
      <h2>Reports</h2>
      {reports.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No reports registered yet.</p>
      ) : (
        <ul>
          {reports.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> <code>{r.id}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
