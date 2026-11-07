# Quizky --- Agent Build Specification

> **Product:** Quizky\
> **Tagline:** Play. Think. Win.\
> **Purpose:** Build a live, teacher-led quiz platform inspired by
> Kahoot.\
> **Primary stack:** SvelteKit, Svelte 5, TypeScript, Cloudflare
> Workers, Durable Objects, D1, Drizzle ORM, Zod.\
> **Deployment constraint:** Prefer Cloudflare's free tier and avoid
> services that require a payment card. Never assume a paid service is
> available.

---

## 1. Instructions to the coding agent

You are the lead engineer responsible for implementing Quizky. Build a
working, maintainable MVP---not a mockup and not a collection of
disconnected screens.

### Mandatory working principles

1.  **Inspect before changing.** Examine the repository, existing code,
    package manager, and deployment configuration before making changes.
2.  **Plan in small milestones.** Implement one milestone at a time.
    After each milestone, run the relevant checks and summarize what
    changed.
3.  **Do not invent platform capabilities.** Check the installed
    versions and current Cloudflare/SvelteKit APIs before relying on a
    feature. Prefer official documentation and supported APIs.
4.  **Keep the application deployable.** Do not leave the project in a
    state where the development server or type checker cannot run.
5.  **No secrets in source control.** Use local environment files for
    development and Cloudflare secrets for deployment. Commit only
    example environment files with placeholder values.
6.  **No paid dependencies by default.** Do not introduce a third-party
    service that requires a card or paid subscription without explaining
    why and asking first.
7.  **No premature complexity.** Do not introduce microservices,
    Kubernetes, Redis, message brokers, or a separate backend server for
    the MVP.
8.  **Use strict TypeScript.** Avoid `any`; use explicit types and
    runtime validation at trust boundaries.
9.  **Do not trust the browser.** The server is authoritative for
    authentication, permissions, game state, deadlines, correctness, and
    scoring.
10. **Explain important trade-offs.** If a requirement conflicts with
    Cloudflare's runtime or free-tier limits, stop and explain the issue
    before implementing a workaround.

### Initial response expected from the agent

Before coding, report: - Repository contents and current state. -
Proposed project structure. - Cloudflare/SvelteKit deployment
approach. - Any version or compatibility concerns. - A short milestone
plan.

Then begin implementation unless a genuinely blocking decision is
missing.

---

## 2. Product definition

Quizky lets teachers create quizzes and host live quiz sessions.
Students join a session using a short code or shared link, enter a
nickname, and answer multiple-choice questions in real time.

### Roles

**Teacher** - Creates an account and signs in. - Creates, edits,
publishes, and archives quizzes. - Adds questions and answer options. -
Marks exactly one correct option per question. - Sets a time limit and
points per question. - Creates a live session from a published quiz. -
Shares a join link and join code. - Sees the lobby and participant
list. - Starts the game. - Can manually advance or end a
question/game. - Sees answer progress and the leaderboard. - Can review
completed session results.

**Student** - Opens a join link or enters a join code. - Enters a
nickname. - Waits in the lobby until the teacher starts. - Receives each
question in real time. - Selects one option and submits one answer. -
Sees whether the question has ended and when the next one starts. - Sees
a completion screen at the end.

### Confirmed product decisions

- Questions are **MCQ only** for the MVP.
- Each question has exactly one correct answer.
- Students may submit only one official answer per question.
- The teacher can manually advance the game.
- Questions also advance automatically when their timer expires.
- The leaderboard is visible to the **teacher only**. Do not expose it
  to student clients.
- Students join with nicknames; student accounts are not required for
  the MVP.
- A teacher owns their quizzes and sessions.
- The game server is authoritative.
- A session must use a snapshot of its quiz content so later edits to
  the original quiz cannot change a running or completed session.

### Out of scope for the first MVP

