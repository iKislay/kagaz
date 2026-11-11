'use client';

import { useState } from 'react';
import { type ShopMemberRole, type SudoMember, type SudoShopDetail } from '@kagaz/shared';
import { Notice, Pill, SegmentedControl } from '@/components/ui';
import { fmtDateTime } from '../../../admin/_lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Table,
  Td,
  useAction,
} from '../../../admin/_components/kit';
import { sudoApi } from '../../_lib/api';
import {
  Hint,
  OneTimePassword,
  ResetPasswordSheet,
  Sheet,
  SheetForm,
} from '../../_components/parts';

const ROLE_LABEL: Record<ShopMemberRole, string> = { OWNER: 'Owner', OPERATOR: 'Operator' };

/** Shop team accounts: owners (dashboard + shop app) and operators (shop app only). */
export function TeamSection({
  shop,
  reload,
}: {
  shop: SudoShopDetail;
  reload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<SudoMember | null>(null);
  const [removeFor, setRemoveFor] = useState<SudoMember | null>(null);
  const roleAction = useAction();
  const archived = shop.lifecycle === 'ARCHIVED';

  return (
    <div className="flex flex-col gap-4">
      {archived && (
        <Notice tone="accent">This shop is archived: its team can’t sign in until restored.</Notice>
      )}
      <Card
        title="Team"
        flush
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} disabled={archived}>
            Add person
          </Button>
        }
      >
        {shop.members.length === 0 ? (
          <Empty>No one yet. Add the shop owner so they can sign in.</Empty>
        ) : (
          <Table head={['Name', 'Login', 'Role', 'Joined', '']}>
            {shop.members.map((m) => (
              <tr key={m.userId}>
                <Td className="font-medium">
                  {m.name ?? '—'}
                  {!m.hasPassword && (
                    <span className="ml-2">
                      <Pill tone="orange">No password</Pill>
                    </span>
                  )}
                </Td>
                <Td>
                  <div>{m.email ?? '—'}</div>
                  {m.phone && <div className="text-[12px] text-text-secondary">{m.phone}</div>}
                </Td>
                <Td>
                  <SegmentedControl
                    label={`Role of ${m.name ?? m.email ?? m.phone}`}
                    value={m.role}
                    disabled={roleAction.busy}
                    onChange={(role) =>
                      void roleAction.run(async () => {
                        await sudoApi.setMemberRole(shop.id, m.userId, role);
                        await reload();
                      })
                    }
                    options={[
                      { value: 'OWNER', label: 'Owner' },
                      { value: 'OPERATOR', label: 'Operator' },
                    ]}
                  />
                </Td>
                <Td className="whitespace-nowrap text-text-secondary">{fmtDateTime(m.joinedAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => setResetFor(m)}>Reset password</Button>
                    <Button variant="danger" onClick={() => setRemoveFor(m)}>
                      Remove
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ErrorNote error={roleAction.error} />
      <Hint>
        Owners sign in to the dashboard (their shop only) and the shop app; operators use the shop
        app on the paired PC. Removing someone ends their shop-app sessions immediately.
      </Hint>

      {adding && (
        <AddMemberSheet shopId={shop.id} onClose={() => setAdding(false)} reload={reload} />
      )}
      {resetFor && (
        <ResetPasswordSheet
          title={`Reset password for ${resetFor.name ?? resetFor.email ?? resetFor.phone}`}
          subtitle="The old password stops working at once and shop-app sessions end."
          login={resetFor.email ?? resetFor.phone}
          reset={(pw) => sudoApi.resetMemberPassword(shop.id, resetFor.userId, pw)}
          onClose={() => {
            setResetFor(null);
            void reload();
          }}
        />
      )}
      {removeFor && (
        <RemoveSheet
          member={removeFor}
          shopName={shop.name}
          onClose={() => setRemoveFor(null)}
          remove={async () => {
            await sudoApi.removeMember(shop.id, removeFor.userId);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function AddMemberSheet({
  shopId,
  onClose,
  reload,
}: {
  shopId: string;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [role, setRole] = useState<ShopMemberRole>('OWNER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<{
    login: string | null;
    password: string | null;
    existing: boolean;
  } | null>(null);

  if (result) {
    return (
      <Sheet title="Person added" onClose={onClose}>
        {result.password ? (
          <OneTimePassword login={result.login} password={result.password} />
        ) : (
          <p className="text-[14px]">
            {result.existing
              ? `${result.login} already had a Kagaz account and keeps its password.`
              : `${result.login} can sign in with the password you set.`}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Add a person to the team" onClose={onClose}>
      <SheetForm
        submitLabel="Add"
        busy={busy}
        error={error}
        disabled={!name.trim() || !(email.trim() || phone.trim())}
        onCancel={onClose}
        onSubmit={async () => {
          const created = await run(() =>
            sudoApi.addMember(shopId, {
              role,
              name: name.trim(),
              ...(email.trim() ? { email: email.trim() } : {}),
              ...(phone.trim() ? { phone: phone.trim() } : {}),
              ...(password ? { password } : {}),
            }),
          );
          if (created) {
            await reload();
            setResult({
              login: created.member.email ?? created.member.phone,
              password: created.temporaryPassword,
              existing: created.existingUser,
            });
          }
        }}
      >
        <SegmentedControl
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'OWNER', label: ROLE_LABEL.OWNER },
            { value: 'OPERATOR', label: ROLE_LABEL.OPERATOR },
          ]}
        />
        <Input label="Full name" value={name} onChange={setName} />
        <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="off" />
        <Input
          label="Phone (E.164)"
          value={phone}
          onChange={setPhone}
          placeholder="+919876543210"
        />
        <Input
          label="Password (optional)"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="Leave empty to generate"
        />
      </SheetForm>
    </Sheet>
  );
}

function RemoveSheet({
  member,
  shopName,
  onClose,
  remove,
}: {
  member: SudoMember;
  shopName: string;
  onClose: () => void;
  remove: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  return (
    <Sheet
      title={`Remove ${member.name ?? member.email ?? member.phone}?`}
      subtitle={`They lose access to ${shopName}. Their account stays and can be added again.`}
      onClose={onClose}
    >
      <SheetForm
        submitLabel="Remove"
        danger
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async () => {
          const ok = await run(async () => {
            await remove();
            return true;
          });
          if (ok) onClose();
        }}
      />
    </Sheet>
  );
}
