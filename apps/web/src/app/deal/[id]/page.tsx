import { DealView } from "./deal-view";

export const metadata = { title: "OTC deal", robots: { index: false } };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealView publicId={id} />;
}
