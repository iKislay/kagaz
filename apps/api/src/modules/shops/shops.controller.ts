import { Controller, Get } from '@nestjs/common';
import { type ShopSummary } from '@kagaz/shared';
import { ShopsService } from './shops.service.js';

@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get()
  async list(): Promise<{ shops: ShopSummary[] }> {
    return { shops: await this.shops.listPublic() };
  }
}
