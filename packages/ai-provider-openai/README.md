# OpenAI AI Provider

Connects Firekylin's internal AI service API to the OpenAI Responses API. It requires a Firekylin build containing
the AI provider API from `firekylin/firekylin#919`; the package also fails closed when that API is unavailable.

After installation, open **AI 连接**, select **OpenAI**, save an API key and endpoint, then use **测试连接**.
Choose a model and explicitly set it as the global default on the same page; saving connection settings alone
does not change the default. Password fields are never returned to the browser after saving and the key
is stored through Firekylin's encrypted, plugin-scoped credential store.

For production, set `FIREKYLIN_AI_CREDENTIAL_KEY` to a stable secret before saving credentials.
