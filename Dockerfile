FROM node:20-alpine

RUN apk update
RUN apk add openssl

WORKDIR /app

# API Configuration
ENV VITE_API_URL=https://socialism.fly.dev:445

# TOD: Web3/Ethereum Configuration
ENV VITE_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id

# OAuth Configuration
ENV VITE_GITHUB_CLIENT_ID=Ov23libRKEfPqNB345e0
ENV VITE_ORCID_CLIENT_ID=APP-CNFU262DB2VL0XQ3
ENV VITE_BITBUCKET_CLIENT_ID=PFdcCeTaGXXY723bfBuTe3deVJDstaf2
ENV VITE_GITLAB_CLIENT_ID=9f2ec00bfdcc86eaa10d2973e0dffb0d50c4c0072a6e7544c2fc10c08c2579d0

ENV VITE_ORCID_DOMAIN=orcid.org

# OAuth Redirect URIs
ENV VITE_GITHUB_REDIRECT_URI=https://socialism.fly.dev:445/auth/github/callback
ENV VITE_ORCID_REDIRECT_URI=https://socialism.fly.dev:445/auth/orcid/callback
ENV VITE_BITBUCKET_REDIRECT_URI=https://socialism.fly.dev:445/auth/bitbucket/callback
ENV VITE_GITLAB_REDIRECT_URI=https://socialism.fly.dev:445/auth/gitlab/callback

COPY . ./
RUN npm install --production
RUN npm install --prefix backend --production
RUN npm install --prefix frontend --production
RUN npm run build

CMD ["npm", "start"]
