/** Account providers expose protocol settings without an API-key reference. */
import { deepSeekConfigFields, type Config as ProtocolConfig } from '@deepseek-ai/dsh-llm-deepseek'
import z from '@deepseek-ai/schemastery'

/** Account route configuration; authentication comes exclusively from the account service. */
export type Config = ProtocolConfig
export const Config = z.object(deepSeekConfigFields)
