import { type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/http/api-exception.filter.js';
import { StaffAuthGuard, type StaffRequest } from '../../identity/staff-session.js';

/**
 * Platform-admin-only routes. Authenticates the staff session (httpOnly `kgz_admin` cookie or
 * Bearer token) and requires role ADMIN; signed-in owners/operators get 403 FORBIDDEN.
 * Routes owners may use combine StaffAuthGuard + RolesGuard + ShopScopeGuard instead.
 */
@Injectable()
export class AdminAuthGuard extends StaffAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (req.staff?.role !== 'ADMIN') {
      throw new AppError('FORBIDDEN', 'Platform admin access required', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
