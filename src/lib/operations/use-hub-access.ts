"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";

// Share only requests in flight. The AuthProvider replaces this user object
// when the session changes, so a new session cannot join an old request.
const pendingHubAccess = new WeakMap<User, Promise<boolean>>();

function checkHubAccess(authUser: User): Promise<boolean> {
  const pending = pendingHubAccess.get(authUser);
  if (pending) return pending;

  const request = fetch("/api/operations/access", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return false;
      const body = await response.json();
      return body?.allowed === true;
    })
    .catch(() => false)
    .finally(() => pendingHubAccess.delete(authUser));

  pendingHubAccess.set(authUser, request);
  return request;
}

export function useHubAccess() {
  const { authUser, user, hasPermission, isLoading } = useAuth();
  const canCheck = !isLoading && authUser !== null && user?.id === authUser.id
    && hasPermission(PERMISSIONS.OPS_VIEW);
  const [grant, setGrant] = useState<{ authUser: User; allowed: boolean } | null>(null);

  useEffect(() => {
    if (!canCheck || !authUser) {
      setGrant(null);
      return;
    }

    let active = true;
    void checkHubAccess(authUser).then((allowed) => {
      if (active) setGrant({ authUser, allowed });
    });

    return () => { active = false; };
  }, [authUser, canCheck]);

  return canCheck && grant !== null && grant.authUser === authUser && grant.allowed;
}
