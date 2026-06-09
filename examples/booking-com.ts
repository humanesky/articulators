/**
 * Worked example: a first-party Booking.com articulator.
 *
 * Illustrative. Shows the read/write split, the confirmation gate on
 * consequential writes, typed errors returned as ToolResult (not thrown), and
 * the SPA pattern (registration.set on navigation). The internal API calls
 * (bookingApi.*) stand in for the site's own first-party data access — the
 * whole point is that a first-party articulator reaches the structured model
 * directly instead of scraping the DOM or screenshotting the page.
 */

import type {
  Registration,
  Tool,
  ToolResult,
} from "../types/articulators";

// --- Stand-in for the site's own internal API (first-party privilege) --------

interface HotelSummary {
  hotelId: string;
  name: string;
  rating: number;
  priceFrom: number;
  currency: string;
  thumbnailUrl: string;
}

interface Offer {
  offerId: string;
  hotelId: string;
  totalPrice: number;
  currency: string;
  cancellationPolicy: string;
  expiresAt: string;
}

interface BookingRecord {
  bookingId: string;
  hotelId: string;
  status: "upcoming" | "past" | "cancelled";
}

declare const bookingApi: {
  isLoggedIn(): boolean;
  searchHotels(q: Record<string, unknown>): Promise<HotelSummary[]>;
  getOffer(q: Record<string, unknown>): Promise<Offer | null>;
  listBookings(status?: string): Promise<BookingRecord[]>;
  createBooking(q: Record<string, unknown>): Promise<BookingRecord>;
  cancelBooking(bookingId: string, reason?: string): Promise<BookingRecord>;
};

// --- Tools -------------------------------------------------------------------

const searchHotels: Tool = {
  name: "searchHotels",
  title: "Search hotels",
  description:
    "Search available hotels for a destination and date range. Returns a ranked list with nightly prices.",
  inputSchema: {
    type: "object",
    required: ["destination", "checkIn", "checkOut", "guests"],
    properties: {
      destination: { type: "string" },
      checkIn: { type: "string", format: "date" },
      checkOut: { type: "string", format: "date" },
      guests: { type: "integer", minimum: 1 },
      rooms: { type: "integer", minimum: 1 },
      priceMax: { type: "number" },
      currency: { type: "string" },
    },
  },
  outputSchema: {
    type: "object",
    properties: { hotels: { type: "array" } },
  },
  effects: { mode: "read", idempotent: true, confirmation: "none" },
  async invoke(args): Promise<ToolResult> {
    const hotels = await bookingApi.searchHotels(args as Record<string, unknown>);
    return { ok: true, data: { hotels }, text: `Found ${hotels.length} hotels.` };
  },
};

const getOffer: Tool = {
  name: "getOffer",
  title: "Get offer",
  description:
    "Get a bookable offer (price, cancellation policy, expiry) for a specific hotel and dates. The returned offerId feeds createBooking.",
  inputSchema: {
    type: "object",
    required: ["hotelId", "checkIn", "checkOut", "guests"],
    properties: {
      hotelId: { type: "string" },
      checkIn: { type: "string", format: "date" },
      checkOut: { type: "string", format: "date" },
      guests: { type: "integer", minimum: 1 },
    },
  },
  effects: { mode: "read", idempotent: true, confirmation: "none" },
  async invoke(args): Promise<ToolResult> {
    const offer = await bookingApi.getOffer(args as Record<string, unknown>);
    if (!offer) {
      return {
        ok: false,
        error: { code: "not_found", message: "No offer available for those dates." },
      };
    }
    return { ok: true, data: offer };
  },
};

