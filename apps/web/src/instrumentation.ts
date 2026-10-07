/**
 * Next.js instrumentation hook: wires the error-monitoring adapter once per server process.
 * ERROR_WEBHOOK_URL receives a JSON POST per unhandled error; swap in Sentry/Datadog here.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const { setErrorReporter } = await import("@app/shared/server");
  setErrorReporter((error, context) => {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "web", error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error), context }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  });
}
