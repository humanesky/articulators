# Articulators v0.1 — Specification

> **Status:** Draft (v0.x, experimental — breaking changes allowed). This is the
> normative specification. The narrative motivation lives in [PROPOSAL.md](./PROPOSAL.md);
> governance and licensing in [GOVERNANCE.md](./GOVERNANCE.md). Reference types in
> [`types/articulators.d.ts`](./types/articulators.d.ts) are illustrative; the
> JSON Schemas in [`schemas/`](./schemas/) are normative for serializable shapes.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHOULD**,
**SHOULD NOT**, **MAY**, and **OPTIONAL** are to be interpreted as described in
RFC 2119 / RFC 8174.

---

## 1. Overview and conformance

An **articulator** is a set of **tools** a supplier exposes to a **browser
agent** for a specific page or URL pattern. A tool is a named, described, typed
operation — the same shape as an MCP / skill tool definition — bound to a
JavaScript implementation. The agent invokes tools directly instead of inferring
intent from rendered pixels.

Every articulator is **site-specific** regardless of supply path: each tool
carries a `targetOrigin` (§8.1) and binds to a particular site's domain
operations. There is no generic, cross-site articulator — a tool that applied to
"any site" would be nothing more than the standard browser API. The supply paths
(§8) differ only in *who* authors and ships the per-site tools, not in their
specificity.

The protocol has two conformance classes:

- A **conforming supplier** registers tools that satisfy §3 (Tool definition),
  §4 (Safety), and §5 (Registration), and, when distributed via the third-party
  path, §8 (Trust) and §9 (Packaging).
- A **conforming agent** (the consumer; a browser or agent extension) implements
  the registry surface (§5–§7), enforces the safety gate (§4.3), and performs
  trust evaluation (§8).

The **registry** is the trusted object that mediates between suppliers and the
agent. It is provided by the agent/browser. The registry is the protocol;
individual tools are content. **This spec defines the registry, the tool shape,
discovery, invocation, precedence, and trust. It does not define any specific
tool.**

A conforming agent MUST support the **first-party** supply path (§8.2). Support
for the **extension** path (§8.3) and any **marketplace/distributor** (§9) is
OPTIONAL; an agent that omits them MUST still function for first-party and
agent-builtin tools. This is the property that keeps the standard usable with no
marketplace present.

---

## 2. The global surface

The registry is exposed as a single global object, `window.articulators`,
implementing the `Articulators` interface:

```ts
interface Articulators {
  readonly version: string;                 // protocol version, e.g. "0.1"
  register(opts: RegisterOptions): Registration;
  list(filter?: ListFilter): ResolvedTool[];
  invoke(qualifiedName: string, args: unknown, opts?: InvokeOptions): Promise<ToolResult>;
  subscribe(listener: (event: RegistryEvent) => void): () => void;
}
```

- `version` MUST be the protocol version string (`"0.1"` for this document).
- An agent MAY provide the registry only on pages where it intends to act.
- A page MUST NOT assume the registry exists before checking; see §5.4
  (registration race).

---

## 3. Tool definition

A tool is an object:

```ts
interface Tool {
  name: string;              // unqualified, ^[a-z][a-zA-Z0-9]*$
  title?: string;            // human display label
  description: string;       // agent-facing: what it does + when to use it
  inputSchema: JSONSchema;   // JSON Schema 2020-12, root type "object" — NORMATIVE
  outputSchema?: JSONSchema; // optional schema for ToolResult.data
  effects: EffectHints;      // REQUIRED safety metadata (§4)
  invoke: ToolInvoke;        // implementation
  meta?: Record<string, unknown>;
}
```

### 3.1 Naming

- `name` MUST match `^[a-z][a-zA-Z0-9]*$` (verb-first lowerCamelCase, e.g.
  `searchHotels`). It MUST NOT contain `/` or `:`.
