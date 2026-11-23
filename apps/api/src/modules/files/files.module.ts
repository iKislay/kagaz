import { Module } from '@nestjs/common';
import { CombinedDocumentService } from './combined-document.service.js';
import { DownloadsController } from './downloads.controller.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [DownloadsController],
  providers: [StorageService, CombinedDocumentService],
  exports: [StorageService, CombinedDocumentService],
})
export class FilesModule {}
