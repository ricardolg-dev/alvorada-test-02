# Conflict-free bookings

[Video demo](https://www.youtube.com/watch?v=K-oVzehxB6o)

A booking system for a team's shared Resources that rejects overlapping Bookings, on the half-open rule `[start, end)`.

- **Focus:** full stack, with the emphasis on the back end: the booking rules, the API contract and the tests. The web app is how the rules are shown.
- **Time spent:** about 6 hours.

Stack:

- Web: Next.js (TypeScript, Tailwind, shadcn/ui)
- API: Nest.js (TypeScript)
-  DB: Postgres 16 running in Docker

## Docs

- [PRD](.issues/docs/PRD.md): the challenge as given.
- [Architecture diagrams](docs/diagrams/architecture.md): containers, data model, backend modules and booking flows.
- [Glossary](GLOSSARY.md): the domain terms this README uses (Resource, Booking, Interval, Conflict, Availability check, Id taken).
- [Architecture decision records (ADRs)](docs/adr/).
- [API contract](api/openapi.yaml) (OpenAPI 3.1).
- [Runbooks](docs/runbooks/README.md): the official record of how the product behaves, one runbook per user flow.

The batch-booking endpoint is described in [Create a batch of bookings](docs/booking-batches.md).

## Setup

Prerequisites:

- [NVM](https://github.com/nvm-sh/nvm)
- Node 22.18 or newer on the 22 line, pinned in `.nvmrc`. 
- npm 10 or newer
- Docker with Compose

From the ***repo root,*** run the following commands:

1- Install Node (first time only: installs the version in `.nvmrc`)

```sh
nvm install
```

2- Switch to the required version

```sh
nvm use
```

3- Create the API environment variables

```sh
cp api/.env.example api/.env
```

ℹ️ You don't need to change any value. **The defaults work as they are**.

4- Create the web environment variables

```sh
cp web/.env.example web/.env.local
```

ℹ️ You don't need to change any value. **The defaults work as they are**.

5- Install the dependencies

```sh
npm install
```

## Run

From the ***root folder***, run each command in its own terminal:

1- Start the database container

```sh
docker compose up db
```

2- Start the API (runs on `http://localhost:3001`)

```sh
npm run dev:api
```

3- Start the web app (runs on `http://localhost:3000`)

```sh
npm run dev:web
```

ℹ️ On start, the API runs the **database migrations**, which also seed the five `Resources`.

ℹ️ `GET http://localhost:3001/health` answers `{"status":"ok"}` when the API can reach the database.

## Tests


| Command                                              | What it runs                                           | Prerequisites                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                           | Web: unit tests.<br>API: unit tests. Integration tests | Postgres up (`docker compose up db`)                                                                                           |
| `npm run test:e2e`                                   | Web: E2E tests                                         | Chromium installed. From `/web`, run `npx playwright install chromium` once.<br>Ports 3000 and 4010 free. No API, no Postgres. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Lint, type checks and production builds of both apps   | Nothing running                                                                                                                |


ℹ️ `npm test` never touches your data. It uses a separate database, `bookings_test`, which is dropped, recreated and migrated before every run.

### Highlighted tests

#### 1. A value at the boundary of a rule

`touching: a ends where b starts`, in `api/src/bookings/booking-rules.spec.ts`.

- **Expected result:** `[10,20)` and `[20,30)` do not overlap, in both argument orders.
- **Error it catches:** a `<=` where `overlaps` needs a `<`, which would reject a Booking that starts exactly where another ends. Checking both orders matters: with `<=` on only one side of the condition, one of the two orders still gives the right answer.

#### 2. The interaction between two rules

`S09 A rejected id stays free, and another resource never conflicts`, in `api/test/runbooks/bookings-create-booking.spec.ts`.

- **Expected result:** with A on R1 `[10,20)` and B on R1 `[20,30)`, creating C on R1 `[19,21)` answers `409 conflict` with the Conflicts A and B. Creating C on R2 `[19,21)` then answers `201`.
- **Error it catches:** a create that writes the row or reserves the id before its checks, so the Rejection takes the id. It also catches a Conflict lookup that ignores the Resource.

#### 3. An invalid input

`S03 Each invalid body returns invalid_data and writes nothing`, in `api/test/runbooks/bookings-create-booking.spec.ts`.

- **Expected result:** eight invalid bodies each answer `422 invalid_data`: a missing `end`, a negative `start`, an `end` of 101, an empty Interval, an id with a space, a 65-character id, a `resource` that is not a string, and an array body. `GET /bookings` then returns an empty list, and a valid create with the id `A` answers `201`.
- **Error it catches:** a validation gap that lets bad data through, and a Rejection that leaves a row behind or holds on to the id. It runs over HTTP against Postgres, so it also catches invalid input that reaches the database and comes back as a 500.

## Demo

This demo replays the PRD example, first in the web app and then with `curl`. A fresh install starts with no Bookings.

ℹ️ To start over at any point, reset the database and restart the API, so it migrates and seeds again:

```sh
docker compose down -v && docker compose up db   # deletes all local Bookings
npm run dev:api
```

### In the web app

Open [http://localhost:3000](http://localhost:3000). As you fill the Operation form, the page asks the API whether the Interval is available, and whether the `Id` is still free. A Booking that would be rejected never reaches the create, so the "Book" CTA stays disabled.

1. **Book A and B.** Enter Id `A`, Resource R1, Start `10`, End `20`, and click Book. Then enter `B`, R1, `20` to `30`, and click Book. Both are created. B is accepted because it starts exactly where A ends: R1 is free again at 20.
2. **Try C on R1.** Enter `C`, R1, `19` to `21`. The preview reads "R1 [19,21) conflicts with A, B", the timeline rings A and B, and Book is disabled. Nothing is created.
3. **Book C on R2.** Switch the Resource to R2. The preview reads "R2 [19,21) is available". Click Book, and C is created. The rejected attempt on R1 did not take the id C, and Bookings of another Resource never conflict.
4. **Cancel A.** In the Bookings table, click Cancel on A and confirm. The dialog says that R1 [10,20) becomes free and that the id A stays taken. A now shows as Canceled.
5. **Try A again.** Enter `A`, R1, `10` to `20`. The preview reads "Id A was already used by another booking", and Book is disabled. The Interval is free, but a created Booking's id is never reused.

### With curl

The web app has just created A, B and C, and ids are never reused, so reset the database and restart the API (see above) before you run these. Each command is followed by the body and the HTTP status the API answers.

1. Book A on R1 `[10,20)`:

```sh
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/bookings -H 'Content-Type: application/json' -d '{"id":"A","resource":"R1","start":10,"end":20}'
```

2. Book B on R1 `[20,30)`. It starts where A ends:

```sh
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/bookings -H 'Content-Type: application/json' -d '{"id":"B","resource":"R1","start":20,"end":30}'
```

3. C on R1 `[19,21)` is rejected with its Conflicts, in ascending id order:

```sh
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/bookings -H 'Content-Type: application/json' -d '{"id":"C","resource":"R1","start":19,"end":21}'
```

4. C on R2 `[19,21)` is accepted. The rejection did not take the id:

```sh
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/bookings -H 'Content-Type: application/json' -d '{"id":"C","resource":"R2","start":19,"end":21}'
```

5. Check R1 `[19,21)` without booking it:

```sh
curl -s -w '\n%{http_code}\n' 'http://localhost:3001/availability?resource=R1&start=19&end=21'
```

6. Cancel A:

```sh
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/bookings/A/cancel
```

7. R1 `[10,20)` is available again:

```sh
curl -s -w '\n%{http_code}\n' 'http://localhost:3001/availability?resource=R1&start=10&end=20'
```

8. The id A stays taken, both for a create and for an Availability check that names it:

```sh
curl -s -w '\n%{http_code}\n' -X POST http://localhost:3001/bookings -H 'Content-Type: application/json' -d '{"id":"A","resource":"R1","start":10,"end":20}'
```

```sh
curl -s -w '\n%{http_code}\n' 'http://localhost:3001/availability?resource=R1&start=10&end=20&id=A'
```

ℹ️ To see every Booking with its status, run `curl -s http://localhost:3001/bookings`. A shows as `canceled`, and B and C show as `active`.

## Decisions

### 1. The `[start, end)` rule lives in one pure module

- **What was checked:** create and the Availability check must never disagree about whether two Intervals overlap. An invalid time must never reach the database and come back as a 500.
- **How it was investigated:**
  - The time columns are Postgres `integer`, so a time above 2147483647 would fail inside the database. That set the first valid range for the parse step. SCH-16 later lowered it to 0 to 100, the limit the web form has, so a direct API call can't create a booking the form couldn't. The API and the form both read that maximum from the `config` workspace.
  - Query strings reach the API as text. So the validation function became `parseInterval` (it was planned as `validInterval`), and it accepts integers or digit-only strings and returns the Interval or `null`.
- **What was concluded:** `api/src/bookings/booking-rules.ts` holds `parseInterval()` and `overlaps()`, with no Nest or TypeORM imports. `BookingsService` uses the same two functions for create and for availability, so they cannot drift apart. The tests are tables of boundary cases, and each `overlaps` case is checked in both argument orders.

### 2. The Availability check answers a taken id with `409 id_taken`

- **What was checked:** in the web app, a taken id only showed up after clicking Book. The preview said the Interval was available, and then the create was rejected with `id_taken`. The check only asked about the Interval, never the id.
- **How it was investigated:**
  - The AI assistant proposed letting `GET /availability` take an optional `id` and return a `200` with a new `idTaken` field next to `available` and `conflicts`. That would show the taken id and the Conflicts together.
  - The alternative was to answer exactly like a create would: `409 id_taken`, checked in the create's order (`invalid_data`, `unknown_resource`, `id_taken`, then the Conflicts).
- **What was concluded:**
  - The `409` was chosen, so the check gives the same answer, in the same order, as the create it predicts. Without `id`, the answer is unchanged.
  - The trade-off: with a taken id, the answer lists no Conflicts.
  - Recorded in [ADR 0002](docs/adr/0002-availability-answers-id-taken-as-409.md) and in the contract (`api/openapi.yaml`).

## How AI was used

[See it in slides (PDF)](docs/how-ai-was-used.pdf)

The work was done with Claude Code, using SPEC-SS workflow for each task.

```
[S] Specify
[P] Plan
[E] Execute
[C] Check
-
[S] Secure
[S] Ship
```

### Spec

- pmkit: [https://fredvanelli.dev/pmkit/](https://fredvanelli.dev/pmkit/)
- mattpocock-skills:grill-with-docs: [https://www.aihero.dev/skills-grill-with-docs](https://www.aihero.dev/skills-grill-with-docs)
- superpowers:brainstorming: [https://github.com/obra/superpowers/tree/main#the-basic-workflow](https://github.com/obra/superpowers/tree/main#the-basic-workflow)

The issues (tickets) are managed using **pmkit**. They live in the repo (`.issues/`). Each one has context, scope (in/out), acceptance criteria and comments (decisions history).

Before any code is written, a question-and-answer session sharpens the issue against the PRD and the glossary (domain). It updates `GLOSSARY.md` and `docs/adr/` when a term or a hard-to-reverse decision comes up, and it ends in a written design in `docs/superpowers/specs/`.

### Plan

- superpowers:writing-plans

A plan comes from that design

### Execution

- superpowers:executing-plans (small tasks)
- superpowers:subagent-driven-development (medium+ tasks)

Implementation follows test-driven development: a failing test first, then the code.

### Check

- Runbooks: [https://fredvanelli.dev/runbooks/](https://fredvanelli.dev/runbooks/)

Each user flow is validated against a runbook in `docs/runbooks/`, verified by a E2E test script: Vitest for the API, Playwright for the web app.

### Secure

- utils:review-work: [https://fredvanelli.dev/utils/review-work/](https://fredvanelli.dev/utils/review-work/)

Before each pull request, an automated review checks the branch against the following criteria:

- Spec match
- Scope and size
- Readability and conventions
- Tech debt
- Unit tests
- E2E tests
- Security
- Cyclomatic complexity
- Error handling and edge cases
- Performance
- Backward compatibility
- Documentation

Its findings are fixed or listed with a reason.

### Ship

- superpowers:finishing-a-development-branch

When the implementation is completed and all previous checks pass, including ***tests***, ***lint***, ***typecheck*** and ***build***, the PR is created and the CI process is monitored.

## What is left

- **Concurrency:** this is a known limit. A create command checks for Conflicts and then inserts, and the two steps are not atomic. So two creates sent at the same moment can both pass the check and overlap. The upgrade path is a Postgres exclusion constraint (`EXCLUDE USING gist`) on the Resource and the Interval, for Active Bookings, so the database itself rejects the overlap.
- **Out of scope by the PRD:** authentication, payment and recurring bookings.