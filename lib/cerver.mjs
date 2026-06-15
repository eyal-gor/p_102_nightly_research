// The cerver integration — the one place this project touches a model.
// We don't call any LLM API: we hand the task to `cerver run`, which executes
// the agent on a compute you own and bills it to your subscription.
import { execFile } from "node:child_process";

const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 16 * 1024 * 1024;

// Strip cerver's per-call header line ("==== claude (3s · subscription · …) ====")
// and return just the agent's reply text.
function stripHeader(out) {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => /^====\s/.test(l));
  return (i >= 0 ? lines.slice(i + 1).join("\n") : out).trim();
}

/**
 * Run one agent task through cerver and return its reply text.
 * @param {string} prompt
 * @param {{cli?: string, compute?: string, bill?: string}} opts
 */
export function runAgent(prompt, opts = {}) {
  const args = ["run", "--cli", opts.cli || "claude"];
  if (opts.compute) args.push("--on", opts.compute);
  if (opts.bill) args.push("--bill", opts.bill);
  args.push(prompt);

  return new Promise((resolve, reject) => {
    execFile("cerver", args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") {
          return reject(new Error("cerver not found — install it: curl -fsSL https://cerver.ai/install.sh | bash"));
        }
        return reject(new Error((stderr && stderr.trim()) || err.message));
      }
      const reply = stripHeader(stdout);
      if (!reply) return reject(new Error("empty reply from cerver"));
      resolve(reply);
    });
  });
}
