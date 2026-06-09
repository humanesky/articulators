# Articulators — Governance

> How the standard is licensed, how it evolves, and how it stays credibly
> neutral and open to broad adoption. Status: v0.1 (Phase 0, bootstrap).

The governing goal is a standard that competing browser/agent vendors can adopt
**without feeling captured** by any one of them. Everything below serves that
goal. The model borrows deliberately from three precedents: **MCP** (vendor-
authored, open, broadly adopted), **W3C WoT Thing Description / WebAuthn**
(neutral-body Web API standardization), and **OpenAPI** (clean spec-vs-tooling
separation with an unambiguous royalty-free implementation grant).

## 1. Licensing

| Artifact | License |
|---|---|
| Specification text (`SPEC.md`, `PROPOSAL.md`, this file, schemas prose) | **CC-BY-4.0** + an explicit **royalty-free implementation grant / patent non-assert** |
| Reference code (`types/`, `schemas/` as machine artifacts, reference SDK, examples) | **MIT** |

CC-BY alone grants the right to copy and adapt the *text*, but not unambiguously
the right to *implement* what it describes. We therefore attach a royalty-free
implementation grant (in the spirit of the W3C RF patent policy and OpenAPI's
Apache-2.0 patent grant): anyone may implement the specification, royalty-free,
and contributors agree not to assert patents essential to implementing it. The
repository's existing `LICENSE` (MIT) governs code; spec text carries the
CC-BY + RF grant noted here and in each document header.

## 2. How the spec evolves

### 2.1 Versioning

- The spec is semver-shaped. **`v0.x` is experimental** — breaking changes are
  allowed. **`v1.0` is a stability commitment.**
- Each normative object is forward-compatible by the "ignore unknown fields"
  rule (SPEC §5.5); clients negotiate via the `version` string and packages via
  `minSpecVersion`.

### 2.2 Articulator Proposals (APs)

Changes flow through lightweight, numbered **Articulator Proposals**, modeled on
Python PEPs / MCP SEPs / the OpenAPI proposal process:

```
Draft → Discussion (open issue/PR, fixed comment window) → Accepted | Rejected → Implemented
```

- Anyone may open an AP. Each AP records motivation, the normative change,
  backward-compatibility impact, and security/privacy considerations.
- Decisions are recorded in a **public decision log**.

### 2.3 The two-implementations rule (the anti-capture core)

A feature **MUST NOT graduate from experimental to normative** (or into a `v1.0`
stability commitment) until **two independent, interoperable implementations**
exist. This is the IETF "rough consensus and running code" bar and the W3C
two-interoperable-implementations bar. It is the single strongest structural
guarantee that no one vendor's private extension becomes the de-facto standard.

## 3. Reference implementation vs specification

- The **specification is the single source of truth.** Reference code is
  illustrative and may lag.
- Clear repo separation: `articulators-spec` (normative) and `articulators-js`
  (reference SDK, MIT), mirroring MCP (spec + SDKs) and OpenAPI (spec + tooling).
- Stated rule: **if the reference implementation disagrees with the spec, the
  spec wins.** This prevents de-facto vendor control through the implementation.

## 4. Stewardship and neutrality mechanics

Neutrality has to be structural, not just stated:

- The spec repository lives under a **neutral organization** (e.g.
  `articulators` / `webarticulators`), **not** under any vendor's GitHub org.
- No single vendor holds the org, and no single vendor may hold a majority of
  maintainer seats. A vendor that implements the standard may earn a maintainer
  seat by contribution, not by being a vendor.
- The standard's **name/trademark** is held by the steward group (and later a
  foundation) under an open usage policy, so no vendor can claim to ship the
  "official" Articulators.
- All distribution interfaces (distributor, identity-issuer, reviewer; SPEC §9.5)
  are vendor-neutral. Any vendor's marketplace or extension is *a* distributor,
  never the gate.

### The neutrality stance, stated plainly

> Articulators is an open standard, owned by no vendor. It is free for any
> browser, agent, or assistive client to implement — there is no gatekeeper and
> no preferred client. The more agents and sites adopt it, the more everyone
> benefits. A bigger pie beats a fenced garden.

## 5. Phased path: bootstrap → neutral body

Governance broadens only when there is a real second party to share it — the same
"running code" discipline applied to governance itself.

| Phase | Trigger | Structure |
|---|---|---|
| **Phase 0 — Bootstrap (now)** | — | Single-steward (the author). MIT/CC-BY + RF grant in place; AP process live; public decision log. Honest "benevolent maintainer" stage (where MCP started). |
| **Phase 1 — Steward group** | A second independent browser/agent ships a conforming client | Multi-stakeholder steward group; published patent/RF policy; the two-implementations rule applies to feature graduation. |
| **Phase 2 — Neutral body** | ≥3 independent implementers, or material commercial dependence | Donate spec + trademark to a neutral standards body. **W3C Community Group → Working Group** is the natural path for a Web API (precedent: WoT, WebAuthn); a foundation (OpenJS / Linux Foundation) is the alternative if a companies-consortium model fits better. |

## 6. Open governance questions (TBD)

- **Final neutral-body destination** (W3C CG vs a foundation) — decided at Phase
  1 based on who the adopters actually are; not pre-committed.
- **Reviewer-trust federation** — how agents discover and agree on trustworthy
  reviewers across distributors (ties into SPEC §12 item 9).
- **Conformance test suite + a self-certification / badge program** for
  "conforming agent" and "conforming supplier" claims.
