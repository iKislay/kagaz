import { Controller, Get, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { OrdersService } from './orders.service.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import {
  type AdminOrdersQuery,
  AdminOrdersQuerySchema,
  AdminOrderListSchema,
  AdminOrderDetailSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';

/** Admin order search and detail (PRD §11.3, FR-ADMIN-07). */
@Controller('admin/orders')
@UseGuards(AdminAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(AdminOrdersQuerySchema)) query: AdminOrdersQuery) {
    return AdminOrderListSchema.parse(await this.orders.list(query));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const detail = await this.orders.detail(id);
    if (!detail) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    }
    return AdminOrderDetailSchema.parse(detail);
  }
}
