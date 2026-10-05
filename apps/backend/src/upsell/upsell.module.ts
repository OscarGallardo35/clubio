import { Module } from '@nestjs/common';
import { UpsellService } from './upsell.service';
import { MotorUpsellService } from './motor-upsell.service';
import { UpsellController } from './upsell.controller';

@Module({
  controllers: [UpsellController],
  providers: [UpsellService, MotorUpsellService],
  exports: [UpsellService, MotorUpsellService],
})
export class UpsellModule {}