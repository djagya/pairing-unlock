FROM node:10

EXPOSE 3000

WORKDIR /usr/app

# First install the dependencies, so it can be cached in a docker layer
COPY package*.json ./
RUN npm install

COPY . .

CMD [ "node", "server.js" ]