'use client';

import { createContext, useContext } from 'react';
import { type AdminMe } from '@kagaz/shared';

export interface AdminSession {
  me: AdminMe;
  /** Called on any 401: drops the session and shows the sign-in screen. */
  onUnauthorized: () => void;
  logout: () => Promise<void>;
}

export const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession must be used inside the admin shell');
  return ctx;
}

export const isAdmin = (me: AdminMe) => me.role === 'ADMIN';
