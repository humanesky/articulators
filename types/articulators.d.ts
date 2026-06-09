/**
 * Articulators v0.1 — reference TypeScript types.
 *
 * ILLUSTRATIVE, NOT NORMATIVE. The normative wire format for `inputSchema`
 * and `outputSchema` is JSON Schema (Draft 2020-12); see schemas/*.json and
 * SPEC.md. These types exist to document the runtime surface and to give tool
 * authors editor-time ergonomics. Where these types and the JSON Schemas
 * disagree, the JSON Schemas + SPEC.md win.
 *
 * License: CC-BY-4.0 (text) with a royalty-free implementation grant; see
 * GOVERNANCE.md. Reference code is MIT.
 */

// ---------------------------------------------------------------------------
// JSON Schema
// ---------------------------------------------------------------------------

/**
 * A JSON Schema document (Draft 2020-12). Modeled loosely; the normative
 * constraint is "a valid JSON Schema 2020-12 object whose root `type` is
 * `object`" for `Tool.inputSchema`.
 */
export type JSONSchema = {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema | JSONSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  format?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  [keyword: string]: unknown;
};

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * A supply-path kind. `extension` is the prose "third-party" path. A supplier
 * MAY declare its kind, but the registry verifies it and MAY downgrade a
 * claimed `first-party` registered from an extension context to `extension`.
 */
export type SupplierKind = "first-party" | "extension" | "agent-builtin";

/**
 * The closed capability vocabulary. A tool declares the capabilities it may
 * exercise; the agent treats this as a ceiling and a consent driver. v0.1 does
 * not enforce capabilities at runtime — exceeding a declared capability is a
 * reviewable/revocable violation, not a silently blocked one.
 */
export type Capability =
  | "read"
  | "write"
  | "payment"
  | "auth"
  | "personal-data"
  | "external-send";

/**
 * Safety/effect metadata. REQUIRED on every tool.
 */
export interface EffectHints {
  /** Hard binary. Reads never mutate observable state; everything else writes. */
  mode: "read" | "write";
  /**
   * Whether repeating the call with the same arguments has the same effect as
   * calling it once. Reads are assumed idempotent; REQUIRED to be explicit for
   * writes.
   */
  idempotent: boolean;
  /**
   * Whether the agent MUST obtain explicit user confirmation before invoking.
   * Any consequential write (spends money, sends a message, destructive) MUST
   * be `"required"`.
   */
  confirmation: "none" | "required";
  /** Hint: cancels, deletes, or is otherwise hard/impossible to reverse. */
  destructive?: boolean;
  /** Declared capability ceiling, surfaced to the user at consent time. */
  scopes?: Capability[];
  /**
   * Short natural-language description of what happens, shown to the user at
   * confirmation time. SHOULD be present whenever `confirmation` is `"required"`.
   */
  consequences?: string;
}

/**
 * Context passed by the registry into a supplier's `invoke` implementation.
 */
export interface InvocationContext {
  /**
   * Set to `true` by the registry when the agent asserted user approval for a
   * `confirmation: "required"` tool. Suppliers MAY enforce defensively but MUST
   * NOT assume the agent skipped its own confirmation.
   */
  confirmed?: boolean;
  /** Cancellation signal, forwarded from the caller and the timeout. */
  signal: AbortSignal;
  /** Unique id for this invocation, for logging/correlation. */
  invocationId: string;
}

/**
 * A single tool. The unit of capability a supplier exposes.
 */
export interface Tool {
  /** Unqualified, `^[a-z][a-zA-Z0-9]*$`, verb-first, e.g. `searchHotels`. */
  name: string;
  /** Optional human display label. */
  title?: string;
  /** Agent-facing description: what it does and when to use it. */
  description: string;
  /** Normative on the wire as JSON Schema 2020-12; root `type` MUST be `object`. */
  inputSchema: JSONSchema;
  /** Optional schema for `ToolResult.data`. */
  outputSchema?: JSONSchema;
  /** Safety/effect metadata. REQUIRED. */
  effects: EffectHints;
  /** Implementation. Always treated as async; a sync return is wrapped. */
  invoke: ToolInvoke;
  /** Free-form, namespaced extension metadata. */
  meta?: Record<string, unknown>;
}

export type ToolInvoke = (
  args: unknown,
  ctx: InvocationContext,
) => ToolResult | Promise<ToolResult> | unknown | Promise<unknown>;

// ---------------------------------------------------------------------------
// Results & errors
// ---------------------------------------------------------------------------

export interface ToolResult<Data = unknown> {
  /** `true` on success, `false` on an operational error. */
  ok: boolean;
  /** Structured result, validated against `outputSchema` if present. */
  data?: Data;
  /** Optional human/agent-readable summary. */
  text?: string;
  /** Present iff `ok === false`. */
  error?: ToolError;
  /** Free-form, e.g. `{ warning: "..." }`. */
  meta?: Record<string, unknown>;
}

