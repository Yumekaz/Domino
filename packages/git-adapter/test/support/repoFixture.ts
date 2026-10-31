import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface FixtureIdentity {
  name: string;
  email: string;
  date: string;
}

export interface FixtureRepo {
  dir: string;
  shas: Record<string, string>;
  cleanup(): void;
}

const ALICE: FixtureIdentity = {
  name: "Alice Example",
  email: "alice@example.com",
  date: "2025-01-01T00:00:00Z",
};
const BOB: FixtureIdentity = {
  name: "Bob Example",
  email: "bob@example.com",
  date: "2025-01-02T00:00:00Z",
};
const CAROL: FixtureIdentity = {
  name: "Carol Example",
  email: "carol@example.com",
  date: "2025-01-04T00:00:00Z",
};
const ALICE_ALT: FixtureIdentity = {
  name: "Alice Example",
  email: "alice+alt@example.com",
  date: "2025-01-07T00:00:00Z",
};

function git(cwd: string, args: string[], identity?: FixtureIdentity): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(identity === undefined
        ? {}
        : {
            GIT_AUTHOR_NAME: identity.name,
            GIT_AUTHOR_EMAIL: identity.email,
            GIT_AUTHOR_DATE: identity.date,
            GIT_COMMITTER_NAME: identity.name,
            GIT_COMMITTER_EMAIL: identity.email,
            GIT_COMMITTER_DATE: identity.date,
          }),
    },
  }).trim();
}

function write(repo: string, relative: string, content: string): void {
  const target = path.join(repo, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function commit(repo: string, message: string, identity: FixtureIdentity): string {
  git(repo, ["add", "-A"]);
  git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", message], identity);
  return git(repo, ["rev-parse", "HEAD"]);
}

export function createHistoryFixture(): FixtureRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-history-fixture-"));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.name", "Fixture"]);
  git(dir, ["config", "user.email", "fixture@example.com"]);
  const shas: Record<string, string> = {};

  write(dir, ".mailmap", "Bob Example <bob@example.com> Robert Example <robert@example.com>\n");
  write(dir, "src/auth.ts", "export const authenticate = (token: string) => token.length > 0;\n");
  write(dir, "src/session.ts", "import { authenticate } from './auth';\nexport const session = { authenticate };\n");
  write(dir, "README.md", "Authentication notes.\n");
  shas.c1 = commit(dir, "feat: add authentication and session modules", ALICE);

  write(
    dir,
    "src/auth.ts",
    "export const authenticate = (token: string) => token.length > 0;\nexport const refresh = () => true;\n",
  );
  write(dir, "src/dashboard.ts", "import { session } from './session';\nexport const dashboard = session;\n");
  shas.c2 = commit(dir, "fix: refresh authentication tokens", BOB);

  fs.mkdirSync(path.join(dir, "src", "auth"), { recursive: true });
  git(dir, ["mv", "src/auth.ts", "src/auth/index.ts"]);
  write(
    dir,
    "src/auth/index.ts",
    "export const authenticate = (token: string) => token.length > 0;\nexport const refresh = () => true;\nexport const revoke = () => false;\n",
  );
  shas.c3 = commit(dir, "refactor: move authentication into its own module", ALICE);

  fs.rmSync(path.join(dir, "README.md"));
  shas.c4 = commit(dir, "docs: remove outdated authentication notes", CAROL);

  write(
    dir,
    "src/auth/index.ts",
    "export const authenticate = (token: string) => token.length > 0;\nexport const refresh = () => true;\nexport const revoke = () => false;\nexport const rotate = () => true;\n",
  );
  write(
    dir,
    "src/session.ts",
    "import { authenticate, rotate } from './auth';\nexport const session = { authenticate, rotate };\n",
  );
  shas.c5 = commit(dir, "fix: rotate sessions with refreshed credentials", {
    ...BOB,
    name: "Robert Example",
    email: "robert@example.com",
    date: "2025-01-05T00:00:00Z",
  });

  write(dir, "src/only-alice.ts", "export const singleOwner = true;\n");
  shas.c6 = commit(dir, "feat: add a file maintained by one author", {
    ...ALICE,
    date: "2025-01-06T00:00:00Z",
  });

  write(dir, "src/notes.ts", "export const notes = 'alias identity';\n");
  shas.c7 = commit(dir, "docs: add notes from another Alice identity", ALICE_ALT);

  return {
    dir,
    shas,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

export function createWorktree(repo: FixtureRepo, sha: string): { dir: string; cleanup(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-history-worktree-"));
  fs.rmdirSync(dir);
  git(repo.dir, ["worktree", "add", "--detach", dir, sha]);
  return {
    dir,
    cleanup() {
      try {
        git(repo.dir, ["worktree", "remove", "--force", dir]);
      } catch {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}

export function createShallowClone(repo: FixtureRepo): { dir: string; cleanup(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domino-history-shallow-"));
  fs.rmdirSync(dir);
  execFileSync("git", ["clone", "--quiet", "--depth", "1", pathToFileURL(repo.dir).href, dir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