Do not implement these unless explicitly requested: - Open-ended
questions, polls, image/audio questions, or multiple-correct answers. -
Teams, classrooms, student accounts, assignments, homework, or scheduled
games. - Public quiz discovery or a marketplace. - Payments,
subscriptions, certificates, or analytics dashboards. - AI-generated
questions. - Native mobile apps. - Complex anti-cheat or proctoring. -
Speed bonuses unless added as a later, explicit product decision.

---

## 3. Brand and visual direction

Use the following visual identity consistently:

Token Value Use

---

Electric blue `#2857EC` Primary actions and brand
Tangerine `#FF6B35` Energy and highlights
Sunshine yellow `#FFD23F` Timers and emphasis
Fresh green `#29C785` Success and correct answers
Midnight `#20212A` Text and dark surfaces
White `#FFFFFF` Main light surfaces

- Brand name: **Quizky** (not Quizkie).
- Tagline: **Play. Think. Win.**
- Style: playful, bold, energetic, approachable.
- Student gameplay should feel lively and immediate.
- Teacher and quiz-authoring screens should be cleaner, calmer, and
  structured.
- Use accessible contrast, visible keyboard focus, readable
  typography, and responsive layouts.
- Do not use color alone to communicate correctness or errors.
- Avoid unnecessary animations that interfere with answering or reduce
  performance.
- Create reusable design tokens and components instead of hardcoding
  styles throughout the app.

---

## 4. Technology and architecture

### Chosen stack

---

Layer Technology

---

Frontend SvelteKit + Svelte 5

Language TypeScript

Runtime and deployment Cloudflare Workers

HTTP API SvelteKit server endpoints and/or a
dedicated Worker API, using one
clearly documented approach

Real-time sessions Cloudflare Durable Objects

Transport WebSockets

Relational application data Cloudflare D1

ORM and migrations Drizzle ORM

Validation Zod

Testing Vitest; add browser/e2e testing
where practical

Package manager Inspect the repository; otherwise
use pnpm
-----------------------------------------------------------------------

### Architectural rules

1.  Prefer a **single SvelteKit application deployed to Cloudflare** for
    the frontend and ordinary HTTP endpoints, with Durable Objects
    handling live session coordination.
2.  Do not create a separate conventional server unless a technical
    limitation makes the chosen deployment impossible.
3.  Use one Durable Object instance per live game session. The Durable
    Object is the authoritative coordinator for that session.
4.  Use D1 for durable application records: teachers, quizzes,
    questions, sessions, participants, answers, and final results.
5.  Use Durable Object storage for room coordination and state that must
    be accessed consistently by that session.
6.  Keep database access behind repository/service modules. Do not
    scatter SQL across UI components or route handlers.
7.  Keep game rules independent of Svelte components and transport
    details so they can be tested in isolation.
8.  Avoid treating an in-memory JavaScript object as the only durable
    record of a game. Design for Durable Object eviction/restart and
    reconnection.
9.  Do not add Redis. Durable Objects provide the initial room
    coordination model.
10. Do not assume a local development emulator perfectly matches
    production. Include a short production smoke-test checklist.

### Important Cloudflare implementation notes

- Verify the currently supported SvelteKit adapter and Cloudflare
  deployment workflow before configuring the project.
- Use the current supported Durable Objects class/binding syntax and
  migration configuration for the installed Wrangler version.
- Durable Object alarms or another supported server-side scheduling
  mechanism should drive question deadlines. Do not rely on a browser
  `setTimeout` to end a question.
- A browser countdown is display-only. The server stores and enforces
  the deadline.
- Use WebSocket hibernation where compatible with the session
  implementation. Reconstruct required connection/session state after
  hibernation; do not rely on ordinary in-memory fields surviving it.
- Persist enough state to recover the current phase, current question,
  deadline, and participant/answer information.
- Verify D1 and Durable Object transaction/storage semantics before
  designing cross-store operations. Do not pretend a transaction spans
  both stores.
- Do not store passwords or long-lived bearer tokens in plaintext.
- Keep Cloudflare bindings and environment types generated from the
  actual Wrangler configuration.

---

## 5. Suggested repository structure

Adapt this to the existing repository rather than blindly replacing it.

