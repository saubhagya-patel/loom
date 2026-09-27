# Loom — Build Process

**Companion to:** `docs/trd.md` (what to build), `docs/plan.md` (how it's phased)
**Date:** 2026-09-10

We build phase by phase. This file fixes the working agreement: what we keep from the zoro
development OS, which skills each phase loads, what "verified" means, what the code and the
logs are supposed to look like, and what gets recorded where.

It is the same agreement used on the Convergence project, adapted. That is deliberate — the
shape was already paid for once, and the parts that did not pay are already dropped.

---

## 1. zoro, and how much of it we run

[zoro](file:///Users/saubhagya.patel/Desktop/projects/zoro) is an agent-agnostic development
OS in two tiers: a central repo holding a ten-phase workflow kernel, a router mapping
technology and task type to skills, and an index of the skill store at `~/.agents/skills`
(27 skills); plus per-project state in a gitignored `agent-cache/`.

**We run it minimally.** The full ceremony is six artifact types, a Simple/Full path choice and
a ten-phase walk per task. Convergence ran it for a full project and produced direct evidence
about what pays, which Loom inherits rather than re-testing:

| zoro feature | Verdict carried over |
|---|---|
| Plan before code, approved | **Kept.** Caught real design problems before they cost anything |
| A named verification command per phase | **Kept.** Highest-value item by a distance |
| TDD | **Kept.** The upload engine (`docs/plan.md` §5) is exactly where tests-first pays |
| `knowledge.md` — decisions and pitfalls | **Kept.** Seeded before Phase 0, not after it |
| `plans/<phase>.md` | **Kept**, and its deviation notes were worth more than the plan itself |
| Routing to skills | **Kept as an outcome, not a ritual.** Fixed per phase in §3; not re-derived |
| `backend.md`'s eight concerns | **Kept as a self-review checklist**, not as phases |
| `flows/<flow>.md` | **Dropped.** Not one was written across a whole project |
| `spec.md` | **Dropped.** `docs/trd.md` is the spec; a pointer file is duplication |
| `repo-map.md` | **Dropped.** It drifts; the layout lives in `docs/plan.md` §3, committed |
| Separate `logs/<feature>.md` | **Dropped.** Folded into the phase plan as an outcome section |
| Simple / Full path choice | **Dropped.** Every phase is Full; a one-line fix needs no ceremony |

So the loop is: **plan → approve → build test-first → verify with real output → record.**

---

## 2. Artifacts

| Where | What | Committed? |
|---|---|---|
| `docs/` | `trd.md`, `plan.md`, `process.md` — the durable truth, including the repo layout | yes |
| `CHANGELOG.md` | One short entry per phase, newest on top | yes |
| `agent-cache/knowledge.md` | Settled decisions and pitfalls. Cumulative — expand, never reset | no |
| `agent-cache/plans/phase-N-<slug>.md` | The phase plan, its deviations, and its outcome | no |

Two cache files, not six. `agent-cache/` stays gitignored, always.

`docs/trd.md` is the architecture document and it is **locked**. A phase that needs to change
it says so in its plan, in writing, with the reason — `docs/plan.md` §2.2 and §2.3 are the two
places this has already happened. Silent divergence from the TRD is the one process failure
that would make the privacy claims unauditable.

---

## 3. Skills per phase

Fixed here so no phase spends effort re-deriving them. All exist in the store at
`~/.agents/skills`. Load only the row for the phase in hand.

| Phase | Technology skills | Process skills |
|---|---|---|
| 0 · Scaffold | `nodejs-backend-patterns`, `nodejs-best-practices` | `writing-plans`, `verification-before-completion` |
| 1 · Auth + Drive | `nodejs-backend-patterns`, `mysql`, `typescript-advanced-types` | `test-driven-development`, always-on |
| 2 · Upload engine | `typescript-advanced-types`, `javascript-pro`, `vercel-react-best-practices` | `brainstorming`, `test-driven-development`, always-on |
| 3 · HEIC pipeline | `javascript-pro`, `modern-javascript-patterns`, `nodejs-backend-patterns` | `test-driven-development`, always-on |
| 4 · Gallery UI | `vercel-react-best-practices`, `frontend-design`, `typescript-advanced-types` | `brainstorming`, `test-driven-development`, always-on |
| 5 · Hardening | `nodejs-best-practices`, `vercel-react-best-practices` | `verification-before-completion`, always-on |

**Always-on:** `writing-plans`, `verification-before-completion`, `requesting-code-review`.
`systematic-debugging` loads on demand, when something surprises us — not pre-emptively.

Three notes on that table:

**`brainstorming` is limited to Phases 2 and 4.** Those are the two with genuine open design
space — the queue's state model and the gallery's interaction. The rest are specified tightly
enough in `docs/plan.md` that brainstorming would only re-open settled decisions.

**Phase 2 loads a React skill even though the engine is not UI.** The engine runs *in* the
browser and its progress is rendered at 8 MiB granularity across possibly hundreds of files;
"how not to re-render the world on every chunk" is a React question, and getting it wrong makes
the engine look broken when it is not.

**Four gaps, all accepted.** The store has no OAuth skill, no Google-APIs skill, no Prisma
skill and no Express skill. Google's documentation is the authority for the first two —
`docs/plan.md` §8 and `agent-cache/knowledge.md` exist largely to capture what it costs us to
learn. `nodejs-backend-patterns` covers Express idioms; Prisma comes from its own docs. None is
worth authoring a skill for right now.

### Backend concerns, as a self-review checklist

From zoro's `backend.md`. Not phases — a list to walk at the end of each phase:

| Concern | Where it bites hardest in Loom |
|---|---|
| requirement-analysis | discharged by `docs/trd.md`; `docs/plan.md` §7 maps every requirement to a phase |
| api-design | four endpoints only (TRD §8) — the discipline is keeping it four |
| service-architecture, data-modeling | `docs/plan.md` §3 layering, §4 the single table and what is absent from it |
| input-validation | the OAuth `code`, the session cookie, and the transcode upload's size and type — all three are attacker-reachable |
| error-handling | **the one that matters most:** a Drive error must not reach a log or a client response carrying a session URI or a filename (`docs/plan.md` §2.8) |
| testing | the fake transport in `docs/plan.md` §5.3 — the engine must be provable without Google |
| performance, observability | flat memory on the transcode stream; no re-render storm during upload; and observability that deliberately records nothing about files |
| code-review | the self-review closing each phase, plus `requesting-code-review` |

---

## 4. Verification per phase

A phase is done when its command has been run and its output shown. Not inferred, not
"should pass".

| Phase | Verification |
|---|---|
| 0 | `npm run verify` (typecheck, lint, unit tests, web build) and `npm run test:e2e` — `/healthz` with the database up, down and back; graceful shutdown; the Vite proxy |
| 1 | `npm test` plus a real sign-in: the Drive folder appears, a server restart keeps the session, a second sign-in reuses the folder, and the stored `refresh_token` is unreadable in `db:shell` |
| 2 | `npm test` over the chunker/state-machine/queue suites, **plus one real multi-hundred-megabyte upload and one deliberately interrupted upload resumed to completion** |
| 3 | `npm test`, plus the same source photo landing viewable in Drive through all three paths, flat RSS on the server path, and a log inspection showing no filename |
| 4 | `npm run build` plus the app driven in a browser: the grid renders real thumbnails, a click opens Drive, and the session survives a real token expiry |
| 5 | recovery across a real network drop on a real phone; the delete prompt provably absent until verification passes; a full log audit |

Phase 2's real-upload requirement is singled out because it is the one thing in V1 that a green
test suite cannot prove. Phase 5's negative test is singled out for the same reason: TRD §9's
guardrail is a promise about something *not* happening.

**Amended 2026-09-14 (§5.2).** `npm test` above now means only the Phase 0 suites plus Phase 2's
chunker and state machine; no new tests are written for Phases 1, 3, 4 or 5. The demonstrations
in each row — the real sign-in, the real interrupted upload, the three HEIC paths, the browser
run, the phone — are unchanged and now carry the whole weight of the word "verified". A phase
whose demonstration has not been *run* is not done, and this matters more now, not less: with
tests deferred, "it should work" has nothing behind it at all.

---

## 5. The working agreement

1. **Plan before code.** A phase plan lands in `agent-cache/plans/`, is presented, and **waits
   for approval.** No implementation before that.
2. **Tests are deferred as of 2026-09-14** — amended mid-project, deliberately, to ship V1
   faster. Verification moves to running the real thing (§4). The exception is
   `docs/plan.md` §5.3's **chunker and upload state machine**, which stay test-first: their
   only alternative proof is a real multi-hundred-megabyte upload per iteration, and their
   failure mode is a file that uploads "successfully" with wrong bytes. That is the one place
   where skipping tests costs speed rather than saving it. The suites already written in
   Phase 0 stay and keep running in `npm run verify`.
3. **Verify with real output.** The §4 command runs and its output is shown.
4. **Self-review before done** — against the TRD sections the phase claims and the §3
   checklist concerns it touched.
5. **Be honest about state.** A skipped step, a failing test, or something verified by reading
   rather than running gets said, not smoothed over.
6. **Record** decisions and pitfalls in `agent-cache/knowledge.md`; outcome in the phase plan;
   one short line in `CHANGELOG.md`.
7. **Never commit `agent-cache/`.**
8. **Never modify the zoro repo during project work.**
9. **Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)** —
   `<type>(<scope>): <description>`, imperative, lowercase, no trailing period. **Subject line
   only.** The diff and the docs carry the detail; a body restating them is noise. Add a body
   only when the *why* would otherwise be unrecoverable, and then a line or two. Group related
   changes into one commit rather than splitting per file.
   Scopes follow the source layout: `config`, `api`, `auth`, `drive`, `media`, `store`,
   `upload`, `heic`, `web`, `prisma`, `db`, `tests`. Documentation uses the `docs` type with no
   scope; tooling and dependencies use `chore`.

---

## 6. Code and log conventions

Prettier and ESLint own formatting and the mechanical rules; this section covers what they
cannot check. `.prettierrc`: no semicolons, single quotes, 100 columns, trailing commas.

**Factory functions, not classes.** `createApp(deps)`, `createStore(cfg)`, `createLogger(cfg)`
— each returns a plain object of functions. Nothing in this codebase needs inheritance, and
parameter properties are not even loadable under Node's type erasure (`docs/plan.md` §2.10).

**Dependencies arrive as parameters.** `loadConfig(env = process.env)` so a test passes a plain
object instead of mutating the process; a health handler takes a `Pinger`, not a Prisma client,
so it is testable with no database. Where a seam is wanted, it is a narrow `type`, declared next
to its consumer.

**`type` over `interface`** unless declaration merging is actually needed.
`import type { … }` for type-only imports — enforced by `consistent-type-imports`.

**Named exports only.** No default exports; a renamed import at one call site and a search that
misses it is not worth the two saved characters.

**Relative imports carry the `.ts` extension.** `./config/config.ts`, not `./config/config`.

**Comments explain why, not what.** The bar: a comment earns its place if removing it would
make a future reader re-derive a decision, re-hit a bug, or misread a deliberate choice as an
accident. `docs/plan.md` is where reasoning that spans files belongs; a comment points at it
rather than restating it.

**Errors:** an `AppError` base plus one centralized Express error middleware. The client gets a
stable `code` and a safe message; the stack and the request context go to the log. Never both.

**Async:** Express 5 forwards rejections from async handlers to the error middleware on its
own, so no wrapper. `no-floating-promises` is on for `src` and off for `tests`, where
`node:test` owns the promise.

**Logging** is `pino`, structured, first argument an object and second a short lowercase
message: `logger.info({ userId }, 'session created')`. And the rule that makes Loom's privacy
claim real, from `docs/plan.md` §2.8, restated here because it is a code-review item on every
diff:

> **No filename, Drive file id, folder id, byte size, MIME type, EXIF field or resumable
> session URI may appear in any log line, at any level, on any path — including error handlers.
> Errors crossing the Drive boundary are sanitized before they reach the logger.** Google's
> `sub` and the user's email are identity, not media, and are the exception.

**SQL** lives in `backend/db/schema.sql`, hand-written, with the same comment bar as the code.
`prisma/schema.prisma` is generated and carries a header saying so.
