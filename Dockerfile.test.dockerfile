FROM node:11.3.0-alpine

WORKDIR /usr/src/app

# If package.json uses git, uncomment this
# RUN apk update \
#     && apk upgrade \
#     && apk add --no-cache git

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app

# Check that it builds
RUN yarn build

RUN yarn audit && yarn lint && yarn test:coverage
