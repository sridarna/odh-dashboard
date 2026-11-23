import { stringify } from 'yaml';
import { convertYamlToResources, getKindReferenceFromYaml } from '../yamlUtils';

const resource = {
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: { name: 'test-resource', namespace: 'test-ns' },
  spec: {},
};

describe('convertYamlToResources', () => {
  it.each([
    resource,
    { ...resource, apiVersion: 'apps/v1', kind: 'Deployment', spec: { replicas: 2 } },
    {
      ...resource,
      apiVersion: 'serving.kserve.io/v1alpha2',
      kind: 'LLMInferenceService',
      spec: { model: { uri: 'hf://test/model' } },
    },
  ])('should accept $apiVersion/$kind resources', (model) => {
    expect(convertYamlToResources(stringify(model))).toStrictEqual({ resources: { model } });
  });

  it('should preserve resource-specific fields and additional metadata', () => {
    const model = {
      ...resource,
      metadata: {
        ...resource.metadata,
        annotations: { 'example.com/custom': 'value' },
        labels: { app: 'test' },
        finalizers: ['example.com/cleanup'],
        resourceVersion: '123',
      },
      data: { setting: 'value' },
      status: { custom: true },
    };

    expect(convertYamlToResources(stringify(model))).toStrictEqual({ resources: { model } });
  });

  it.each([{ model: { uri: 42 } }, { replicas: 2, args: ['--foo'], extras: null }])(
    'should leave spec contents validation to extensions: %j',
    (spec) => {
      const model = { ...resource, kind: 'LLMInferenceService', spec };
      expect(convertYamlToResources(stringify(model))).toStrictEqual({ resources: { model } });
    },
  );

  it.each([undefined, '', ' \n\t'])('should reject empty YAML: %j', (yaml) => {
    expect(convertYamlToResources(yaml)).toStrictEqual({
      resources: { model: undefined },
      error: new Error('YAML cannot be empty'),
    });
  });

  it.each(['null', '# comment only', '42', 'true', 'text', '[]', '- kind: ConfigMap'])(
    'should reject YAML without a resource object: %s',
    (yaml) => {
      const result = convertYamlToResources(yaml);
      expect(result.resources.model).toBeUndefined();
      expect(result.error?.message).toContain('Invalid Kubernetes resource YAML: resource:');
    },
  );

  it.each([
    ['apiVersion', { ...resource, apiVersion: undefined }],
    ['apiVersion', { ...resource, apiVersion: '' }],
    ['apiVersion', { ...resource, apiVersion: 1 }],
    ['kind', { ...resource, kind: undefined }],
    ['kind', { ...resource, kind: '' }],
    ['kind', { ...resource, kind: 1 }],
    ['metadata', { ...resource, metadata: undefined }],
    ['metadata', { ...resource, metadata: null }],
    ['metadata', { ...resource, metadata: 'invalid' }],
    ['metadata', { ...resource, metadata: [] }],
    ['metadata.name', { ...resource, metadata: { namespace: 'test-ns' } }],
    ['metadata.name', { ...resource, metadata: { ...resource.metadata, name: '' } }],
    ['metadata.name', { ...resource, metadata: { ...resource.metadata, name: 42 } }],
    ['metadata.namespace', { ...resource, metadata: { name: 'test-resource' } }],
    ['metadata.namespace', { ...resource, metadata: { ...resource.metadata, namespace: '' } }],
    ['metadata.namespace', { ...resource, metadata: { ...resource.metadata, namespace: false } }],
    [
      'metadata.annotations',
      { ...resource, metadata: { ...resource.metadata, annotations: null } },
    ],
    [
      'metadata.annotations.custom',
      { ...resource, metadata: { ...resource.metadata, annotations: { custom: 42 } } },
    ],
    ['metadata.labels', { ...resource, metadata: { ...resource.metadata, labels: [] } }],
    [
      'metadata.labels.custom',
      { ...resource, metadata: { ...resource.metadata, labels: { custom: false } } },
    ],
    ['spec', { ...resource, spec: undefined }],
    ['spec', { ...resource, spec: null }],
    ['spec', { ...resource, spec: 'not-a-spec' }],
    ['spec', { ...resource, spec: 42 }],
    ['spec', { ...resource, spec: [] }],
  ])('should report invalid %s and return no model', (path, model) => {
    const result = convertYamlToResources(stringify(model));
    expect(result.resources.model).toBeUndefined();
    expect(result.error?.message).toContain(`Invalid Kubernetes resource YAML: ${path}:`);
  });

  it.each(['invalid: yaml:', `${stringify(resource)}---\n${stringify(resource)}`])(
    'should return an error for malformed YAML or multiple documents: %s',
    (yaml) => {
      const result = convertYamlToResources(yaml);
      expect(result.resources.model).toBeUndefined();
      expect(result.error).toBeInstanceOf(Error);
    },
  );
});

describe('getKindReferenceFromYaml', () => {
  it('should derive group, version, apiVersion, and kind from grouped resources', () => {
    expect(
      getKindReferenceFromYaml(
        stringify({
          ...resource,
          apiVersion: 'serving.kserve.io/v1beta1',
          kind: 'InferenceService',
        }),
      ),
    ).toEqual({
      apiVersion: 'serving.kserve.io/v1beta1',
      group: 'serving.kserve.io',
      version: 'v1beta1',
      kind: 'InferenceService',
    });
  });

  it('should derive core group kinds with an empty group', () => {
    expect(getKindReferenceFromYaml(stringify(resource))).toEqual({
      apiVersion: 'v1',
      group: '',
      version: 'v1',
      kind: 'ConfigMap',
    });
  });

  it.each([undefined, '', 'kind: MissingApiVersion', 'invalid: yaml:'])(
    'should return null when the YAML cannot produce a valid kind reference: %j',
    (yaml) => {
      expect(getKindReferenceFromYaml(yaml)).toBeNull();
    },
  );
});
