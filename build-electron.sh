#!/bin/bash
set -e

# build rowboat-www Next.js app
(cd apps/rowboat-www && \
    npm install && \
    npm run build)

# build rowboat server
(cd apps/cli && \
    npm install && \
    npm run build)
