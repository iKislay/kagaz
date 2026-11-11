'use client';

import { useState } from 'react';
import { type SudoAdmin } from '@kagaz/shared';
import { Pill } from '@/components/ui';
import { fmtDateTime } from '../../admin/_lib/format';
import {
  Button,
  Card,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
  useAction,
  useLoad,
} from '../../admin/_components/kit';
import { sudoApi } from '../_lib/api';
import { Hint, OneTimePassword, ResetPasswordSheet, Sheet, SheetForm } from '../_components/parts';

/** Kagaz platform admins: full access to every shop and this console. */
export default function AdminsPage() {
  const { data, error, loading, reload } = useLoad(() => sudoApi.admins(), []);
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<SudoAdmin | null>(null);
  const remove = useAction();

  return (
    <>
      <PageHeader
        title="Kagaz admins"
        subtitle="People at Kagaz with full access to every shop and this console."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add admin
          </Button>
        }
      />
      <ErrorNote error={error} />
      <ErrorNote error={remove.error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <Card flush>
            <Table head={['Name', 'Email', 'Added', '']}>
              {data.admins.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">
                    {a.name ?? '—'}
                    {a.isSelf && (
                      <span className="ml-2">
                        <Pill tone="accent">You</Pill>
                      </span>
                    )}
                  </Td>
                  <Td>{a.email ?? a.phone}</Td>
                  <Td className="text-text-secondary">{fmtDateTime(a.createdAt)}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setResetFor(a)}>Reset password</Button>
                      {!a.isSelf && (
                        <Button
                          variant="danger"
                          disabled={remove.busy}
                          onClick={() => {
                            if (window.confirm(`Remove admin access for ${a.name ?? a.email}?`)) {
                              void remove.run(async () => {
                                await sudoApi.removeAdmin(a.id);
                                await reload();
                              });
                            }
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      )}
      <div className="mt-3">
        <Hint>
          You can’t remove yourself, and Kagaz always keeps at least one admin. A removed admin is
          signed out on their next request.
        </Hint>
      </div>
      {adding && <AddAdminSheet onClose={() => setAdding(false)} onAdded={() => void reload()} />}
      {resetFor && (
        <ResetPasswordSheet
          title={`Reset password for ${resetFor.name ?? resetFor.email}`}
          login={resetFor.email}
          reset={(pw) => sudoApi.resetAdminPassword(resetFor.id, pw)}
          onClose={() => setResetFor(null)}
        />
      )}
    </>
  );
}

function AddAdminSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [temp, setTemp] = useState<{ login: string; password: string | null } | null>(null);

  if (temp) {
    return (
      <Sheet title="Admin added" onClose={onClose}>
        {temp.password ? (
          <OneTimePassword login={temp.login} password={temp.password} />
        ) : (
          <p className="text-[14px]">{temp.login} can sign in with the password you set.</p>
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
    <Sheet
      title="Add a Kagaz admin"
      subtitle="Admins can see and change every shop, subscription and account."
      onClose={onClose}
    >
      <SheetForm
        submitLabel="Add admin"
        busy={busy}
        error={error}
        disabled={!name.trim() || !email.trim()}
        onCancel={onClose}
        onSubmit={async () => {
          const created = await run(() =>
            sudoApi.createAdmin({
              name: name.trim(),
              email: email.trim(),
              ...(password ? { password } : {}),
            }),
          );
          if (created) {
            onAdded();
            setTemp({ login: created.admin.email ?? email, password: created.temporaryPassword });
          }
        }}
      >
        <Input label="Full name" value={name} onChange={setName} />
        <Input label="Email" type="email" value={email} onChange={setEmail} autoComplete="off" />
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
