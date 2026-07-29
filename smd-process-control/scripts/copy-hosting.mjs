import fs from "node:fs/promises";
import path from "node:path";

const source = path.resolve(".openai", "hosting.json");
const targetDirectory = path.resolve("dist", ".openai");

await fs.mkdir(targetDirectory, { recursive: true });
await fs.copyFile(source, path.join(targetDirectory, "hosting.json"));
