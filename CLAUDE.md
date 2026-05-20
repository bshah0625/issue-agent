# issue-agent — Claude Code Instructions

Read this file completely before making any changes. Then read GAMEPLAN.md for full architecture detail.

---

## Project Purpose

This is a reusable GitHub issue-to-PR automation agent. It reads GitHub issues, writes
failing tests first (TDD), implements the code, runs CI locally, and opens a PR.
It is designed to work across multiple projects via a single config file.

---

## Before You Write Any Code

1. Read `GAMEPLAN.md` — it is the authoritative spec for every module
2. Read `.claude/docs/README.md` — it is the quick-reference for all files and functions
3. Check the relevant `__tests__/*.test.ts` file before touching any `src/` file
4. Run `npm test` to confirm the current state before making changes

---

## TDD Contract — Non-Negotiable

Tests are ALWAYS written before implementation. This applies to all code in this
repo, including the agent's own source files.

When implementing a function:

1. Write the test cases in `__tests__/` first
2. Confirm they fail: `npx vitest run`
3. Implement the function in `src/`
4. Confirm they pass: `npx vitest run`
5. Commit in two separate commits: `test(scope): ...` then `feat(scope): ...`

Never skip the failing test confirmation step.

---

## Code Conventions

- TypeScript strict mode — no `any`, no `@ts-ignore`, no implicit returns
- Named exports only — no default exports except in `config/projects.ts`
- All async functions must have explicit return types
- All external calls (GitHub API, git, shell) must be wrapped in try/catch
- No `console.log` in `src/` — use a consistent logger pattern
- All env vars accessed via `process.env` — validated at startup in `webhook.ts`

---

## File Reference

See `.claude/docs/README.md` for a function-by-function breakdown of every file.

---

## CI Requirements

Every PR must pass all four GitHub Actions jobs before merging:

- TypeScript — `npx tsc --noEmit`
- Lint — `npx eslint . --ext .ts`
- Tests — `npx vitest run` (sharded)
- Coverage gate — 80% lines, 80% functions, 75% branches

The pre-commit hook runs typecheck + related tests + lint-staged on every commit.

---

## Adding a New Target Project

1. Add one entry to `config/projects.ts` matching the `ProjectConfig` interface
2. The key must exactly match the GitHub repo name (matched against webhook payload)
3. Set `localPath` to the absolute path of the repo on the machine running the agent
4. Register the webhook in that repo's GitHub settings (see GAMEPLAN.md §12)
5. No other code changes are required

---

## Changelog

| Date       | Change                |
| ---------- | --------------------- |
| 2026-05-20 | Initial project setup |
