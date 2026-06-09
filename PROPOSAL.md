# Articulators: an open standard for how websites talk to agents

> A proposal. This document is the narrative case; the normative protocol is in
> [SPEC.md](./SPEC.md) and governance in [GOVERNANCE.md](./GOVERNANCE.md).
> Status: v0.1 draft.

## The problem: the screenshot tax

AI browsers are converging on a frustrating shape: a copilot that can *see* your
tabs but can't *use* the powerful tooling that lives elsewhere, and capable
agent tooling that has no eyes on the live, authenticated tab. You pick one or
the other, never both.

The bridge most browsers reach for to cross that gap is the worst one available:
**screenshots**. The agent renders the page to pixels and then spends tokens and
latency OCR-ing data that is already sitting structured one layer down. Open a
spreadsheet in a tab and watch the copilot screenshot it to read cells it could
have read as numbers. Call this the **screenshot tax** — paid on every page,
every turn, in tokens, latency, and lost structure (headings, tables, state).

The tax is not a model problem; it is a *plumbing* problem. The data exists. The
page already holds it. What is missing is a way for the page to **say what it can
do** in a form an agent can call directly.

## The idea: articulators expose tools

An **articulator** is a set of **tools** a web page exposes to a browser agent —
JavaScript functions, each with a name, a description, and a typed parameter
schema. The exact shape of a tool definition in MCP or an agent skill:

```js
window.articulators.register({
  supplier: { kind: "first-party", id: "https://www.booking.com", title: "Booking.com" },
  tools: [
    {
      name: "searchHotels",
      description: "Search available hotels for a destination and date range.",
      inputSchema: { type: "object", required: ["destination", "checkIn", "checkOut"], properties: { /* … */ } },
      effects: { mode: "read", idempotent: true, confirmation: "none" },
      invoke: async (args) => ({ ok: true, data: await bookingApi.searchHotels(args) }),
    },
    // createBooking, cancelBooking, …
  ],
});
```

The agent stops "looking at" the page and starts **operating its data model**.
No OCR, no DOM-selector guessing, no screenshot tax — a typed call, a structured
result. The contract is explicit, versioned, and domain-specific.

## Three supply paths, one identical API

The same API serves tools no matter who wrote them. That decoupling is the whole
design:

| Path | Who supplies the tools | How they reach the data |
|---|---|---|
| **First-party** | The web app's own developers | Direct access to the site's internal state and APIs |
| **Extension** (third-party) | Anyone — via an extension, distributed through a marketplace | Operate over the page's surfaces |
| **Agent-builtin** | The browser / agent vendor, shipping its own per-site articulators | Operate over the page's surfaces |

**Every articulator is bound to a specific page or URL pattern — there is no
generic, one-size-fits-all articulator.** A tool that worked on "any site" would
just be the standard browser API and buy nothing; the value is precisely that a
tool knows `booking.com`'s `searchHotels` or `createBooking`. The three paths
differ only in *who authored and ships* the per-site tools, never in how specific
they are. Even the agent-builtin path is the vendor writing articulators for
particular sites — and the intended dynamic is that clients author their own,
then **reshare what works** so good per-site articulators spread.

A browser agent consumes one uniform registry; only the authorship differs. For a
given site, a first-party tool wins when present, otherwise an installed
extension's, otherwise the agent's own bundled one — all three target *that same
site*. If no articulator exists for a site at all, there are simply no tools for
it and the agent does whatever it did before (its own DOM/vision behavior, which
is outside this standard) — so unadopted sites still work, just without the
benefit, and anyone can write and reshare an articulator to close the gap. That
per-site graceful fallback is what makes a cold standard adoptable.

## Accessibility is the point, not a footnote

A semantic action layer is, fundamentally, an **assistive-technology primitive**
in the lineage of ARIA and WCAG. When a page declares *what it can do* —
`createBooking`, `cancelBooking` — rather than relying on an agent to
reverse-engineer pixels, every intention-based assistant benefits: users with
motor, visual, or cognitive challenges get robust, high-level operations instead
of brittle DOM heuristics. Vendor-neutral interaction standards are exactly where
accessibility has always lived; Articulators belongs in that tradition. This is a
primary motivation, not an afterthought.

## Why this is an open standard (and why a vendor should still want it)

Articulators is an **open, vendor-agnostic standard, owned by no vendor.** That
is not altruism — it is the only thing that works. A site will never add tools
for one browser's proprietary format; the moat such a format appears to offer is
illusory because nobody adopts it. Openness is the precondition for the supply
side to exist at all.

So why would a browser vendor invest? Because of the **MCP playbook.** MCP is
authored by a commercial vendor, fully open and vendor-neutral, *and*
strategically valuable — because Claude was the first and best-integrated client.
A vendor can be the **flagship implementer** of an open standard and capture
asymmetric value by being first and best, not by locking anyone in.

