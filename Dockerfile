FROM node:7.5.0-alpine

ARG YARN_VERSION=0.20.3
RUN npm install -g "yarn@${YARN_VERSION}" http-server

WORKDIR /usr/src/app

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app
RUN yarn build

EXPOSE 8080
CMD ["http-server", "build"]
