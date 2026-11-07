import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import {
  type CreateOrderRequest,
  CreateOrderRequestSchema,
  type CreateOrderResponse,
  type PublicOrder,
  type UpdateOptionsRequest,
  UpdateOptionsRequestSchema,
  type UploadCompleteRequest,
  UploadCompleteRequestSchema,
  type UploadUrlRequest,
  UploadUrlRequestSchema,
  type UploadUrlResponse,
  trackingCookieName,
} from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { CustomerSessionService } from '../../common/auth/customer-session.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { OrdersService } from './orders.service.js';
import { TrackingGuard } from './tracking.guard.js';

/** Anonymous/guest customer until OTP sign-in (P2.2). */
const GUEST: Actor = { type: 'CUSTOMER', id: null };

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly orders: OrdersService,
    private readonly sessions: CustomerSessionService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateOrderRequestSchema)) body: CreateOrderRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateOrderResponse> {
    // Signed-in customers (P2.2) own the order; guests rely on the tracking token alone.
    const session = await this.sessions.fromRequest(req);
    const actor: Actor = session ? { type: 'CUSTOMER', id: session.customerId } : GUEST;
    const result = await this.orders.createDraft(body, actor, session);
    res.cookie(trackingCookieName(result.order.id), result.trackingToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.APP_ENV !== 'local',
      path: `/api/orders/${result.order.id}`,
      maxAge: 30 * 24 * 3600_000,
    });
    return result;
  }

  @Get(':id')
  @UseGuards(TrackingGuard)
  get(@Param('id') id: string): Promise<PublicOrder> {
    return this.orders.getPublic(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  async cancel(@Param('id') id: string, @Req() req: Request): Promise<PublicOrder> {
    const session = await this.sessions.fromRequest(req);
    return this.orders.cancel(id, session ? { type: 'CUSTOMER', id: session.customerId } : GUEST);
  }

  @Patch(':id/options')
  @UseGuards(TrackingGuard)
  updateOptions(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOptionsRequestSchema)) body: UpdateOptionsRequest,
  ): Promise<PublicOrder> {
    return this.orders.updateOptions(id, body.options, GUEST);
  }

  @Post(':id/upload-url')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  uploadUrl(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UploadUrlRequestSchema)) body: UploadUrlRequest,
  ): Promise<UploadUrlResponse> {
    return this.orders.requestUploadUrl(id, body.bytes);
  }

  @Post(':id/upload-complete')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  uploadComplete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UploadCompleteRequestSchema)) body: UploadCompleteRequest,
  ): Promise<PublicOrder> {
    return this.orders.completeUpload(id, body.fileId, GUEST);
  }
}
