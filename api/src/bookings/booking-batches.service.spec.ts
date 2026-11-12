import { DataSource } from 'typeorm';
import type { Booking } from './booking.entity.js';
import { BookingsRepository } from './bookings.repository.js';
import { ResourcesService } from '../resources/resources.service.js';
import { BookingBatchesService } from './booking-batches.service.js';

describe('BookingBatchesService', () => {
  const findById = vi.fn();
  const findActiveByResource = vi.fn();
  const findResource = vi.fn();
  const insert = vi.fn();
  const transaction = vi.fn();
  const a = { id: 'A', resource: 'R1', start: 10, end: 20 };
  const b = { id: 'B', resource: 'R1', start: 20, end: 30 };
  let service: BookingBatchesService;

  beforeEach(() => {
    for (const fn of [findById, findActiveByResource, findResource, insert, transaction]) fn.mockReset();
    findById.mockResolvedValue(null);
    findActiveByResource.mockResolvedValue([]);
    findResource.mockImplementation(async (id: string) => ({ id, name: `Room ${id}` }));
    insert.mockResolvedValue(undefined);
    transaction.mockImplementation(async (work: (manager: unknown) => Promise<unknown>) =>
      work({ getRepository: () => ({ insert }) }));
    service = new BookingBatchesService(
      { findById, findActiveByResource, insert } as unknown as BookingsRepository,
      { findById: findResource } as unknown as ResourcesService,
      { transaction } as unknown as DataSource,
    );
  });

  it('creates adjacent bookings and returns their views in input order', async () => {
    expect(await service.create({ bookings: [b, a] })).toEqual({
      ok: true,
      bookings: [b, a].map((booking) => ({ ...booking, status: 'active', resource: { id: 'R1', name: 'Room R1' } })),
    });
  });

  it.each([null, [], {}, { bookings: [] }, { bookings: Array(11).fill(a) }])('rejects an invalid envelope %j', async (body) => {
    expect(await service.create(body)).toMatchObject({ ok: false, error: 'invalid_data' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('validates every item before inserting', async () => {
    expect(await service.create({ bookings: [a, { ...b, end: 20 }] })).toEqual({ ok: false, error: 'invalid_data', index: 1 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects an unknown resource without writing the earlier item', async () => {
    findResource.mockImplementation(async (id: string) => id === 'R1' ? { id, name: 'Room R1' } : null);
    expect(await service.create({ bookings: [a, { ...b, resource: 'R9' }] })).toEqual({ ok: false, error: 'unknown_resource', index: 1 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('keeps an id taken after cancellation', async () => {
    findById.mockResolvedValue({ ...a, status: 'canceled' });
    expect(await service.create({ bookings: [a] })).toEqual({ ok: false, error: 'id_taken', index: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('reports conflicts with stored bookings without writing', async () => {
    findActiveByResource.mockResolvedValue([{ ...a, id: 'Z', status: 'active' } satisfies Booking]);
    expect(await service.create({ bookings: [a] })).toEqual({ ok: false, error: 'conflict', index: 0, conflicts: ['Z'] });
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns unavailable when the insert fails', async () => {
    insert.mockRejectedValue(new Error('connection lost'));
    expect(await service.create({ bookings: [a] })).toEqual({ ok: false, error: 'unavailable', index: 0 });
  });
});
