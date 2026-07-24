import fs from "node:fs/promises";
import path from "node:path";

const source = path.resolve(".openai", "hosting.json");
const targetDir = path.resolve("dist", ".openai");
const target = path.join(targetDir, "hosting.json");

await fs.mkdir(targetDir, { recursive: true });
await fs.copyFile(source, target);
console.log("Copied Sites hosting metadata to dist/.openai/hosting.json");
