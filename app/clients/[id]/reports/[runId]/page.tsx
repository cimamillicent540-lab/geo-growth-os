import { ReportPageClient } from '@/app/components/Console';

export default async function Page({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  return <ReportPageClient clientId={id} runId={runId} />;
}
