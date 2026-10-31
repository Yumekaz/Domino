import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
const run = promisify(execFile);
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error(
    "This optional helper supports Windows x64. Other platforms should use their existing PostgreSQL 17 installation.",
  );
const directory = resolve(".domino/tools/postgres-17.11");
const archive = join(
  directory,
  "embedded-postgres-windows-x64-17.11.0-beta.19.tgz",
);
const binary = join(directory, "package/native/bin/postgres.exe");
const integrity =
  "sha512-z1/SIyBulCYPWYsLWDkgniAYqSd2KBc48zwPOPpyu2YGYIoQ5kRCU6bEJ2q/lcsBuseAdWAn1lBg7KiI/pIg4Q==";
await mkdir(directory, { recursive: true });
if (
  !(await access(archive).then(
    () => true,
    () => false,
  ))
) {
  const response = await fetch(
    "https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-17.11.0-beta.19.tgz",
    { signal: AbortSignal.timeout(300000) },
  );
  if (!response.ok)
    throw new Error(
      `PostgreSQL binary download failed: HTTP ${response.status}`,
    );
  await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
}
if (
  "sha512-" +
    createHash("sha512")
      .update(await readFile(archive))
      .digest("base64") !==
  integrity
)
  throw new Error(
    "PostgreSQL package integrity mismatch; archive retained, not executed",
  );
if (
  !(await access(binary).then(
    () => true,
    () => false,
  ))
) {
  await run("tar", ["-xzf", archive, "-C", directory], {
    windowsHide: true,
    timeout: 120000,
  });
}
const result = await run(binary, ["--version"], {
  windowsHide: true,
  timeout: 10000,
});
if (!result.stdout.includes("PostgreSQL) 17.11"))
  throw new Error("Unexpected local PostgreSQL binary");
console.log(
  "Verified PostgreSQL 17.11 tools. No database was initialized, reset or deleted.",
);
console.log(
  `DOMINO_PG_BIN_DIR=${join(directory, "package/native/bin").replaceAll("\\", "/")}`,
);
console.log(
  `DOMINO_PG_DATA_DIR=${resolve(".domino/data/postgres").replaceAll("\\", "/")}`,
);
