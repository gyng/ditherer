FROM node:11.3.0-alpine as builder

# If package.json uses git, uncomment this
# RUN apk update \
#     && apk upgrade \
#     && apk add --no-cache git

WORKDIR /usr/src/app

COPY package.json yarn.lock /usr/src/app/
RUN yarn install --frozen-lockfile \
    && yarn check --integrity \
    && yarn cache clean

ARG NODE_ENV=production
COPY . /usr/src/app
RUN yarn build:production



FROM node:11.3.0-alpine as runner

WORKDIR /usr/app

RUN yarn global add superstatic
COPY superstatic.json /usr/app
COPY --from=builder /usr/src/app/dist /usr/app

EXPOSE 8080
CMD ["superstatic", ".", "--port", "8080", "--host", "0.0.0.0", "--compression", "-c", "superstatic.json"]