```text
quizky/
├── src/
│   ├── app.html
│   ├── app.d.ts
│   ├── hooks.server.ts
│   ├── routes/
│   │   ├── (public)/
│   │   │   ├── +page.svelte
│   │   │   └── join/[code]/
│   │   ├── (teacher)/
│   │   │   ├── dashboard/
│   │   │   ├── quizzes/
│   │   │   └── sessions/[id]/
│   │   ├── play/[code]/
│   │   └── api/
│   │       ├── auth/
│   │       ├── quizzes/
│   │       └── sessions/
│   ├── lib/
│   │   ├── components/
│   │   ├── server/
│   │   │   ├── auth/
│   │   │   ├── db/
│   │   │   ├── repositories/
│   │   │   ├── services/
│   │   │   └── validation/
│   │   ├── game/
│   │   │   ├── protocol/
│   │   │   ├── rules/
│   │   │   └── types/
│   │   └── shared/
│   └── styles/
├── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── static/
├── drizzle.config.ts
├── svelte.config.js
├── vite.config.ts
├── wrangler.jsonc
├── package.json
├── .env.example
└── README.md
```

A Durable Object class can live in a dedicated module such as
`src/lib/server/game/session-room.ts`. Keep it separate from page
components.

---

## 6. Data model

Use UUIDs or another robust opaque identifier for internal IDs. Use
timestamps in UTC. Add indexes for common lookups and foreign keys where
supported.

### `teachers`

- `id`
- `email` (unique; normalize consistently)
- `password_hash`
- `display_name`
- `created_at`
- `updated_at`

### `teacher_sessions`

- `id`
- `teacher_id`
- `token_hash` or another secure session identifier representation
- `expires_at`
- `created_at`

Use secure, HttpOnly, SameSite cookies. Never store raw session tokens
in the database if a hash can be used.

### `quizzes`

- `id`
- `teacher_id`
- `title`
- `description` (nullable)
- `status` (`draft`, `published`, `archived`)
- `created_at`
- `updated_at`

### `questions`

- `id`
- `quiz_id`
- `text`
- `position`
- `time_limit_seconds`
- `points`
- `created_at`
- `updated_at`

### `question_options`

- `id`
- `question_id`
- `text`
- `position`
- `is_correct`

Do not return `is_correct` to student clients while a question is open.

### `game_sessions`

- `id`
- `quiz_id`
- `teacher_id`
- `join_code` (unique while active; define code reuse policy)
- `status` (`lobby`, `in_progress`, `completed`, `cancelled`)
- `current_question_index`
- `created_at`
- `started_at` (nullable)
- `ended_at` (nullable)

### Session snapshot tables

At game creation, copy the quiz's questions and options into
session-owned snapshot records. Suggested tables:

- `session_questions`: session ID, source question ID (optional),
  text, position, time limit, points.
- `session_question_options`: session question ID, text, position, and
  correct-option marker.

The snapshot is immutable once the game starts. Students must never
receive the correct-option marker before the question closes.

### `participants`

- `id`
- `session_id`
- `nickname`
- `nickname_normalized`
- `participant_token_hash` (or another secure token-verification
  design)
- `status` (`connected`, `disconnected`, `finished`)
- `joined_at`
- `last_seen_at`

Enforce nickname uniqueness per session using a normalized nickname and
a database uniqueness constraint where feasible. Handle collisions
gracefully.

### `participant_answers`

- `id`
- `participant_id`
- `session_question_id`
- `selected_option_id`
- `is_correct`
- `score_awarded`
- `response_time_ms`
- `submitted_at`

Enforce one official answer per participant per question with a unique
constraint on `(participant_id, session_question_id)`.

### Data integrity rules

- A quiz must have at least one question before it can be published.
- Each question must have at least two options and exactly one correct
  option.
- Time limits and point values must be within documented safe bounds.
- A session can only be created from a published quiz owned by the
  requesting teacher.
- Session snapshots must be created atomically as far as the chosen
  database permits.
- Do not allow deletion or mutation of a session snapshot after a game
  starts.
- Validate ownership on every teacher operation; never rely only on an
  ID supplied by the client.

