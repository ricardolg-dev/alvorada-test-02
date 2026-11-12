import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ResourcesService } from '../resources/resources.service.js';
import type { Booking, BookingView } from './booking.entity.js';
import { overlaps } from './booking-rules.js';
import { BookingsRepository } from './bookings.repository.js';
import { type CreateError, parseBooking } from './bookings.service.js';

export type BatchError = CreateError | 'unavailable';
export type BatchResult =
  | { ok: true; bookings: BookingView[] }
  | { ok: false; error: BatchError; index?: number; conflicts?: string[] };

@Injectable()
export class BookingBatchesService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly resources: ResourcesService,
    private readonly database: DataSource,
  ) {}

  async create(body: unknown): Promise<BatchResult> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { ok: false, error: 'invalid_data' };
    }
    const raw = (body as Record<string, unknown>).bookings;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) {
      return { ok: false, error: 'invalid_data' };
    }

    const parsed: Booking[] = [];
    for (const [index, item] of raw.entries()) {
      const booking = parseBooking(item);
      if (!booking) return { ok: false, error: 'invalid_data', index };
      parsed.push(booking);
    }

    const views: BookingView[] = [];
    for (const [index, booking] of parsed.entries()) {
      try {
        const resource = await this.resources.findById(booking.resource);
        if (!resource) return { ok: false, error: 'unknown_resource', index };
        if (await this.bookings.findById(booking.id)) {
          return { ok: false, error: 'id_taken', index };
        }
        const active = await this.bookings.findActiveByResource(booking.resource);
        const conflicts = active.filter((other) => overlaps(booking, other)).map((other) => other.id);
        if (conflicts.length > 0) {
          return { ok: false, error: 'conflict', index, conflicts };
        }
        views.push({ ...booking, resource: { id: resource.id, name: resource.name } });
      } catch {
        return { ok: false, error: 'unavailable', index };
      }
    }

    let index = 0;
    try {
      await this.database.transaction(async () => {
        for (const booking of parsed) {
          await this.bookings.insert(booking);
          index += 1;
        }
      });
      return { ok: true, bookings: views };
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      return { ok: false, error: code === '23505' ? 'id_taken' : 'unavailable', index };
    }
  }
}
