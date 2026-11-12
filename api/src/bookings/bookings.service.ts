import { Injectable } from '@nestjs/common';
import { ResourcesService } from '../resources/resources.service.js';
import type { Booking, BookingView } from './booking.entity.js';
import { type Interval, overlaps, parseInterval } from './booking-rules.js';
import { BookingsRepository } from './bookings.repository.js';

export type CreateError =
  'invalid_data' | 'unknown_resource' | 'id_taken' | 'conflict';

export type CreateResult =
  | { ok: true; booking: BookingView }
  | { ok: false; error: Exclude<CreateError, 'conflict'> }
  | { ok: false; error: 'conflict'; conflicts: string[] };

export type CancelResult =
  | { ok: true; result: 'canceled' | 'already_canceled'; booking: BookingView }
  | { ok: false; error: 'not_found' };

export type AvailabilityError = 'invalid_data' | 'unknown_resource' | 'id_taken';

export type Availability = { available: boolean; conflicts: string[] };

export type AvailabilityResult =
  | ({ ok: true } & Availability)
  | { ok: false; error: AvailabilityError };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// A resource id to look up: a non-empty string. Arrays (a repeated query
// param) and NUL fail. Postgres text cannot hold NUL: it would throw a 500
// instead of invalid_data.
function isResourceId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !value.includes('\u0000');
}

// Returns the booking to insert, or null when the body is invalid_data.
export function parseBooking(body: unknown): Booking | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const { id, resource, start, end } = body as Record<string, unknown>;
  const interval = parseInterval(start, end);
  if (
    typeof id !== 'string' ||
    !ID.test(id) ||
    !isResourceId(resource) ||
    interval === null
  ) {
    return null;
  }
  return { id, resource, ...interval, status: 'active' };
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly resources: ResourcesService,
  ) {}

  // Checks run in the order invalid_data, unknown_resource, id_taken,
  // conflict. Every check runs before the insert, so a rejection writes nothing.
  async create(body: unknown): Promise<CreateResult> {
    const booking = parseBooking(body);
    if (!booking) return { ok: false, error: 'invalid_data' };
    const resource = await this.resources.findById(booking.resource);
    if (!resource) return { ok: false, error: 'unknown_resource' };
    if (await this.bookings.findById(booking.id)) {
      return { ok: false, error: 'id_taken' };
    }
    const conflicts = await this.findConflicts(booking.resource, booking);
    if (conflicts.length > 0)
      return { ok: false, error: 'conflict', conflicts };
    // ponytail: check-then-insert is not atomic; concurrency is out of scope (PRD).
    await this.bookings.insert(booking);
    const { id, name } = resource;
    return { ok: true, booking: { ...booking, resource: { id, name } } };
  }

  // An id that fails the pattern cannot exist, so it is not_found without a
  // query (this also keeps NUL away from Postgres). Canceling twice writes once.
  async cancel(id: string): Promise<CancelResult> {
    const booking = ID.test(id)
      ? await this.bookings.findByIdWithResource(id)
      : null;
    if (!booking) return { ok: false, error: 'not_found' };
    if (booking.status === 'canceled') {
      return { ok: true, result: 'already_canceled', booking };
    }
    await this.bookings.setStatus(id, 'canceled');
    return {
      ok: true,
      result: 'canceled',
      booking: { ...booking, status: 'canceled' },
    };
  }

  // Every booking, active and canceled, in ascending id order.
  list(): Promise<BookingView[]> {
    return this.bookings.findAllWithResource();
  }

  // Read-only: checks run in the same order as create (invalid_data,
  // unknown_resource, id_taken when an id is sent, then the conflict lookup).
  // Nothing is written. Takes the raw query values.
  async availability(
    resource: unknown,
    start: unknown,
    end: unknown,
    id?: unknown,
  ): Promise<AvailabilityResult> {
    const interval = parseInterval(start, end);
    const badId = id !== undefined && (typeof id !== 'string' || !ID.test(id));
    if (!isResourceId(resource) || !interval || badId) {
      return { ok: false, error: 'invalid_data' };
    }
    if (!(await this.resources.exists(resource))) {
      return { ok: false, error: 'unknown_resource' };
    }
    if (typeof id === 'string' && (await this.bookings.findById(id))) {
      return { ok: false, error: 'id_taken' };
    }
    const conflicts = await this.findConflicts(resource, interval);
    return { ok: true, available: conflicts.length === 0, conflicts };
  }

  // The one conflict lookup, shared by create and availability so they cannot
  // disagree. Ids keep the repository's ascending id order.
  private async findConflicts(
    resource: string,
    interval: Interval,
  ): Promise<string[]> {
    const active = await this.bookings.findActiveByResource(resource);
    return active
      .filter((other) => overlaps(interval, other))
      .map((other) => other.id);
  }
}
