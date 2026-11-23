import { configureMonacoYaml, type MonacoYaml, type MonacoYamlOptions } from 'monaco-yaml';
import { ensureMonacoYamlEnvironment } from './ensureMonacoYamlEnvironment';
import { KindSchema } from './useKindSchema';

/** Stable model URI so future schema registration can `fileMatch` this path. */
export const DEPLOYMENT_WIZARD_YAML_MODEL_URI = 'file:///deployment-wizard.yaml';

export type ConfigureDeploymentWizardMonacoYamlOptions = Pick<MonacoYamlOptions, 'schemas'>;

type MonacoEditorInstance = Parameters<typeof configureMonacoYaml>[0];

declare global {
  interface Window {
    monaco?: MonacoEditorInstance;
  }
}

/**
 * Wires `monaco-yaml` for syntax-level validation in the deployment wizard YAML editor.
 * Passes an empty `schemas` array by default so schema-aware linting can be added later
 * without reworking this call site.
 *
 * Bundled Monaco is selected when the YAML editor module loads
 * (see ensureMonacoYamlEnvironment), so PatternFly does not download the CDN build.
 * The supplied editor instance is published on `window.monaco` after that setup so a
 * remote Monaco import cannot replace the instance Cypress reads.
 */
export const configureDeploymentWizardMonacoYaml = (
  monaco: MonacoEditorInstance,
  options: ConfigureDeploymentWizardMonacoYamlOptions = {},
): MonacoYaml => {
  ensureMonacoYamlEnvironment();
  const monacoYaml = configureMonacoYaml(monaco, {
    enableSchemaRequest: false,
    hover: true,
    completion: true,
    validate: true,
    schemas: options.schemas ?? [],
  });
  if (typeof window !== 'undefined') {
    window.monaco = monaco;
  }
  return monacoYaml;
};

export const buildDeploymentWizardYamlSchemas = (
  schema: KindSchema | null,
): NonNullable<MonacoYamlOptions['schemas']> => {
  if (!schema) {
    return [];
  }

  const normalizedSchema = normalizeLocalSchemaRefs(schema);

  return [
    {
      uri: 'file:///deployment-wizard-schema.json',
      fileMatch: [DEPLOYMENT_WIZARD_YAML_MODEL_URI],
      schema: inlineReferencedRootComponentSchema(normalizedSchema),
    },
  ];
};

const normalizeLocalSchemaRefs = (schema: KindSchema): KindSchema => {
  return Object.entries(schema).reduce<KindSchema>((acc, [key, value]) => {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('/components/')) {
      acc[key] = `#${value}`;
      return acc;
    }

    if (Array.isArray(value)) {
      acc[key] = value.map(normalizeSchemaValue);
      return acc;
    }

    if (isKindSchemaObject(value)) {
      acc[key] = normalizeLocalSchemaRefs(value);
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
};

const inlineReferencedRootComponentSchema = (schema: KindSchema): KindSchema => {
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/components/schemas/')) {
    return schema;
  }

  const schemaName = schema.$ref.replace('#/components/schemas/', '');
  const componentSchemas = getComponentSchemas(schema);

  const rootSchema = componentSchemas?.[schemaName];
  if (!rootSchema || typeof rootSchema !== 'object' || Array.isArray(rootSchema)) {
    return schema;
  }

  return {
    ...rootSchema,
    components: { schemas: componentSchemas },
  };
};

const getComponentSchemas = (schema: KindSchema): Record<string, KindSchema> | undefined => {
  const { components } = schema;
  if (typeof components !== 'object' || !components || Array.isArray(components)) {
    return undefined;
  }

  const schemas = 'schemas' in components ? components.schemas : undefined;
  if (!isKindSchemaRecord(schemas)) {
    return undefined;
  }

  return schemas;
};

const isKindSchemaRecord = (value: unknown): value is Record<string, KindSchema> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKindSchemaObject = (value: unknown): value is KindSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeSchemaValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaValue);
  }

  if (isKindSchemaObject(value)) {
    return normalizeLocalSchemaRefs(value);
  }

  return value;
};
