import { fieldDocsFromSchema } from '@shared/jsonFields'
import type { FieldDoc } from '@shared/types'

export async function modelDocumentation(projectId: string, modelId: string): Promise<{ raw: string; field_docs: FieldDoc[] }> {
  const result = await window.api.models.resolveRefs(projectId, { $ref: `kindraapi://model/${modelId}` })
  if (!result.ok) throw new Error(result.error)
  if (result.data.warnings.length) throw new Error(result.data.warnings.map(w => w.message).join('；'))
  const generated = await window.api.models.generateFromSchema(projectId, result.data.schema)
  if (!generated.ok) throw new Error(generated.error)
  return { raw: JSON.stringify(generated.data.value, null, 2), field_docs: fieldDocsFromSchema(result.data.schema) }
}
