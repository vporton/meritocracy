FROM node:20-alpine

WORKDIR /app

COPY . ./
RUN npm install --production
RUN npm install --prefix backend --production
RUN npm install --prefix frontend --production
RUN npm run build

CMD ["npm", "start"]
