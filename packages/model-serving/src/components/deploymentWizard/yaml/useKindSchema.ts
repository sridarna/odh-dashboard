import * as React from 'react';
import axios from '@odh-dashboard/ui-core/utilities/axios';

export type KindReference = {
  group: string;
  version: string;
  kind: string;
};

type OpenAPIV3Schema = {
  $ref?: string;
  description?: string;
  properties?: Record<string, OpenAPIV3Schema>;
  required?: string[];
  type?: string;
  items?: OpenAPIV3Schema;
  [key: string]: unknown;
};

type OpenAPIV3Document = {
  components?: {
    schemas?: Record<string, OpenAPIV3Schema>;
  };
};

export type KindSchema = OpenAPIV3Schema;

type KindSchemaDocument = OpenAPIV3Schema & {
  components: {
    schemas: Record<string, OpenAPIV3Schema>;
  };
};

export type UseKindSchemaResult = {
  schema: KindSchemaDocument | null;
  isLoaded: boolean;
};

const openApiDocumentCache = new Map<string, Promise<OpenAPIV3Document>>();

const getOpenApiCacheKey = ({ group, version }: Pick<KindReference, 'group' | 'version'>): string =>
  `${group}/${version}`;

const getOpenApiDocumentPath = ({
  group,
  version,
}: Pick<KindReference, 'group' | 'version'>): string =>
  `/api/k8s/openapi/v3/apis/${group}/${version}`;

const fetchOpenApiDocument = async (
  kindReference: Pick<KindReference, 'group' | 'version'>,
): Promise<OpenAPIV3Document> => {
  const cacheKey = getOpenApiCacheKey(kindReference);
  const cachedPromise = openApiDocumentCache.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = axios
    .get<OpenAPIV3Document>(getOpenApiDocumentPath(kindReference), {
      headers: { Accept: 'application/json' },
    })
    .then((response) => response.data)
    .catch((error: unknown) => {
      openApiDocumentCache.delete(cacheKey);
      throw error;
    });

  openApiDocumentCache.set(cacheKey, request);

  return request;
};

export const getKindSchema = (
  document: OpenAPIV3Document,
  kind: string,
  kindReference?: Pick<KindReference, 'group' | 'version'>,
): KindSchemaDocument | null => {
  if (!kind) {
    return null;
  }

  const schemas = document.components?.schemas;
  if (!schemas) {
    return null;
  }

  const schemaEntries = Object.entries(schemas).filter(
    ([schemaName]) => schemaName.endsWith(`.${kind}`) && !schemaName.endsWith(`.${kind}List`),
  );

  if (schemaEntries.length === 0) {
    return null;
  }

  const groupParts = kindReference?.group.split('.').filter(Boolean) ?? [];
  const version = kindReference?.version;
  const reversedGroupParts = [...groupParts].reverse();

  const scoredEntries = schemaEntries.map(([schemaName, schemaValue]) => {
    const versionScore = version
      ? schemaName.includes(`.${version}.`)
        ? 1000
        : schemaName.includes(version)
        ? 100
        : 0
      : 0;

    const orderedGroupScore = reversedGroupParts.reduce(
      (acc, part) => {
        const partIndex = schemaName.indexOf(part, acc.searchIndex);
        return partIndex === -1
          ? acc
          : { score: acc.score + 10, searchIndex: partIndex + part.length };
      },
      { score: 0, searchIndex: 0 },
    ).score;

    const containsGroupScore = reversedGroupParts.reduce(
      (score, part) => (schemaName.includes(part) ? score + 1 : score),
      0,
    );

    return {
      schemaName,
      schemaValue,
      score: versionScore + orderedGroupScore + containsGroupScore,
    };
  });

  const bestMatch = scoredEntries.reduce<(typeof scoredEntries)[number] | null>(
    (best, candidate) => {
      if (!best || candidate.score > best.score) {
        return candidate;
      }

      return best;
    },
    null,
  );

  const match = bestMatch
    ? ([bestMatch.schemaName, bestMatch.schemaValue] as const)
    : schemaEntries[0];

  const [schemaName] = match;

  return {
    $ref: `#/components/schemas/${schemaName}`,
    components: {
      schemas,
    },
  };
};

export const useKindSchema = (kindReference: KindReference | null): UseKindSchemaResult => {
  const [state, setState] = React.useState<UseKindSchemaResult>({
    schema: null,
    isLoaded: !kindReference,
  });

  React.useEffect(() => {
    let isCancelled = false;

    if (!kindReference) {
      setState({ schema: null, isLoaded: true });
      return undefined;
    }

    setState((currentState) => ({ ...currentState, isLoaded: false }));

    void fetchOpenApiDocument(kindReference)
      .then((document) => {
        if (isCancelled) {
          return;
        }

        setState({
          schema: getKindSchema(document, kindReference.kind, kindReference),
          isLoaded: true,
        });
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setState({ schema: null, isLoaded: true });
      });

    return () => {
      isCancelled = true;
    };
  }, [kindReference]);

  return state;
};

export const clearOpenApiDocumentCache = (): void => {
  openApiDocumentCache.clear();
};

export const kindSchemaTestUtils = {
  getOpenApiCacheKey,
  getOpenApiDocumentPath,
};
