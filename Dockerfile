FROM node:20-alpine

RUN apk update
RUN apk add openssl

WORKDIR /app

COPY . ./
RUN npm install --production
RUN npm install --prefix backend --production
RUN npm install --prefix frontend --production
RUN npm run build

CMD ["npm", "start"]
