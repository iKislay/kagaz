import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type ShopMemberRole,
  type SudoAdmin,
  type SudoAdminCreateRequest,
  type SudoAdminCreated,
  type SudoMember,
  type SudoMemberCreateRequest,
  type SudoMemberCreated,
  type SudoPasswordReset,
} from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { auditStaffAction } from '../admin/admin-audit.js';
import { SuperAdminService } from '../admin/auth/super-admin.service.js';
import { type StaffContext } from '../identity/staff-session.js';
import { findOrCreateStaffUser, passwordFor } from './accounts.js';

const TX_OPTS = { timeout: 15_000 }; // Argon2 hashing runs inside the transaction.

/**
 * Accounts managed from /sudoadmin: shop team members (owners/operators) and Kagaz platform
 * admins. Passwords are set by the admin or generated and returned once; they are never logged
 * or audited. Removing someone also ends their shop-app operator sessions (web sessions stop
 * working on the next request because roles are re-read from the DB).
 *
 * Error codes: SHOP_NOT_FOUND, MEMBER_NOT_FOUND, MEMBER_EXISTS, ACCOUNT_CONFLICT,
 * ACCOUNT_IS_ADMIN, EMAIL_TAKEN, ADMIN_NOT_FOUND, CANNOT_REMOVE_SELF, LAST_ADMIN,
 * SUPERADMIN_MANAGED.
 */