const listMyBookings: Tool = {
  name: "listMyBookings",
  title: "List my bookings",
  description: "List the signed-in user's reservations, optionally filtered by status.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["upcoming", "past", "cancelled"] },
    },
  },
  effects: { mode: "read", idempotent: true, confirmation: "none", scopes: ["personal-data"] },
  async invoke(args): Promise<ToolResult> {
    if (!bookingApi.isLoggedIn()) {
      // Typed error returned as a result, not thrown.
      return {
        ok: false,
        error: { code: "unauthorized", message: "Sign in to view your bookings." },
      };
    }
    const { status } = args as { status?: string };
    const bookings = await bookingApi.listBookings(status);
    return { ok: true, data: { bookings } };
  },
};

const createBooking: Tool = {
  name: "createBooking",
  title: "Create booking",
  description:
    "Reserve a room from a previously fetched offer. Charges the selected payment method.",
  inputSchema: {
    type: "object",
    required: ["offerId", "guest", "paymentMethodId"],
    properties: {
      offerId: { type: "string" },
      guest: {
        type: "object",
        required: ["firstName", "lastName", "email"],
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string", format: "email" },
        },
      },
      paymentMethodId: { type: "string" },
    },
  },
  effects: {
    mode: "write",
    idempotent: false,
    confirmation: "required",
    scopes: ["write", "payment", "personal-data"],
    consequences:
      "Charges your saved payment method and reserves the room. Subject to the offer's cancellation policy.",
  },
  async invoke(args, ctx): Promise<ToolResult> {
    // Defense in depth: the trusted registry already enforces the gate, but a
    // consequential write double-checks it was confirmed.
    if (!ctx.confirmed) {
      return {
        ok: false,
        error: { code: "confirmation_required", message: "Booking requires explicit confirmation." },
      };
    }
    try {
      const booking = await bookingApi.createBooking(args as Record<string, unknown>);
      return { ok: true, data: booking, text: `Booked. Confirmation ${booking.bookingId}.` };
    } catch {
      return {
        ok: false,
        error: { code: "conflict", message: "That offer has expired. Fetch a fresh offer and retry.", retriable: true },
      };
    }
  },
};

const cancelBooking: Tool = {
  name: "cancelBooking",
  title: "Cancel booking",
  description: "Cancel an existing reservation. Refunds follow the cancellation policy.",
  inputSchema: {
    type: "object",
    required: ["bookingId"],
    properties: {
      bookingId: { type: "string" },
      reason: { type: "string" },
    },
  },
  effects: {
    mode: "write",
    idempotent: true, // re-cancelling a cancelled booking is a no-op
    destructive: true,
    confirmation: "required",
    scopes: ["write"],
    consequences:
      "Cancels the reservation. Refund depends on the cancellation policy and may be partial or none.",
  },
  async invoke(args, ctx): Promise<ToolResult> {
    if (!ctx.confirmed) {
      return {
        ok: false,
        error: { code: "confirmation_required", message: "Cancellation requires explicit confirmation." },
      };
    }
    const { bookingId, reason } = args as { bookingId: string; reason?: string };
    const booking = await bookingApi.cancelBooking(bookingId, reason);
    return { ok: true, data: booking };
  },
};

// --- Registration ------------------------------------------------------------

const reg: Registration = window.articulators.register({
  supplier: {
    kind: "first-party",
    id: "https://www.booking.com",
    title: "Booking.com",
    version: "2026.6.0",
  },
  // Base tools available everywhere on the site.
  tools: [searchHotels, getOffer, listMyBookings, createBooking],
});

// --- SPA pattern: add context-specific tools on navigation -------------------
//
// When the user navigates into a specific booking's detail view, expose
// cancelBooking (and any other detail-scoped tools). The registry diffs the new
// set against the old and emits `tools-added`; navigating away calls set() again
// to drop them. The page is responsible for keeping its tool set in sync with
// app state.
function onEnterBookingDetail(): void {
  reg.set([searchHotels, getOffer, listMyBookings, createBooking, cancelBooking]);
}

function onLeaveBookingDetail(): void {
  reg.set([searchHotels, getOffer, listMyBookings, createBooking]);
}

export { onEnterBookingDetail, onLeaveBookingDetail };
