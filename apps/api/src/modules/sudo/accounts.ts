import { HttpStatus } from '@nestjs/common';
import { type SudoAccountRequest } from '@kagaz/shared';
import { randomCode } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { type Prisma, type User } from '../../generated/prisma/client.js';
import { hashPassword } from '../identity/passwords.js';
import { type Tx } from '../orders/order-state-machine.js';
import { TEMP_PASSWORD_ALPHABET } from './billing.js';

/** e.g. "kf7Q-m2Xp-9hTa". Returned to the admin exactly once; never stored or audited. */
export function temporaryPassword(): string {
  const raw = randomCode(12, TEMP_PASSWORD_ALPHABET);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Hash of the given password, or of a generated one (then also returned in plaintext). */
export async function passwordFor(
  given: string | undefined,
): Promise<{ hash: string; temporary: string | null }> {
  const plain = given ?? temporaryPassword();
  return { hash: await hashPassword(plain), temporary: given ? null : plain };
}

export interface StaffAccount {
  user: User;
  /** The login already existed (its password is kept if it had one). */
  existingUser: boolean;
  temporaryPassword: string | null;
}

/**
 * Finds the login (email and/or phone) or creates a STAFF user for a shop team.
 * An existing customer login becomes STAFF (customer phone sign-in keeps working);
 * a platform admin can't also be shop staff.
 */
export async function findOrCreateStaffUser(
  tx: Tx,
  req: SudoAccountRequest,
): Promise<StaffAccount> {
  const email = req.email?.trim().toLowerCase();
  const phone = req.phone;
  const byEmail = email ? await tx.user.findUnique({ where: { email } }) : null;
  const byPhone = phone ? await tx.user.findUnique({ where: { phone } }) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    throw new AppError(
      'ACCOUNT_CONFLICT',
      'That email and phone belong to two different accounts',
      HttpStatus.CONFLICT,
    );
  }
  const existing = byEmail ?? byPhone;

  if (!existing) {
    const pw = await passwordFor(req.password);
    const user = await tx.user.create({
      data: {
        email: email ?? null,
        phone: phone ?? null,
        name: req.name,
        kind: 'STAFF',
        passwordHash: pw.hash,
      },
    });
    return { user, existingUser: false, temporaryPassword: pw.temporary };
  }

  if (existing.kind === 'ADMIN') {
    throw new AppError(
      'ACCOUNT_IS_ADMIN',
      'A Kagaz platform admin can’t be added to a shop team',
      HttpStatus.CONFLICT,
    );
  }
  const data: Prisma.UserUpdateInput = {};
  let temporary: string | null = null;
  if (existing.kind !== 'STAFF') data.kind = 'STAFF';
  if (!existing.email && email) data.email = email;
  if (!existing.phone && phone) data.phone = phone;
  if (!existing.name) data.name = req.name;
  if (!existing.passwordHash) {
    const pw = await passwordFor(req.password);
    data.passwordHash = pw.hash;
    temporary = pw.temporary;
  }
  const user =
    Object.keys(data).length > 0
      ? await tx.user.update({ where: { id: existing.id }, data })
      : existing;
  return { user, existingUser: true, temporaryPassword: temporary };
}

export function loginOf(user: { email: string | null; phone: string | null }): string | null {
  return user.email ?? user.phone;
}
