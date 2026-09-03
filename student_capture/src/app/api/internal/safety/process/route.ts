import { serverEnv } from "@/lib/env";
import { processNextSafetyJob } from "@/lib/safety/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${serverEnv.safetyWorkerSecret()}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const processed: string[] = [];
  while (processed.length < 4 && Date.now() - started < 240_000) {
    const result = await processNextSafetyJob();
    if (!result.processed) break;
    processed.push(result.jobId);
  }
  return Response.json({ ok: true, processed: processed.length });
}
