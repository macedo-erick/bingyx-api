import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module';
import { CONFIG, type Config } from './config';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ConfigModule } from './config.module';
import { DatabaseModule } from './database/database.module';
import { EngineModule } from './engine/engine.module';
import { GamesModule } from './games/games.module';
import { HealthModule } from './health/health.module';
import { loggerOptions } from './logging';
import { MeModule } from './me/me.module';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';
import { PlayersModule } from './players/players.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [CONFIG],
      useFactory: (config: Config) => loggerOptions(config),
    }),
    DatabaseModule,
    AuthModule,
    MetricsModule,
    HealthModule,
    GamesModule,
    PlayersModule,
    EngineModule,
    RealtimeModule,
    MeModule,
  ],
  providers: [HttpMetricsMiddleware, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
