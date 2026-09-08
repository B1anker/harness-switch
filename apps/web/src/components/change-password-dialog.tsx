import { LIMITS } from '@seaveyon/harness-switch-shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/lib/i18n';
import { errorLine, lineText, type MessageLine } from '@/lib/messages';
import { useAppStore } from '@/stores/app-store';

type Field = 'current' | 'next' | 'confirm';

/**
 * Rotates the shared web password without editing the `web_password` file by hand.
 *
 * The client mirrors the server's floor (min length, new ≠ current) so a doomed request
 * is caught before it is sent; the server stays authoritative and its rejection is shown
 * against the same field. Success hands a line to the toast and closes the dialog — the
 * server re-issues this session's cookie, so nothing needs reloading.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const changePassword = useAppStore((state) => state.changePassword);
  const setNotice = useAppStore((state) => state.setNotice);
  const [values, setValues] = useState<Record<Field, string>>({
    current: '',
    next: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, MessageLine>>>({});
  const [submitting, setSubmitting] = useState(false);

  const update = (field: Field, value: string): void => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // A field the user is fixing should shed its error as they type, not on the next submit.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  /** The same rules the server enforces, so an obvious mistake never reaches the network. */
  const validate = (): Partial<Record<Field, MessageLine>> => {
    const next: Partial<Record<Field, MessageLine>> = {};
    if (values.next.length < LIMITS.minPassword) {
      next.next = {
        key: 'error.auth.passwordTooShort',
        params: { count: LIMITS.minPassword },
      };
    } else if (values.next === values.current) {
      next.next = { key: 'error.auth.passwordUnchanged' };
    }
    if (values.confirm !== values.next) {
      next.confirm = { key: 'account.password.mismatch' };
    }
    return next;
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(values.current, values.next);
      setNotice([{ key: 'account.password.changed' }]);
      onOpenChange(false);
    } catch (err) {
      // A wrong current password comes back as `passwordChangeRejected`; pin it to that
      // field so the correction is where the reader is looking. Anything else is generic.
      const line = errorLine(err);
      setErrors({
        [line.key === 'error.auth.passwordChangeRejected' ? 'current' : 'next']: line,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('account.password.title')}</DialogTitle>
          <DialogDescription>{t('account.password.intro')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <FormField
            id="current-password"
            label={t('account.password.current')}
            error={errors.current ? lineText(t, errors.current) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                autoFocus
                maxLength={LIMITS.apiKey}
                value={values.current}
                onChange={(event) => update('current', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id="new-password"
            label={t('account.password.next')}
            hint={t('account.password.hint', { count: LIMITS.minPassword })}
            error={errors.next ? lineText(t, errors.next) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                maxLength={LIMITS.apiKey}
                value={values.next}
                onChange={(event) => update('next', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id="confirm-password"
            label={t('account.password.confirm')}
            error={errors.confirm ? lineText(t, errors.confirm) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                maxLength={LIMITS.apiKey}
                value={values.confirm}
                onChange={(event) => update('confirm', event.target.value)}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('account.password.submitting') : t('account.password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
