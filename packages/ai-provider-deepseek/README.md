# DeepSeek AI Provider

Connects Firekylin's internal AI service API to DeepSeek's Chat Completions API. It requires a Firekylin build containing the AI provider API from `firekylin/firekylin#919` and fails closed without it.

After installation, open **DeepSeek → DeepSeek 设置** in the administration area. Save your API key, then click **测试连接**. Choose the default Provider and model on the unified **AI 服务** page; saving connection settings does not change the default. The default endpoint is `https://api.deepseek.com`; a custom HTTPS endpoint can be configured. The saved key is never returned to the browser and is stored through Firekylin's encrypted, plugin-scoped credential store.

For production, set `FIREKYLIN_AI_CREDENTIAL_KEY` to a stable secret before saving credentials. The connection test makes a small, billable request to DeepSeek. Do not put API keys in Git or PR comments.
