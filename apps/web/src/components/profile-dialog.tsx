import type { HarnessId } from '@seaveyon/harness-switch-shared';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/stores/app-store';

type ProfileDialogProps = {
  open: boolean;
  harnessId: HarnessId | null;
  harnessLabel: string;
  onOpenChange: (open: boolean) => void;
};

export function ProfileDialog({ open, harnessId, harnessLabel, onOpenChange }: ProfileDialogProps) {
  const createProfile = useAppStore((state) => state.createProfile);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!harnessId) {
      return;
    }
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await createProfile(harnessId, {
        name: String(form.get('name') ?? ''),
        baseUrl: String(form.get('baseUrl') ?? ''),
        apiKey: String(form.get('apiKey') ?? ''),
        model: String(form.get('model') ?? ''),
        notes: String(form.get('notes') ?? ''),
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>新增 {harnessLabel} 配置</DialogTitle>
            <DialogDescription>API key 仅保存在服务器本地，列表不会回显明文。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="配置名称" name="name" placeholder="例如：openrouter-main" required />
            <Field
              label="API Base URL"
              name="baseUrl"
              placeholder="https://api.example.com/v1"
              required
            />
            <Field label="API Key" name="apiKey" type="password" placeholder="必填" required />
            <Field label="模型（可选）" name="model" placeholder="例如：claude-sonnet-4-5" />
            <div className="space-y-2">
              <Label htmlFor="notes">备注（可选）</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存配置'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} placeholder={placeholder} required={required} />
    </div>
  );
}
