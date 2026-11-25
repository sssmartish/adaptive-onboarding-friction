import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

const environment = {
  recorded_at: new Date().toISOString(),
  operating_system: `${os.type()} ${os.release()}`,
  operating_system_version: os.version(),
  architecture: os.arch(),
  processor: os.cpus()[0]?.model ?? "Unknown",
  logical_processors: os.cpus().length,
  total_memory_gb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
  node: process.version,
  browsers: {
    microsoft_edge: process.env.EDGE_VERSION ?? "Unknown",
    google_chrome: process.env.CHROME_VERSION ?? "Unknown",
    mozilla_firefox: process.env.FIREFOX_VERSION ?? "Unknown"
  }
};

await mkdir(new URL("../evidence/results/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../evidence/results/test-environment.json", import.meta.url),
  `${JSON.stringify(environment, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify(environment, null, 2));