export type ToolErrorCode =
  | "invalid_arguments"
  | "confirmation_required"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "timeout"
  | "cancelled"
  | "rate_limited"
  | "unavailable"
  | "internal";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  /** Optional structured detail, e.g. the failing JSON Pointer for validation. */
  data?: unknown;
  /** Hint: the same call may succeed later. */
  retriable?: boolean;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface SupplierInfo {
  /** Declared kind; the registry verifies and may downgrade it. */
  kind: SupplierKind;
  /** Stable, unique supplier identity (origin or reverse-DNS). */
  id: string;
  title?: string;
  /** The supplier's own version, distinct from the protocol version. */
  version?: string;
}

export interface RegisterOptions {
  supplier: SupplierInfo;
  tools: Tool[];
}

/**
 * A scoped, revocable handle for one supplier. A supplier may mutate only its
 * own tool bucket; it cannot touch another supplier's tools.
 */
export interface Registration {
  readonly id: string;
  /** Add tools to this supplier's set. */
  add(tools: Tool[]): void;
  /** Remove tools by unqualified name. */
  remove(names: string[]): void;
  /** Atomically replace this supplier's whole set (the SPA-navigation pattern). */
  set(tools: Tool[]): void;
  /** Remove all of this supplier's tools. */
  unregister(): void;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Provenance the registry attaches to every resolved tool. See the
 * provenance envelope in SPEC.md / schemas/provenance.schema.json for the full
 * trust-bearing form; this is the discovery-facing subset.
 */
export interface Provenance {
  kind: SupplierKind;
  supplierId: string;
  supplierTitle?: string;
  /** The origin the tool acts on / was registered from. */
  origin: string;
  /** Agent-computed trust tier; never set by the supplier. */
  trustTier?: TrustTier;
}

/**
 * T0 first-party-verified, T1 agent-builtin, T2 reviewed-third-party,
 * T3 verified-unreviewed-third-party, T4 unverified (not callable by default).
 */
export type TrustTier = "T0" | "T1" | "T2" | "T3" | "T4";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface ResolvedTool {
  /** `<origin>/<kind>:<supplierId>/<name>`. Constructed by the registry. */
  qualifiedName: string;
  /** The unqualified `Tool.name`. */
  name: string;
  /** The full tool definition. */
  tool: Tool;
  provenance: Provenance;
  /** Set to the qualified name of the higher-precedence tool that shadows this one. */
  shadowedBy?: string;
}

export interface ListFilter {
  mode?: "read" | "write";
  kind?: SupplierKind;
  /** Include precedence-shadowed tools. Default `false`. */
  includeShadowed?: boolean;
}

export type RegistryEvent =
  | { type: "tools-added"; tools: ResolvedTool[] }
  | { type: "tools-removed"; qualifiedNames: string[] }
  | { type: "tools-changed"; tools: ResolvedTool[] }
  | { type: "supplier-registered"; supplier: SupplierInfo }
  | { type: "supplier-unregistered"; supplierId: string };

// ---------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------

export interface InvokeOptions {
  /** The agent asserts the user approved a `confirmation: "required"` tool. */
  confirmed?: boolean;
  /** Caller cancellation. */
  signal?: AbortSignal;
  /** Per-call timeout; registry enforces. Default 30_000. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// The global surface
// ---------------------------------------------------------------------------

export interface Articulators {
  /** Protocol version, e.g. `"0.1"`. */
  readonly version: string;
  /** Register a supplier and its initial tool set; returns a scoped handle. */
  register(opts: RegisterOptions): Registration;
  /** The merged, precedence-resolved tool view. Shadowed tools hidden by default. */
  list(filter?: ListFilter): ResolvedTool[];
  /** Invoke a tool by qualified name. Validates args, enforces the confirmation gate. */
  invoke(
    qualifiedName: string,
    args: unknown,
    opts?: InvokeOptions,
  ): Promise<ToolResult>;
  /** Subscribe to registry changes; returns an unsubscribe function. */
  subscribe(listener: (event: RegistryEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// Author-side DX helper (illustrative only)
// ---------------------------------------------------------------------------

/**
 * Convenience for authors who want typed args/data while editing. The runtime
 * contract is still the JSON Schema in `inputSchema`/`outputSchema`.
 */
export type TypedTool<Args = unknown, Data = unknown> = Omit<Tool, "invoke"> & {
  invoke: (
    args: Args,
    ctx: InvocationContext,
  ) => ToolResult<Data> | Promise<ToolResult<Data>>;
};

declare global {
  interface Window {
    articulators: Articulators;
  }
}