- The **qualified name** is constructed by the registry, never by the supplier:

  ```
  <origin>/<kind>:<supplierId>/<name>
  e.g.  https://www.booking.com/first-party:https://www.booking.com/searchHotels
        https://www.booking.com/extension:ext:com.acme.travel/searchHotels
  ```

  Agents and users address tools by qualified name in `invoke` and discovery.

### 3.2 Parameters

- `inputSchema` MUST be a valid JSON Schema (Draft 2020-12) document whose root
  `type` is `object`. It is the **normative** parameter contract; the registry
  validates arguments against it (§6.2).
- `outputSchema`, if present, describes `ToolResult.data` and is validated
  leniently (§6.5).
- Validation against [`schemas/tool.schema.json`](./schemas/tool.schema.json)
  applies to the serializable portion of a tool (everything except `invoke`).

### 3.3 Result shape

```ts
interface ToolResult {
  ok: boolean;               // true = success, false = operational error
  data?: unknown;            // structured result (validated against outputSchema if present)
  text?: string;             // optional human/agent-readable summary
  error?: ToolError;         // present iff ok === false
  meta?: Record<string, unknown>;
}

interface ToolError {
  code: ToolErrorCode;
  message: string;
  data?: unknown;            // optional structured detail (e.g. failing JSON Pointer)
  retriable?: boolean;
}
```

- A supplier SHOULD populate `data` (structured data is the point — it removes
  the screenshot tax). `text` is an OPTIONAL convenience summary.
- **Operational failures MUST be returned as `ok: false` with a typed `error`,
  not thrown.** A thrown exception from supplier code is caught and normalized by
  the registry to `error.code = "internal"` (§6.4).

#### `ToolErrorCode` (closed set)

| Code | Meaning |
|---|---|
| `invalid_arguments` | Args failed `inputSchema` validation. |
| `confirmation_required` | A `confirmation:"required"` tool was invoked without confirmation. |
| `not_found` | Unknown qualified name, or the addressed entity does not exist. |
| `unauthorized` | User not authenticated / lacks rights. |
| `forbidden` | The tool refuses the operation. |
| `conflict` | State changed (e.g. an offer expired). |
| `timeout` | The invocation exceeded its deadline. |
| `cancelled` | The caller aborted the invocation. |
| `rate_limited` | Too many requests. |
| `unavailable` | Backend unavailable; typically `retriable`. |
| `internal` | Uncaught supplier failure. |

This set is normative for v0.1. Agents MUST treat an unrecognized code as
`internal`.

---

## 4. Safety and effects

Every tool MUST declare `effects`:

```ts
interface EffectHints {
  mode: "read" | "write";            // REQUIRED
  idempotent: boolean;               // REQUIRED
  confirmation: "none" | "required"; // REQUIRED
  destructive?: boolean;
  scopes?: Capability[];             // declared capability ceiling
  consequences?: string;             // shown to the user at confirmation time
}
```

### 4.1 Read/write

- `mode` is a hard binary. A `read` tool MUST NOT mutate observable state.
  Anything that mutates state is a `write`.

### 4.2 Confirmation declaration

- A `write` tool that spends money, sends a message to a third party, or is
  `destructive` MUST set `confirmation: "required"`.
- A `write` tool MAY set `confirmation: "none"` only when the write is trivially
  reversible and low-stakes (e.g. toggling a UI filter).
- When `confirmation: "required"`, the supplier SHOULD provide `consequences`.

### 4.3 The confirmation gate (two-party; the agent owns the UX)

Confirmation is a two-party protocol. **The agent owns the confirmation UX; the
supplier MUST NOT render its own confirmation as a substitute** (that would
invite spoofing and inconsistent consent surfaces).

For a tool with `confirmation: "required"`, a conforming agent MUST, **before**
invocation:

1. Resolve the tool, its `effects` (including `consequences`), and its
   `provenance` (§7, §8).
2. Present a confirmation to the user containing, at minimum: the qualified tool
   name, the **provenance** (who supplied it and its trust tier), the concrete
   arguments to be passed, and `effects.consequences`.
