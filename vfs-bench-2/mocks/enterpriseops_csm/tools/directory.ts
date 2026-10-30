/**
 * CSM's directory tools: ports of `CSMManager`'s methods and their routes
 * (sn-csm-server's database/csm_manager.py and apis/csm_apis.py, read from
 * the image's bytecode).
 */
import type { Tool } from '../../enterpriseops/fake.ts'

export const tools: Record<string, Tool> = {}
