# Articulators

**An open, vendor-agnostic standard for how websites expose tools to browser agents.**

Today, AI browsers "see" pages by screenshotting them and OCR-ing data that
already exists structured one layer down — the **screenshot tax**: paid in
tokens, latency, and lost structure, on every page and every turn.

Articulators removes it. A web page (or a third party) exposes **tools** —
JavaScript functions with names, descriptions, and typed parameter schemas, in
the same shape as an MCP / agent-skill tool definition — that a browser agent can
**call directly**:

```js
window.articulators.register({
  supplier: { kind: "first-party", id: "https://www.booking.com", title: "Booking.com" },
  tools: [{
    name: "searchHotels",
    description: "Search available hotels for a destination and date range.",
    inputSchema: { type: "object", required: ["destination", "checkIn", "checkOut"], properties: { /* … */ } },
    effects: { mode: "read", idempotent: true, confirmation: "none" },
    invoke: async (args) => ({ ok: true, data: await bookingApi.searchHotels(args) }),
  }],
});
```

The agent operates the page's data model instead of looking at its pixels. The
contract is explicit, typed, versioned, and domain-specific — and the same API
serves tools whoever wrote them.

## Why it matters

- **No screenshot tax.** Structured calls, structured results.
- **Three supply paths, one API.** Sites ship first-party tools; anyone can add
  tools for a site via an extension/marketplace; browser agents ship their own
  per-site articulators. Articulators are always **site-specific** — there is no
  generic, one-size-fits-all tool (that would just be the browser API). Same
  registry, per-site tools, graceful fallback to the next author when present.
- **Accessibility-native.** A semantic action layer is an assistive-technology
  primitive in the ARIA/WCAG lineage — intention-based operations, not DOM
  heuristics.
- **Open, not owned.** A standard no vendor controls, designed for a first-mover
  browser to adopt as flagship client (the same open-standard playbook MCP
  followed) without locking anyone in.

## Documents

| File | What it is |
|---|---|
| [PROPOSAL.md](./PROPOSAL.md) | The narrative case: problem, the idea, the supply paths, the pitch. |
| [SPEC.md](./SPEC.md) | The **normative** specification (protocol, safety, trust, packaging). |
| [GOVERNANCE.md](./GOVERNANCE.md) | Licensing, the proposal process, and the path to neutral stewardship. |
| [types/articulators.d.ts](./types/articulators.d.ts) | Reference TypeScript types (illustrative). |
| [schemas/](./schemas/) | Normative JSON Schemas: `tool`, `provenance`, `package`. |
| [examples/booking-com.ts](./examples/booking-com.ts) | A worked first-party articulator. |

New here? Read **PROPOSAL.md** for the why, then **SPEC.md** for the how.

## Status

**v0.1 draft** — experimental (`v0.x`, breaking changes allowed). The goal of
this revision is to be complete enough for a second implementer to build a
conforming client from, and concrete enough to put in front of a flagship
browser. Open issues are tracked in [SPEC.md §12](./SPEC.md#12-open-issues-tbd-non-normative-for-v01).

## License

Dual-licensed: **MIT** for code (types, schemas, examples, reference
implementations); **CC-BY-4.0 + a royalty-free implementation grant** for
specification text. See [LICENSE](./LICENSE) and [GOVERNANCE.md §1](./GOVERNANCE.md#1-licensing).
