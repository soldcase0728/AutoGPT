/**
 * Cron entry point: call one scheduled job on the web service.
 *
 * This exists as a file rather than an inline `dockerCommand` for two reasons,
 * both of which have already cost a deploy:
 *
 *   1. The runtime image has no wget and no curl. It is node:22-slim plus
 *      openssl, ca-certificates and tini -- nothing else. A command built
 *      around `wget` exits 127 (command not found) every five minutes, which
 *      is what the first Blueprint deploy did. Node's built-in fetch is the
 *      one HTTP client the image is guaranteed to have.
 *   2. An inline command has to survive YAML folding and shell word-splitting
 *      before it reaches node. A file has no quoting to get wrong.
 *
 * Several jobs may be named in one invocation. They run in sequence and one
 * failure does not stop the rest -- expired holds should still be released in a
 * five-minute window where the outbound queue happens to be broken. The exit
 * code is non-zero if any of them failed.
 *
 * Usage: node run-job.mjs <job-name> [job-name...]
 */

const jobNames = process.argv.slice(2);

if (jobNames.length === 0) {
  console.error("Usage: node run-job.mjs <job-name> [job-name...]");
  process.exit(2);
}

const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
const token = process.env.JOB_RUNNER_TOKEN;

// These two are the whole configuration, so say plainly which one is missing
// rather than failing on a malformed URL further down.
if (!appUrl) {
  console.error(
    "APP_URL is not set, so there is no address to call.\n" +
      "Set APP_URL on this cron job to the public URL Render assigned the web\n" +
      "service (for example https://olsm-facilities.onrender.com), then redeploy.",
  );
  process.exit(1);
}

if (!token) {
  console.error(
    "JOB_RUNNER_TOKEN is not set. It should come from the web service via\n" +
      "fromService in render.yaml, so that both sides share one value.",
  );
  process.exit(1);
}

let failed = 0;

for (const jobName of jobNames) {
  const target = `${appUrl}/api/jobs/${jobName}`;

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      // Comfortably inside the five-minute cron interval even with several
      // jobs, so a hung request cannot leave two runs overlapping.
      signal: AbortSignal.timeout(60_000),
    });

    const body = (await response.text()).slice(0, 500);

    if (!response.ok) {
      failed += 1;
      console.error(`${jobName}: HTTP ${response.status} ${body}`);
      // 401 is the one worth naming: it means the two services disagree about
      // the token, which no amount of retrying fixes.
      if (response.status === 401) {
        console.error(
          "  The web service rejected the token. JOB_RUNNER_TOKEN differs between\n" +
            "  this cron job and the web service.",
        );
      }
      continue;
    }

    console.log(`${jobName}: ${body}`);
  } catch (error) {
    failed += 1;
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`${jobName}: request to ${target} failed — ${reason}`);
  }
}

if (failed > 0) {
  console.error(`${failed} of ${jobNames.length} job(s) failed.`);
  process.exit(1);
}
