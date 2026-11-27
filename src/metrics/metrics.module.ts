import { Module } from '@nestjs/common';
import { PrometheusModule, makeHistogramProvider } from '@willsoto/nestjs-prometheus';

export const HTTP_REQUEST_DURATION = 'http_request_duration_seconds';

const metrics = [
  makeHistogramProvider({
    name: HTTP_REQUEST_DURATION,
    help: 'HTTP request latency, by route template and response status.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  }),
];

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultLabels: { app: 'bingyx-api' },
    }),
  ],
  providers: metrics,
  exports: [PrometheusModule, ...metrics],
})
export class MetricsModule {}
