# Firekylin Marketplace

Browse, install, update, and remove trusted Firekylin plugins and themes from the administrator UI. This plugin requires
Firekylin's package-management core and the `packages:manage` permission. The default registry is the versioned
`registry.json` in the official `firekylin/plugins` repository.

Plugin installation is available on writable server and Docker deployments and requires a restart. Theme archives are
verified with SHA-512 before the core safely extracts them. Vercel installations are handled by a deployment adapter
instead of mutating the running function filesystem.
