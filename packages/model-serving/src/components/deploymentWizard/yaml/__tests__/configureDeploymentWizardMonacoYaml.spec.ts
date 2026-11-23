import { configureMonacoYaml } from 'monaco-yaml';
import {
  buildDeploymentWizardYamlSchemas,
  configureDeploymentWizardMonacoYaml,
  DEPLOYMENT_WIZARD_YAML_MODEL_URI,
} from '../configureDeploymentWizardMonacoYaml';
import { ensureMonacoYamlEnvironment } from '../ensureMonacoYamlEnvironment';

jest.mock('monaco-yaml', () => ({
  configureMonacoYaml: jest.fn(() => ({
    dispose: jest.fn(),
    update: jest.fn(),
    getOptions: jest.fn(),
  })),
}));

jest.mock('../ensureMonacoYamlEnvironment', () => ({
  ensureMonacoYamlEnvironment: jest.fn(),
}));

const mockConfigureMonacoYaml = jest.mocked(configureMonacoYaml);
const mockEnsureMonacoYamlEnvironment = jest.mocked(ensureMonacoYamlEnvironment);

describe('configureDeploymentWizardMonacoYaml', () => {
  beforeEach(() => {
    mockConfigureMonacoYaml.mockClear();
    mockEnsureMonacoYamlEnvironment.mockReset();
  });

  afterEach(() => {
    delete (window as { monaco?: unknown }).monaco;
  });

  it('should expose a stable model URI for schema fileMatch registration', () => {
    expect(DEPLOYMENT_WIZARD_YAML_MODEL_URI).toBe('file:///deployment-wizard.yaml');
  });

  it('should enable syntax validation with an empty schemas array by default', () => {
    const monaco = {} as Parameters<typeof configureDeploymentWizardMonacoYaml>[0];

    configureDeploymentWizardMonacoYaml(monaco);

    expect(mockEnsureMonacoYamlEnvironment).toHaveBeenCalledTimes(1);
    expect(mockConfigureMonacoYaml).toHaveBeenCalledTimes(1);
    expect(mockConfigureMonacoYaml).toHaveBeenCalledWith(monaco, {
      enableSchemaRequest: false,
      hover: true,
      completion: true,
      validate: true,
      schemas: [],
    });
  });

  it('should accept a schemas array for future schema-aware registration', () => {
    const monaco = {} as Parameters<typeof configureDeploymentWizardMonacoYaml>[0];
    const schemas = [
      {
        uri: 'https://example.com/schema.json',
        fileMatch: [DEPLOYMENT_WIZARD_YAML_MODEL_URI],
        schema: { type: 'object' },
      },
    ];

    configureDeploymentWizardMonacoYaml(monaco, { schemas });

    expect(mockConfigureMonacoYaml).toHaveBeenCalledWith(
      monaco,
      expect.objectContaining({
        validate: true,
        schemas,
      }),
    );
  });

  it('should keep the beforeMount Monaco on window when worker setup replaces it', () => {
    const editorMonaco = {} as Parameters<typeof configureDeploymentWizardMonacoYaml>[0];
    const remoteMonaco = { kind: 'remote' };
    const browserWindow = window as { monaco?: unknown };
    browserWindow.monaco = remoteMonaco;
    mockEnsureMonacoYamlEnvironment.mockImplementation(() => {
      browserWindow.monaco = remoteMonaco;
    });

    configureDeploymentWizardMonacoYaml(editorMonaco);

    expect(browserWindow.monaco).toBe(editorMonaco);
    expect(mockConfigureMonacoYaml).toHaveBeenCalledWith(
      editorMonaco,
      expect.objectContaining({ validate: true }),
    );
  });

  it('should build a file-matched schema registration for the active kind', () => {
    expect(
      buildDeploymentWizardYamlSchemas({ type: 'object', description: 'Example schema' }),
    ).toEqual([
      {
        uri: 'file:///deployment-wizard-schema.json',
        fileMatch: [DEPLOYMENT_WIZARD_YAML_MODEL_URI],
        schema: { type: 'object', description: 'Example schema' },
      },
    ]);
  });

  it('should preserve referenced component schemas for nested yaml validation', () => {
    expect(
      buildDeploymentWizardYamlSchemas({
        $ref: '#/components/schemas/io.k8s.example.v1.ExampleKind',
        components: {
          schemas: {
            'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta': { type: 'object' },
            'io.k8s.example.v1.ExampleKind': {
              type: 'object',
              properties: {
                metadata: {
                  $ref: '#/components/schemas/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta',
                },
              },
            },
          },
        },
      }),
    ).toEqual([
      {
        uri: 'file:///deployment-wizard-schema.json',
        fileMatch: [DEPLOYMENT_WIZARD_YAML_MODEL_URI],
        schema: {
          type: 'object',
          properties: {
            metadata: {
              $ref: '#/components/schemas/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta',
            },
          },
          components: {
            schemas: {
              'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta': { type: 'object' },
              'io.k8s.example.v1.ExampleKind': {
                type: 'object',
                properties: {
                  metadata: {
                    $ref: '#/components/schemas/io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta',
                  },
                },
              },
            },
          },
        },
      },
    ]);
  });

  it('should normalize openapi local refs so monaco can resolve component schemas', () => {
    expect(
      buildDeploymentWizardYamlSchemas({
        $ref: '/components/schemas/io.kserve.serving.v1beta1.InferenceService',
        components: {
          schemas: {
            'io.kserve.serving.v1beta1.InferenceService': {
              type: 'object',
              properties: {
                spec: {
                  $ref: '/components/schemas/io.kserve.serving.v1beta1.InferenceServiceSpec',
                },
              },
            },
            'io.kserve.serving.v1beta1.InferenceServiceSpec': {
              type: 'object',
              properties: {
                predictor: {
                  $ref: '/components/schemas/io.kserve.serving.v1beta1.PredictorSpec',
                },
              },
            },
            'io.kserve.serving.v1beta1.PredictorSpec': { type: 'object' },
          },
        },
      }),
    ).toEqual([
      {
        uri: 'file:///deployment-wizard-schema.json',
        fileMatch: [DEPLOYMENT_WIZARD_YAML_MODEL_URI],
        schema: {
          type: 'object',
          properties: {
            spec: {
              $ref: '#/components/schemas/io.kserve.serving.v1beta1.InferenceServiceSpec',
            },
          },
          components: {
            schemas: {
              'io.kserve.serving.v1beta1.InferenceService': {
                type: 'object',
                properties: {
                  spec: {
                    $ref: '#/components/schemas/io.kserve.serving.v1beta1.InferenceServiceSpec',
                  },
                },
              },
              'io.kserve.serving.v1beta1.InferenceServiceSpec': {
                type: 'object',
                properties: {
                  predictor: {
                    $ref: '#/components/schemas/io.kserve.serving.v1beta1.PredictorSpec',
                  },
                },
              },
              'io.kserve.serving.v1beta1.PredictorSpec': { type: 'object' },
            },
          },
        },
      },
    ]);
  });

  it('should inline the root schema for llm inference services so monaco does not resolve a root component ref', () => {
    expect(
      buildDeploymentWizardYamlSchemas({
        $ref: '#/components/schemas/io.kserve.serving.v1alpha1.LLMInferenceService',
        components: {
          schemas: {
            'io.kserve.serving.v1alpha1.LLMInferenceService': {
              type: 'object',
              properties: {
                spec: {
                  $ref: '/components/schemas/io.kserve.serving.v1alpha1.LLMInferenceServiceSpec',
                },
              },
            },
            'io.kserve.serving.v1alpha1.LLMInferenceServiceSpec': {
              type: 'object',
            },
          },
        },
      }),
    ).toEqual([
      {
        uri: 'file:///deployment-wizard-schema.json',
        fileMatch: [DEPLOYMENT_WIZARD_YAML_MODEL_URI],
        schema: {
          type: 'object',
          properties: {
            spec: {
              $ref: '#/components/schemas/io.kserve.serving.v1alpha1.LLMInferenceServiceSpec',
            },
          },
          components: {
            schemas: {
              'io.kserve.serving.v1alpha1.LLMInferenceService': {
                type: 'object',
                properties: {
                  spec: {
                    $ref: '#/components/schemas/io.kserve.serving.v1alpha1.LLMInferenceServiceSpec',
                  },
                },
              },
              'io.kserve.serving.v1alpha1.LLMInferenceServiceSpec': {
                type: 'object',
              },
            },
          },
        },
      },
    ]);
  });

  it('should return no schema registrations when schema context is incomplete', () => {
    expect(buildDeploymentWizardYamlSchemas(null)).toEqual([]);
  });
});
