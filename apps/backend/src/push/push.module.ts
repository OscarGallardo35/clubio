import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PushService, COLA_PUSH } from './push.service';
import { PushProcessor } from './push.processor';
import { PushScheduler } from './push.scheduler';
import { PushController } from './push.controller';

@Module({
  imports: [BullModule.registerQueue({ name: COLA_PUSH })],
  controllers: [PushController],
  providers: [PushService, PushProcessor, PushScheduler],
  exports: [PushService],
})
export class PushModule {}