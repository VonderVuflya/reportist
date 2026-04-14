import { useMemo, useState } from 'react';

type JsonSchemaProperty = {
  type?: string;
  format?: string;
  description?: string;
};

type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

export type FieldOption = { value: string; label: string };

type Props = {
  schema: JsonSchemaObject;
  fieldOptions?: Record<string, FieldOption[]>;
  disabled?: boolean;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
};

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export function ParamsForm({ schema, fieldOptions, disabled, onSubmit }: Props) {
  const fields = useMemo(
    () => Object.entries(schema.properties ?? {}),
    [schema.properties],
  );
  const required = schema.required ?? [];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [name] of fields) initial[name] = '';
    return initial;
  });

  const handleChange = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues((prev) => ({ ...prev, [name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(values);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}
    >
      {fields.map(([name, prop]) => {
        const options = fieldOptions?.[name];
        const isRequired = required.includes(name);
        const label = (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              {humanize(name)}
              {isRequired && <span style={{ color: 'tomato' }}> *</span>}
            </span>
            {options ? (
              <select
                value={values[name] ?? ''}
                onChange={handleChange(name)}
                required={isRequired}
                disabled={disabled}
              >
                <option value=''>— choose —</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={prop.type === 'string' && prop.format === 'date' ? 'date' : 'text'}
                value={values[name] ?? ''}
                onChange={handleChange(name)}
                required={isRequired}
                disabled={disabled}
                placeholder={prop.description ?? ''}
              />
            )}
          </label>
        );
        return <div key={name}>{label}</div>;
      })}
      <button type='submit' disabled={disabled}>
        {disabled ? 'Running…' : 'Run'}
      </button>
    </form>
  );
}
