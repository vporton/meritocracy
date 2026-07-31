#!/bin/sh

flyctl deploy -c deploy/fly.production.toml \
    --build-arg VITE_FRONTEND_URL=https://merit.science-dao.org \
    --build-arg VITE_API_URL=https://api.merit.science-dao.org \
    --build-arg VITE_WALLETCONNECT_PROJECT_ID=1b73cc17532df865d3f9377b3463fc42 \
    --build-arg VITE_ORCID_DOMAIN=orcid.org \
    --build-arg MY_MACHINE_IDS="$MY_MACHINE_IDS"
