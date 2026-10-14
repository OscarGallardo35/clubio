import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { MemoriaCacheService } from './memoria-cache.service';

@Global()
@Module({
  providers: [RedisService, MemoriaCacheService],
  exports: [RedisService, MemoriaCacheService],
})
export class RedisModule {}
