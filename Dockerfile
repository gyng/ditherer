FROM node:10.3.0-alpine

ARG YARN_VERSION=1.2.1
RUN npm install -g "yarn@${YARN_VERSION}" superstatic

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
RUN yarn build:production

RUN apk del git

COPY superstatic.json /usr/src/app
EXPOSE 8080
CMD ["superstatic", "dist", "--port", "8080", "--host", "0.0.0.0", "--compression", "-c", "superstatic.json"]
