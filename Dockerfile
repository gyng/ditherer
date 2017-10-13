FROM node:8.7.0-alpine

ARG YARN_VERSION=1.2.1
RUN npm install -g "yarn@${YARN_VERSION}" http-server

RUN apk update \
    && apk upgrade \
    && apk add --no-cache git

WORKDIR /usr/src/app

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app
RUN yarn build

RUN apk del git

EXPOSE 8080
CMD ["http-server", "build"]
