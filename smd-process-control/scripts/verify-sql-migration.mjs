import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function verifyLexicalClosure(sql) {
  let state = "normal";
  let dollarTag = "";
  let blockDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (state === "line-comment") {
      if (current === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) state = "normal";
      }
      continue;
    }
    if (state === "single-quote") {
      if (current === "'" && next === "'") index += 1;
      else if (current === "'") state = "normal";
      continue;
    }
    if (state === "double-quote") {
      if (current === '"' && next === '"') index += 1;
      else if (current === '"') state = "normal";
      continue;
    }
    if (state === "dollar-quote") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = "normal";
        dollarTag = "";
      }
      continue;
    }

    if (current === "-" && next === "-") {
      state = "line-comment";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "block-comment";
      blockDepth = 1;
      index += 1;
    } else if (current === "'") {
      state = "single-quote";
    } else if (current === '"') {
      state = "double-quote";
    } else if (current === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        state = "dollar-quote";
        index += dollarTag.length - 1;
      }
    }
  }

  if (state !== "normal" && state !== "line-comment") {
    fail(`unterminated SQL lexical state: ${state}`);
  }
}

function parseArguments(argv) {
  const file = argv[2];
  if (!file) fail("usage: verify-sql-migration.mjs <file> [--expected-chars N]");
  const expectedIndex = argv.indexOf("--expected-chars");
  const expectedChars = expectedIndex === -1
    ? null
    : Number.parseInt(argv[expectedIndex + 1] ?? "", 10);
  if (expectedIndex !== -1 && !Number.isSafeInteger(expectedChars)) {
    fail("--expected-chars requires a safe integer");
  }
  return { file: resolve(file), expectedChars };
}

try {
  const { file, expectedChars } = parseArguments(process.argv);
  const sql = readFileSync(file, "utf8");

  if (/tokens truncated|warning:\s*truncated output/i.test(sql) || sql.includes("…")) {
    fail("transport truncation marker detected");
  }
  if (expectedChars !== null && sql.length !== expectedChars) {
    fail(`length mismatch: expected ${expectedChars}, received ${sql.length}`);
  }
  if (!sql.trimEnd().endsWith(";")) fail("migration does not end with a semicolon");

  verifyLexicalClosure(sql);

  const dollarDelimiters = sql.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) ?? [];
  if (dollarDelimiters.length % 2 !== 0) {
    fail(`odd dollar delimiter count: ${dollarDelimiters.length}`);
  }

  process.stdout.write(
    `SQL migration guard verified ${sql.length} characters `
      + `and ${dollarDelimiters.length} dollar delimiters\n`,
  );
} catch (error) {
  process.stderr.write(`SQL migration guard failed: ${error.message}\n`);
  process.exitCode = 1;
}
