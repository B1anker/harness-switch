import { useEffect } from 'react';
import { DashboardPage } from '@/pages/dashboard-page';
import { LoginPage } from '@/pages/login-page';
import { useAppStore } from '@/stores/app-store';

export function App() {
  const sessionChecked = useAppStore((state) => state.sessionChecked);
  const authenticated = useAppStore((state) => state.authenticated);
  const loadSession = useAppStore((state) => state.loadSession);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (!sessionChecked) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        正在检查会话…
      </div>
    );
  }

  return authenticated ? <DashboardPage /> : <LoginPage />;
}
