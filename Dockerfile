FROM node:20-alpine

RUN apt update
RUN apt install -y openssl

WORKDIR /app

COPY . ./
RUN npm install --production
RUN npm install --prefix backend --production
RUN npm install --prefix frontend --production
RUN npm run build

CMD ["npm", "start"]
