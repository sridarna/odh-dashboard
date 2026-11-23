import { testHook } from '@odh-dashboard/jest-config/hooks';
import axios from '@odh-dashboard/ui-core/utilities/axios';
import {
  clearOpenApiDocumentCache,
  getKindSchema,
  kindSchemaTestUtils,
  useKindSchema,
} from '../useKindSchema';

jest.mock('@odh-dashboard/ui-core/utilities/axios');

const mockedAxios = jest.mocked(axios);

describe('getKindSchema', () => {
  it('should return the exact kind schema when a matching component exists', () => {
    expect(
      getKindSchema(
        {
          components: {
            schemas: {
              'io.k8s.example.v1.ExampleKind': { type: 'object' },
              'io.k8s.example.v1.ExampleKindList': { type: 'object' },
            },
          },
        },
        'ExampleKind',
      ),
    ).toEqual({
      $ref: '#/components/schemas/io.k8s.example.v1.ExampleKind',
      components: {
        schemas: {
          'io.k8s.example.v1.ExampleKind': { type: 'object' },
          'io.k8s.example.v1.ExampleKindList': { type: 'object' },
        },
      },
    });
  });

  it('should exclude list schemas when selecting a kind schema', () => {
    expect(
      getKindSchema(
        {
          components: {
            schemas: {
              'io.k8s.example.v1.ExampleKindList': { type: 'object' },
            },
          },
        },
        'ExampleKind',
      ),
    ).toBeNull();
  });

  it('should prefer the exact group/version schema for kserve inference services', () => {
    expect(
      getKindSchema(
        {
          components: {
            schemas: {
              'com.example.shadow.InferenceService': { type: 'object' },
              'io.kserve.serving.v1beta1.InferenceService': {
                type: 'object',
                properties: {
                  spec: {
                    $ref: '/components/schemas/io.kserve.serving.v1beta1.InferenceServiceSpec',
                  },
                },
              },
            },
          },
        },
        'InferenceService',
        { group: 'serving.kserve.io', version: 'v1beta1' },
      ),
    ).toEqual({
      $ref: '#/components/schemas/io.kserve.serving.v1beta1.InferenceService',
      components: {
        schemas: {
          'com.example.shadow.InferenceService': { type: 'object' },
          'io.kserve.serving.v1beta1.InferenceService': {
            type: 'object',
            properties: {
              spec: {
                $ref: '/components/schemas/io.kserve.serving.v1beta1.InferenceServiceSpec',
              },
            },
          },
        },
      },
    });
  });

  it('should prefer the exact version match for llm inference services when multiple versions exist', () => {
    expect(
      getKindSchema(
        {
          components: {
            schemas: {
              'io.kserve.serving.v1alpha2.LLMInferenceService': { type: 'object' },
              'io.kserve.serving.v1alpha1.LLMInferenceService': { type: 'object' },
            },
          },
        },
        'LLMInferenceService',
        { group: 'serving.kserve.io', version: 'v1alpha1' },
      ),
    ).toEqual({
      $ref: '#/components/schemas/io.kserve.serving.v1alpha1.LLMInferenceService',
      components: {
        schemas: {
          'io.kserve.serving.v1alpha2.LLMInferenceService': { type: 'object' },
          'io.kserve.serving.v1alpha1.LLMInferenceService': { type: 'object' },
        },
      },
    });
  });
});

describe('useKindSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearOpenApiDocumentCache();
  });

  it('should construct the backend request path with the expected Accept header', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        components: { schemas: { 'io.k8s.example.v1.ExampleKind': { type: 'object' } } },
      },
    });

    const renderResult = testHook(useKindSchema)({
      group: 'serving.kserve.io',
      version: 'v1beta1',
      kind: 'ExampleKind',
    });

    await renderResult.waitForNextUpdate();

    expect(
      kindSchemaTestUtils.getOpenApiDocumentPath({
        group: 'serving.kserve.io',
        version: 'v1beta1',
      }),
    ).toBe('/api/k8s/openapi/v3/apis/serving.kserve.io/v1beta1');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      '/api/k8s/openapi/v3/apis/serving.kserve.io/v1beta1',
      {
        headers: { Accept: 'application/json' },
      },
    );
    expect(renderResult).hookToStrictEqual({
      schema: {
        $ref: '#/components/schemas/io.k8s.example.v1.ExampleKind',
        components: {
          schemas: {
            'io.k8s.example.v1.ExampleKind': { type: 'object' },
          },
        },
      },
      isLoaded: true,
    });
  });

  it('should cache documents per group and version across hook mounts', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        components: { schemas: { 'io.k8s.example.v1.ExampleKind': { type: 'object' } } },
      },
    });

    const firstRender = testHook(useKindSchema)({
      group: 'serving.kserve.io',
      version: 'v1beta1',
      kind: 'ExampleKind',
    });
    await firstRender.waitForNextUpdate();

    const secondRender = testHook(useKindSchema)({
      group: 'serving.kserve.io',
      version: 'v1beta1',
      kind: 'ExampleKind',
    });
    await secondRender.waitForNextUpdate();

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(firstRender).hookToStrictEqual({
      schema: {
        $ref: '#/components/schemas/io.k8s.example.v1.ExampleKind',
        components: {
          schemas: {
            'io.k8s.example.v1.ExampleKind': { type: 'object' },
          },
        },
      },
      isLoaded: true,
    });
    expect(secondRender).hookToStrictEqual({
      schema: {
        $ref: '#/components/schemas/io.k8s.example.v1.ExampleKind',
        components: {
          schemas: {
            'io.k8s.example.v1.ExampleKind': { type: 'object' },
          },
        },
      },
      isLoaded: true,
    });
  });

  it('should gracefully fall back to a null schema when the fetch fails', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network error'));

    const renderResult = testHook(useKindSchema)({
      group: 'serving.kserve.io',
      version: 'v1beta1',
      kind: 'ExampleKind',
    });

    await renderResult.waitForNextUpdate();

    expect(renderResult).hookToStrictEqual({ schema: null, isLoaded: true });
  });
});
