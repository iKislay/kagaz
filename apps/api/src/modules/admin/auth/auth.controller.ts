import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type AdminLoginRequest, AdminLoginRequestSchema, AdminMeSchema } from '@kagaz/shared';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CurrentStaff, StaffAuthGuard, type StaffContext } from '../../identity/staff-session.js';
import { AdminAuthService } from './auth.service.js';

/**
 * Staff web authentication (PRD §11.3, P2.3).
 * Session is an httpOnly `kgz_admin` cookie holding a HS256 JWT (12 h).
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(AdminLoginRequestSchema)) body: AdminLoginRequest,
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
  @UseGuards(StaffAuthGuard)
  async me(@CurrentStaff() staff: StaffContext) {
    return AdminMeSchema.parse(await this.auth.me(staff.userId));
  }
}
