import type { FavoriteInput } from '@seaveyon/harness-switch-shared';
import type { z } from 'zod';

/**
 * Where one zod issue lands in the editor: a field (by its `FormField` id), a channel
 * card (by connection id), or nowhere identifiable — only the last group may fall back
 * to the generic `favorites.invalid` line.
 */
export type LocatedFavoriteIssues = {
  fields: Record<string, string>;
  cards: Record<string, string>;
  global: string[];
};

/** Cross-field refinements carry their rule name as the issue message. */
const CUSTOM_ISSUE_KEYS: Record<string, string> = {
  favoriteInvalidFacts: 'favorites.validation.invalidFacts',
  favoriteDuplicateConnection: 'favorites.validation.duplicateConnection',
};

function issueKey(issue: z.core.$ZodIssue): string {
  if (issue.code === 'custom') {
    return CUSTOM_ISSUE_KEYS[issue.message] ?? 'favorites.invalid';
  }
  return issue.code === 'too_small' || issue.code === 'invalid_type'
    ? 'favorites.validation.required'
    : 'favorites.validation.invalidValue';
}

export function isCrossFieldIssue(issue: z.core.$ZodIssue): boolean {
  return issue.code === 'custom';
}

export function locateFavoriteIssues(
  draft: FavoriteInput,
  issues: z.core.$ZodIssue[],
): LocatedFavoriteIssues {
  const located: LocatedFavoriteIssues = { fields: {}, cards: {}, global: [] };
  for (const issue of issues) {
    const key = issueKey(issue);
    const [head, second, third] = issue.path as Array<string | number | undefined>;
    if (head === 'name') {
      located.fields['favorite-name'] = key;
    } else if (head === 'notes') {
      located.fields['favorite-notes'] = key;
    } else if (head === 'defaults') {
      // Cross-field rule: point at the reasoning declaration it constrains.
      located.fields[typeof second === 'string' ? `favorite-${second}` : 'favorite-reasoning'] =
        key;
    } else if (head === 'connections' && typeof second === 'number') {
      const connection = draft.connections[second];
      if (!connection) {
        located.global.push(key);
        continue;
      }
      locateConnectionIssue(
        located,
        connection.id,
        third,
        issue.path[3] as string | number | undefined,
        key,
      );
    } else {
      located.global.push(key);
    }
  }
  located.global = [...new Set(located.global)];
  return located;
}

function locateConnectionIssue(
  located: LocatedFavoriteIssues,
  connectionId: string,
  field: string | number | undefined,
  subfield: string | number | undefined,
  key: string,
): void {
  if (field === undefined) {
    located.cards[connectionId] = key;
  } else if (field === 'providerId' || field === 'endpointKey') {
    located.fields[`${connectionId}-provider`] = key;
  } else if (field === 'requestModelId') {
    located.fields[`${connectionId}-model`] = key;
  } else if (field === 'protocol') {
    located.fields[`${connectionId}-protocol`] = key;
  } else if (field === 'label') {
    located.fields[`${connectionId}-label`] = key;
  } else if (field === 'factOverrides' && typeof subfield === 'string') {
    located.fields[`${connectionId}-${subfield}`] = key;
  } else if (field === 'preferenceOverrides') {
    located.fields[`${connectionId}-reasoningEffort`] = key;
  } else {
    located.cards[connectionId] = key;
  }
}
