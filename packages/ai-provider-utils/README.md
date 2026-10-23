# Firekylin AI provider utilities

Shared usage normalization for independently installable provider plugins. This is a library, not a
provider plugin. It does not make network requests, select models, store credentials, write audit logs,
or estimate fees.

## Standard protocols

```js
const {chatUsage: {metadata, failure}} = require('firekylin-ai-provider-utils');
// OpenAI Responses uses responsesUsage instead.
return {text, usage: payload.usage, ...metadata(payload.usage, response)};
```

`chatUsage` maps Chat Completions fields; `responsesUsage` maps Responses API fields. Both expose
`metadata(usage, response?)` and `failure(message, response?, usage?)`. Native `usage` remains owned by
the provider and is not mutated. Errors keep their message and attach only a request ID and, if supplied,
normalized usage; never a complete response.

## Provider differences

Declare only fields that differ from the protocol, using dotted paths, ordered fallback paths, or
accessor functions for protocol-specific arithmetic:

```js
const {createUsageAdapter, CHAT_COMPLETION_FIELDS} = require('firekylin-ai-provider-utils');
module.exports = createUsageAdapter({...CHAT_COMPLETION_FIELDS,
  cacheReadTokens: ['prompt_cache_hit_tokens', CHAT_COMPLETION_FIELDS.cacheReadTokens]
});
```

Canonical fields: `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens`,
`reasoningTokens`. Unmapped, missing, negative, fractional, unsafe or non-numeric values become `null`;
reported zero remains zero. Total is derived with `sumTokens` only if both input/output are known.
Details are not automatically added to totals: input/output mappings must account for whether their
native protocol includes cache or reasoning counts. For example, Anthropic adds cache reads/writes
to its native input count, while Gemini adds thoughts to its candidate output count.

`sumTokens(...counts)` returns null if any count is unknown or invalid, or the sum overflows a safe
integer. It does not guess missing counts. Any protocol-defined absent-as-zero behavior belongs in the
provider accessor (not in shared normalization).

`createUsageAdapter(fields, {requestIdHeaders})` optionally selects request-ID headers. Defaults are
`x-request-id`, `request-id`, `cf-ray`; no other headers are retained. Adapter declarations are snapshotted
so changing one provider's mapping does not affect another provider.

## Verification and release

Run this package's `npm test` for normalization tests, then repository-root `npm test` for the real-client
contracts across all providers. This library has no build step. Publish it before dependent provider
versions; providers declare a normal npm semver dependency rather than a workspace-only protocol.
