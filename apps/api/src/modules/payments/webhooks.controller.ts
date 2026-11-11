import { Controller, HttpCode, Param, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { type Request } from 'express';
import { type WebhookAck } from '@kagaz/shared';
import { WebhooksService } from './webhooks.service.js';

/** POST /api/webhooks/:provider — raw-body webhook (P3.3). Requires `rawBody: true` at boot. */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':provider')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<WebhookAck> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
      else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(', ');
    }
    return this.webhooks.receive(provider, req.rawBody, headers);
  }
}
