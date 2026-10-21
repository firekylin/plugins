# AI Content

Adds AI-assisted summary, title, rewrite and translation actions to the Firekylin article editor. The plugin is
provider-neutral and calls Firekylin's shared AI client; install and configure a compatible provider separately.

This plugin depends on the Core AI and editor action APIs in `firekylin/firekylin#919` and `#920`. Generated text
is applied only to the unsaved editor state, so an author can review it before saving or publishing. Existing MCP
abilities are not changed or duplicated.
