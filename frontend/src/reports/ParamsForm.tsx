import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type JsonSchemaProperty = {
  type?: string
  format?: string
  description?: string
}

type JsonSchemaObject = {
  type?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type FieldOption = { value: string; label: string }

type Props = {
  schema: JsonSchemaObject
  fieldOptions?: Record<string, FieldOption[]>
  disabled?: boolean
  onSubmit: (values: Record<string, string>) => void | Promise<void>
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}

export function ParamsForm({
  schema,
  fieldOptions,
  disabled,
  onSubmit,
}: Props) {
  const fields = useMemo(
    () => Object.entries(schema.properties ?? {}),
    [schema.properties],
  )
  const required = schema.required ?? []

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const [name] of fields) initial[name] = ''
    return initial
  })

  const setValue = (name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await onSubmit(values)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className='flex flex-col gap-4 max-w-md'
    >
      {fields.map(([name, prop]) => {
        const options = fieldOptions?.[name]
        const isRequired = required.includes(name)
        const inputId = `param-${name}`
        return (
          <div key={name} className='flex flex-col gap-2'>
            <Label htmlFor={inputId}>
              {humanize(name)}
              {isRequired && (
                <span className='ml-0.5 text-destructive'>*</span>
              )}
            </Label>
            {options ? (
              <Select
                value={values[name] ?? ''}
                onValueChange={v => setValue(name, v)}
                disabled={disabled}
                required={isRequired}
              >
                <SelectTrigger id={inputId} className='w-full'>
                  <SelectValue placeholder='— choose —' />
                </SelectTrigger>
                <SelectContent>
                  {options.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={inputId}
                type={
                  prop.type === 'string' && prop.format === 'date'
                    ? 'date'
                    : 'text'
                }
                value={values[name] ?? ''}
                onChange={e => setValue(name, e.target.value)}
                required={isRequired}
                disabled={disabled}
                placeholder={prop.description ?? ''}
              />
            )}
          </div>
        )
      })}
      <Button type='submit' disabled={disabled} className='self-start'>
        {disabled ? 'Running…' : 'Run'}
      </Button>
    </form>
  )
}