---

## 7. Game state machine

Implement and test an explicit state machine. Avoid scattered booleans
and loosely related flags.

### Session phases

```text
LOBBY
  └── teacher starts game ──> IN_PROGRESS

IN_PROGRESS
  ├── all questions completed ──> COMPLETED
  └── teacher ends game ──> COMPLETED

LOBBY
  └── teacher cancels ──> CANCELLED
```

### Question phases

```text
PENDING
  └── server opens question ──> OPEN

OPEN
  ├── deadline reached ──> CLOSED
  └── teacher advances/ends question ──> CLOSED

CLOSED
  └── next question begins ──> OPEN
```

After the last question closes, mark the session `COMPLETED`.

### Server-authoritative rules

- The server determines which question is active.
- The server records `opened_at` and `deadline_at`.
- The server rejects answers received after the deadline.
- The server calculates correctness and score.
- The server accepts at most one official answer per participant per
  question.
- A teacher may manually close/advance a question before its deadline.
- When the deadline expires, the server closes the question and
  advances automatically.
- Duplicate or stale commands must not advance the game twice.
- A client reconnecting must receive a safe state snapshot for its
  role.
- A timer displayed by a browser is only a visual estimate; it never
  determines answer validity.

### Initial scoring

Keep scoring simple:

- Correct answer: award the question's configured points.
- Incorrect answer: zero.
- No answer: zero.
- No speed bonus in the MVP.
- Calculate and persist the final score on the server.

For tie-breaking, use total score first, then number of correct answers,
then a deterministic final tie-breaker. Document the rule and use the
same rule everywhere.

---

## 8. Real-time protocol

Use a versioned, typed message protocol. Validate every incoming
WebSocket message with Zod. Treat all client messages as untrusted.

### Client-to-server messages

```ts
type ClientMessage =
	| { type: 'join_session'; participantToken?: string }
	| { type: 'submit_answer'; questionId: string; optionId: string; requestId: string }
	| { type: 'teacher_start_game'; requestId: string }
	| { type: 'teacher_advance_question'; requestId: string }
	| { type: 'teacher_end_game'; requestId: string };
```

Authentication and authorization must be established before privileged
commands are accepted. Do not trust a client-provided `role`,
`teacherId`, `participantId`, score, correctness value, or deadline.

### Server-to-client messages

Use role-specific payloads. Example event shapes:

```ts
type ServerMessage =
	| { type: 'room_snapshot'; payload: RoomSnapshot }
	| { type: 'participant_joined'; payload: PublicParticipant }
	| { type: 'participant_left'; payload: { participantId: string } }
	| { type: 'game_started'; payload: { startedAt: string } }
	| { type: 'question_started'; payload: PublicQuestion }
	| { type: 'answer_received'; payload: { answeredCount: number; participantCount: number } }
	| { type: 'question_ended'; payload: QuestionResultForRole }
	| { type: 'leaderboard_updated'; payload: TeacherLeaderboard }
	| { type: 'game_completed'; payload: GameSummary }
	| { type: 'error'; payload: { code: string; message: string } };
```

`PublicQuestion` must not contain the correct answer.
`QuestionResultForRole` must be built separately for teacher and student
audiences. The teacher can see the correct answer and answer statistics
after closure; students may see an appropriate post-question result, but
must not receive the teacher-only leaderboard.

### Protocol requirements

- Include a protocol version or versioned envelope.
- Include request IDs for commands that may be retried.
- Make commands idempotent where practical.
- Define error codes for invalid state, expired deadline, duplicate
  answer, unauthorized command, invalid option, and rate limiting.
- Do not broadcast participant tokens or authentication secrets.
- Do not broadcast every answer's selected option to other students.
- Send only the minimum data required by each role.
- Handle WebSocket close, reconnect, duplicate messages, and stale
  state.
- Rate-limit joining and answer submissions.

---

## 9. HTTP API surface

Use consistent JSON responses and a documented error format. Exact paths
may be adapted to the SvelteKit routing conventions.

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Quiz management

