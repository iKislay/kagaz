import { Controller, Get, HttpStatus, Param, StreamableFile } from '@nestjs/common';
import { AppError } from '../../common/http/api-exception.filter.js';
import { StorageService } from './storage.service.js';

/** Shop app installer + Velopack update feed, uploaded by .github/workflows/shop-agent-release.yml. */
export const SHOP_AGENT_PREFIX = 'downloads/shop-agent/';
const SHOP_AGENT_FILE =
  /^(KagazShop-win-Setup\.exe|KagazShop-win-Portable\.zip|releases\.win\.json|assets\.win\.json|RELEASES|KagazShop-\d+\.\d+\.\d+(-[\w.]+)?-(full|delta)\.nupkg)$/;

/**
 * Public downloads (the Windows shop app), streamed from the private bucket (invariant 11) for an
 * allow-listed file name. Served from api.kaggaz.in itself: redirecting to a presigned
 * *.r2.cloudflarestorage.com URL got the installer blocked by antivirus web shields.
 */
@Controller('downloads')
export class DownloadsController {
  constructor(private readonly storage: StorageService) {}

  @Get('shop-agent/:file')
  async shopAgent(@Param('file') file: string): Promise<StreamableFile> {
    const object = SHOP_AGENT_FILE.test(file)
      ? await this.storage.getStream(SHOP_AGENT_PREFIX + file)
      : null;
    if (!object) {
      throw new AppError('DOWNLOAD_NOT_FOUND', 'File not found', HttpStatus.NOT_FOUND);
    }
    const json = file.endsWith('.json');
    return new StreamableFile(object.body, {
      type: json ? 'application/json' : 'application/octet-stream',
      length: object.bytes,
      disposition: json ? undefined : `attachment; filename="${file}"`,
    });
  }
}