3. Only on explicit user approval, call `invoke` with `{ confirmed: true }`.

The **registry enforces the gate**: if `tool.effects.confirmation === "required"`
and the caller did not pass `{ confirmed: true }`, the registry MUST reject with
`ToolErrorCode.confirmation_required` **before** dispatching to supplier code. A
supplier MAY additionally check `ctx.confirmed` defensively but MUST NOT assume
the agent skipped step 2.

> The registry receives `confirmed` from the agent and forwards it to the
> supplier via `InvocationContext.confirmed`. v0.1 uses a boolean; a
> cryptographic / origin-bound confirmation token is a future extension (§12).

### 4.4 Capabilities (closed vocabulary)

```
read | write | payment | auth | personal-data | external-send
```

- `effects.scopes` declares a tool's capability **ceiling**. It is surfaced to
  the user and used to drive consent. v0.1 does **not** enforce capabilities at
  runtime; a tool exceeding its declared capability is a reviewable/revocable
  violation (§9), not a silently blocked one.
- Operations carrying `write`, `payment`, or `auth` MUST require per-invocation
  user confirmation regardless of trust tier, unless the user has granted "always
  allow" for that exact `(supplier, origin, capability)` triple. First-party
  status does **not** exempt `payment` or `auth` from confirmation.

### 4.5 Hard prohibition

No tool MAY change permission, sharing, ACL, or authentication/credential state
of the user's account. This is a spec-level MUST NOT, not an opt-out flag.

---

## 5. Registration

```ts
interface RegisterOptions { supplier: SupplierInfo; tools: Tool[]; }

interface SupplierInfo {
  kind: "first-party" | "extension" | "agent-builtin";
  id: string;            // stable, unique (origin or reverse-DNS)
  title?: string;
  version?: string;      // the supplier's own version
}

interface Registration {
  readonly id: string;
  add(tools: Tool[]): void;
  remove(names: string[]): void;   // by unqualified name
  set(tools: Tool[]): void;        // atomic replace of THIS supplier's set
  unregister(): void;
}
```

### 5.1 Handles and isolation

- `register` MUST return a `Registration` handle scoped to that supplier. A
  supplier MUST be able to mutate only its own tool bucket via the handle; it
  MUST NOT be able to read, modify, or remove another supplier's tools.

### 5.2 Kind verification (anti-spoofing)

- The `kind` in `SupplierInfo` is a **claim**. The registry MUST verify it and
  MUST downgrade where the claim cannot be substantiated:
  - `first-party` is honored only when the registering execution context is
    same-origin with the page AND not an injected extension content-script
    context. A claimed `first-party` from an extension context MUST be recorded
    as `extension`.
- This verification is what makes precedence (§7.3) and trust (§8) trustworthy
  rather than supplier-asserted.

### 5.3 Dynamic and SPA tool sets

- Tools MAY appear and disappear as application state changes. The supplier keeps
  its set in sync via `add` / `remove` / `set`.
- The RECOMMENDED SPA pattern is to call `registration.set(toolsForCurrentView)`
  on each route/state change. The registry diffs the new set against the old and
  emits the minimal change events (§7.2).
- A stale tool that errors when invoked is a supplier bug; agents surface it as a
  normal `ToolError`.

### 5.4 Registration race (registry-before-page)

A page script and the agent's registry may load in either order. v0.1 RECOMMENDS
(but does not require) a buffering shim: if `window.articulators` is absent, a
page MAY install a minimal queue object exposing `register` that records calls
and is drained by the real registry on arrival. The exact shim contract is
**TBD** (§12); agents SHOULD tolerate a drained queue.

### 5.5 Protocol versioning

- `window.articulators.version` carries the protocol version.
- v0.1 evolves **additively**: agents and suppliers MUST ignore unknown
  object fields (forward compatibility), and SHOULD place private extensions
  under `meta`.

---

