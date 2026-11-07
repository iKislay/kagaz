import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import { type Response } from 'express';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './auth.service.js';
import { AdminLoginRequestSchema } from '@kagaz/shared';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';

/**
 * Admin authentication endpoints (PRD §11.3).
 * Session is an httpOnly `kgz_admin` cookie holding a HS256 JWT (12 h).
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(AdminLoginRequestSchema)) body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? '';
    const { cookie, admin } = await this.auth.login(body, ip);
    res.setHeader('Set-Cookie', cookie);
    return { admin };
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', this.auth.logoutCookie());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@Req() req: Request & { admin?: { userId: string } }) {
    return this.auth.me(req.admin!.userId);
  }
}
