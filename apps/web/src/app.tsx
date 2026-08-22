import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { DashboardPage } from '@/pages/dashboard-page';
import { LoginPage } from '@/pages/login-page';
import { useAppStore } from '@/stores/app-store';

export function App() {
  const { t } = useTranslation();
  const sessionChecked = useAppStore((state) => state.sessionChecked);
  const authenticated = useAppStore((state) => state.authenticated);
  const loadSession = useAppStore((state) => state.loadSession);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (!sessionChecked) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-sm text-muted-foreground">
        {t('app.checkingSession')}
      </div>
    );
  }

  return authenticated ? <DashboardPage /> : <LoginPage />;
}
