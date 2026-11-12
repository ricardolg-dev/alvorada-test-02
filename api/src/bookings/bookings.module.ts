import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResourcesModule } from '../resources/resources.module.js';
import { Booking } from './booking.entity.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';
import { BookingBatchesController } from './booking-batches.controller.js';
import { BookingBatchesService } from './booking-batches.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Booking]), ResourcesModule],
  controllers: [BookingsController, BookingBatchesController],
  providers: [BookingsService, BookingsRepository, BookingBatchesService],
})
export class BookingsModule {}