## 6. Invocation

```ts
interface InvokeOptions {
  confirmed?: boolean;     // agent asserts user approval (§4.3)
  signal?: AbortSignal;    // caller cancellation
  timeoutMs?: number;      // default 30_000
}
```

Agents MUST invoke through `registry.invoke(qualifiedName, args, opts)` so that
validation and the safety gate run. Direct calls to a supplier's `tool.invoke`
bypass the protocol and are out of conformance.

Normative invocation order:

1. **Resolve.** Unknown qualified name → `not_found`.
2. **Validate input.** Validate `args` against `inputSchema` (JSON Schema
   2020-12) **before** dispatch. On failure → `invalid_arguments`, with the
   failing JSON Pointer in `error.data`. Suppliers MAY assume args are valid.
3. **Confirmation gate.** If `effects.confirmation === "required"` and
   `!opts.confirmed` → `confirmation_required`, no dispatch (§4.3).
4. **Dispatch** with `InvocationContext { confirmed, signal, invocationId }`.
5. **Normalize.** A thrown error or rejected promise from supplier code MUST be
   caught and returned as `{ ok: false, error: { code: "internal", ... } }`. The
   registry MUST NOT let a raw exception escape to the agent.
6. **Timeout.** The registry races the supplier promise against `timeoutMs`
   (default `30000`); on expiry it aborts via `signal` and returns `timeout`.
7. **Cancellation.** The caller's `AbortSignal` is forwarded as `ctx.signal`;
   on abort → `cancelled`.

### 6.5 Output validation (lenient)

If `outputSchema` is present, the registry validates `data` and, on mismatch,
attaches a non-fatal `meta.warning` rather than failing the call. **Input
validation is strict; output validation is lenient** — a slightly-off result
should not block the agent.

---

## 7. Discovery

```ts
interface ResolvedTool {
  qualifiedName: string;
  name: string;
  tool: Tool;
  provenance: Provenance;
  shadowedBy?: string;     // set when precedence demoted this tool
}

interface ListFilter {
  mode?: "read" | "write";
  kind?: "first-party" | "extension" | "agent-builtin";
  includeShadowed?: boolean;  // default false
}
```

### 7.1 Enumeration

- `list(filter?)` MUST return the **merged, precedence-resolved** view (§7.3).
  Shadowed tools MUST be hidden unless `includeShadowed: true`.
- Every `ResolvedTool` MUST carry `provenance` (§8.1) so the agent can group,
  label, and gate tools by supplier and trust tier.

### 7.2 Change notifications

```ts
type RegistryEvent =
  | { type: "tools-added"; tools: ResolvedTool[] }
  | { type: "tools-removed"; qualifiedNames: string[] }
  | { type: "tools-changed"; tools: ResolvedTool[] }   // e.g. precedence reshuffle
  | { type: "supplier-registered"; supplier: SupplierInfo }
  | { type: "supplier-unregistered"; supplierId: string };
```

- `subscribe(listener)` MUST return an unsubscribe function.
- The registry MUST coalesce a `set()` / SPA change into the minimal add/removed/
  changed events (diffed by qualified name plus a shallow tool hash) so agents
  maintain a live list without polling.

### 7.3 Precedence and merge

Precedence across supply paths, highest first:

```
first-party  >  extension  >  agent-builtin
```

