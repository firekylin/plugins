# Firekylin Marketplace

Browse, install, update, and remove trusted Firekylin plugins and themes from the administrator UI. This plugin requires
Firekylin's package-management core and the `packages:manage` permission. The default registry is the versioned
`registry.json` in the official `firekylin/plugins` repository.

Plugin installation is available on writable server and Docker deployments and requires a restart. Theme archives are
verified with SHA-512 before the core safely extracts them. Vercel installations are handled by a deployment adapter
instead of mutating the running function filesystem.

For Vercel, configure the `vercel-git` deployment adapter in the site's `firekylin.config.js` and install a protected
`repository_dispatch` workflow in its source repository. Marketplace actions then create a reviewed repository change;
merging it triggers the site's existing Vercel Git deployment.
