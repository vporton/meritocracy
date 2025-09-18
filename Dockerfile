FROM node:20-alpine

RUN apk update
RUN apk add openssl

WORKDIR /app

# Frontend URL
ENV VITE_FRONTEND_URL=https://socialism.fly.dev

# API Configuration
ENV VITE_API_URL=https://socialism.fly.dev:445

# TOD: Web3/Ethereum Configuration
ENV VITE_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id

# OAuth Configuration
ENV VITE_GITHUB_CLIENT_ID=Iv23liACVkYe3qylnSpT
ENV VITE_ORCID_CLIENT_ID=APP-CNFU262DB2VL0XQ3
ENV VITE_BITBUCKET_CLIENT_ID=PFdcCeTaGXXY723bfBuTe3deVJDstaf2
ENV VITE_GITLAB_CLIENT_ID=8a8b4b40b8d3d78ccde78b4c80ffd69db99ca6f022a42ac0159ab21c8d148da6

ENV VITE_ORCID_DOMAIN=orcid.org

COPY . ./
RUN npm install
RUN npm install --prefix backend
RUN npm install --prefix frontend
RUN npm run build

CMD ["npm", "start"]
#CMD ["sleep", "inf"]
