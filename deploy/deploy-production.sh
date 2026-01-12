#!/bin/sh

flyctl deploy -c deploy/fly.production.toml \
    --build-arg VITE_FRONTEND_URL=https://merit.science-dao.org \
    --build-arg VITE_API_URL=https://merit.science-dao.org:445 \
    --build-arg VITE_WALLETCONNECT_PROJECT_ID=1b73cc17532df865d3f9377b3463fc42 \
    --build-arg VITE_GITHUB_CLIENT_ID=Iv23liACVkYe3qylnSpT \
    --build-arg VITE_ORCID_CLIENT_ID=APP-CNFU262DB2VL0XQ3 \
    --build-arg VITE_BITBUCKET_CLIENT_ID=PFdcCeTaGXXY723bfBuTe3deVJDstaf2 \
    --build-arg VITE_GITLAB_CLIENT_ID=8a8b4b40b8d3d78ccde78b4c80ffd69db99ca6f022a42ac0159ab21c8d148da6 \
    --build-arg VITE_ORCID_DOMAIN=orcid.org