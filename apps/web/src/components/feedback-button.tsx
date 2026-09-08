import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

/**
 * Where feedback goes. The repository's issue tracker rather than an in-app form: this is
 * a local single-user tool, so there is no backend to receive a report — the user's own
 * GitHub account is the channel that already exists.
 */
const ISSUES_URL = 'https://github.com/B1anker/harness-switch/issues';

/** A persistent way out to the issue tracker, anchored where a help affordance is looked for. */
export function FeedbackButton() {
  const { t } = useTranslation();
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="fixed bottom-4 right-4 z-30 rounded-full shadow-lg"
    >
      <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer" title={t('feedback.hint')}>
        <MessageSquarePlus />
        <span className="hidden sm:inline">{t('feedback.label')}</span>
      </a>
    </Button>
  );
}