- `GET /api/quizzes`
- `POST /api/quizzes`
- `GET /api/quizzes/:quizId`
- `PUT /api/quizzes/:quizId`
- `DELETE /api/quizzes/:quizId`
- `POST /api/quizzes/:quizId/publish`
- `POST /api/quizzes/:quizId/archive`

### Session management

- `POST /api/quizzes/:quizId/sessions`
- `GET /api/sessions/:joinCode`
- `POST /api/sessions/:joinCode/join`
- `GET /api/sessions/:sessionId/results` (teacher-only)
- `GET /api/sessions/:sessionId/leaderboard` (teacher-only)

### WebSocket

- `/api/sessions/:sessionId/ws` or another documented route that
  resolves to the session's Durable Object.

The HTTP layer should validate input, authenticate the caller, enforce
ownership, and forward session-specific operations to the correct
Durable Object. Do not duplicate game rules between HTTP handlers and
the Durable Object.

---

## 10. Authentication and security

### Teacher authentication

- Hash passwords with a reputable password-hashing algorithm supported
  by the chosen runtime. Verify runtime compatibility before selecting
  a library.
- Use secure, HttpOnly, SameSite cookies for teacher sessions.
- Use HTTPS in production.
- Protect state-changing HTTP requests against CSRF when cookie
  authentication is used.
- Apply reasonable login and registration rate limits.
- Avoid revealing whether an email address is registered in sensitive
  authentication responses.
- Validate email and password lengths and enforce documented password
  rules.
- Ensure logout invalidates the server-side session.

### Student identity

- Students do not need accounts.
- After joining, issue a cryptographically random participant
  credential.
- Store only a hash of the credential when feasible.
- Bind the credential to one participant and one session.
- Never accept a participant ID alone as proof of identity.
- Do not put long-lived credentials in URLs.
- Define how a student recovers their participant identity after
  refresh/reconnect.

### Authorization

- Only the session's owning teacher may start, advance, or end a game.
- Only the owning teacher may see the leaderboard and detailed
  results.
- A participant may submit answers only for their own participant
  identity.
- Students cannot choose the correct answer, alter scores, or alter
  deadlines.
- Do not expose private quiz answer keys through public quiz/session
  endpoints.
- Validate ownership on every read and write, including nested
  resources.

### Additional protections

- Validate and limit all payload sizes.
- Escape/render user-generated text safely.
- Normalize and constrain nicknames.
- Rate-limit join attempts and answer submissions.
- Avoid logging passwords, cookies, participant tokens, or full
  sensitive payloads.
- Use generic, safe error messages in production.
- Add basic abuse protection for join-code guessing.
- Review CORS and origin policy for the actual deployment topology.

---

## 11. User interface requirements

Build responsive screens for desktop, tablet, and mobile.

### Public landing page

- Explain Quizky in a few seconds.
- Primary actions: create a quiz / join a game.
- Display the brand and tagline.
- Provide a clear join-code entry point.

### Teacher authentication

- Registration and login forms.
- Useful validation messages.
- Loading and error states.
- Protected teacher routes.

### Teacher dashboard

- List the teacher's quizzes.
- Show draft/published/archived status.
- Create a quiz.
- Edit, publish, archive, or delete with confirmation where
  destructive.
- Provide an obvious way to launch a live session.

### Quiz editor

- Edit title and description.
- Add, edit, delete, and reorder questions.
- Add and remove answer options.
- Select exactly one correct option.
- Configure time limit and points.
- Validate before publishing.
- Prevent accidental loss of unsaved changes where practical.

### Teacher lobby

- Show join code prominently.
- Provide a shareable join link and QR code if a suitable free/local
  implementation is available.
- Show participants joining and leaving in real time.
- Allow the teacher to start when ready.
- Handle empty lobby and connection errors.

### Student join flow

- Enter join code or open a join link.
- Enter nickname.
- Show validation errors, including duplicate nickname.
- Display a waiting room before the game starts.
- Provide clear reconnecting/disconnected feedback.

### Student gameplay

