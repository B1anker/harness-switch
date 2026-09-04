import type {
  GitHubDeviceCodeResponse,
  GitHubDevicePollResponse,
} from '@seaveyon/harness-switch-shared';
import { useEffect, useRef, useState } from 'react';
import { api, githubPath } from '@/lib/api';
import { errorLine, type MessageLine } from '@/lib/messages';

/** GitHub's device flow never polls faster than this, even if the server suggests less. */
export const MIN_POLL_SECONDS = 5;

export type DeviceFlow = {
  code: GitHubDeviceCodeResponse | null;
  requesting: boolean;
  /** A background poll is running; the user need not do anything. */
  polling: boolean;
  /** The user asked "check now", so a result — including a failure — is owed to them. */
  checking: boolean;
  intervalSeconds: number;
  requestCode: () => Promise<void>;
  checkNow: () => Promise<void>;
};

/**
 * The GitHub device flow: ask for a code, then poll until the user has entered it.
 *
 * The polling is the reason this is a hook rather than inline state. Its interval is set by
 * GitHub — which raises it when we ask too often — and the timer has to survive re-renders
 * and be cleared on unmount, none of which belongs in a pane that is mostly markup.
 *
 * Only a manual check reports failures. A background poll that cannot reach the server
 * would otherwise flash an error at a user who is not looking at this tab yet.
 */
export function useDeviceFlow(options: {
  onAuthorized: (username: string) => void;
  onError: (error: MessageLine) => void;
  onStarted: () => void;
}): DeviceFlow {
  const [code, setCode] = useState<GitHubDeviceCodeResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(MIN_POLL_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The timer's callback outlives the render that scheduled it, so it reads the callers
  // through a ref rather than closing over the ones it happened to be created with.
  const handlers = useRef(options);
  handlers.current = options;

  useEffect(() => () => stop(), []);

  function stop() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
  }

  function start(deviceCode: string, seconds = MIN_POLL_SECONDS) {
    if (timerRef.current) clearInterval(timerRef.current);
    setPolling(true);
    setIntervalSeconds(seconds);
    timerRef.current = setInterval(
      () => void poll(deviceCode, false),
      Math.max(seconds, MIN_POLL_SECONDS) * 1000,
    );
  }

  async function poll(deviceCode: string, manual: boolean) {
    if (manual) {
      setChecking(true);
      handlers.current.onStarted();
    }
    try {
      const result = await api<GitHubDevicePollResponse>(githubPath.devicePoll, {
        method: 'POST',
        body: JSON.stringify({ deviceCode }),
      });
      settle(result, deviceCode);
    } catch (caught) {
      if (manual) handlers.current.onError(errorLine(caught));
    } finally {
      if (manual) setChecking(false);
    }
  }

  function settle(result: GitHubDevicePollResponse, deviceCode: string) {
    if (result.status === 'authorized') {
      stop();
      setCode(null);
      handlers.current.onAuthorized(result.username ?? '');
      return;
    }
    if (result.status === 'expired' || result.status === 'error') {
      stop();
      const fallback =
        result.status === 'expired' ? 'githubSync.codeExpired' : 'githubSync.authFailed';
      handlers.current.onError(result.error ? errorLine(result.error) : { key: fallback });
      return;
    }
    if (result.interval && result.interval > MIN_POLL_SECONDS) {
      // GitHub asked us to slow down.
      start(deviceCode, result.interval);
    }
  }

  return {
    code,
    requesting,
    polling,
    checking,
    intervalSeconds,
    requestCode: async () => {
      setRequesting(true);
      handlers.current.onStarted();
      try {
        const result = await api<GitHubDeviceCodeResponse>(githubPath.deviceCode, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        setCode(result);
        start(result.deviceCode, result.interval);
      } catch (caught) {
        handlers.current.onError(errorLine(caught));
      } finally {
        setRequesting(false);
      }
    },
    checkNow: async () => {
      if (code?.deviceCode) await poll(code.deviceCode, true);
    },
  };
}
