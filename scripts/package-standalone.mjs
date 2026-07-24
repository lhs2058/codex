import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(projectRoot, "dist-standalone", "index.html");
const outputDir = path.join(projectRoot, "output");
const destination = path.join(outputDir, "ACM_일일_출근_현황_오프라인.html");

await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(source, destination);

const stat = await fs.stat(destination);
console.log(`Standalone HTML: ${destination} (${stat.size} bytes)`);