- Show question text and answer options.
- Show a clear countdown.
- Make answer selection usable on touchscreens.
- Confirm that an answer was received.
- Prevent repeated submissions in the UI, while still enforcing this
  on the server.
- Show question-closed/next-question states.
- Do not display the leaderboard.

### Teacher live game screen

- Show current question and remaining time.
- Show answer count/progress.
- Show manual advance and end-game controls.
- Show results after each question.
- Show teacher-only leaderboard.
- Confirm destructive or irreversible actions.
- Clearly indicate connection state.

### Completion/results

- Show the teacher a final leaderboard and session summary.
- Show students a completion state without revealing teacher-only
  information.
- Preserve results for later teacher review.

Every screen must include loading, empty, error, and disconnected states
where relevant. Avoid fake data in production flows.

---

## 12. Reliability and reconnection

A live game must not silently corrupt when a browser refreshes or a
Durable Object is evicted.

- Persist enough session state to reconstruct the active game.
- Use server-side deadlines and alarms; on recovery, compare the
  current time with the persisted deadline and transition correctly.
- Make answer submission idempotent using a unique constraint and/or
  request ID.
- Reconnecting teachers must recover the current game state and
  controls.
- Reconnecting students must recover their participant identity and
  current question without creating duplicate participants.
- Do not let a reconnect reset the question timer.
- Handle a teacher disconnect without automatically destroying the
  game.
- Decide and document what happens if the session's owner never
  reconnects.
- Add tests for object restart/recovery behavior to the extent
  supported by the local test environment.

---

## 13. Testing and quality gates

### Unit tests

Test at least: - Quiz publishing validation. - Question option
validation. - Nickname normalization and uniqueness behavior. -
State-machine transitions. - Deadline enforcement. - Correct/incorrect
scoring. - Duplicate answer rejection. - Tie-breaking. - Role-specific
payload filtering. - Authorization rules.

### Integration tests

Test at least: - Teacher registration and login. - Quiz CRUD and
ownership enforcement. - Publishing a valid quiz. - Creating a session
and immutable snapshot. - Student joining and duplicate nickname
handling. - Teacher starting a game. - Student answer submission. -
Manual question advance. - Automatic timeout progression. - Final
completion and results persistence. - Teacher-only leaderboard access. -
Student reconnect and teacher reconnect.

### End-to-end test

Create one automated happy-path test: 1. Register a teacher. 2. Create a
quiz with at least two MCQ questions. 3. Publish it. 4. Create a
session. 5. Join as two students. 6. Start the game. 7. Submit answers
from both students. 8. Close/advance the question. 9. Complete the game. 10. Verify the teacher sees correct results and students cannot access
the leaderboard.

### Quality gates

Before declaring a milestone complete: - Run formatter. - Run linter. -
Run TypeScript/Svelte checks. - Run unit and relevant integration
tests. - Build the production application. - Fix errors rather than
suppressing them. - Document any test that cannot run and why.

---

## 14. Implementation milestones

Build in this order. Keep each milestone small enough to review.

### Milestone 0 --- Repository and deployment foundation

- Inspect existing repository.
- Establish SvelteKit + Svelte 5 + TypeScript project.
- Configure strict TypeScript.
- Configure Cloudflare adapter and Wrangler.
- Configure local development bindings for D1 and Durable Objects.
- Add scripts for dev, check, lint, test, build, and migrations.
- Add `.env.example`, `.gitignore`, and a useful README.
- Verify a minimal local app and Cloudflare preview/deployment path.

**Acceptance:** The app starts locally, type-checks, builds, and has a
documented Cloudflare configuration.

### Milestone 1 --- Database and teacher authentication

- Define Drizzle schema and migrations.
- Implement teacher registration/login/logout/me.
- Implement secure cookie-based sessions.
- Add protected teacher layout/routes.
- Add ownership tests.

**Acceptance:** A teacher can register, log in, refresh, and access only
their own protected area.

### Milestone 2 --- Quiz authoring

