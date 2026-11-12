import { Controller, Get, HttpStatus, Param, Redirect } from '@nestjs/common';
import { AppError } from '../../common/http/api-exception.filter.js';
import { StorageService } from './storage.service.js';

/** Shop app installer + Velopack update feed, uploaded by .github/workflows/shop-agent-release.yml. */
export const SHOP_AGENT_PREFIX = 'downloads/shop-agent/';
const SHOP_AGENT_FILE =
  /^(KagazShop-win-Setup\.exe|KagazShop-win-Portable\.zip|releases\.win\.json|assets\.win\.json|RELEASES|KagazShop-\d+\.\d+\.\d+(-[\w.]+)?-(full|delta)\.nupkg)$/;

/**
 * Public downloads (the Windows shop app). The bucket stays private (CLAUDE.md invariant 11):
 * each request is redirected to a short-lived signed URL for an allow-listed file name.
 */
@Controller('downloads')
export class DownloadsController {
  constructor(private readonly storage: StorageService) {}

  @Get('shop-agent/:file')
  @Redirect()
  async shopAgent(@Param('file') file: string): Promise<{ url: string; statusCode: number }> {
    const key = SHOP_AGENT_PREFIX + file;
    if (!SHOP_AGENT_FILE.test(file) || !(await this.storage.head(key))) {
      throw new AppError('DOWNLOAD_NOT_FOUND', 'File not found', HttpStatus.NOT_FOUND);
    }
    const { url } = await this.storage.createDownloadUrl(key, 300);
    return { url, statusCode: HttpStatus.FOUND };
  }
}
