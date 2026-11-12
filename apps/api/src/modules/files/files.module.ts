import { Module } from '@nestjs/common';
import { DownloadsController } from './downloads.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [DownloadsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class FilesModule {}
