import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
import QRCode from 'qrcode';
import { type ShopSummary, shopOrderPath } from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { ShopsService } from './shops.service.js';

/** Public URL a shop's QR code encodes: `<PUBLIC_WEB_URL>/s/<slug>`. */
export function shopOrderUrl(config: Pick<AppConfig, 'PUBLIC_WEB_URL'>, slug: string): string {
  return `${config.PUBLIC_WEB_URL.replace(/\/+$/, '')}${shopOrderPath(slug)}`;
}

/**
 * Public, cacheable image headers. Helmet's default `Cross-Origin-Resource-Policy: same-origin`
 * would stop the website (another origin) from showing the QR, so these images opt out.
 */
function sendImage(res: Response, type: string, body: Buffer | string): void {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.type(type).send(body);
}

const qrSize = (raw?: string) => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 128), 2048) : 640;
};

@Controller('shops')
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async list(): Promise<{ shops: ShopSummary[] }> {
    return { shops: await this.shops.listPublic() };
  }

  /**
   * The shop's QR code (public): it opens a new order at this shop. Used by the shop app's
   * "Shop QR" page and the printable poster. `?size=` in pixels (128–2048, default 640).
   */
  @Get(':slug/qr.png')
  async qrPng(
    @Param('slug') slug: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const shop = await this.shops.requireBySlug(slug);
    const png = await QRCode.toBuffer(shopOrderUrl(this.config, shop.slug), {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: qrSize(size),
    });
    sendImage(res, 'image/png', png);
  }

  @Get(':slug/qr.svg')
  async qrSvg(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const shop = await this.shops.requireBySlug(slug);
    const svg = await QRCode.toString(shopOrderUrl(this.config, shop.slug), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
    });
    sendImage(res, 'image/svg+xml', svg);
  }
}
