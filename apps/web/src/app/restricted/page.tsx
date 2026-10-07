export const metadata = { title: "Not available" };

export default function Restricted() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <h1 className="title-display text-[40px]">Not available in your region</h1>
      <p className="mt-3 text-muted">This service can't be used from your location. You can still read the terms, privacy policy and risk disclosure.</p>
    </div>
  );
}
