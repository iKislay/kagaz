import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
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
  type ShopMemberList,
  type ShopMemberRequest,
  ShopMemberRequestSchema,
  type PlaceSearchResponse,
  PlaceSearchQuerySchema,
  type ReversePlaceResponse,
  ReversePlaceQuerySchema,
  type ShopLocationRequest,
  ShopLocationRequestSchema,
  type ShopPricing,
  type ShopPrinter,
  type ShopProfile,
  type UpdateShopPricing,
  UpdateShopPricingSchema,
  type UpdateShopProfile,
  UpdateShopProfileSchema,
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
import { ShopAccountService, requireOwner } from './shop-account.service.js';
import { ShopPrintersService } from './shop-printers.service.js';
import { ShopProfileService } from './shop-profile.service.js';
import { PlacesService } from './places.service.js';
import { RequireOperator } from '../identity/operator-auth.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

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
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly account: ShopAccountService,
    private readonly profile: ShopProfileService,
    private readonly places: PlacesService,
  ) {}

  // ─── Shop profile + first-run setup, by the owner from the app ───

  @Get('profile')
  getProfile(@CurrentDevice() device: DeviceContext): Promise<ShopProfile> {
    return this.profile.get(device);
  }

  @Patch('profile')
  @RequireOperator()
  updateProfile(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(UpdateShopProfileSchema)) body: UpdateShopProfile,
  ): Promise<ShopProfile> {
    return this.profile.update(device, body);
  }

  /** Address suggestions while the owner types, ranked near the shop (or Mandya). */
  @Get('places')
  @RequireOperator()
  async searchPlaces(
    @CurrentDevice() device: DeviceContext,
    @Query(new ZodValidationPipe(PlaceSearchQuerySchema)) query: { q: string },
  ): Promise<PlaceSearchResponse> {
    const { location } = await this.profile.get(device);
    return { places: await this.places.search(query.q, location) };
  }

  /** A suggested address for the PC's current position, for the owner to check and edit. */
  @Get('places/reverse')
  @RequireOperator()
  async reversePlace(
    @Query(new ZodValidationPipe(ReversePlaceQuerySchema)) query: { lat: number; lng: number },
  ): Promise<ReversePlaceResponse> {
    return { address: await this.places.reverse(query.lat, query.lng) };
  }

  @Put('location')
  @RequireOperator()
  setLocation(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(ShopLocationRequestSchema)) body: ShopLocationRequest,
  ): Promise<ShopProfile> {
    return this.profile.setLocation(device, body);
  }

  @Post('profile/complete-setup')
  @RequireOperator()
  @HttpCode(200)
  completeSetup(@CurrentDevice() device: DeviceContext): Promise<ShopProfile> {
    return this.profile.completeSetup(device);
  }

  // ─── Shop logins and prices, managed by the owner from the app ───

  @Get('members')
  @RequireOperator()
  members(@CurrentDevice() device: DeviceContext): Promise<ShopMemberList> {
    requireOwner(device);
    return this.account.members(device);
  }

  @Post('members')
  @RequireOperator()
  @HttpCode(200)
  addMember(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(ShopMemberRequestSchema)) body: ShopMemberRequest,
  ): Promise<ShopMemberList> {
    return this.account.addOperator(device, body);
  }

  @Delete('members/:userId')
  @RequireOperator()
  removeMember(
    @CurrentDevice() device: DeviceContext,
    @Param('userId', Uuid) userId: string,
  ): Promise<ShopMemberList> {
    return this.account.removeOperator(device, userId);
  }

  @Get('pricing')
  async pricing(@CurrentDevice() device: DeviceContext): Promise<ShopPricing | null> {
    return this.account.currentPricing(device);
  }

  @Put('pricing')
  @RequireOperator()
  setPricing(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(UpdateShopPricingSchema)) body: UpdateShopPricing,
  ): Promise<ShopPricing | null> {
    return this.account.setPricing(device, body);
  }

  /** The in-shop "scan to print" QR target: <web>/s/<slug> opens a new order at this shop. */
  @Get('poster')
  async poster(@CurrentDevice() device: DeviceContext): Promise<{ shopName: string; url: string }> {
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: device.shopId },
      select: { name: true, slug: true },
    });
    const web = this.config.PUBLIC_WEB_URL.replace(/\/$/, '');
    return { shopName: shop.name, url: `${web}/s/${shop.slug}` };
  }

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
}
