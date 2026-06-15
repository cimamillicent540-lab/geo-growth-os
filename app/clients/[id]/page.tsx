import { ClientDetailPage } from '@/app/components/Console';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetailPage clientId={id} />;
}
