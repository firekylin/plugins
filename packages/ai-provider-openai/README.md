# OpenAI AI Provider

Connects Firekylin's internal AI service API to the OpenAI Responses API. It requires a Firekylin build containing
the AI provider API from `firekylin/firekylin#919`; the package also fails closed when that API is unavailable.

After installation, open **OpenAI → OpenAI 设置** in the administration area, save an API key and endpoint,
then use **测试连接**. Choose the default Provider and model on the unified **AI 服务** page; saving connection settings does not change the default. Password fields are never returned to the browser after saving and the key
is stored through Firekylin's encrypted, plugin-scoped credential store.

For production, set `FIREKYLIN_AI_CREDENTIAL_KEY` to a stable secret before saving credentials.
