import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { type BatchError, BookingBatchesService } from './booking-batches.service.js';

const STATUS: Record<BatchError, number> = {
  invalid_data: 422,
  unknown_resource: 404,
  id_taken: 409,
  conflict: 409,
  unavailable: 503,
};

@Controller('booking-batches')
export class BookingBatchesController {
  constructor(private readonly batches: BookingBatchesService) {}

  @Post()
  async create(@Body() body: unknown) {
    const result = await this.batches.create(body);
    if (result.ok) return { bookings: result.bookings };
    const { ok: _, ...failure } = result;
    throw new HttpException(failure, STATUS[result.error]);
  }
}