@Injectable()
export class SudoAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  // ─── Shop team ───

  async addMember(
    staff: StaffContext,
    shopId: string,
    req: SudoMemberCreateRequest,
  ): Promise<SudoMemberCreated> {
    const { role, ...account } = req;
    return this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { id: true } });
      if (!shop) throw shopNotFound();
      const result = await findOrCreateStaffUser(tx, account);
      const already = await tx.shopUser.findUnique({
        where: { shopId_userId: { shopId, userId: result.user.id } },
      });
      if (already) {
        throw new AppError(
          'MEMBER_EXISTS',
          'This person is already on the shop’s team',
          HttpStatus.CONFLICT,
        );
      }
      const member = await tx.shopUser.create({ data: { shopId, userId: result.user.id, role } });
      await auditStaffAction(tx, staff, 'sudo.member.added', shopId, {
        userId: result.user.id,
        role,
        existingUser: result.existingUser,
      });
      return {
        member: {
          userId: result.user.id,
          name: result.user.name,
          email: result.user.email,
          phone: result.user.phone,
          role,
          hasPassword: !!result.user.passwordHash,
          joinedAt: member.createdAt.toISOString(),
        },
        existingUser: result.existingUser,
        temporaryPassword: result.temporaryPassword,
      };
    }, TX_OPTS);
  }

  async updateMemberRole(
    staff: StaffContext,
    shopId: string,
    userId: string,
    role: ShopMemberRole,
  ): Promise<SudoMember> {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.shopUser.findUnique({
        where: { shopId_userId: { shopId, userId } },
        include: { user: true },
      });
      if (!member) throw memberNotFound();
      if (member.role !== role) {
        await tx.shopUser.update({ where: { id: member.id }, data: { role } });
        await auditStaffAction(tx, staff, 'sudo.member.role_changed', shopId, {
          userId,
          from: member.role,
          to: role,
        });
      }
      return {
        userId,
        name: member.user.name,
        email: member.user.email,
        phone: member.user.phone,
        role,
        hasPassword: !!member.user.passwordHash,
        joinedAt: member.createdAt.toISOString(),
      };
    });
  }

  async resetMemberPassword(
    staff: StaffContext,
    shopId: string,
    userId: string,
    password: string | undefined,
  ): Promise<SudoPasswordReset> {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.shopUser.findUnique({
        where: { shopId_userId: { shopId, userId } },
      });
      if (!member) throw memberNotFound();
      const pw = await passwordFor(password);
      await tx.user.update({ where: { id: userId }, data: { passwordHash: pw.hash } });
      const sessions = await tx.operatorSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditStaffAction(tx, staff, 'sudo.member.password_reset', shopId, {
        userId,
        generated: pw.temporary !== null,
        operatorSessionsEnded: sessions.count,
      });
      return { temporaryPassword: pw.temporary };
    }, TX_OPTS);
  }

  async removeMember(staff: StaffContext, shopId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.shopUser.findUnique({
        where: { shopId_userId: { shopId, userId } },
      });
      if (!member) throw memberNotFound();
      await tx.shopUser.delete({ where: { id: member.id } });
      const sessions = await tx.operatorSession.updateMany({
        where: { userId, shopId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditStaffAction(tx, staff, 'sudo.member.removed', shopId, {
        userId,
        role: member.role,
        operatorSessionsEnded: sessions.count,
      });
    });
  }

  // ─── Platform admins ───

  async listAdmins(staff: StaffContext): Promise<SudoAdmin[]> {
    const admins = await this.prisma.user.findMany({
      where: { kind: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    return admins.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone,
      createdAt: a.createdAt.toISOString(),
      isSelf: a.id === staff.userId,
      managedByEnv: this.superAdmin.isSuperAdmin(a),
    }));
  }

  async createAdmin(staff: StaffContext, req: SudoAdminCreateRequest): Promise<SudoAdminCreated> {
    const email = req.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email } })) {
        throw new AppError(
          'EMAIL_TAKEN',
          'An account with this email already exists',
          HttpStatus.CONFLICT,
        );
      }
      const pw = await passwordFor(req.password);
      const user = await tx.user.create({
        data: { email, name: req.name, kind: 'ADMIN', passwordHash: pw.hash },
      });
      await auditStaffAction(tx, staff, 'sudo.admin.created', null, { userId: user.id });
      return {
        admin: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          createdAt: user.createdAt.toISOString(),
          isSelf: false,
          managedByEnv: false,
        },
        temporaryPassword: pw.temporary,
      };
    }, TX_OPTS);
  }

  async resetAdminPassword(
    staff: StaffContext,
    userId: string,
    password: string | undefined,
  ): Promise<SudoPasswordReset> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user?.kind !== 'ADMIN') throw adminNotFound();
      if (this.superAdmin.isSuperAdmin(user)) throw superAdminManaged();
      const pw = await passwordFor(password);
      await tx.user.update({ where: { id: userId }, data: { passwordHash: pw.hash } });
      await auditStaffAction(tx, staff, 'sudo.admin.password_reset', null, {
        userId,
        generated: pw.temporary !== null,
      });
      return { temporaryPassword: pw.temporary };
    }, TX_OPTS);
  }

  /** Revokes admin rights (the account stays, without a password). Never yourself or the last. */
  async removeAdmin(staff: StaffContext, userId: string): Promise<void> {
    if (userId === staff.userId) {
      throw new AppError(
        'CANNOT_REMOVE_SELF',
        'You can’t remove your own admin access',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user?.kind !== 'ADMIN') throw adminNotFound();
      if (this.superAdmin.isSuperAdmin(user)) throw superAdminManaged();
      const admins = await tx.user.count({ where: { kind: 'ADMIN' } });
      if (admins <= 1) {
        throw new AppError('LAST_ADMIN', 'Kagaz needs at least one admin', HttpStatus.CONFLICT);
      }
      await tx.user.update({
        where: { id: userId },
        data: { kind: 'CUSTOMER', passwordHash: null },
      });
      await auditStaffAction(tx, staff, 'sudo.admin.removed', null, { userId });
    });
  }
}

function shopNotFound(): AppError {
  return new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
}
function memberNotFound(): AppError {
  return new AppError('MEMBER_NOT_FOUND', 'Team member not found', HttpStatus.NOT_FOUND);
}
function superAdminManaged(): AppError {
  return new AppError(
    'SUPERADMIN_MANAGED',
    'The superadmin is set in the server’s .env (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD); change it there',
    HttpStatus.CONFLICT,
  );
}
function adminNotFound(): AppError {
  return new AppError('ADMIN_NOT_FOUND', 'Admin not found', HttpStatus.NOT_FOUND);
}
