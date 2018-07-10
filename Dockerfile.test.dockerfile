FROM node:10.3.0

ARG YARN_VERSION=1.7.0
# These depdendencies below are installed for Electron which is used by Nightmare
RUN set -ex \
    && apt-get update \
    && apt-get install -y \
                          xvfb \
                          libgtk2.0 \
                          libxtst6 \
                          libxss1 \
                          libgconf2-4 \
                          libnss3 \
                          libasound2 \
    && npm install -g "yarn@${YARN_VERSION}"

WORKDIR /usr/src/app

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app

# Check that it builds
RUN yarn build

ARG DISPLAY=':99.0'
RUN yarn test:xvfb & yarn lint && yarn test:full
