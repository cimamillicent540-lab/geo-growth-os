import { RunResultPage } from '@/app/components/Console';

export default async function Page({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  return <RunResultPage clientId={id} runId={runId} />;
}
