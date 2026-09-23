import { z } from 'zod';
import type {
  CasinoGameManifestV1,
  CasinoGameManifestValidationResult,
  GameManifestMetadata,
} from './types';

const localeEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const presentationSchema = z.object({
  mode: z.enum(['full-iframe', 'embedded']),
  hostPanels: z.object({
    openSession: z.boolean(),
    history: z.boolean(),
    status: z.boolean(),
  }),
});

const capabilitiesSchema = z.object({
  openSession: z.literal(true),
  submitAction: z.boolean(),
  forfeitExpiredSession: z.boolean(),
  cancelStuckRandomness: z.boolean(),
  resize: z.boolean(),
});

const assetsSchema = z.object({
  iconUrl: z.string().optional(),
  coverUrl: z.string().optional(),
});

/** Minimal validation for routing + catalog; full shape still typed as CasinoGameManifestV1. */
export const casinoGameManifestSchema = z
  .object({
    schemaVersion: z.literal(1, {
      error: 'Unsupported manifest schemaVersion or apiVersion.',
    }),
    apiVersion: z.literal(1, {
      error: 'Unsupported manifest schemaVersion or apiVersion.',
    }),
    gameId: z.string().min(1, { error: 'Manifest gameId and defaultLocale are required.' }),
    defaultLocale: z.string().min(1, { error: 'Manifest gameId and defaultLocale are required.' }),
    locales: z
      .record(z.string(), localeEntrySchema)
      .refine(locales => Object.keys(locales).length > 0, {
        error: 'Manifest locales must contain at least one locale.',
      }),
    presentation: presentationSchema,
    capabilities: capabilitiesSchema,
    assets: assetsSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    const defaultLocaleEntry = manifest.locales[manifest.defaultLocale];
    if (!defaultLocaleEntry?.name) {
      ctx.addIssue({
        code: 'custom',
        message: 'Manifest defaultLocale must exist in locales.',
        path: ['defaultLocale'],
      });
    }
  });

/** Matches on-chain `normalizeGameName` / manifest `gameId` conventions (strip trailing "Game", lowercase, alnum only). */
export const canonicalCasinoGameId = (value: string | undefined | null): string => {
  if (!value) {
    return '';
  }

  let trimmed = value.trim();
  if (trimmed.match(/Game$/i)) {
    trimmed = trimmed.replace(/Game$/i, '');
  }

  return trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
};

export const validateCasinoGameManifest = (value: unknown): CasinoGameManifestValidationResult => {
  const result = casinoGameManifestSchema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const pathPrefix = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    const reason = issue?.message
      ? `${pathPrefix}${issue.message}`.replace(/^: /, '')
      : 'Manifest is invalid.';

    if (issue?.path[0] === 'presentation') {
      return { ok: false, reason: 'Manifest presentation is invalid.' };
    }

    if (issue?.path[0] === 'capabilities') {
      return { ok: false, reason: 'Manifest capabilities are invalid.' };
    }

    if (issue?.path[0] === 'assets') {
      return { ok: false, reason: 'Manifest assets are invalid.' };
    }

    if (typeof value !== 'object' || value === null) {
      return { ok: false, reason: 'Manifest must be an object.' };
    }

    return { ok: false, reason };
  }

  return {
    ok: true,
    manifest: result.data as CasinoGameManifestV1,
  };
};

export const resolveManifestMetadata = (
  manifest: CasinoGameManifestV1,
  requestedLocale: string,
): GameManifestMetadata => {
  const locale =
    manifest.locales[requestedLocale] !== undefined ? requestedLocale : manifest.defaultLocale;
  const localized = manifest.locales[locale] ?? manifest.locales[manifest.defaultLocale];

  return {
    locale,
    name: localized.name,
    description: localized.description,
    iconUrl: manifest.assets?.iconUrl,
    coverUrl: manifest.assets?.coverUrl,
  };
};

export const assertSameOriginUrls = (manifestUrl: string, iframeUrl: string): boolean => {
  try {
    const manifestOrigin = new URL(manifestUrl).origin;
    const iframeOrigin = new URL(iframeUrl).origin;

    return manifestOrigin === iframeOrigin;
  } catch {
    return false;
  }
};