**Opera Neon is the natural first flagship adopter** — the way Claude was the
first flagship MCP client. Neon already leans DOM-native rather than
screenshot-first, which is exactly the edge Articulators rewards. The pitch:

> Articulators is an open standard, owned by no vendor. Opera Neon is its first
> flagship adopter and reference client. Being first and best-integrated is the
> advantage; the standard stays open so that Comet, Edge, Arc, Claude for Chrome,
> and any future agent can adopt it and grow the set of sites that ship tools. A
> bigger pie beats a fenced garden.

Competitor adoption is *desirable*: every browser that speaks Articulators gives
sites another reason to ship tools, which makes the whole ecosystem — and the
first mover's head start — more valuable.

## Trust: the hard part, handled

The moment anyone can publish tools for a site they don't own, trust becomes the
load-bearing problem: *if anyone can publish an articulator for booking.com, how
does an agent know it does what it says?*

The answer is that trust is a property of a **claim** ("this tool is authorized
to act for `booking.com`"), evaluated by the agent, never asserted by the
supplier:

- **First-party tools** are trusted by default because they register from the
  site's own origin — the Web's existing same-origin boundary. If you can run JS
  on booking.com, you already are booking.com.
- **Third-party tools** are **signed** by an accountable, verified publisher. The
  signature proves authorship and accountability, not site endorsement, and the
  agent always shows the user: *"This action is provided by Acme (a third-party
  extension), not by booking.com."* That attribution is the single most
  important safeguard.
- **Trust tiers** (first-party-verified, reviewed, verified-unreviewed,
  unverified) let the agent calibrate consent — and crucially, an agent works
  fully even with **no marketplace at all**.
- **Consequential actions** (writes, payments, auth) always require explicit,
  per-action user confirmation, with the agent owning the confirmation UX so it
  can't be spoofed. First-party status earns no exemption for spending money.

See [SPEC.md §8](./SPEC.md#8-trust-and-provenance) for the verification algorithm.

## The marketplace is one distributor, not a chokepoint

A marketplace — a place to publish, review, and discover third-party
articulators — is a natural product, and building a flagship one (plus
hand-written articulators for high-value gap sites like Booking.com) is a
concrete way to seed the ecosystem. But the **standard defines interfaces, not a
registry**: a distributor interface, an identity-issuer interface, and a reviewer
interface, each implementable by anyone. The reference marketplace is *a*
distributor and *a* default-trusted reviewer — never a required gate. The
conformance test is explicit: an agent must work with the marketplace entirely
absent. That boundary is what keeps the standard credibly neutral while still
leaving room for a great marketplace to compete on convenience and review
quality — again, the MCP↔Claude posture.

We **lead with the gaps, not the strongholds.** The first hand-written
articulators target sites where agents are stuck paying the screenshot tax and no
first-party automation exists — travel, commerce, dashboards (Booking.com is the
opening case). We deliberately *skip* sites a platform already automates well
(e.g. Google Docs, which Google itself drives): the goal is to fill gaps, not to
duplicate automation users already have.

## Governance: open, with credible neutrality

To be adopted by competitors, the standard must be more than open-licensed — it
must be *governed* so no single vendor can capture it:

- Spec text under CC-BY with a royalty-free implementation grant; reference code
  MIT.
- Lightweight, numbered proposals (Articulator Proposals) with a public decision
  log; a feature graduates from experimental to normative only with **two
  independent implementations** (the IETF "running code" bar) — the strongest
  anti-capture signal.
- A neutral org for the spec; the flagship vendor holds a maintainer seat, not
  the org; no single vendor majority.
- A phased path: bootstrap stewardship now (with Opera as flagship adopter) →
  a multi-stakeholder steward group once a second client ships → donation to a
  neutral standards body (W3C Community Group is the natural home for a Web API;
  precedent: WoT, WebAuthn).

Full details in [GOVERNANCE.md](./GOVERNANCE.md).

## What v0.1 ships

A normative spec covering the core protocol (tool format, registration,
discovery, invocation), the safety model (read/write, capabilities, the
confirmation gate), precedence across the three supply paths, the trust and
provenance model, the package/marketplace interfaces, and governance — plus
reference TypeScript types, machine-readable JSON Schemas, and a worked
Booking.com example. It is intended to be complete enough for a second
implementer to build a conforming client from, and concrete enough to put in
front of a flagship browser.

## Call to adopt

If you are building a browser agent: implement the first-party path (it's small),
and you immediately read structured tools from any site that ships them — no
screenshot tax. If you run a website: declare your domain actions as tools and
become directly operable by every conforming agent, and more accessible to every
assistive one. If you are Opera Neon: be the first flagship client of the open
standard for how websites talk to agents — and own that story.
