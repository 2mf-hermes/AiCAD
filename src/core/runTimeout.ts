import type { Settings } from './settings';

const MIN_TIMEOUT_SEC = 5;

/**
 * Returns the visible whole-run safety limit for the providers used by a task.
 * Individual HTTP requests still enforce each provider's own timeout. The
 * whole-run guard must not silently impose the old 90-second minimum, because
 * that made smaller values entered in Preferences appear to do nothing.
 */
export function resolveRunTimeoutSec(settings: Settings, task: 'generate' | 'inpaint'): number {
  const selectedIds = new Set<string>([settings.activeImageProvider]);
  if (task === 'generate' && settings.activeTextProvider !== 'none') {
    selectedIds.add(settings.activeTextProvider);
  }

  const selectedTimeouts = settings.providers
    .filter((provider) => provider.enabled && selectedIds.has(provider.id))
    .map((provider) => provider.timeout)
    .filter((timeout) => Number.isFinite(timeout));

  return Math.max(MIN_TIMEOUT_SEC, ...selectedTimeouts);
}