Every tool in all three paths is bound to a specific origin / URL pattern (its
`targetOrigin`, §8.1) — there is no generic, cross-site tool. Precedence
therefore ranks *authority over the same site*, not generality. Rationale:
first-party tools have direct, privileged access to the site's internal model and
are authoritative; an extension is an explicit, user-installed augmentation for
that site; an agent-builtin is the vendor's own bundled articulator for that
site, ranked lowest because it is neither the site itself nor the user's explicit
per-site choice. (Absence of any tool for a site is not an "agent-builtin
fallback" — it simply means the agent has no Articulators tools there.)

Merge rules:

- The registry maintains a **union** of all tools keyed by **qualified name**
  (which embeds kind + supplierId + origin), so distinct suppliers never truly
  collide.
- A **conflict** is two tools with the same unqualified `name` within the same
  `origin`. The higher-precedence tool is **active**; the lower-precedence one is
  **shadowed** (`shadowedBy` set to the active tool's qualified name) and hidden
  from default `list()`.
- A tie **within the same kind** (e.g. two extensions both defining
  `searchHotels`) MUST be broken deterministically by registration order (first
  registered wins) and surfaced via `meta.warning`. Silent last-writer-wins is
  non-conforming.
- Agents always know provenance per tool (§8.1); the confirmation UI MUST surface
  it (§4.3).

---

## 8. Trust and provenance

Trust is a property of a **claim** — "this tool is authorized to act on behalf
of `targetOrigin`" — not of a tool in the abstract. The tool definition stays
MCP/skill-shaped; trust rides in a sibling **provenance envelope**.

### 8.1 Provenance envelope

Normative shape: [`schemas/provenance.schema.json`](./schemas/provenance.schema.json).

```ts
provenance: {
  supplyPath: "first-party" | "extension" | "agent-builtin",
  targetOrigin: string,                  // origin the tool claims to act on (a claim)
  supplier: { id, displayName, kind },   // kind: "site" | "extension" | "agent"
  toolHash: string,                      // sha256 of canonical tool def + bound code ref
  signature: Signature | null,           // REQUIRED for extension path
  attestations: Attestation[],           // detached, additive (e.g. marketplace review)
  declaredCapabilities: Capability[],
  version: string,                       // semver
  notBefore?, notAfter?                  // validity window (bounds revocation staleness)
}
```

`targetOrigin` is a **claim**. The **trust tier** (§8.5) is the agent's verified
judgment of that claim. A supplier MUST NOT assert its own tier; an agent MUST
NOT accept one.

### 8.2 First-party verification (trusted by default)

A tool is **first-party verified** when registered from a context same-origin
with its `targetOrigin`. Two binding mechanisms:

1. **Same-origin runtime registration** (baseline, always available). The page
   calls `window.articulators.register(...)` from its own origin's JS context;
   the agent stamps `targetOrigin` from the *actual* registering origin, which
   the page cannot forge. This reuses the Web's existing same-origin trust
   boundary: code that already runs on `booking.com`'s origin already *is*
   booking.com for practical purposes.
2. **Origin-bound static manifest** (OPTIONAL hardening + discoverability). A
   site MAY publish `/.well-known/articulators.json` listing its tool
   definitions (or their hashes), fetched same-origin over HTTPS. This lets an
   agent enumerate first-party tools before executing page JS and cross-check
   runtime registrations against the declaration.

First-party tools require **no signature** and are trusted by default for read
operations; consequential operations remain gated by §4.4.

### 8.3 Third-party (extension) tools

The hard case: a supplier exposes tools for an origin it does **not** own (e.g.
an extension adding `findCheaperDates` to booking.com). The agent MUST NOT treat
this as the site itself.

- **Who signs:** the supplier (extension author), with a key bound to a verified
  supplier identity. The signature proves *accountability* ("a named, accountable
  party authored exactly this tool and targets this origin"), **not** endorsement
  by the target site.
- **What is signed:** the canonicalized tuple
  `{ toolDef, codeRef/codeHash, targetOrigin, supplierId, version }`. Signing
  `targetOrigin` and the code together prevents (a) swapping code under a reviewed
  definition and (b) re-pointing a signed tool at a different origin. Large code
  is hashed, and the hash is signed, so bundles stay out of the per-tool envelope.
- **Identity binding** — an agent accepts any of:
  - **(A) Marketplace-issued identity** — a distributor verifies the publisher and
    issues a signing certificate.
  - **(B) Domain-bound self-identity** — the supplier proves control of its own
    domain by publishing keys at `https://<supplier-domain>/.well-known/articulators-keys.json`;
    `supplier.id` is that domain. Requires no marketplace (keeps the standard
    vendor-neutral).
  - **(C) Sigstore-style keyless / OIDC** — the signing identity is an OIDC
    identity, transparency-log backed.

### 8.4 Verification algorithm (normative)

To evaluate a third-party tool, a conforming agent MUST:

1. Recompute `toolHash` from the received tool definition + code; reject on
   mismatch.
2. Verify `signature` over the canonical tuple; reject on failure.
3. Resolve `keyId → supplier identity` via the cert chain / well-known key /
   transparency log, establishing a **verified supplier display name**.
4. Confirm `targetOrigin` equals the origin the agent is acting on.
5. Check revocation (§9.4) and the `notBefore`/`notAfter` window.
6. Assign a trust tier (§8.5) from *which* identity method and attestations
   verified — never from supplier claims.

### 8.5 Trust tiers

| Tier | Definition | Default consent posture |
|---|---|---|
| **T0** first-party-verified | same-origin registration or origin-bound manifest | Read: silent. Write/payment/auth: confirm per §4.4. |
| **T1** agent-builtin | shipped/curated by the agent or browser vendor | Vendor-trusted within its scope; treated like first-party. |
| **T2** reviewed-third-party | verified supplier **and** a valid review attestation (§9.2) | First use: one-time attributed consent. Writes: confirm. |
| **T3** verified-unreviewed-third-party | verified supplier identity, no review attestation | Explicit attributed consent before each new capability; prominent "not reviewed" notice. |
| **T4** unverified | signature/identity absent or failing on a third-party tool | **Not callable by default.** Agent MAY offer an advanced manual opt-in only. |

Two orthogonal axes are captured: *identity verified?* and *behavior reviewed?*
Their separation is what lets an agent operate fully at **T3** with no
marketplace present.

### 8.6 Mandatory attribution

Before first use of a third-party (T2–T3) tool on a site, the agent MUST surface
attribution making clear the tool is **not** provided by the target site, naming
the verified supplier and its review status. RECOMMENDED wording:

> "The **`<toolName>`** action here is provided by **`<Supplier>`** (a
> third-party extension), not by `<site>`. Verified publisher · {Reviewed by
> `<reviewer>` | Not reviewed}. [Use once] [Always allow `<Supplier>` on
> `<site>`] [Block]"

This attribution is the single most important security control in the protocol
and its substance (not exact pixels) is normative.

---

## 9. Packaging, distribution, and the standard ⇄ marketplace boundary

The third-party path is distributed as signed **packages**. The spec defines
**interfaces**, not a registry — any party MAY run a distributor; no single
marketplace is a required chokepoint.

### 9.1 Package format (`.artpkg`)

Normative manifest shape: [`schemas/package.schema.json`](./schemas/package.schema.json).
A package is a signed bundle of:

- `manifest.json`: `packageId` (reverse-DNS), `version` (semver), `publisher`
  (+ `verifiedIdentity`), `targetMatch` (URLPattern-subset match patterns),
  `tools[]` (each with `toolDef`, `codeRef`, `targetOrigin`,
  `declaredCapabilities`), `signature`, `integrity.codeHashes`, `minSpecVersion`.
- detached `attestations/` (e.g. review attestations).
- `code/` (the tool implementations).

Every tool's `targetOrigin` MUST be covered by `targetMatch`, and `targetMatch`
is part of the signed payload. The `targetMatch` grammar is a restricted
URLPattern subset (path wildcards permitted; it MUST NOT silently broaden to
arbitrary apex domains).

### 9.2 Review and the T2 attestation

- A review mints a **signed, version-pinned `marketplace-review` attestation**
  over the exact package hash. Because it is version-pinned, publishing a new
  version drops the package to **T3** until re-reviewed — this blocks
  review-then-swap.
- Minimum review bar: publisher identity verification; declared capabilities
  match observed behavior of `code`; `targetMatch`/`targetOrigin` are not
  impersonating; static/dynamic scan; description accuracy.

### 9.3 Impersonation and squatting controls

- Publisher identity MUST be verified before a package targeting a third-party
  origin is published.
- **Origin-claim allowlist:** the legitimate owner of an origin MAY register
  (using the same domain-control proof as first-party, §8.2) to (a) claim **T0**
  for its own packages and (b) set policy for third-party packages targeting it:
  `open` (default), `review-required`, or `disallow`.
- A package MUST NOT present a `displayName`/icon implying it *is* the target
  site; enforced at review and surfaced by §8.6 regardless.

### 9.4 Versioning, updates, revocation

- Packages are semver'd; each version is independently signed and reviewed.
- Auto-update MAY be allowed within a minor range for T2 packages, but any
  **capability escalation** (a new `write`/`payment`/`auth`) MUST drop to manual
  consent even on auto-update.
- Each distributor and publisher MUST publish a signed, append-only,
  short-TTL **revocation feed** (revoked `packageId@version`, revoked keys,
  reason). Agents MUST honor revocation before invoking `write`/`payment` tools
  and SHOULD check before reads. A compromised publisher key, once revoked,
  invalidates all signatures and attestations referencing it.

### 9.5 Vendor-neutral interfaces

The spec defines three interfaces; any party may implement each:

- **Distributor interface** — a discovery/index endpoint + a revocation feed +
  the attestation format.
- **Identity-issuer interface** — methods A/B/C of §8.3.
- **Reviewer interface** — anyone may mint `*-review` attestations under their
  own verified identity; the agent maintains a configurable trusted-reviewer
  list and decides which reviewers it honors.

A reference distributor / default-trusted reviewer is a **policy choice of a
given agent**, not a spec requirement. **Conformance test:** a conforming agent
MUST be able to support T0 (first-party), method-B T3 (self-hosted third-party),
and any trusted reviewer's T2 **with no specific marketplace present.**

---

## 10. Accessibility

A semantic action layer is, by design, an assistive-technology primitive in the
ARIA/WCAG lineage: it gives assistive agents high-level, intention-based
operations instead of forcing DOM-heuristic or vision-based inference. Suppliers
SHOULD treat articulator tools as an accessibility surface and describe domain
actions (`createBooking`) rather than UI mechanics (`clickButton`).

---

## 11. Implementation note: hybrid-read routing (non-normative)

The tool format is the **contract**; how an unprivileged supplier (extension /
agent-builtin) *implements* a tool is its own concern. The RECOMMENDED technique
is **hybrid-read routing**: prefer the structured DOM / the site's own internal
JSON API, fall back to the accessibility tree, and use a screenshot only for
canvas-rendered or otherwise opaque surfaces. First-party suppliers reach the
internal model directly and need none of this.

---

## 12. Open issues (TBD; non-normative for v0.1)

The following are deliberately unspecified in v0.1 and tracked for a later
version:

1. **Streaming / progress results** — v0.1 is unary (one `Promise`, one
   `ToolResult`). A progress/`AsyncIterable` channel is deferred.
2. **Signed confirmation tokens** — v0.1 uses a boolean + registry enforcement
   (§4.3); an origin-bound cryptographic token is deferred.
3. **Registration-race buffering shim** — the exact queue-shim contract (§5.4).
4. **Lazy / pull tool discovery** — v0.1 assumes eager enumeration (§7.1).
5. **User-policy precedence overrides** — v0.1 ships the fixed order of §7.3.
6. **Protocol feature-detection** beyond a single `version` string.
7. **Subdomain / related-origin first-party vouching** (a `related_origins`
   list in the well-known manifest).
8. **Runtime capability enforcement / sandboxing** — v0.1 is consent-based
   (§4.4).
9. **Cross-distributor attestation federation** + a shared transparency log.
10. **Method-B key rotation / recovery UX** for domain-bound publishers.
