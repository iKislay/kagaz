import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import {
  type AcceptJobRequest,
  AcceptJobRequestSchema,
  type LeaseResponse,
  MarkReadyRequestSchema,
  type OrderStatus,
  OrderStatusSchema,
  type PrintStatusReport,
  PrintStatusReportSchema,
  type RegisterPrintersRequest,
  RegisterPrintersRequestSchema,
  type RejectJobRequest,
  RejectJobRequestSchema,
  type ResolveJobRequest,
  ResolveJobRequestSchema,
  type ShopJob,
  type ShopJobDetail,
  type ShopPrinter,
  type VerifyPickupRequest,
  VerifyPickupRequestSchema,
  type VerifyPickupResponse,
} from '@kagaz/shared';
import { AgentVersionGuard } from '../../common/auth/agent-version.guard.js';
import {
  CurrentDevice,
  DeviceAuthGuard,
  type DeviceContext,
} from '../../common/auth/device-auth.guard.js';
import {
  IdempotencyInterceptor,
  SkipIdempotency,
} from '../../common/http/idempotency.interceptor.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { PrintJobsService } from './print-jobs.service.js';
import { ShopJobsService } from './shop-jobs.service.js';
import { ShopPrintersService } from './shop-printers.service.js';
import { RequireOperator } from '../identity/operator-auth.guard.js';

const Uuid = new ZodValidationPipe(z.uuid());
const StatusList = new ZodValidationPipe(
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
    .pipe(z.array(OrderStatusSchema).optional()),
);

/**
 * Shop / device API (PRD §11.2) for the Windows app. The shop is always the authenticated
 * device's shop — no route takes a shop id. Agents below MIN_AGENT_VERSION get 426;
 * mutating calls honour `Idempotency-Key` (P2.1).
 */
@Controller('shop')
@UseGuards(DeviceAuthGuard, AgentVersionGuard)
@UseInterceptors(IdempotencyInterceptor)
export class ShopController {
  constructor(
    private readonly jobs: ShopJobsService,
    private readonly printJobs: PrintJobsService,
    private readonly printers: ShopPrintersService,
  ) {}

  @Get('jobs')
  async listJobs(
    @CurrentDevice() device: DeviceContext,
    @Query('status', StatusList) status?: OrderStatus[],
  ): Promise<{ jobs: ShopJob[] }> {
    return { jobs: await this.jobs.list(device, status) };
  }

  @Get('jobs/:orderId')
  job(
    @CurrentDevice() device: DeviceContext,
    @Param('orderId', Uuid) orderId: string,
  ): Promise<ShopJobDetail> {
    return this.jobs.detail(device, orderId);
  }

  @Post('jobs/:orderId/accept')
  @RequireOperator()
  @HttpCode(200)
  accept(
    @CurrentDevice() device: DeviceContext,
    @Param('orderId', Uuid) orderId: string,
    @Body(new ZodValidationPipe(AcceptJobRequestSchema)) body: AcceptJobRequest,
  ): Promise<ShopJob> {
    return this.jobs.accept(device, orderId, body.printerId);
  }

  @Post('jobs/:orderId/reject')
  @RequireOperator()
  @HttpCode(200)
  reject(
    @CurrentDevice() device: DeviceContext,
    @Param('orderId', Uuid) orderId: string,
    @Body(new ZodValidationPipe(RejectJobRequestSchema)) body: RejectJobRequest,
  ): Promise<ShopJob> {
    return this.jobs.reject(device, orderId, body);
  }

  @Post('jobs/:orderId/ready')
  @RequireOperator()
  @HttpCode(200)
  ready(
    @CurrentDevice() device: DeviceContext,
    @Param('orderId', Uuid) orderId: string,
    @Body(new ZodValidationPipe(MarkReadyRequestSchema)) _body: unknown,
  ): Promise<ShopJob> {
    return this.jobs.markReady(device, orderId);
  }

  /** Needs-check resolution (contract §2): CONFIRM_PRINTED | REPRINT | MARK_FAILED. */
  @Post('jobs/:orderId/resolve')
  @RequireOperator()
  @HttpCode(200)
  resolve(
    @CurrentDevice() device: DeviceContext,
    @Param('orderId', Uuid) orderId: string,
    @Body(new ZodValidationPipe(ResolveJobRequestSchema)) body: ResolveJobRequest,
  ): Promise<ShopJobDetail> {
    return this.jobs.resolve(device, orderId, body);
  }

  /** Not stored for replay: the response holds a signed URL; re-lease by the holder is safe. */
  @Post('print-jobs/:id/lease')
  @HttpCode(200)
  @SkipIdempotency()
  lease(
    @CurrentDevice() device: DeviceContext,
    @Param('id', Uuid) id: string,
  ): Promise<LeaseResponse> {
    return this.printJobs.lease(device, id);
  }

  @Post('print-jobs/:id/status')
  @HttpCode(200)
  status(
    @CurrentDevice() device: DeviceContext,
    @Param('id', Uuid) id: string,
    @Body(new ZodValidationPipe(PrintStatusReportSchema)) body: PrintStatusReport,
  ): Promise<ShopJob> {
    return this.printJobs.report(device, id, body);
  }

  @Get('printers')
  listPrinters(@CurrentDevice() device: DeviceContext): Promise<ShopPrinter[]> {
    return this.printers.list(device);
  }

  @Put('printers')
  @RequireOperator()
  registerPrinters(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(RegisterPrintersRequestSchema)) body: RegisterPrintersRequest,
  ): Promise<ShopPrinter[]> {
    return this.printers.register(device, body);
  }

  @Post('pickups/verify')
  @RequireOperator()
  @HttpCode(200)
  verifyPickup(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(VerifyPickupRequestSchema)) body: VerifyPickupRequest,
  ): Promise<VerifyPickupResponse> {
    return this.jobs.verifyPickup(device, body.code);
  }
}
