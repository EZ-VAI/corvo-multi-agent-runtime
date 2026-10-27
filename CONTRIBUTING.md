# Contributing

This repository is assembled from historical Corvo source. Please keep contributions focused on the multi-agent runtime and its supporting integrations.

For proposed changes, explain the problem, the expected behavior, and how the change was tested. Run `node --test tests/*.test.js` before submitting. Tests must not use real customer data, contact production services, or incur model or rendering charges.

Never commit environment files, credentials, session data, generated customer content, or production-specific endpoints. New integrations should be configured explicitly and fail safely when credentials are absent.
