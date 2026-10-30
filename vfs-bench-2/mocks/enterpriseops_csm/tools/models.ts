/**
 * The `Literal` types of upstream's CSM models (models/csm_models.py), in
 * upstream's order, which a validation error lists them in.
 */
export const ROLE = ['admin', 'agent', 'manager', 'customer'] as const
export const ACCOUNT_TYPE = ['customer', 'partner', 'internal'] as const
export const CITY = ['New_York', 'London', 'Mumbai', 'Tokyo', 'Sydney'] as const
export const COUNTRY = ['Usa', 'Uk', 'India', 'Japan', 'Australia'] as const
export const GROUP_TYPE = ['support', 'backoffice', 'field', 'vendor'] as const
export const CATEGORY = ['software', 'hardware', 'service'] as const
export const LIFECYCLE = ['active', 'retired'] as const
export const CASE_CHANNEL = ['web', 'email', 'phone', 'chat', 'social', 'alert', 'community'] as const
export const CASE_PRIORITY = ['critical', 'high', 'moderate', 'low'] as const
export const CASE_STATE = ['new', 'in_progress', 'pending', 'resolved', 'closed', 'canceled'] as const
export const ESC_REASON = ['urgency', 'vip', 'impact', 'breach_risk', 'customer_request'] as const
export const CONTRACT_TYPE = ['support', 'warranty', 'subscription'] as const
export const CONTRACT_STATUS = ['draft', 'active', 'suspended', 'expired'] as const
export const SUPPORT_LEVEL = ['standard', 'premium', 'enterprise'] as const
export const COVERAGE_HOURS = ['h8x5', 'h12x6', 'h24x7'] as const
export const SLA_METRIC = ['response', 'resolution'] as const
export const PRIORITY = ['critical', 'high', 'moderate', 'low'] as const
