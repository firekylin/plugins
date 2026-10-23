# DeepSeek AI Provider

Connects Firekylin's internal AI service API to DeepSeek's Chat Completions API. It requires a Firekylin build containing the AI provider API from `firekylin/firekylin#919` and fails closed without it.

After installation, open **AI 连接**, select **DeepSeek**, save your API key and click **测试连接**. You can also choose a model and explicitly set it as the global default on the same page. Saving connection settings alone does not change the default. The default endpoint is `https://api.deepseek.com`; a custom HTTPS endpoint can be configured. The saved key is never returned to the browser and is stored through Firekylin's encrypted, plugin-scoped credential store.

For production, set `FIREKYLIN_AI_CREDENTIAL_KEY` to a stable secret before saving credentials. The connection test makes a small, billable request to DeepSeek. Do not put API keys in Git or PR comments.