- Implement quiz CRUD.
- Implement question and option CRUD/reordering.
- Implement publish validation.
- Build dashboard and quiz editor.
- Add ownership and validation tests.

**Acceptance:** A teacher can create and publish a valid MCQ quiz.

### Milestone 3 --- Session creation and lobby

- Create a session from a published quiz.
- Snapshot questions and options.
- Generate a collision-resistant, human-friendly join code.
- Create and bind a Durable Object per session.
- Implement student join and participant credentials.
- Implement lobby WebSocket events.
- Build teacher lobby and student waiting room.

**Acceptance:** A teacher can open a lobby and multiple students can
join and appear in real time.

### Milestone 4 --- Game engine

- Implement the explicit state machine.
- Implement server-side question opening and deadlines.
- Implement alarms or the supported scheduling mechanism.
- Implement answer validation, scoring, and duplicate prevention.
- Implement manual advance and automatic progression.
- Implement role-specific WebSocket messages.

**Acceptance:** Two or more students can answer questions in a live
session and the server determines all outcomes.

### Milestone 5 --- Results and recovery

- Implement teacher-only leaderboard and results.
- Implement student completion screen.
- Implement reconnection and state snapshots.
- Implement durable recovery after object hibernation/restart.
- Add integration and end-to-end tests.

**Acceptance:** A completed game has persistent results, and
reconnecting clients recover the correct state.

### Milestone 6 --- Hardening and deployment

- Review security and authorization.
- Review free-tier quotas and expected usage.
- Add rate limiting and abuse protection.
- Test mobile layouts and accessibility.
- Test multiple concurrent rooms.
- Document deployment, migrations, secrets, and rollback/recovery.
- Add a production smoke-test checklist.

**Acceptance:** The app is deployable and the known free-tier
limitations are documented.

---

## 15. Free-tier and cost constraints

The initial target is a no-card, free-tier deployment.

- Prefer Cloudflare services that can be used without attaching a
  payment card.
- Verify current signup, account verification, and plan requirements
  rather than assuming.
- Do not enable paid features, automatic upgrades, or paid third-party
  integrations.
- Do not claim the product is unlimited or production-grade merely
  because it can be deployed for free.
- Document the relevant quotas and what happens when each quota is
  exceeded.
- Add graceful error handling for quota exhaustion and service
  unavailability.
- Avoid background polling that consumes requests unnecessarily.
- Use WebSockets and Durable Objects efficiently.
- Do not put a database on an expiring free trial as the only
  permanent store.
- Before production launch, verify data retention, backup/export
  options, and current free-tier limits from official documentation.

If a provider requires a card, a paid commitment, or a trial that later
charges automatically, it does not satisfy the project's hosting
constraint. Explain alternatives instead of proceeding.

---

## 16. README requirements

The final README must include:

- What Quizky is.
- Feature list.
- Architecture diagram (Mermaid is acceptable).
- Tech stack.
- Prerequisites.
- Local setup instructions.
- How to run the app.
- How to create/use local D1 and Durable Object bindings.
- How to apply migrations locally and remotely.
- Required environment variables and Cloudflare secrets (names only;
  never real values).
- Test, check, lint, and build commands.
- Deployment instructions.
- Known limitations and free-tier constraints.
- A short troubleshooting section.

---

## 17. Definition of done

The MVP is complete only when:

- A teacher can register and log in.
- A teacher can create, edit, and publish an MCQ quiz.
- A teacher can launch a session and share its join code/link.
- Multiple students can join with unique nicknames.
- Students see a live waiting room.
- The teacher can start the game.
- Questions are delivered in real time.
- Students can submit one answer per question.
- The server enforces correctness and deadlines.
- The teacher can manually advance questions.
- Questions automatically advance when time expires.
- The teacher can end the game.
- Only the teacher can see the leaderboard and detailed results.
- Results persist after the game ends.
- Refresh/reconnect does not create duplicate participants or reset
  the game.
- Core flows have automated tests.
- The app passes type checking and production build.
- Deployment and free-tier limitations are documented.

**Build the smallest complete, reliable version first. Do not add
features outside this specification without asking.**
