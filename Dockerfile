FROM node:7.5.0-alpine

RUN npm install -g yarn http-server

WORKDIR /usr/src/app

ARG NODE_ENV=production

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile

COPY . /usr/src/app
RUN yarn build

EXPOSE 8080
CMD ["http-server", "build"]
