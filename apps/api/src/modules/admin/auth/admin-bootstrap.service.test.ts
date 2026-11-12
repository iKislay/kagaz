import { describe, expect, it, vi } from 'vitest';
import { type AppConfig } from '../../../common/config/config.schema.js';
import { type PrismaService } from '../../../common/prisma/prisma.service.js';
import { hashPassword, verifyPassword } from '../../identity/passwords.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';

const PASSWORD = 'correct horse battery';

function setup(existing: { id: string; kind: string; passwordHash: string | null } | null) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockResolvedValue({ id: 'u1' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const config = { ADMIN_EMAIL: 'admin@kaggaz.in', ADMIN_PASSWORD: PASSWORD } as AppConfig;
  return { prisma, service: new AdminBootstrapService(config, prisma as unknown as PrismaService) };
}

describe('AdminBootstrapService', () => {
  it('creates the admin with a hashed password', async () => {
    const { prisma, service } = setup(null);
    await service.onApplicationBootstrap();
    const { create } = prisma.user.upsert.mock.calls[0]![0] as { create: { passwordHash: string } };
    expect(create.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(create.passwordHash, PASSWORD)).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
  });

  it('does nothing when the stored password already matches', async () => {
    const { prisma, service } = setup({
      id: 'u1',
      kind: 'ADMIN',
      passwordHash: await hashPassword(PASSWORD),
    });
    await service.onApplicationBootstrap();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('resets a changed password', async () => {
    const { prisma, service } = setup({
      id: 'u1',
      kind: 'ADMIN',
      passwordHash: await hashPassword('an old password'),
    });
    await service.onApplicationBootstrap();
    expect(prisma.user.upsert).toHaveBeenCalledOnce();
  });
});
